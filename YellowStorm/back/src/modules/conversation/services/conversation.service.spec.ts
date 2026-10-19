import { Types } from 'mongoose';
import { ConversationService } from './conversation.service';

describe('ConversationService neutral persistence', () => {
  let conversationStore: Record<string, jest.Mock>;
  let agentRepository: Record<string, jest.Mock>;
  let featureVisibility: { getVisibility: jest.Mock; isEnabled: jest.Mock };
  let userLookup: { byId: jest.Mock; byIds: jest.Mock; byEmails: jest.Mock };
  let emailService: { sendBulk: jest.Mock };
  let service: ConversationService;
  let workspaceDocuments: { findByMultipleWorkspaces: jest.Mock };
  let workspaceService: { createSystemWorkspace: jest.Mock };

  const record = (patch: Record<string, unknown> = {}) => ({
    id: new Types.ObjectId().toString(),
    runtimeMode: 'standard',
    runtimePurpose: 'chat',
    title: 'Conversation',
    createdBy: new Types.ObjectId().toString(),
    workspaces: [],
    selectedSkills: [],
    taggedAgentIds: [],
    messageCount: 0,
    isArchived: false,
    isShared: false,
    initializationStatus: 'ready',
    isGroup: false,
    members: [],
    invitedUsers: [],
    groupTaggedAgentIds: [],
    isFirstMessage: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...patch,
  });

  beforeEach(() => {
    conversationStore = {
      create: jest.fn(),
      findById: jest.fn(),
      findByPlatformCreationRequest: jest.fn(),
      findLatestPlatformConversation: jest.fn(),
      findByGovernedCreationRequest: jest.fn(),
      list: jest.fn().mockResolvedValue({ records: [], total: 0 }),
      updateOwned: jest.fn(),
      deleteOwned: jest.fn(),
      setSystemWorkspace: jest.fn(),
      joinGroup: jest.fn(),
      removeMember: jest.fn(),
      updateMemberJob: jest.fn(),
      touchMessage: jest.fn(),
      addGroupTaggedAgents: jest.fn(),
      replaceTaggedAgentIds: jest.fn(),
      updateInternal: jest.fn(),
      getWorkspaceIds: jest.fn(),
      findOrphaned: jest.fn(),
      markMentionSeen: jest.fn(),
      addMention: jest.fn(),
      findActiveAccessById: jest.fn(),
      countByProject: jest.fn(),
      countByProjects: jest.fn(),
      detachProject: jest.fn(),
      removeWorkspaceFromAll: jest.fn(),
    };
    agentRepository = {
      findActiveDefaultIdBySlugAndType: jest.fn(),
      findByIds: jest.fn(),
      findById: jest.fn().mockResolvedValue(null),
    };
    featureVisibility = { getVisibility: jest.fn().mockResolvedValue({ platformCopilot: true }), isEnabled: jest.fn().mockReturnValue(true) };
    userLookup = {
      byId: jest.fn(async (id: string) => ({ id, email: 'owner@example.com', firstName: '', lastName: '', status: 'active' })),
      byIds: jest.fn(async (ids: string[]) =>
        new Map(ids.map((id) => [id, { id, email: 'owner@example.com', firstName: 'Owner', lastName: '', status: 'active' }]))),
      byEmails: jest.fn(async (emails: string[]) => {
        const map = new Map();
        for (const email of emails) map.set(email.toLowerCase(), { id: `u-${email}`, email, firstName: '', lastName: '', status: 'active' });
        return map;
      }),
    };
    emailService = { sendBulk: jest.fn().mockResolvedValue(undefined) };
    workspaceDocuments = { findByMultipleWorkspaces: jest.fn() };
    workspaceService = { createSystemWorkspace: jest.fn() };
    const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };
    service = new ConversationService(
      conversationStore as never,
      userLookup as never,
      logger as never,
      { get: jest.fn((_key: string, fallback: unknown) => fallback) } as never,
      workspaceService as never,
      workspaceDocuments as never,
      emailService as never,
      agentRepository as never,
      { resolveRootForConversation: jest.fn().mockResolvedValue(null) } as never,
      featureVisibility as never,
      {
        hasAccess: jest.fn().mockResolvedValue(false),
        assertProjectWriteAccess: jest.fn().mockResolvedValue(undefined),
      } as never,
    );
  });

  it.each(['owner', 'member'])('lists only conversation uploads for current %s', async userId => {
    const conversation = record({ createdBy: 'owner', members: [{ userId: 'member' }], systemWorkspaceId: 'uploads', workspaces: ['linked', 'foreign'] });
    conversationStore.findById.mockResolvedValue(conversation);
    const result = { documents: [{ id: 'upload-1' }], pagination: { page: 2, limit: 10, total: 11, totalPages: 2 } };
    workspaceDocuments.findByMultipleWorkspaces.mockResolvedValueOnce(result);
    expect(await service.getUploadedDocuments(conversation.id, { page: 2, limit: 10 }, userId)).toBe(result);
    expect(workspaceDocuments.findByMultipleWorkspaces).toHaveBeenCalledWith(['uploads'], { page: 2, limit: 10 });
    expect(workspaceService.createSystemWorkspace).not.toHaveBeenCalled();
  });
  it.each(['foreign', 'invited', 'project-viewer'])('rejects %s upload listing without current membership', async userId => {
    const conversation = record({ createdBy: 'owner', members: [], systemWorkspaceId: 'uploads', invitedUsers: [{ email: 'invited@example.com' }], projectId: 'project' });
    conversationStore.findById.mockResolvedValue(conversation);
    await expect(service.getUploadedDocuments(conversation.id, {}, userId)).rejects.toThrow('current membership');
    expect(workspaceDocuments.findByMultipleWorkspaces).not.toHaveBeenCalled();
    expect(workspaceService.createSystemWorkspace).not.toHaveBeenCalled();
  });
  it('returns an empty upload page without creating a missing workspace', async () => {
    const conversation = record({ createdBy: 'owner' });
    conversationStore.findById.mockResolvedValue(conversation);
    expect(await service.getUploadedDocuments(conversation.id, { page: 3, limit: 10 }, 'owner')).toEqual({ documents: [], pagination: { page: 3, limit: 10, total: 0, totalPages: 0 } });
    expect(workspaceDocuments.findByMultipleWorkspaces).not.toHaveBeenCalled();
    expect(workspaceService.createSystemWorkspace).not.toHaveBeenCalled();
    expect(conversationStore.setSystemWorkspace).not.toHaveBeenCalled();
  });
  it('fails closed for governed upload listing without a current audience grant', async () => {
    const conversation = record({ createdBy: 'owner', runtimeMode: 'governed', governanceContext: { scopeId: 'scope' }, systemWorkspaceId: 'uploads' });
    conversationStore.findById.mockResolvedValue(conversation);
    await expect(service.getUploadedDocuments(conversation.id, {}, 'owner')).rejects.toThrow('Governed scope');
    expect(workspaceDocuments.findByMultipleWorkspaces).not.toHaveBeenCalled();
  });

  it('resolves current group recipients in owner-first order without display hydration', async () => {
    const group = record({ createdBy: 'owner', isGroup: true, rootAgentId: 'root',
      members: [{ userId: 'member-2' }, { userId: 'owner' }, { userId: 'member-1' }, { userId: 'member-2' }] });
    conversationStore.findById.mockResolvedValueOnce(group)
      .mockResolvedValueOnce({ ...group, members: [{ userId: 'member-1' }] });
    expect(await service.getBroadcastMemberIds(group.id)).toEqual(['owner', 'member-2', 'member-1']);
    expect(await service.getBroadcastMemberIds(group.id)).toEqual(['owner', 'member-1']);
    // Both lookups retain the same default visibility/initialization filters
    // as findById; no includeInitializing override or recipient cache.
    expect(conversationStore.findById.mock.calls).toEqual([[group.id], [group.id]]);
    expect(userLookup.byIds).not.toHaveBeenCalled();
    expect(agentRepository.findById).not.toHaveBeenCalled();
  });

  it('broadcasts a non-group conversation only to its owner', async () => {
    const single = record({ createdBy: 'owner', rootAgentId: 'root', members: [{ userId: 'other' }] });
    conversationStore.findById.mockResolvedValue(single);
    expect(await service.getBroadcastMemberIds(single.id)).toEqual(['owner']);
    expect(userLookup.byIds).not.toHaveBeenCalled();
    expect(agentRepository.findById).not.toHaveBeenCalled();
  });

  it('preserves not-found behavior and propagates recipient lookup failures', async () => {
    conversationStore.findById.mockResolvedValueOnce(null);
    await expect(service.getBroadcastMemberIds('missing')).rejects.toMatchObject({ response: 'Conversation not found' });
    const failure = new Error('recipient lookup failed');
    conversationStore.findById.mockRejectedValueOnce(failure);
    await expect(service.getBroadcastMemberIds('failed')).rejects.toBe(failure);
    expect(userLookup.byIds).not.toHaveBeenCalled();
  });

  it('fails closed when workspace authorization is unavailable for a requester', async () => {
    await expect(
      service.filterAccessibleWorkspaceIds('user-1', ['workspace-1']),
    ).resolves.toEqual([]);
  });

  describe('group conversion', () => {
    it('materializes the owner and invitations when participant emails create a group', async () => {
      const ownerId = new Types.ObjectId().toString();
      const existing = record({ createdBy: ownerId });
      conversationStore.findById.mockResolvedValue(existing);
      conversationStore.updateOwned.mockImplementation(async (_id, _ownerId, patch) =>
        record({ ...existing, ...patch }),
      );

      await service.update(existing.id, ownerId, {
        participantEmails: ['Guest@Example.com'],
      });

      expect(conversationStore.updateOwned).toHaveBeenCalledWith(
        existing.id,
        ownerId,
        expect.objectContaining({
          isGroup: true,
          members: [
            expect.objectContaining({ userId: ownerId, status: 'owner', mentions: [] }),
          ],
          invitedUsers: [
            expect.objectContaining({ email: 'guest@example.com', status: 'Guest' }),
          ],
        }),
      );
      expect(emailService.sendBulk).toHaveBeenCalledWith(
        expect.objectContaining({
          emails: [expect.objectContaining({ to: 'guest@example.com' })],
        }),
      );
    });

    it('derives invitation emails and jobs from rich participants', async () => {
      const ownerId = new Types.ObjectId().toString();
      const existing = record({ createdBy: ownerId });
      conversationStore.findById.mockResolvedValue(existing);
      conversationStore.updateOwned.mockImplementation(async (_id, _ownerId, patch) =>
        record({ ...existing, ...patch }),
      );

      await service.update(existing.id, ownerId, {
        participants: [{ email: 'Reviewer@Example.com', job: 'Reviewer' }],
      });

      expect(conversationStore.updateOwned).toHaveBeenCalledWith(
        existing.id,
        ownerId,
        expect.objectContaining({
          isGroup: true,
          members: [expect.objectContaining({ userId: ownerId, status: 'owner' })],
          invitedUsers: [
            expect.objectContaining({
              email: 'reviewer@example.com',
              status: 'Guest',
              job: 'Reviewer',
            }),
          ],
        }),
      );
      expect(emailService.sendBulk).toHaveBeenCalledWith(
        expect.objectContaining({
          emails: [expect.objectContaining({ to: 'reviewer@example.com' })],
        }),
      );
    });
  });

  describe('group joining', () => {
    it('returns the conversation to its owner instead of failing on the missing invitation', async () => {
      const ownerId = new Types.ObjectId().toString();
      const existing = record({ createdBy: ownerId, isGroup: true, isShared: true });
      conversationStore.findActiveAccessById.mockResolvedValue({
        id: existing.id,
        createdBy: ownerId,
        memberIds: [],
        invitedEmails: [],
      });
      conversationStore.findById.mockResolvedValue(existing);

      const result = await service.joinGroup(existing.id, ownerId, 'owner@example.com');

      expect(result).toMatchObject({ id: existing.id, createdBy: ownerId });
      expect(conversationStore.joinGroup).not.toHaveBeenCalled();
    });

    it('returns the conversation to an existing member', async () => {
      const memberId = new Types.ObjectId().toString();
      const existing = record({ isGroup: true });
      conversationStore.findActiveAccessById.mockResolvedValue({
        id: existing.id,
        createdBy: new Types.ObjectId().toString(),
        memberIds: [memberId],
        invitedEmails: [],
      });
      conversationStore.findById.mockResolvedValue(existing);

      await service.joinGroup(existing.id, memberId, 'member@example.com');

      expect(conversationStore.joinGroup).not.toHaveBeenCalled();
    });

    it('joins an invited guest through the store', async () => {
      const guestId = new Types.ObjectId().toString();
      const existing = record({ isGroup: true });
      conversationStore.findActiveAccessById.mockResolvedValue({
        id: existing.id,
        createdBy: new Types.ObjectId().toString(),
        memberIds: [],
        invitedEmails: ['guest@example.com'],
      });
      conversationStore.joinGroup.mockResolvedValue(existing);
      conversationStore.findById.mockResolvedValue(existing);

      await service.joinGroup(existing.id, guestId, 'guest@example.com');

      expect(conversationStore.joinGroup).toHaveBeenCalledWith(
        existing.id,
        guestId,
        'guest@example.com',
        expect.any(Date),
      );
    });

    it('still fails when there is neither invitation nor existing access', async () => {
      conversationStore.findActiveAccessById.mockResolvedValue({
        id: 'conv-1',
        createdBy: 'owner-1',
        memberIds: [],
        invitedEmails: [],
      });
      conversationStore.joinGroup.mockResolvedValue(null);

      await expect(
        service.joinGroup('conv-1', 'stranger', 'stranger@example.com'),
      ).rejects.toMatchObject({ response: 'Conversation not found or invitation missing' });
    });
  });

  describe('platform copilot pinning', () => {
    it('resolves only the active canonical Platform Copilot Agent', async () => {
      const agentId = new Types.ObjectId().toString();
      agentRepository.findActiveDefaultIdBySlugAndType.mockResolvedValue(agentId);
      await expect(service.assertPlatformCopilotAgent(agentId)).resolves.toBe(agentId);
      expect(agentRepository.findActiveDefaultIdBySlugAndType).toHaveBeenCalledWith(
        'platform-copilot',
        'platform_copilot',
      );
    });

    it('fails closed when the stored pin no longer matches the active agent', async () => {
      agentRepository.findActiveDefaultIdBySlugAndType.mockResolvedValue(
        new Types.ObjectId().toString(),
      );
      await expect(
        service.assertPlatformCopilotAgent(new Types.ObjectId().toString()),
      ).rejects.toThrow('Yellowmind is currently unavailable');
    });

    it('fails closed while Platform Copilot is disabled', async () => {
      featureVisibility.getVisibility.mockResolvedValue({ platformCopilot: false });
      await expect(service.assertPlatformCopilotAgent()).rejects.toThrow(
        'Yellowmind is currently unavailable',
      );
      expect(agentRepository.findActiveDefaultIdBySlugAndType).not.toHaveBeenCalled();
    });

    it('binds the resolved root agent on standard creation (WP01)', async () => {
      const ownerId = new Types.ObjectId().toString();
      const rootId = new Types.ObjectId().toString();
      conversationStore.create.mockImplementation(async (input) => record(input));
      (service as any).agentService.resolveRootForConversation.mockResolvedValue({ _id: rootId });
      agentRepository.findById.mockResolvedValue({ _id: rootId, rootExecutionPolicy: {} });

      expect(await service.create(ownerId, {})).toMatchObject({ concurrentRepliesEnabled: true });

      expect((service as any).agentService.resolveRootForConversation).toHaveBeenCalledWith(ownerId, undefined);
      expect(conversationStore.create).toHaveBeenCalledWith(
        expect.objectContaining({ rootAgentId: rootId }),
      );
    });

    it('creates distinct conversations idempotently by creation request', async () => {
      const ownerId = new Types.ObjectId().toString();
      const agentId = new Types.ObjectId().toString();
      const requestId = crypto.randomUUID();
      conversationStore.findByPlatformCreationRequest.mockResolvedValue(null);
      agentRepository.findActiveDefaultIdBySlugAndType.mockResolvedValue(agentId);
      conversationStore.create.mockImplementation(async (input) => record(input));

      await service.create(ownerId, {
        runtimePurpose: 'platform_copilot',
        creationRequestId: requestId,
      });

      expect(conversationStore.findByPlatformCreationRequest).toHaveBeenCalledWith(
        ownerId,
        requestId,
      );
      expect(conversationStore.create).toHaveBeenCalledWith(
        expect.objectContaining({
          platformCopilotCreationRequestId: requestId,
          pinnedAgentId: agentId,
          taggedAgentIds: [agentId],
        }),
      );
    });

    it('replays an existing explicit creation request without creating again', async () => {
      const ownerId = new Types.ObjectId().toString();
      const agentId = new Types.ObjectId().toString();
      const existing = record({
        createdBy: ownerId,
        runtimePurpose: 'platform_copilot',
        pinnedAgentId: agentId,
      });
      conversationStore.findByPlatformCreationRequest.mockResolvedValue(existing);
      agentRepository.findActiveDefaultIdBySlugAndType.mockResolvedValue(agentId);
      const result = await service.create(ownerId, {
        runtimePurpose: 'platform_copilot',
        creationRequestId: crypto.randomUUID(),
      });
      expect(result.id).toBe(existing.id);
      expect(conversationStore.create).not.toHaveBeenCalled();
    });

    it('does not silently repin an explicit request with a retired agent', async () => {
      const staleAgentId = new Types.ObjectId().toString();
      conversationStore.findByPlatformCreationRequest.mockResolvedValue(
        record({ runtimePurpose: 'platform_copilot', pinnedAgentId: staleAgentId }),
      );
      agentRepository.findActiveDefaultIdBySlugAndType.mockResolvedValue(
        new Types.ObjectId().toString(),
      );
      await expect(
        service.create(new Types.ObjectId().toString(), {
          runtimePurpose: 'platform_copilot',
          creationRequestId: crypto.randomUUID(),
        }),
      ).rejects.toThrow('Yellowmind is currently unavailable');
      expect(conversationStore.create).not.toHaveBeenCalled();
    });

    it('creates a replacement when default initialization has only stale history', async () => {
      const ownerId = new Types.ObjectId().toString();
      const agentId = new Types.ObjectId().toString();
      conversationStore.findLatestPlatformConversation.mockResolvedValue(null);
      agentRepository.findActiveDefaultIdBySlugAndType.mockResolvedValue(agentId);
      conversationStore.create.mockImplementation(async (input) => record(input));
      await service.create(ownerId, { runtimePurpose: 'platform_copilot' });
      expect(conversationStore.findLatestPlatformConversation).toHaveBeenCalledWith(
        ownerId,
        agentId,
      );
      expect(conversationStore.create).toHaveBeenCalledWith(
        expect.objectContaining({
          platformCopilotCreationRequestId: `initial:${agentId}`,
          pinnedAgentId: agentId,
        }),
      );
    });

    it('resolves a unique-race replay through the same request identity', async () => {
      const ownerId = new Types.ObjectId().toString();
      const agentId = new Types.ObjectId().toString();
      const raced = record({
        createdBy: ownerId,
        runtimePurpose: 'platform_copilot',
        pinnedAgentId: agentId,
      });
      conversationStore.findLatestPlatformConversation.mockResolvedValue(null);
      conversationStore.create.mockRejectedValue({ code: '23505' });
      conversationStore.findByPlatformCreationRequest.mockResolvedValue(raced);
      agentRepository.findActiveDefaultIdBySlugAndType.mockResolvedValue(agentId);
      await expect(service.create(ownerId, { runtimePurpose: 'platform_copilot' })).resolves.toMatchObject({
        id: raced.id,
      });
      expect(conversationStore.findByPlatformCreationRequest).toHaveBeenCalledWith(
        ownerId,
        `initial:${agentId}`,
      );
    });

    it('lists platform-copilot history through an owner-scoped store query', async () => {
      const ownerId = new Types.ObjectId().toString();
      await service.findAllByUser(ownerId, { runtimePurpose: 'platform_copilot' });
      expect(conversationStore.list).toHaveBeenCalledWith(
        expect.objectContaining({ userId: ownerId, runtimePurpose: 'platform_copilot' }),
      );
    });

    it('batch-loads users once for a page of conversations', async () => {
      const ownerId = new Types.ObjectId().toString();
      conversationStore.list.mockResolvedValue({
        records: [record({ createdBy: ownerId }), record({ createdBy: ownerId })],
        total: 2,
      });
      await service.findAllByUser(ownerId, {});
      expect(userLookup.byIds).toHaveBeenCalledTimes(1);
      expect(userLookup.byIds).toHaveBeenCalledWith([ownerId]);
    });

    it('does not return a governed conversation after audience access is revoked', async () => {
      const ownerId = new Types.ObjectId().toString();
      conversationStore.list.mockResolvedValue({ records: [record({ createdBy: ownerId, runtimeMode: 'governed', governanceContext: { scopeId: 'scope-1' } })], total: 1 });
      (service as any).audienceAuthorization = { isUserAuthorized: jest.fn().mockResolvedValue(false) };
      const result = await service.findAllByUser(ownerId, {});
      expect(result.conversations).toEqual([]);
      expect(result.pagination).toMatchObject({ total: 0 });
      expect(conversationStore.list).toHaveBeenCalledWith(expect.objectContaining({ governedAudienceEnabled: true }));
    });
  });

  describe('agent tag persistence', () => {
    it('replaces neutral tagged-agent IDs', async () => {
      const conversationId = new Types.ObjectId().toString();
      const agentIds = [new Types.ObjectId().toString(), new Types.ObjectId().toString()];
      await service.replaceTaggedAgentIds(conversationId, agentIds);
      expect(conversationStore.replaceTaggedAgentIds).toHaveBeenCalledWith(
        conversationId,
        agentIds,
      );
    });

    it('atomically adds group tagged-agent IDs', async () => {
      const conversationId = new Types.ObjectId().toString();
      const agentIds = [new Types.ObjectId().toString()];
      await service.updateTaggedAgents(conversationId, agentIds);
      expect(conversationStore.addGroupTaggedAgents).toHaveBeenCalledWith(
        conversationId,
        agentIds,
      );
    });

    it('does not call the store for an empty group tag update', async () => {
      await service.updateTaggedAgents(new Types.ObjectId().toString(), []);
      expect(conversationStore.addGroupTaggedAgents).not.toHaveBeenCalled();
    });
  });

  it('exposes only public branch provenance fields', async () => {
    const branchProvenance = {
      sourceConversationId: new Types.ObjectId().toString(),
      sourceTargetMessageId: new Types.ObjectId().toString(),
      branchedAt: '2026-08-30T10:00:00.000Z',
      branchedBy: new Types.ObjectId().toString(),
      requestId: 'internal-request',
      requestFingerprint: 'internal-fingerprint',
      selectedAnswerIds: [new Types.ObjectId().toString()],
    };
    const branch = record({
      branchProvenance,
    });
    conversationStore.findById.mockResolvedValue(branch);
    const response = await service.findById(branch.id);
    expect(response.branchProvenance).toEqual({
      sourceConversationId: branchProvenance.sourceConversationId,
      sourceTargetMessageId: branchProvenance.sourceTargetMessageId,
      branchedAt: branchProvenance.branchedAt,
    });
  });

  describe('system workspace cleanup ordering', () => {
    const build = (pool?: unknown) => {
      const calls: string[] = [];
      const workspaceService = {
        deleteSystemWorkspace: jest.fn(async () => {
          calls.push('deleteWorkspace');
        }),
      };
      const workspaceDocumentService = {
        deleteAllByWorkspace: jest.fn(async () => {
          calls.push('deleteDocuments');
        }),
      };
      conversationStore.deleteOwned.mockImplementation(async (id: string) => {
        calls.push('deleteConversation');
        return record({ id, systemWorkspaceId: 'ws-sys' });
      });
      const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };
      const svc = new ConversationService(
        conversationStore as never,
        userLookup as never,
        logger as never,
        { get: jest.fn((_key: string, fallback: unknown) => fallback) } as never,
        workspaceService as never,
        workspaceDocumentService as never,
        emailService as never,
        agentRepository as never,
        { resolveRootForConversation: jest.fn().mockResolvedValue(null) } as never,
        featureVisibility as never,
        {} as never,
        pool as never,
      );
      return { svc, calls, workspaceService };
    };

    it('deletes the conversation row before its system workspace', async () => {
      const { svc, calls, workspaceService } = build();
      conversationStore.findById.mockResolvedValue(
        record({ id: 'c1', createdBy: 'u1', systemWorkspaceId: 'ws-sys' }),
      );
      await svc.delete('c1', 'u1');
      expect(calls).toEqual(['deleteConversation', 'deleteDocuments', 'deleteWorkspace']);
      expect(workspaceService.deleteSystemWorkspace).toHaveBeenCalledWith('ws-sys');
    });

    it('orphan cleanup deletes the conversation first and destroys the client when unlock fails', async () => {
      const client = {
        query: jest
          .fn()
          .mockResolvedValueOnce({ rows: [{ acquired: true }] })
          .mockRejectedValueOnce(new Error('unlock failed')),
        release: jest.fn(),
      };
      const pool = { connect: jest.fn().mockResolvedValue(client) };
      const { svc, calls } = build(pool);
      conversationStore.findOrphaned.mockResolvedValue([
        record({ id: 'c2', createdBy: 'u2', systemWorkspaceId: 'ws-sys' }),
      ]);
      await svc.cleanupOrphanedConversations();
      expect(calls).toEqual(['deleteConversation', 'deleteDocuments', 'deleteWorkspace']);
      expect(client.release).toHaveBeenCalledWith(expect.any(Error));
    });

    it('returns the lock client normally when unlock succeeds', async () => {
      const client = {
        query: jest.fn().mockResolvedValueOnce({ rows: [{ acquired: true }] }).mockResolvedValue({}),
        release: jest.fn(),
      };
      const { svc } = build({ connect: jest.fn().mockResolvedValue(client) });
      conversationStore.findOrphaned.mockResolvedValue([]);
      await svc.cleanupOrphanedConversations();
      expect(client.release).toHaveBeenCalledWith(undefined);
    });
  });
});

describe('Conversation system workspace configured quota', () => {
  it('uses the admin default for new workspaces and preserves existing quota', async () => {
    const service = Object.create(ConversationService.prototype) as ConversationService;
    const conversationStore = { findById: jest.fn().mockResolvedValue({ id: 'conversation', systemWorkspaceId: null }), setSystemWorkspace: jest.fn() };
    const workspaceService = { createSystemWorkspace: jest.fn().mockResolvedValue({ id: 'new-workspace' }) };
    const workspaceUploadSettings = { getSettings: jest.fn().mockResolvedValue({ conversationWorkspaceStorageMb: 200 }) };
    Object.assign(service, { conversationStore, workspaceService, workspaceUploadSettings });
    await expect(service.ensureSystemWorkspace('owner', 'conversation')).resolves.toBe('new-workspace');
    expect(workspaceService.createSystemWorkspace).toHaveBeenCalledWith('owner', 'conversation', 209715200);
    conversationStore.findById.mockResolvedValue({ systemWorkspaceId: 'existing-workspace' });
    await expect(service.ensureSystemWorkspace('owner', 'conversation')).resolves.toBe('existing-workspace');
    expect(workspaceService.createSystemWorkspace).toHaveBeenCalledTimes(1);
  });
});
