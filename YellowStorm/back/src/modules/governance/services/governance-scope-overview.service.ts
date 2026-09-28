import { Inject, Injectable } from '@nestjs/common';
import { NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { USER_LOOKUP_PORT, type UserLookupPort } from '@common/ports/user-lookup.port';
import { GovernanceAccessService } from './governance-access.service';
import { GovernanceProgramService } from './governance-program.service';
import {              
  type GovernanceBindingRecord,                
  type GovernanceDeploymentRecord,                
  type GovernanceDocumentRecord,                
  type GovernanceDryRunRecord,                
  type GovernanceRevisionRecord,                
  type GovernanceScopeRecord,                
} from '../persistence';
import { AgentRepository } from '@modules/agent/repositories/agent.repository';
import { PgWorkspaceDocumentReadAdapter } from '../../workspace/persistence/postgres/pg-workspace-document-read.adapter';
import { PgMetricStore } from '../persistence/postgres/pg-metric.store';
import { PgDryRunStore } from '../persistence/postgres/pg-dry-run.store';
import { PgRevisionStore } from '../persistence/postgres/pg-revision.store';
import { PgDeploymentStore } from '../persistence/postgres/pg-deployment.store';
import { PgScopeStore } from '../persistence/postgres/pg-scope.store';
import { PgGovernanceDocumentStore } from '../persistence/postgres/pg-document.store';
import { PgBindingStore } from '../persistence/postgres/pg-binding.store';
import { PgMembershipStore } from '../persistence/postgres/pg-membership.store';

interface GovernanceActorSummary { id: string; displayName: string; email: string }

type ReadinessStatus = 'ready' | 'blocked' | 'warning';
type CheckStatus = 'passed' | 'warning' | 'failed';
type CheckSeverity = 'info' | 'warning' | 'blocking';

export interface GovernanceScopeOverviewCheck {
  key: string;
  label: string;
  status: CheckStatus;
  severity: CheckSeverity;
  message?: string;
  targetType?: string;
  targetId?: string;
}

export interface GovernanceScopeOverview {
  scope: Record<string, unknown>;
  authorization: { canApprove: boolean };
  readiness: { score: number; status: ReadinessStatus; blockers: GovernanceScopeOverviewCheck[]; warnings: GovernanceScopeOverviewCheck[]; checks: GovernanceScopeOverviewCheck[] };
  knowledge: { sharedWorkspaces: Record<string, unknown>[]; localWorkspaces: Record<string, unknown>[]; documents: Record<string, unknown>[]; reviewBlockers: GovernanceScopeOverviewCheck[] };
  agents: { mappedAgents: Array<{ id: string; isPrimary: boolean }>; primaryAgentId?: string; missingAgent: boolean };
  deployment?: Record<string, unknown>;
  draftRevision?: Record<string, unknown>;
  publishedRevision?: Record<string, unknown>;
  channels: Record<string, unknown>;
  latestDryRun?: Record<string, unknown>;
  metricsSummary: { totalEvents: number; byChannel: Record<string, number>; byType: Record<string, number> };
}

@Injectable()
export class GovernanceScopeOverviewService {
  constructor(
    private readonly scopeStore: PgScopeStore,
    private readonly documentStore: PgGovernanceDocumentStore,
    private readonly workspaceDocumentReadPort: PgWorkspaceDocumentReadAdapter,
    private readonly bindingStore: PgBindingStore,
    private readonly deploymentStore: PgDeploymentStore,
    private readonly revisionStore: PgRevisionStore,
    private readonly dryRunStore: PgDryRunStore,
    private readonly membershipStore: PgMembershipStore,
    private readonly metricStore: PgMetricStore,
    private readonly agentRepository: AgentRepository,
    @Inject(USER_LOOKUP_PORT) private readonly userLookup: UserLookupPort,
    private readonly programService: GovernanceProgramService,
    private readonly accessService: GovernanceAccessService,
  ) {}

  async getOverview(actorId: string, programId: string, scopeId: string): Promise<GovernanceScopeOverview> {
    await this.programService.assertOwnedProgram(actorId, programId);
    await this.accessService.assertScopeAccess(actorId, programId, scopeId);
    const [scope, workspaceBindings, deployment] = await Promise.all([
      this.scopeStore.findByProgramAndId(programId, scopeId),
      this.loadEffectiveWorkspaceBindings(programId, scopeId),
      this.deploymentStore.findByProgramAndScope(programId, scopeId),
    ]);
    if (!scope) throw new NotFoundException(ErrorCode.GOVERNANCE_SCOPE_NOT_FOUND);
    const documents = await this.loadEffectiveDocuments(programId, workspaceBindings.map((binding) => binding.workspaceId));
    const [draftRevision, publishedRevision, latestDryRun, scopeMemberships, metrics, mappedAgents, canApprove] = await Promise.all([
      this.findRevision(deployment?.currentDraftRevisionId),
      this.findRevision(deployment?.currentPublishedRevisionId),
      this.findLatestDryRun(deployment?.id),
      this.findScopeMemberships(programId, scopeId),
      this.metricStore.listByProgramAndScope(programId, scopeId),
      this.findMappedAgents(scope.agentIds ?? []),
      this.accessService.canActInScopeRole(actorId, programId, scopeId, ['scope_approver']),
    ]);
    const checks = this.buildChecks(scope, documents, workspaceBindings.length > 0, draftRevision, latestDryRun, scopeMemberships, mappedAgents);
    const revisionActors = await this.findRevisionActors([draftRevision, publishedRevision] as unknown as Array<Record<string, unknown> | null>);
    const sharedWorkspaces = workspaceBindings.filter((binding) => binding.visibility === 'program_shared');
    const localWorkspaces = workspaceBindings.filter((binding) => binding.visibility !== 'program_shared');
    return {
      scope: this.scopeToResponse(scope),
      authorization: { canApprove },
      readiness: this.buildReadiness(checks),
      knowledge: {
        sharedWorkspaces: sharedWorkspaces as unknown as Record<string, unknown>[],
        localWorkspaces: localWorkspaces as unknown as Record<string, unknown>[],
        documents,
        reviewBlockers: checks.filter((check) => check.targetType === 'document' && check.status !== 'passed'),
      },
      agents: this.buildAgentSummary(scope.agentIds ?? []),
      deployment: deployment ? this.deploymentToResponse(deployment) : undefined,
      draftRevision: draftRevision ? this.revisionToResponse(draftRevision, revisionActors) : undefined,
      publishedRevision: publishedRevision ? this.revisionToResponse(publishedRevision, revisionActors) : undefined,
      channels: (deployment?.channels as Record<string, unknown>) ?? {},
      latestDryRun: latestDryRun ? this.dryRunToResponse(latestDryRun) : undefined,
      metricsSummary: this.summarizeMetrics(metrics as unknown as Array<Record<string, unknown>>),
    };
  }

  private async loadEffectiveDocuments(programId: string, workspaceIds: string[]): Promise<Record<string, unknown>[]> {
    if (workspaceIds.length === 0) return [];
    const governanceDocuments = await this.documentStore.listForProgramWorkspaces(programId, workspaceIds, false);
    const artifacts = await this.workspaceDocumentReadPort.find({ ids: governanceDocuments.map((document) => document.documentId), isFolder: false });
    const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
    return governanceDocuments.map((governance) => {
      const document = byId.get(governance.documentId);
      return { id: governance.id, programId: governance.programId, documentId: governance.documentId, workspaceId: governance.workspaceId, document: document ? { originalName: document.originalName, mimeType: document.mimeType, type: document.type, sourceUrl: document.sourceUrl, contentHash: document.contentHash, status: document.status, indexingStatus: document.indexingStatus, updatedAt: document.updatedAt } : undefined, governance: { status: governance.status, validity: governance.validity, tags: governance.tags, metadata: governance.metadata, ownerUserId: governance.ownerUserId, ownerScopeId: governance.ownerScopeId, updatedAt: governance.updatedAt } };
    });
  }

  private async loadEffectiveWorkspaceBindings(programId: string, scopeId: string): Promise<GovernanceBindingRecord[]> {
    return this.bindingStore.listEnabled(programId, [scopeId]);
  }

  private async findRevision(revisionId?: string): Promise<GovernanceRevisionRecord | null> {
    if (!revisionId) return null;
    return this.revisionStore.findById(revisionId);
  }

  private async findLatestDryRun(deploymentId?: string): Promise<GovernanceDryRunRecord | null> {
    if (!deploymentId) return null;
    return this.dryRunStore.findLatestByDeployment(deploymentId);
  }

  private buildChecks(scope: GovernanceScopeRecord, documents: Record<string, unknown>[], hasWorkspaceBinding: boolean, draftRevision: GovernanceRevisionRecord | null, latestDryRun: GovernanceDryRunRecord | null, memberships: Array<Record<string, unknown>>, agents: Record<string, unknown>[]): GovernanceScopeOverviewCheck[] {
    const agentIds = Array.isArray(scope.agentIds) ? scope.agentIds : [];
    const knowledge = scope.knowledge as { sourceMode?: string } | undefined;
    // LLM-only scopes need no mapped workspaces; legacy scopes without the
    // knowledge setting keep the workspace-binding requirement.
    const knowledgeConfigured = knowledge?.sourceMode === 'llm_only' || hasWorkspaceBinding;
    const ownershipAssigned = (memberships as Array<Record<string, unknown>>).some((membership) => membership.status === 'active' && String(membership.role) === 'scope_approver');
    const guardrailsReviewed = agents.length > 0 && agents.every((agent) => this.hasAnyGuardrailEnabled(agent));
    const audience = scope.audience as { mode?: string; userIds?: unknown[]; groupIds?: unknown[] } | undefined;
    const audienceConfigured = audience?.mode === 'all_authenticated' || Boolean(audience?.userIds?.length || audience?.groupIds?.length);
    const roster = draftRevision?.allowedAgentIds ?? (draftRevision?.agentId ? [draftRevision.agentId] : []);
    const mappedAgentIds = new Set(agentIds.map(String));
    const rosterValid = roster.length > 0 && roster.every((id) => mappedAgentIds.has(String(id)));
    const workspaceSetValid = draftRevision !== null && Array.isArray(draftRevision.workspaceIds);
    return [
      this.check('scope_active', 'Scope active', scope.status === 'active', 'blocking', 'rule'),
      this.check('agents_mapped', 'Agent mapped', agentIds.length > 0, 'blocking', 'agent'),
      this.check('knowledge_mapped', 'Knowledge mapped', knowledgeConfigured, 'blocking', 'workspace'),
      this.check('ownership_assigned', 'Ownership assigned', ownershipAssigned, 'blocking', 'rule'),
      this.check('guardrails_reviewed', 'Guardrails reviewed', guardrailsReviewed, 'warning', 'agent'),
      this.check('draft_revision', 'Draft revision exists', Boolean(draftRevision), 'blocking', 'rule'),
      this.check('dry_run_passed', 'Dry-run passed', latestDryRun?.status === 'passed' && String(latestDryRun.revisionId) === String(draftRevision?.id), 'warning', 'dry_run'),
      this.check('audience_configured', 'Audience configured', audienceConfigured, 'warning', 'audience'),
      this.check('published_agent_roster_valid', 'Published assistant roster valid', rosterValid, 'blocking', 'agent'),
      this.check('published_workspace_set_valid', 'Published knowledge set valid', workspaceSetValid, 'blocking', 'workspace'),
      ...documents.map((document) => this.documentReviewCheck(document)),
    ];
  }

  private async findScopeMemberships(programId: string, scopeId: string): Promise<Array<Record<string, unknown>>> {
    const memberships = await this.membershipStore.listByProgram(programId);
    return memberships
      .filter((membership) => membership.status === 'active' && (!membership.scopeId || membership.scopeId === scopeId))
      .map((membership) => membership as unknown as Record<string, unknown>);
  }

  private async findMappedAgents(agentIds: unknown[]): Promise<Record<string, unknown>[]> {
    const ids = Array.isArray(agentIds) ? agentIds.filter((id): id is string => Boolean(id)) : [];
    if (ids.length === 0) return [];
    return this.agentRepository.findByIds(ids.map(String)) as unknown as Promise<Record<string, unknown>[]>;
  }

  private async findRevisionActors(revisions: Array<unknown>): Promise<Map<string, GovernanceActorSummary>> {
    const ids = [...new Set(revisions.flatMap((revision) => [(revision as { createdBy?: string } | null)?.createdBy, (revision as { publishedBy?: string } | null)?.publishedBy]).filter(Boolean).map(String))];
    if (ids.length === 0) return new Map();
    const users = await this.userLookup.byIds(ids);
    return new Map([...users.values()].map((user) => {
      const displayName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.email;
      return [user.id, { id: user.id, displayName, email: user.email }];
    }));
  }

  private hasAnyGuardrailEnabled(agent: Record<string, unknown>): boolean {
    const guardrails = agent.guardrails as { promptInjection?: Record<string, unknown>; toolActionReview?: Record<string, unknown> } | undefined;
    return Boolean(guardrails?.promptInjection?.inputEnabled || guardrails?.promptInjection?.outputEnabled || guardrails?.toolActionReview?.enabled);
  }

  private check(key: string, label: string, passed: boolean, severity: CheckSeverity, targetType: string): GovernanceScopeOverviewCheck {
    return { key, label, status: passed ? 'passed' : 'failed', severity, targetType };
  }

  private documentReviewCheck(entry: Record<string, unknown>): GovernanceScopeOverviewCheck {
    const governance = entry.governance as { status?: string; validity?: { businessStatus?: string } };
    const document = entry.document as { originalName?: string } | undefined;
    const isBlocked = governance.status === 'rejected' || ['expired', 'conflicting', 'suspended'].includes(governance.validity?.businessStatus ?? '');
    const needsReview = governance.status === 'to_review' || governance.validity?.businessStatus === 'needs_review';
    return { key: `document_${String(entry.documentId)}`, label: document?.originalName ?? String(entry.documentId), status: isBlocked ? 'failed' : needsReview ? 'warning' : 'passed', severity: isBlocked ? 'blocking' : 'warning', targetType: 'document', targetId: String(entry.documentId) };
  }

  private buildReadiness(checks: GovernanceScopeOverviewCheck[]): GovernanceScopeOverview['readiness'] {
    const blockers = checks.filter((check) => check.severity === 'blocking' && check.status === 'failed');
    const warnings = checks.filter((check) => check.severity === 'warning' && check.status !== 'passed');
    const score = Math.round((checks.filter((check) => check.status === 'passed').length / checks.length) * 100);
    return { score, status: blockers.length ? 'blocked' : warnings.length ? 'warning' : 'ready', blockers, warnings, checks };
  }

  private buildAgentSummary(agentIds: string[]): GovernanceScopeOverview['agents'] {
    const mappedAgents = agentIds.map((id, index) => ({ id, isPrimary: index === 0 }));
    return { mappedAgents, primaryAgentId: mappedAgents[0]?.id, missingAgent: mappedAgents.length === 0 };
  }

  private summarizeMetrics(metrics: Array<Record<string, unknown>>): GovernanceScopeOverview['metricsSummary'] {
    const initialSummary: GovernanceScopeOverview['metricsSummary'] = { totalEvents: 0, byChannel: {}, byType: {} };
    return metrics.reduce<GovernanceScopeOverview['metricsSummary']>((summary, metric) => {
      const value = Number(metric.value ?? 0);
      const channel = String(metric.channel ?? 'unknown');
      const type = String(metric.type ?? 'unknown');
      summary.totalEvents += value;
      summary.byChannel[channel] = (summary.byChannel[channel] ?? 0) + value;
      summary.byType[type] = (summary.byType[type] ?? 0) + value;
      return summary;
    }, initialSummary);
  }

  private scopeToResponse(scope: GovernanceScopeRecord): Record<string, unknown> {
    const knowledge = scope.knowledge ?? { sourceMode: 'llm_only' as const, webSourcesEnabled: false, webAllowedDomains: [] as string[], webBlockedDomains: [] as string[] };
    return { id: scope.id, programId: scope.programId, parentScopeId: scope.parentScopeId, name: scope.name, type: scope.type, status: scope.status, agentIds: scope.agentIds ?? [], metadata: scope.metadata ?? {}, knowledge: { sourceMode: knowledge.sourceMode ?? 'llm_only', webSourcesEnabled: knowledge.webSourcesEnabled ?? false, webAllowedDomains: knowledge.webAllowedDomains ?? [], webBlockedDomains: knowledge.webBlockedDomains ?? [] }, createdAt: this.toIso(scope.createdAt), updatedAt: this.toIso(scope.updatedAt) };
  }

  private deploymentToResponse(deployment: GovernanceDeploymentRecord): Record<string, unknown> {
    return { id: deployment.id, programId: deployment.programId, scopeId: deployment.scopeId, name: deployment.name, status: deployment.status, currentDraftRevisionId: deployment.currentDraftRevisionId, currentPublishedRevisionId: deployment.currentPublishedRevisionId, channels: deployment.channels ?? {}, createdAt: this.toIso(deployment.createdAt), updatedAt: this.toIso(deployment.updatedAt) };
  }

  private revisionToResponse(revision: GovernanceRevisionRecord, actors: Map<string, GovernanceActorSummary>): Record<string, unknown> {
    const allowedAgentIds = revision.allowedAgentIds ?? [];
    const createdBy = String(revision.createdBy);
    const publishedBy = revision.publishedBy;
    return { id: revision.id, deploymentId: revision.deploymentId, revisionNumber: revision.revisionNumber, status: revision.status, agentId: String(revision.agentId ?? ''), allowedAgentIds: allowedAgentIds.length > 0 ? allowedAgentIds : [String(revision.agentId ?? '')], workspaceIds: revision.workspaceIds ?? [], workspaceBindingSnapshot: revision.workspaceBindingSnapshot ?? {}, configurationFingerprint: revision.configurationFingerprint, scopeSnapshot: revision.scopeSnapshot ?? {}, audienceSnapshot: revision.audienceSnapshot ?? {}, previousAudienceSnapshot: revision.previousAudienceSnapshot ?? {}, createdBy, createdByUser: actors.get(createdBy), publishedBy, publishedByUser: publishedBy ? actors.get(publishedBy) : undefined, publishedAt: this.toOptionalIso(revision.publishedAt), createdAt: this.toIso(revision.createdAt), updatedAt: this.toIso(revision.updatedAt) };
  }

  private dryRunToResponse(dryRun: GovernanceDryRunRecord): Record<string, unknown> {
    return { id: dryRun.id, programId: dryRun.programId, scopeId: dryRun.scopeId, deploymentId: dryRun.deploymentId, revisionId: dryRun.revisionId, conversationId: dryRun.conversationId, testerId: dryRun.testerId, status: dryRun.status, testCases: dryRun.testCases ?? [], checks: dryRun.checks ?? {}, createdAt: this.toIso(dryRun.createdAt), updatedAt: this.toIso(dryRun.updatedAt) };
  }

  private toIso(value: unknown): string { return value instanceof Date ? value.toISOString() : String(value ?? ''); }
  private toOptionalIso(value: unknown): string | undefined { return value ? this.toIso(value) : undefined; }
}
