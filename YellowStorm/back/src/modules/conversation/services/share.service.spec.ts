import { Types } from 'mongoose';
import { ShareService } from './share.service';
import type { EmbeddedMessage } from '../interfaces/share.interface';
import type { MessageComponent } from '../interfaces/message.interface';

describe('ShareService public share sanitization', () => {
  let sharedConversationModel: { create: jest.Mock; findOne: jest.Mock };
  let conversationModel: { findById: jest.Mock };
  let messageModel: { find: jest.Mock };
  let service: ShareService;

  const now = new Date('2026-07-15T10:00:00.000Z');
  const conversationId = new Types.ObjectId();
  const shareId = new Types.ObjectId();
  const userId = new Types.ObjectId().toString();

  const components: MessageComponent[] = [
    { id: 'activity', type: 'agentActivity', data: { summary: 'Preparing answer', detail: 'Private reasoning', status: 'completed' } },
    { id: 'tool', type: 'toolActivity', data: { toolName: 'activate_skill', paramsJson: '{"secret":"value"}', resultJson: '{"private":true}' } },
    { id: 'artifact', type: 'artifact', data: { artifactId: 'artifact-1', filename: 'private.pdf', storagePath: 'owner/run/private.pdf' } },
    { id: 'task', type: 'task', data: { title: 'Smart Agent', items: ['Raw private context'], status: 'completed' } },
    { id: 'answer', type: 'text', data: { content: 'Public answer' } },
    { id: 'choice', type: 'choice', data: { prompt: 'Continue?' } },
  ];
  const unknownComponent = { id: 'debug', type: 'debug', data: { content: 'Internal debug payload' } } as unknown as MessageComponent;

  beforeEach(() => {
    sharedConversationModel = {
      create: jest.fn(),
      findOne: jest.fn(),
    };
    conversationModel = {
      findById: jest.fn().mockResolvedValue({ _id: conversationId, title: 'Shared title' }),
    };
    messageModel = {
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([{
            conversationType: 'ai',
            content: 'Internal instructions',
            components: [...components, unknownComponent],
            modelId: 'model-1',
            createdAt: now,
          }]),
        }),
      }),
    };

    service = new ShareService(
      sharedConversationModel as never,
      conversationModel as never,
      messageModel as never,
      { get: jest.fn().mockReturnValue(30) } as never,
      { setContext: jest.fn(), log: jest.fn(), error: jest.fn() } as never,
    );
  });

  it('removes internal components before persisting a public share snapshot', async () => {
    const shared = {
      _id: shareId,
      originalConversationId: conversationId,
      sharedBy: new Types.ObjectId(userId),
      shareType: 'public',
      title: 'Shared title',
      accessToken: 'token',
      viewCount: 0,
      isRevoked: false,
      createdAt: now,
      updatedAt: now,
    };
    sharedConversationModel.create.mockResolvedValue(shared);

    await service.createShare(userId, { conversationId: conversationId.toString(), shareType: 'public' });

    const snapshot = sharedConversationModel.create.mock.calls[0][0].messages as EmbeddedMessage[];
    expect(snapshot[0].components).toEqual([
      { ...components[0], data: { summary: 'Preparing answer', status: 'completed' } },
      { ...components[1], data: { toolName: 'activate_skill' } },
      { ...components[3], data: { ...components[3].data, items: [] } },
      components[4],
      components[5],
    ]);
    expect(snapshot[0].content).toBeUndefined();
  });

  it('removes internal components from legacy snapshots without mutating them', async () => {
    const legacyMessages: EmbeddedMessage[] = [
      { conversationType: 'ai', content: 'Internal instructions', components: [...components, unknownComponent], modelId: 'model-1', createdAt: now },
      { conversationType: 'user', content: 'Hello', createdAt: now },
      { conversationType: 'ai', components: [components[0]], createdAt: now },
    ];
    const share = {
      _id: shareId,
      title: 'Shared title',
      sharedBy: new Types.ObjectId(userId),
      messages: legacyMessages,
      viewCount: 3,
      isRevoked: false,
      createdAt: now,
      save: jest.fn().mockResolvedValue(undefined),
    };
    sharedConversationModel.findOne.mockResolvedValue(share);

    const result = await service.viewPublicShare('token');

    expect(result.messages[0].components).toEqual([
      { ...components[0], data: { summary: 'Preparing answer', status: 'completed' } },
      { ...components[1], data: { toolName: 'activate_skill' } },
      { ...components[3], data: { ...components[3].data, items: [] } },
      components[4],
      components[5],
    ]);
    expect(result.messages[0].content).toBeUndefined();
    expect(result.messages[1]).toEqual(legacyMessages[1]);
    expect(result.messages[2].components).toEqual([
      { ...components[0], data: { summary: 'Preparing answer', status: 'completed' } },
    ]);
    expect(share.messages).toEqual(legacyMessages);
    expect(share.save).toHaveBeenCalledTimes(1);
  });
});
