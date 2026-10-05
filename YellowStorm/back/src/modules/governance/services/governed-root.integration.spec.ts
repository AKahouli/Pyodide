import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describeIntegration, makeTestDb } from '../../postgres/testing/pg-integration';
import { governancePrograms, governanceScopeAudienceUsers, workspaces } from '../../postgres/schema';
import { PgScopeStore } from '../persistence/postgres/pg-scope.store';
import { PgDeploymentStore } from '../persistence/postgres/pg-deployment.store';
import { PgRevisionStore } from '../persistence/postgres/pg-revision.store';
import { PgBindingStore } from '../persistence/postgres/pg-binding.store';
import { GovernanceAudienceAuthorizationService } from './governance-audience-authorization.service';
import { GovernedConversationRuntimeService } from './governed-conversation-runtime.service';
import { ConversationRootResolverService } from '../../conversation/root-work/conversation-root-resolver.service';
import { newRootExecutionPolicy } from '../../agent/interfaces/root-execution-policy.interface';
import { sealRootWork } from './governance-root-snapshot';

describeIntegration('Published governed Root SQL authority', () => {
  const database = makeTestDb();
  const scopes = new PgScopeStore(database.db), deployments = new PgDeploymentStore(database.db);
  const revisions = new PgRevisionStore(database.db), bindings = new PgBindingStore(database.db);
  const id = () => randomBytes(12).toString('hex');
  const secret = 'isolated-governed-root-test-only';
  let programId: string;
  let fixtureWorkspaceId: string;
  afterEach(async () => {
    if (programId) await database.db.delete(governancePrograms).where(eq(governancePrograms.id, programId));
    if (fixtureWorkspaceId) await database.db.delete(workspaces).where(eq(workspaces.id, fixtureWorkspaceId));
  });
  afterAll(async () => { await database.close(); });

  async function fixture() {
    programId = id();
    const actorId = id(), rootId = id(), workerId = id(), workspaceId = id();
    fixtureWorkspaceId = workspaceId;
    await database.db.insert(workspaces).values({ id: workspaceId, name: `Root fixture ${workspaceId}`, alias: workspaceId,
      storagePrefix: workspaceId, createdBy: actorId, allocatedStorage: 0 });
    await database.db.insert(governancePrograms).values({ id: programId, name: 'Root isolation fixture', ownerUserId: actorId });
    const scope = await scopes.insert({ programId, name: 'Approved fixture', agentIds: [rootId, workerId],
      audience: { mode: 'restricted', userIds: [actorId], groupIds: [] } });
    const deployment = await deployments.insert({ programId, scopeId: scope.id, name: 'Root fixture' });
    const binding = await bindings.insert({ programId, workspaceId, visibility: 'scope_specific', scopeIds: [scope.id], createdBy: actorId });
    const draft = await revisions.insert({ deploymentId: deployment.id, revisionNumber: 1, agentId: rootId,
      allowedAgentIds: [rootId, workerId], workspaceIds: [workspaceId], createdBy: actorId });
    const pool = { rootAgentId: rootId, rootSnapshotDigest: 'root-digest', delegationEnabled: true,
      defaultConfigurationMode: 'native' as const, policy: newRootExecutionPolicy(),
      entries: [{ agentId: workerId, name: 'Fixture worker', description: '', agentTypeSlug: 'simple', configurationMode: 'native' as const,
        snapshotDigest: 'worker-digest', source: { direct: true, teamIds: [] } }], unavailableCounts: { agents: 0, teams: 0 } };
    const rootWork = sealRootWork({ version: 1, pool }, draft.id, secret);
    await revisions.update(draft.id, { status: 'published', agentSnapshot: { rootWork } }, draft);
    await deployments.update(deployment.id, { status: 'published', currentPublishedRevisionId: draft.id });
    const audience = new GovernanceAudienceAuthorizationService(scopes, { findGroupIdsForMember: async () => [] } as never,
      { isEnabled: () => true } as never);
    const runtime = new GovernedConversationRuntimeService(scopes, deployments, revisions, audience, bindings,
      { get: () => secret } as never);
    const conversation = { runtimeMode: 'governed' as const, createdBy: actorId, rootAgentId: rootId, governanceContext: {
      programId, scopeId: scope.id, deploymentId: deployment.id, revisionId: draft.id, revisionNumber: 1,
      runtimeDefinition: { primaryAgentId: rootId, allowedAgentIds: [rootId, workerId], workspaceIds: [workspaceId] } } };
    const resolver = new ConversationRootResolverService({ getConversationDocument: async () => conversation } as never,
      { resolveForActor: async () => { throw new Error('ordinary grant denied'); } } as never, runtime,
      { findByIds: async () => [{ _id: rootId }, { _id: workerId }] } as never,
      { computeDigest: (agent: { _id: string }) => agent._id === rootId ? 'root-digest' : 'worker-digest' } as never);
    return { actorId, rootId, workerId, workspaceId, scope, deployment, binding, draft, runtime, conversation, resolver };
  }

  it('pins an old signed revision across newer publication and enforces live binding/audience revocation', async () => {
    const h = await fixture();
    const newer = await revisions.insert({ deploymentId: h.deployment.id, revisionNumber: 2, agentId: h.rootId,
      allowedAgentIds: [h.rootId, h.workerId], workspaceIds: [], createdBy: h.actorId, status: 'published' });
    await deployments.update(h.deployment.id, { currentPublishedRevisionId: newer.id });
    expect((await h.resolver.resolveForActor(h.rootId, h.actorId, 'conversation', h.draft.id)).rootSnapshotDigest).toBe('root-digest');
    await h.resolver.assertWorkspaces('conversation', h.actorId, [h.workspaceId]);
    await bindings.update(h.binding.id, { enabled: false });
    await expect(h.resolver.assertWorkspaces('conversation', h.actorId, [h.workspaceId])).rejects.toThrow('source access changed');
    await database.db.delete(governanceScopeAudienceUsers).where(eq(governanceScopeAudienceUsers.scopeId, h.scope.id));
    await expect(h.resolver.resolveForActor(h.rootId, h.actorId, 'conversation', h.draft.id)).rejects.toMatchObject({ status: 403 });
  });

  it('rejects stale publication captures and draft edits racing with publication', async () => {
    const h = await fixture();
    const draft = await revisions.insert({ deploymentId: h.deployment.id, revisionNumber: 2, agentId: h.rootId,
      allowedAgentIds: [h.rootId], workspaceIds: [h.workspaceId], createdBy: h.actorId });
    await revisions.update(draft.id, { workspaceIds: [] });
    expect(await revisions.update(draft.id, { status: 'published' }, draft)).toBeNull();
    const current = (await revisions.findById(draft.id))!;
    expect(await revisions.update(draft.id, { status: 'published' }, current)).not.toBeNull();
    expect(await revisions.update(draft.id, { agentSnapshot: { rootWork: { forged: true } } })).toBeNull();
  });
});
