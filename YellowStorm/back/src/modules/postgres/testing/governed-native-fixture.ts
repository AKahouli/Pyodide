import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../schema';
import { PgScopeStore } from '../../governance/persistence/postgres/pg-scope.store';
import { PgDeploymentStore } from '../../governance/persistence/postgres/pg-deployment.store';
import { PgRevisionStore } from '../../governance/persistence/postgres/pg-revision.store';
import { PgBindingStore } from '../../governance/persistence/postgres/pg-binding.store';
import { GovernanceAudienceAuthorizationService } from '../../governance/services/governance-audience-authorization.service';
import { GovernedConversationRuntimeService } from '../../governance/services/governed-conversation-runtime.service';
import { ConversationRootResolverService } from '../../conversation/root-work/conversation-root-resolver.service';
import { AgentExecutionSnapshotService } from '../../agent/services/agent-execution-snapshot.service';
import type { AgentRecord } from '../../agent/repositories/agent-record.mapper';
import { newRootExecutionPolicy } from '../../agent/interfaces/root-execution-policy.interface';
import { sealRootWork } from '../../governance/services/governance-root-snapshot';

/** SQL governance and profile digests are real; the disposable profile repository is a fixture seam. */
export async function governedNativeFixture(db: NodePgDatabase<typeof schema>, conversationId: string, actorId: string) {
  const id = () => randomBytes(12).toString('hex');
  const programId = id(), workspaceId = id(), workerId = id(), secret = id();
  const scopes = new PgScopeStore(db), deployments = new PgDeploymentStore(db);
  const revisions = new PgRevisionStore(db), bindings = new PgBindingStore(db);
  const policy = newRootExecutionPolicy(); policy.background.enabled = true;
  policy.fanout.enabled = true; policy.fanout.allowBackground = true;
  const profile = { _id: actorId, name: 'QualificationSynthesis', instruction: 'Return VECTORNATIVENEST exactly.',
    role: 'assistant', ignorePrePrompt: true, llmModel: 'gpt-6-luna', temperature: 0,
    tools: [], skills: [], knowledgeBases: [], rootExecutionPolicy: policy, updatedAt: new Date() } as unknown as AgentRecord;
  const snapshots = new AgentExecutionSnapshotService();
  const digest = snapshots.computeDigest(profile);
  const worker = { ...profile, _id: workerId, name: 'QualificationWorker', rootExecutionPolicy: undefined };
  const workerDigest = snapshots.computeDigest(worker);
  try {
    await db.insert(schema.workspaces).values({ id: workspaceId, name: 'Native fixture', alias: workspaceId,
      storagePrefix: workspaceId, createdBy: actorId, allocatedStorage: 0 });
    await db.insert(schema.governancePrograms).values({ id: programId, name: 'Native fixture', ownerUserId: actorId });
    const scope = await scopes.insert({ programId, name: 'Native fixture', agentIds: [actorId, workerId],
      audience: { mode: 'restricted', userIds: [actorId], groupIds: [] } });
    const deployment = await deployments.insert({ programId, scopeId: scope.id, name: 'Native fixture' });
    const binding = await bindings.insert({ programId, workspaceId, visibility: 'scope_specific',
      scopeIds: [scope.id], createdBy: actorId });
    const draft = await revisions.insert({ deploymentId: deployment.id, revisionNumber: 1, agentId: actorId,
      allowedAgentIds: [actorId, workerId], workspaceIds: [workspaceId], createdBy: actorId });
    const rootWork = sealRootWork({ version: 1, pool: { rootAgentId: actorId, rootSnapshotDigest: digest,
      delegationEnabled: true, defaultConfigurationMode: 'native', policy, entries: [{ agentId: workerId,
        name: worker.name, description: '', agentTypeSlug: 'simple', configurationMode: 'native',
        snapshotDigest: workerDigest, source: { direct: true, teamIds: [] } }],
      unavailableCounts: { agents: 0, teams: 0 } } }, draft.id, secret);
    await revisions.update(draft.id, { status: 'published', agentSnapshot: { rootWork } }, draft);
    await deployments.update(deployment.id, { status: 'published', currentPublishedRevisionId: draft.id });
    await db.update(schema.conversations).set({ rootAgentId: actorId, runtimeMode: 'governed', governanceContext: {
      programId, scopeId: scope.id, deploymentId: deployment.id, revisionId: draft.id, revisionNumber: 1,
      runtimeDefinition: { primaryAgentId: actorId, allowedAgentIds: [actorId, workerId], workspaceIds: [workspaceId] },
    } }).where(eq(schema.conversations.id, conversationId));
    const getConversationDocument = async () => (await db.select().from(schema.conversations)
      .where(eq(schema.conversations.id, conversationId)))[0];
    const audience = new GovernanceAudienceAuthorizationService(scopes, { findGroupIdsForMember: async () => [] } as never,
      { isEnabled: () => true } as never);
    const runtime = new GovernedConversationRuntimeService(scopes, deployments, revisions, audience, bindings,
      { get: () => secret } as never);
    const resolver = new ConversationRootResolverService({ getConversationDocument } as never,
      { resolveForActor: async () => { throw new Error('Ordinary grants are deliberately denied'); } } as never,
      runtime, { findByIds: async () => [profile, worker] } as never, snapshots);
    return { resolver, getConversationDocument, digest, workerId, workerDigest, revisionId: draft.id, workspaceId, scopeId: scope.id,
      bindings, binding, async close() {
        await db.delete(schema.governancePrograms).where(eq(schema.governancePrograms.id, programId));
        await db.delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
      } };
  } catch (error) {
    await db.delete(schema.governancePrograms).where(eq(schema.governancePrograms.id, programId));
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
    throw error;
  }
}
