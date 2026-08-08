import { Types } from 'mongoose';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { ConversationPlaybookBuilderService } from './conversation-playbook-builder.service';

describe('ConversationPlaybookBuilderService', () => {
  const userId = new Types.ObjectId().toString();
  const conversationId = new Types.ObjectId().toString();
  const questionId = new Types.ObjectId();
  const assistantId = new Types.ObjectId();

  function createService(overrides?: { ownerId?: string; completion?: string }) {
    const conversationService = {
      findById: jest.fn().mockResolvedValue({
        id: conversationId,
        createdBy: overrides?.ownerId ?? userId,
        workspaces: ['workspace-1'],
      }),
    };
    const question = {
      _id: questionId,
      conversationId: new Types.ObjectId(conversationId),
      conversationType: 'user',
      content: 'How should incidents be handled?',
    };
    const assistant = {
      _id: assistantId,
      conversationId: new Types.ObjectId(conversationId),
      conversationType: 'ai',
      isComplete: true,
      isStreaming: false,
      questionMessageId: questionId,
      components: [{ type: 'text', data: { content: 'Triage, contain, recover, and review.' } }],
    };
    const messageService = {
      getMessageDocument: jest.fn(async (id: string) => id === assistantId.toString() ? assistant : question),
    };
    const settingsService = {
      resolvePlaybookSuggestor: jest.fn().mockResolvedValue({
        model: 'suggestor-model',
        temperature: 0.2,
        instruction: 'Suggest operational playbooks.',
      }),
    };
    const chatCompletionService = {
      completeText: jest.fn().mockResolvedValue(
        overrides?.completion ?? JSON.stringify({ name: 'Incident response', prompt: 'Define inputs, triage, containment, recovery, decisions, outputs, and failure handling.' }),
      ),
    };
    const designService = {
      generateFlow: jest.fn().mockResolvedValue({ id: 'playbook-1' }),
    };
    const idempotencyService = {
      reserveSave: jest.fn().mockResolvedValue({ type: 'reserved' }),
      confirmSaveResult: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
    };
    return {
      service: new ConversationPlaybookBuilderService(
        conversationService as never,
        messageService as never,
        settingsService as never,
        chatCompletionService as never,
        designService as never,
        idempotencyService as never,
      ),
      chatCompletionService,
      designService,
      idempotencyService,
    };
  }

  it('reformulates the persisted pair and invokes the existing autobuilder', async () => {
    const { service, chatCompletionService, designService } = createService();

    await expect(service.build(userId, conversationId, assistantId.toString(), 'original')).resolves.toEqual({ id: 'playbook-1' });

    expect(chatCompletionService.completeText).toHaveBeenCalledWith(
      expect.stringContaining('How should incidents be handled?'),
      expect.objectContaining({ modelId: 'suggestor-model', temperature: 0.2 }),
    );
    expect(designService.generateFlow).toHaveBeenCalledWith(
      userId,
      'Incident response',
      expect.stringContaining('failure handling'),
      ['workspace-1'],
    );
  });

  it('normalizes the runtime ObjectId user before ownership checks', async () => {
    const { service, designService } = createService();

    await expect(service.build(new Types.ObjectId(userId), conversationId, assistantId.toString(), 'original'))
      .resolves.toEqual({ id: 'playbook-1' });
    expect(designService.generateFlow).toHaveBeenCalledWith(
      userId,
      expect.any(String),
      expect.any(String),
      ['workspace-1'],
    );
  });

  it('uses a validated user name override while preserving the suggested prompt', async () => {
    const { service, designService } = createService();

    await service.build(userId, conversationId, assistantId.toString(), 'original', 'My response workflow');

    expect(designService.generateFlow).toHaveBeenCalledWith(
      userId,
      'My response workflow',
      expect.stringContaining('failure handling'),
      ['workspace-1'],
    );
  });

  it('rejects access by a non-owner before invoking the suggestor', async () => {
    const { service, chatCompletionService } = createService({ ownerId: new Types.ObjectId().toString() });

    await expect(service.build(userId, conversationId, assistantId.toString(), 'original')).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    expect(chatCompletionService.completeText).not.toHaveBeenCalled();
  });

  it('does not invoke the autobuilder for malformed suggestor output', async () => {
    const { service, designService } = createService({ completion: 'not json' });

    await expect(service.build(userId, conversationId, assistantId.toString(), 'original')).rejects.toMatchObject({ code: ErrorCode.PLAYBOOK_SUGGESTION_INVALID });
    expect(designService.generateFlow).not.toHaveBeenCalled();
  });

  it('uses the explicitly selected persisted correction attempt', async () => {
    const { service, chatCompletionService } = createService();
    const assistant = await (service as any).messageService.getMessageDocument(assistantId.toString());
    assistant.correctionWorkflow = {
      activeVersion: 'corrected',
      attempts: [{
        attemptId: 'attempt-2',
        components: [{ type: 'text', data: { content: 'Selected corrected workflow' } }],
      }],
    };

    await service.build(userId, conversationId, assistantId.toString(), 'attempt:attempt-2');

    expect(chatCompletionService.completeText).toHaveBeenCalledWith(
      expect.stringContaining('Selected corrected workflow'),
      expect.any(Object),
    );
  });

  it('returns the existing playbook for a repeated build claim', async () => {
    const { service, idempotencyService, chatCompletionService } = createService();
    idempotencyService.reserveSave.mockResolvedValue({
      type: 'duplicate',
      responseBody: { id: 'playbook-existing' },
    });

    await expect(service.build(userId, conversationId, assistantId.toString(), 'original'))
      .resolves.toEqual({ id: 'playbook-existing' });
    expect(chatCompletionService.completeText).not.toHaveBeenCalled();
  });
});
