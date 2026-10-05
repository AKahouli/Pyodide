import { GovernedConversationRuntimeService } from './governed-conversation-runtime.service';

describe('Pinned governed runtime authority', () => {
  function fixture() {
    const scope = { id: 'scope', programId: 'program', status: 'active', agentIds: ['guide'] };
    const deployment = { id: 'deployment', scopeId: 'scope', programId: 'program', status: 'published', currentPublishedRevisionId: 'newer' };
    const revision = { id: 'pinned', deploymentId: 'deployment', status: 'published', revisionNumber: 24,
      agentId: 'guide', allowedAgentIds: ['guide'], workspaceIds: ['approved', 'removed'] };
    const bindings = { listEnabled: jest.fn().mockResolvedValue([{ workspaceId: 'approved' }, { workspaceId: 'newly-approved' }]) };
    const audience = { assertUserAuthorized: jest.fn().mockResolvedValue(undefined) };
    const conversation = { runtimeMode: 'governed' as const, createdBy: 'viewer', governanceContext: {
      programId: 'program', scopeId: 'scope', deploymentId: 'deployment', revisionId: 'pinned', revisionNumber: 24,
      runtimeDefinition: { primaryAgentId: 'guide', allowedAgentIds: ['guide'], workspaceIds: ['approved', 'removed', 'forged'] },
    } };
    const service = new GovernedConversationRuntimeService({ findById: async () => scope } as never,
      { findById: async () => deployment } as never, { findById: async () => revision } as never, audience as never, bindings as never);
    return { service, scope, deployment, revision, bindings, audience, conversation };
  }

  it('keeps the old published revision pinned and intersects its sources with current enabled bindings', async () => {
    const h = fixture();
    expect(await h.service.resolveRuntime('viewer', h.conversation)).toMatchObject({ revisionId: 'pinned', revisionNumber: 24,
      workspaceIds: ['approved'] });
    expect(h.bindings.listEnabled).toHaveBeenCalledWith('program', ['scope']);
  });
  it.each(['scope-program', 'deployment-program', 'deployment-scope', 'revision-deployment', 'revision-status',
    'revision-number', 'primary', 'roster', 'current-agent'])('rejects a mismatched %s binding', async (field) => {
    const h = fixture();
    if (field === 'scope-program') h.scope.programId = 'other';
    if (field === 'deployment-program') h.deployment.programId = 'other';
    if (field === 'deployment-scope') h.deployment.scopeId = 'other';
    if (field === 'revision-deployment') h.revision.deploymentId = 'other';
    if (field === 'revision-status') h.revision.status = 'draft';
    if (field === 'revision-number') h.revision.revisionNumber = 25;
    if (field === 'primary') h.revision.agentId = 'other';
    if (field === 'roster') h.revision.allowedAgentIds = [];
    if (field === 'current-agent') h.scope.agentIds = [];
    await expect(h.service.resolveRuntime('viewer', h.conversation)).rejects.toMatchObject({ status: 403 });
  });
  it('denies revoked audience, deployment and owner authority', async () => {
    const h = fixture();
    await expect(h.service.resolveRuntime('other', h.conversation)).rejects.toMatchObject({ status: 403 });
    h.audience.assertUserAuthorized.mockRejectedValueOnce(new Error('Revoked'));
    await expect(h.service.resolveRuntime('viewer', h.conversation)).rejects.toMatchObject({ status: 403 });
    h.deployment.status = 'suspended';
    await expect(h.service.resolveRuntime('viewer', h.conversation)).rejects.toMatchObject({ status: 403 });
  });
});
