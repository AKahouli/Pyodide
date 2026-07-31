import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { GovernanceAccessService } from './governance-access.service';
import { GovernanceProgramService } from './governance-program.service';
import { GovernanceDeployment, GovernanceDeploymentDocument } from '../schemas/governance-deployment.schema';
import { GovernanceDeploymentRevision, GovernanceDeploymentRevisionDocument } from '../schemas/governance-deployment-revision.schema';
import { GovernanceDryRun, GovernanceDryRunDocument } from '../schemas/governance-dry-run.schema';
import { GovernanceMembership, GovernanceMembershipDocument } from '../schemas/governance-membership.schema';
import { GovernanceMetric, GovernanceMetricDocument } from '../schemas/governance-metric.schema';
import { GovernanceScope, GovernanceScopeDocument } from '../schemas/governance-scope.schema';
import { GovernanceSource, GovernanceSourceDocument } from '../schemas/governance-source.schema';
import { GovernanceWorkspaceBinding, GovernanceWorkspaceBindingDocument } from '../schemas/governance-workspace-binding.schema';
import { Agent, AgentDocument } from '@modules/agent/schemas/agent.schema';
import { User, UserDocument } from '@modules/user/schemas/user.schema';

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
  knowledge: { sharedSources: Record<string, unknown>[]; localSources: Record<string, unknown>[]; workspaceMappings: Record<string, unknown>[]; reviewBlockers: GovernanceScopeOverviewCheck[] };
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
    @InjectModel(GovernanceScope.name) private readonly scopeModel: Model<GovernanceScopeDocument>,
    @InjectModel(GovernanceSource.name) private readonly sourceModel: Model<GovernanceSourceDocument>,
    @InjectModel(GovernanceWorkspaceBinding.name) private readonly workspaceBindingModel: Model<GovernanceWorkspaceBindingDocument>,
    @InjectModel(GovernanceDeployment.name) private readonly deploymentModel: Model<GovernanceDeploymentDocument>,
    @InjectModel(GovernanceDeploymentRevision.name) private readonly revisionModel: Model<GovernanceDeploymentRevisionDocument>,
    @InjectModel(GovernanceDryRun.name) private readonly dryRunModel: Model<GovernanceDryRunDocument>,
    @InjectModel(GovernanceMembership.name) private readonly membershipModel: Model<GovernanceMembershipDocument>,
    @InjectModel(GovernanceMetric.name) private readonly metricModel: Model<GovernanceMetricDocument>,
    @InjectModel(Agent.name) private readonly agentModel: Model<AgentDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly programService: GovernanceProgramService,
    private readonly accessService: GovernanceAccessService,
  ) {}

  async getOverview(actorId: string, programId: string, scopeId: string): Promise<GovernanceScopeOverview> {
    await this.programService.assertOwnedProgram(actorId, programId);
    await this.accessService.assertScopeAccess(actorId, programId, scopeId);
    const [scope, sources, workspaceBindings, deployment] = await Promise.all([
      this.scopeModel.findOne({ _id: new Types.ObjectId(scopeId), programId: new Types.ObjectId(programId) }).lean().exec(),
      this.loadEffectiveSources(programId, scopeId),
      this.loadEffectiveWorkspaceBindings(programId, scopeId),
      this.deploymentModel.findOne({ programId: new Types.ObjectId(programId), scopeId: new Types.ObjectId(scopeId) }).sort({ updatedAt: -1 }).lean().exec(),
    ]);
    if (!scope) throw new NotFoundException(ErrorCode.GOVERNANCE_SCOPE_NOT_FOUND);
    const [draftRevision, publishedRevision, latestDryRun, scopeMemberships, metrics, mappedAgents, canApprove] = await Promise.all([
      this.findRevision(deployment?.currentDraftRevisionId),
      this.findRevision(deployment?.currentPublishedRevisionId),
      this.findLatestDryRun(deployment?._id),
      this.findScopeMemberships(programId, scopeId),
      this.metricModel.find({ programId: new Types.ObjectId(programId), scopeId: new Types.ObjectId(scopeId) }).lean().exec(),
      this.findMappedAgents(scope.agentIds ?? []),
      this.accessService.canActInScopeRole(actorId, programId, scopeId, ['scope_approver']),
    ]);
    const checks = this.buildChecks(scope, sources, workspaceBindings.length > 0, draftRevision, latestDryRun, scopeMemberships, mappedAgents);
    const revisionActors = await this.findRevisionActors([draftRevision, publishedRevision]);
    const sharedSources = sources.filter((source) => source.visibility === 'program_shared');
    const localSources = sources.filter((source) => source.visibility !== 'program_shared');
    return {
      scope: this.scopeToResponse(scope),
      authorization: { canApprove },
      readiness: this.buildReadiness(checks),
      knowledge: {
        sharedSources: sharedSources.map((source) => this.sourceToResponse(source)),
        localSources: localSources.map((source) => this.sourceToResponse(source)),
        workspaceMappings: sources.filter((source) => source.workspaceId).map((source) => this.sourceToResponse(source)),
        reviewBlockers: checks.filter((check) => check.targetType === 'source' && check.status !== 'passed'),
      },
      agents: this.buildAgentSummary(scope.agentIds ?? []),
      deployment: deployment ? this.deploymentToResponse(deployment) : undefined,
      draftRevision: draftRevision ? this.revisionToResponse(draftRevision, revisionActors) : undefined,
      publishedRevision: publishedRevision ? this.revisionToResponse(publishedRevision, revisionActors) : undefined,
      channels: (deployment?.channels as Record<string, unknown>) ?? {},
      latestDryRun: latestDryRun ? this.dryRunToResponse(latestDryRun) : undefined,
      metricsSummary: this.summarizeMetrics(metrics),
    };
  }

  private async loadEffectiveSources(programId: string, scopeId: string): Promise<Record<string, unknown>[]> {
    return this.sourceModel.find({
      programId: new Types.ObjectId(programId),
      $or: [{ visibility: 'program_shared' }, { scopeIds: new Types.ObjectId(scopeId) }],
    }).sort({ visibility: 1, title: 1 }).lean().exec();
  }

  private async loadEffectiveWorkspaceBindings(programId: string, scopeId: string): Promise<Record<string, unknown>[]> {
    return this.workspaceBindingModel.find({ programId: new Types.ObjectId(programId), enabled: true, $or: [{ visibility: 'program_shared' }, { scopeIds: new Types.ObjectId(scopeId) }] }).lean().exec();
  }

  private async findRevision(revisionId?: Types.ObjectId): Promise<Record<string, unknown> | null> {
    if (!revisionId) return null;
    return this.revisionModel.findById(revisionId).lean().exec();
  }

  private async findLatestDryRun(deploymentId?: Types.ObjectId): Promise<Record<string, unknown> | null> {
    if (!deploymentId) return null;
    return this.dryRunModel.findOne({ deploymentId }).sort({ createdAt: -1 }).lean().exec();
  }

  private buildChecks(scope: Record<string, unknown>, sources: Record<string, unknown>[], hasWorkspaceBinding: boolean, draftRevision: Record<string, unknown> | null, latestDryRun: Record<string, unknown> | null, memberships: Record<string, unknown>[], agents: Record<string, unknown>[]): GovernanceScopeOverviewCheck[] {
    const agentIds = Array.isArray(scope.agentIds) ? scope.agentIds : [];
    const ownershipAssigned = memberships.some((membership) => membership.status === 'active' && String(membership.role) === 'scope_approver');
    const guardrailsReviewed = agents.length > 0 && agents.every((agent) => this.hasAnyGuardrailEnabled(agent));
    const audience = scope.audience as { mode?: string; userIds?: unknown[]; groupIds?: unknown[] } | undefined;
    const audienceConfigured = audience?.mode === 'all_authenticated' || Boolean(audience?.userIds?.length || audience?.groupIds?.length);
    const roster = (draftRevision?.allowedAgentIds as unknown[] | undefined) ?? (draftRevision?.agentId ? [draftRevision.agentId] : []);
    const mappedAgentIds = new Set(agentIds.map(String));
    const rosterValid = roster.length > 0 && roster.every((id) => mappedAgentIds.has(String(id)));
    const workspaceSetValid = draftRevision !== null && Array.isArray(draftRevision.workspaceIds);
    return [
      this.check('scope_active', 'Scope active', scope.status === 'active', 'blocking', 'rule'),
      this.check('agents_mapped', 'Agent mapped', agentIds.length > 0, 'blocking', 'agent'),
      this.check('knowledge_mapped', 'Knowledge mapped', sources.length > 0 || hasWorkspaceBinding, 'blocking', 'source'),
      this.check('ownership_assigned', 'Ownership assigned', ownershipAssigned, 'blocking', 'rule'),
      this.check('guardrails_reviewed', 'Guardrails reviewed', guardrailsReviewed, 'warning', 'agent'),
      this.check('draft_revision', 'Draft revision exists', Boolean(draftRevision), 'blocking', 'rule'),
      this.check('dry_run_passed', 'Dry-run passed', latestDryRun?.status === 'passed' && String(latestDryRun.revisionId) === String(draftRevision?._id), 'warning', 'dry_run'),
      this.check('audience_configured', 'Audience configured', audienceConfigured, 'warning', 'audience'),
      this.check('published_agent_roster_valid', 'Published assistant roster valid', rosterValid, 'blocking', 'agent'),
      this.check('published_workspace_set_valid', 'Published knowledge set valid', workspaceSetValid, 'blocking', 'workspace'),
      ...sources.map((source) => this.sourceReviewCheck(source)),
    ];
  }

  private async findScopeMemberships(programId: string, scopeId: string): Promise<Record<string, unknown>[]> {
    return this.membershipModel.find({
      programId: new Types.ObjectId(programId),
      status: 'active',
      $or: [{ scopeId: null }, { scopeId: new Types.ObjectId(scopeId) }],
    }).lean().exec();
  }

  private async findMappedAgents(agentIds: unknown[]): Promise<Record<string, unknown>[]> {
    const ids = Array.isArray(agentIds) ? agentIds.filter((id): id is Types.ObjectId | string => Boolean(id)) : [];
    if (ids.length === 0) return [];
    return this.agentModel.find({ _id: { $in: ids.map((id) => new Types.ObjectId(String(id))) } }).lean().exec();
  }

  private async findRevisionActors(revisions: Array<Record<string, unknown> | null>): Promise<Map<string, GovernanceActorSummary>> {
    const ids = [...new Set(revisions.flatMap((revision) => [revision?.createdBy, revision?.publishedBy]).filter(Boolean).map(String))];
    if (ids.length === 0) return new Map();
    const users = await this.userModel.find({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) } }).select('email profile').lean().exec();
    return new Map(users.map((user) => {
      const profile = user.profile as { firstName?: string; lastName?: string } | undefined;
      const displayName = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ').trim() || user.email;
      return [user._id.toString(), { id: user._id.toString(), displayName, email: user.email }];
    }));
  }

  private hasAnyGuardrailEnabled(agent: Record<string, unknown>): boolean {
    const promptInjection = (agent.guardrails as { promptInjection?: Record<string, unknown> } | undefined)?.promptInjection;
    return Boolean(promptInjection?.inputGuardrailEnabled || promptInjection?.outputGuardrailEnabled || promptInjection?.toolCallGuardrailEnabled);
  }

  private check(key: string, label: string, passed: boolean, severity: CheckSeverity, targetType: string): GovernanceScopeOverviewCheck {
    return { key, label, status: passed ? 'passed' : 'failed', severity, targetType };
  }

  private sourceReviewCheck(source: Record<string, unknown>): GovernanceScopeOverviewCheck {
    const isBlocked = source.status === 'expired' || source.status === 'rejected';
    const needsReview = source.status === 'to_review';
    return { key: `source_${String(source._id)}`, label: String(source.title), status: isBlocked ? 'failed' : needsReview ? 'warning' : 'passed', severity: isBlocked ? 'blocking' : 'warning', targetType: 'source', targetId: String(source._id) };
  }

  private buildReadiness(checks: GovernanceScopeOverviewCheck[]): GovernanceScopeOverview['readiness'] {
    const blockers = checks.filter((check) => check.severity === 'blocking' && check.status === 'failed');
    const warnings = checks.filter((check) => check.severity === 'warning' && check.status !== 'passed');
    const score = Math.round((checks.filter((check) => check.status === 'passed').length / checks.length) * 100);
    return { score, status: blockers.length ? 'blocked' : warnings.length ? 'warning' : 'ready', blockers, warnings, checks };
  }

  private buildAgentSummary(agentIds: Types.ObjectId[]): GovernanceScopeOverview['agents'] {
    const mappedAgents = agentIds.map((id, index) => ({ id: id.toString(), isPrimary: index === 0 }));
    return { mappedAgents, primaryAgentId: mappedAgents[0]?.id, missingAgent: mappedAgents.length === 0 };
  }

  private summarizeMetrics(metrics: Record<string, unknown>[]): GovernanceScopeOverview['metricsSummary'] {
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

  private scopeToResponse(doc: Record<string, unknown>): Record<string, unknown> {
    return { id: String(doc._id), programId: String(doc.programId), parentScopeId: this.optionalId(doc.parentScopeId), name: doc.name, type: doc.type, status: doc.status, agentIds: this.toStrings(doc.agentIds), metadata: doc.metadata ?? {}, createdAt: this.toIso(doc.createdAt), updatedAt: this.toIso(doc.updatedAt) };
  }

  private sourceToResponse(doc: Record<string, unknown>): Record<string, unknown> {
    return { id: String(doc._id), programId: String(doc.programId), scopeIds: this.toStrings(doc.scopeIds), visibility: doc.visibility, title: doc.title, sourceType: doc.sourceType, url: doc.url, workspaceId: this.optionalId(doc.workspaceId), documentId: this.optionalId(doc.documentId), status: doc.status, tags: doc.tags ?? [], metadata: doc.metadata ?? {}, createdAt: this.toIso(doc.createdAt), updatedAt: this.toIso(doc.updatedAt) };
  }

  private deploymentToResponse(doc: Record<string, unknown>): Record<string, unknown> {
    return { id: String(doc._id), programId: String(doc.programId), scopeId: String(doc.scopeId), name: doc.name, status: doc.status, currentDraftRevisionId: this.optionalId(doc.currentDraftRevisionId), currentPublishedRevisionId: this.optionalId(doc.currentPublishedRevisionId), channels: doc.channels ?? {}, createdAt: this.toIso(doc.createdAt), updatedAt: this.toIso(doc.updatedAt) };
  }

  private revisionToResponse(doc: Record<string, unknown>, actors: Map<string, GovernanceActorSummary>): Record<string, unknown> {
    const allowedAgentIds = this.toStrings(doc.allowedAgentIds);
    const createdBy = String(doc.createdBy);
    const publishedBy = this.optionalId(doc.publishedBy);
    return { id: String(doc._id), deploymentId: String(doc.deploymentId), revisionNumber: doc.revisionNumber, status: doc.status, agentId: String(doc.agentId), allowedAgentIds: allowedAgentIds.length > 0 ? allowedAgentIds : [String(doc.agentId)], workspaceIds: this.toStrings(doc.workspaceIds), sourceIds: this.toStrings(doc.sourceIds), includedSourceIds: this.toStrings(doc.includedSourceIds), excludedSourceIds: this.toStrings(doc.excludedSourceIds), sourceSnapshot: doc.sourceSnapshot ?? {}, workspaceBindingSnapshot: doc.workspaceBindingSnapshot ?? {}, configurationFingerprint: doc.configurationFingerprint, scopeSnapshot: doc.scopeSnapshot ?? {}, audienceSnapshot: doc.audienceSnapshot ?? {}, previousAudienceSnapshot: doc.previousAudienceSnapshot ?? {}, createdBy, createdByUser: actors.get(createdBy), publishedBy, publishedByUser: publishedBy ? actors.get(publishedBy) : undefined, publishedAt: this.toOptionalIso(doc.publishedAt), createdAt: this.toIso(doc.createdAt), updatedAt: this.toIso(doc.updatedAt) };
  }

  private dryRunToResponse(doc: Record<string, unknown>): Record<string, unknown> {
    return { id: String(doc._id), programId: String(doc.programId), scopeId: String(doc.scopeId), deploymentId: String(doc.deploymentId), revisionId: String(doc.revisionId), conversationId: this.optionalId(doc.conversationId), testerId: String(doc.testerId), status: doc.status, testCases: doc.testCases ?? [], checks: doc.checks ?? {}, createdAt: this.toIso(doc.createdAt), updatedAt: this.toIso(doc.updatedAt) };
  }

  private toStrings(value: unknown): string[] { return Array.isArray(value) ? value.map((id) => id.toString()) : []; }
  private optionalId(value: unknown): string | undefined { return value ? value.toString() : undefined; }
  private toIso(value: unknown): string { return value instanceof Date ? value.toISOString() : String(value ?? ''); }
  private toOptionalIso(value: unknown): string | undefined { return value ? this.toIso(value) : undefined; }
}
