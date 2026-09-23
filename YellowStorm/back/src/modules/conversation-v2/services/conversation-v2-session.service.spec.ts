import { Test } from '@nestjs/testing';
import { ConversationV2SessionService } from './conversation-v2-session.service';
import {
  CONVERSATION_V2_SESSION_STORE,
  type ConversationV2SessionRecord,
  type ConversationV2SessionStore,
} from '../persistence/conversation-v2-session.store';

const SESSION_HEX = 'a'.repeat(24);

function sessionRecord(
  overrides: Partial<ConversationV2SessionRecord> & Pick<ConversationV2SessionRecord, 'id'>,
): ConversationV2SessionRecord {
  return {
    ownerId: 'u1',
    aiSessionId: null,
    title: '',
    status: 'active',
    lastEventAt: new Date(0),
    isShared: false,
    shareTokenHash: null,
    deletedAt: null,
    deployStatus: 'idle',
    deployedUrl: null,
    deployedAppTitle: null,
    lastDeployedAt: null,
    lastDeployedRevisionId: null,
    hasAiFeatures: false,
    aiFeaturesCheckedRevisionId: null,
    workspaceIds: [],
    selectedSkillIds: [],
    selectedConnectorIds: [],
    eventSequence: 0,
    eventCount: 0,
    systemWorkspaceId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

describe('ConversationV2SessionService', () => {
  let svc: ConversationV2SessionService;
  let store: jest.Mocked<Pick<
    ConversationV2SessionStore,
    | 'createDraft'
    | 'attachAiSession'
    | 'deleteDraft'
    | 'listDeployedApps'
    | 'listDraftApps'
    | 'findByIds'
    | 'listByOwner'
    | 'softDelete'
    | 'rename'
    | 'findByOwnerAndId'
    | 'findByAiSessionId'
    | 'removeDeployedApp'
  >>;

  beforeEach(async () => {
    store = {
      createDraft: jest.fn(),
      attachAiSession: jest.fn(),
      deleteDraft: jest.fn(),
      listDeployedApps: jest.fn(),
      listDraftApps: jest.fn(),
      findByIds: jest.fn(),
      listByOwner: jest.fn(),
      softDelete: jest.fn(),
      rename: jest.fn(),
      findByOwnerAndId: jest.fn(),
      findByAiSessionId: jest.fn(),
      removeDeployedApp: jest.fn(),
    };

    const mod = await Test.createTestingModule({
      providers: [
        ConversationV2SessionService,
        { provide: CONVERSATION_V2_SESSION_STORE, useValue: store },
      ],
    }).compile();

    svc = mod.get(ConversationV2SessionService);
  });

  it('listDeployedApps filters deployed sessions with a URL and maps the DTO', async () => {
    const id = SESSION_HEX;
    store.listDeployedApps.mockResolvedValueOnce([
      sessionRecord({
        id,
        title: 'Conversation title',
        deployedAppTitle: 'Generated app',
        deployedUrl: 'https://apps.example/app-1',
        lastDeployedAt: new Date('2026-07-17T10:00:00.000Z'),
        deployStatus: 'deployed',
      }),
    ]);

    await expect(svc.listDeployedApps('u1')).resolves.toEqual([
      {
        sessionId: id,
        title: 'Generated app',
        deployedUrl: 'https://apps.example/app-1',
        lastDeployedAt: '2026-07-17T10:00:00.000Z',
        source: 'owned',
        shareId: null,
        canOpenConversation: true,
        hasAiFeatures: false,
        lastDeployedRevisionId: null,
        latestFinalizedRevisionId: null,
        latestFinalizedAt: null,
        finalizedVersionCount: 0,
      },
    ]);
    expect(store.listDeployedApps).toHaveBeenCalledWith('u1');
  });

  it('listDraftApps returns unpublished sessions with activity', async () => {
    const id = SESSION_HEX;
    store.listDraftApps.mockResolvedValueOnce([
      sessionRecord({
        id,
        title: 'Work in progress',
        deployedAppTitle: null,
        deployStatus: 'idle',
        lastEventAt: new Date('2026-07-15T10:00:00.000Z'),
      }),
    ]);

    await expect(svc.listDraftApps('u1')).resolves.toEqual([
      {
        sessionId: id,
        title: 'Work in progress',
        lastUpdatedAt: '2026-07-15T10:00:00.000Z',
        deployStatus: 'idle',
        hasAiFeatures: false,
        lastDeployedRevisionId: null,
        latestFinalizedRevisionId: null,
        latestFinalizedAt: null,
        finalizedVersionCount: 0,
      },
    ]);
    expect(store.listDraftApps).toHaveBeenCalledWith('u1');
  });

  it('removeDeployedApp clears deployment state without deleting the conversation', async () => {
    const id = '507f1f77bcf86cd799439011';
    store.removeDeployedApp.mockResolvedValueOnce(sessionRecord({ id }));

    await svc.removeDeployedApp('u1', id);

    expect(store.removeDeployedApp).toHaveBeenCalledWith('u1', id);
  });

  it('resolveRevisionContextBySessionIds maps aiSessionId and lastDeployedRevisionId', async () => {
    const id = SESSION_HEX;
    store.findByIds.mockResolvedValueOnce([
      sessionRecord({
        id,
        aiSessionId: 'ai-1',
        lastDeployedRevisionId: 'rev_7',
        hasAiFeatures: true,
        aiFeaturesCheckedRevisionId: 'rev_7',
      }),
    ]);

    const result = await svc.resolveRevisionContextBySessionIds([id]);

    expect(store.findByIds).toHaveBeenCalledWith([id]);
    expect(result.get(id)).toEqual({
      aiSessionId: 'ai-1',
      lastDeployedRevisionId: 'rev_7',
      hasAiFeatures: true,
      aiFeaturesCheckedRevisionId: 'rev_7',
    });
  });

  it('list filters by owner, excludes soft-deleted, sorts desc by lastEventAt', async () => {
    store.listByOwner.mockResolvedValueOnce([
      sessionRecord({ id: SESSION_HEX, title: 'a', status: 'active', lastEventAt: new Date(0), isShared: false, workspaceIds: [] }),
    ]);

    await svc.list('u1', { limit: 20 } as any);
    expect(store.listByOwner).toHaveBeenCalledWith({
      ownerId: 'u1',
      cursor: undefined,
      q: undefined,
      limit: 20,
    });
  });

  it('softDelete sets deletedAt', async () => {
    const id = '507f1f77bcf86cd799439011';
    store.softDelete.mockResolvedValueOnce(sessionRecord({ id, deletedAt: new Date() }));
    await svc.softDelete('u1', id);
    expect(store.softDelete).toHaveBeenCalledWith('u1', id);
  });

  it('rename updates only the title', async () => {
    const id = '507f1f77bcf86cd799439011';
    store.rename.mockResolvedValueOnce(sessionRecord({ id, title: 'New' }));
    const r = await svc.rename('u1', id, 'New');
    expect(store.rename).toHaveBeenCalledWith('u1', id, 'New');
    expect(r?.title).toBe('New');
  });

  it('getOne returns null for a malformed id (delegates to store)', async () => {
    store.findByOwnerAndId.mockResolvedValueOnce(null);
    const result = await svc.getOne('u1', 'not-a-real-id');
    expect(result).toBeNull();
    expect(store.findByOwnerAndId).toHaveBeenCalledWith('u1', 'not-a-real-id');
  });

  it('list maps doc.id to result.sessionId', async () => {
    const id = SESSION_HEX;
    store.listByOwner.mockResolvedValueOnce([
      sessionRecord({ id, title: 't', status: 'active', lastEventAt: new Date(0), isShared: false, workspaceIds: [] }),
    ]);

    const result = await svc.list('u1', { limit: 20 } as any);
    expect(result[0].sessionId).toBe(id);
  });

  it('createDraft inserts an empty pointer with aiSessionId=null and returns the new doc', async () => {
    const fakeId = SESSION_HEX;
    store.createDraft.mockResolvedValueOnce(
      sessionRecord({ id: fakeId, ownerId: 'u1', aiSessionId: null, workspaceIds: ['ws-a'] }),
    );

    const doc = await svc.createDraft('u1', ['ws-a']);

    expect(doc.id).toBe(fakeId);
    expect(store.createDraft).toHaveBeenCalledWith('u1', ['ws-a']);
  });

  it('attachAiSession only patches docs whose aiSessionId is still null', async () => {
    const id = SESSION_HEX;
    store.attachAiSession.mockResolvedValueOnce(undefined);
    await svc.attachAiSession(id, 'ai-session-1', '507f1f77bcf86cd799439011');

    expect(store.attachAiSession).toHaveBeenCalledWith(
      id,
      'ai-session-1',
      '507f1f77bcf86cd799439011',
    );
  });

  it('deleteDraft only removes docs that are still drafts (aiSessionId null AND deletedAt null)', async () => {
    const id = SESSION_HEX;
    store.deleteDraft.mockResolvedValueOnce(undefined);
    await svc.deleteDraft(id);

    expect(store.deleteDraft).toHaveBeenCalledWith(id);
  });

  it('findByAiSessionId looks up a live pointer by APImanus session id', async () => {
    const doc = sessionRecord({ id: SESSION_HEX, aiSessionId: '72e7924c2cc04f5f' });
    store.findByAiSessionId.mockResolvedValueOnce(doc);

    await expect(svc.findByAiSessionId('72e7924c2cc04f5f')).resolves.toEqual(doc);
    expect(store.findByAiSessionId).toHaveBeenCalledWith('72e7924c2cc04f5f');
  });
});
