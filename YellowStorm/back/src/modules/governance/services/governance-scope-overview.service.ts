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
import { GovernanceDocument, GovernanceDocumentDocument } from '../schemas/governance-document.schema';
import { GovernanceWorkspaceBinding, GovernanceWorkspaceBindingDocument } from '../schemas/governance-workspace-binding.schema';
import { WorkspaceDoc, WorkspaceDocumentDoc } from '@modules/workspace/schemas/workspace-document.schema';
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
    @InjectModel(GovernanceScope.name) private readonly scopeModel: Model<GovernanceScopeDocument>,
    @InjectModel(GovernanceDocument.name) private readonly documentModel: Model<GovernanceDocumentDocument>,
    @InjectModel(WorkspaceDoc.name) private readonly workspaceDocumentModel: Model<WorkspaceDocumentDoc>,
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
    const [scope, workspaceBindings, deployment] = await Promise.all([
      this.scopeModel.findOne({ _id: new Types.ObjectId(scopeId), programId: new Types.ObjectId(programId) }).lean().exec(),
      this.loadEffectiveWorkspaceBindings(programId, scopeId),
      this.deploymentModel.findOne({ programId: new Types.ObjectId(programId), scopeId: new Types.ObjectId(scopeId) }).sort({ updatedAt: -1 }).lean().exec(),
    ]);
    if (!scope) throw new NotFoundException(ErrorCode.GOVERNANCE_SCOPE_NOT_FOUND);
    const documents = await this.loadEffectiveDocuments(programId, workspaceBindings.map((binding) => String(binding.workspaceId)));
    const [draftRevision, publishedRevision, latestDryRun, scopeMemberships, metrics, mappedAgents, canApprove] = await Promise.all([
      this.findRevision(deployment?.currentDraftRevisionId),
      this.findRevision(deployment?.currentPublishedRevisionId),
      this.findLatestDryRun(deployment?._id),
      this.findScopeMemberships(programId, scopeId),
      this.metricModel.find({ programId: new Types.ObjectId(programId), scopeId: new Types.ObjectId(scopeId) }).lean().exec(),
      this.findMappedAgents(scope.agentIds ?? []),
      this.accessService.canActInScopeRole(actorId, programId, scopeId, ['scope_approver']),
    ]);
    const checks = this.buildChecks(scope, documents, workspaceBindings.length > 0, draftRevision, latestDryRun, scopeMemberships, mappedAgents);
    const revisionActors = await this.findRevisionActors([draftRevision, publishedRevision]);
    const sharedWorkspaces = workspaceBindings.filter((binding) => binding.visibility === 'program_shared');
    const localWorkspaces = workspaceBindings.filter((binding) => binding.visibility !== 'program_shared');
    return {
      scope: this.scopeToResponse(scope),
      authorization: { canApprove },
      readiness: this.buildReadiness(checks),
      knowledge: {
        sharedWorkspaces,
        localWorkspaces,
        documents,
        reviewBlockers: checks.filter((check) => check.targetType === 'document' && check.status !== 'passed'),
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

  private async loadEffectiveDocuments(programId: string, workspaceIds: string[]): Promise<Record<string, unknown>[]> {
    if (workspaceIds.length === 0) return [];
    const governanceDocuments = await this.documentModel.find({ programId: new Types.ObjectId(programId), workspaceId: { $in: workspaceIds.map((id) => new Types.ObjectId(id)) }, status: { $ne: 'archived' } }).sort({ updatedAt: -1 }).lean().exec();
    const artifacts = await this.workspaceDocumentModel.find({ _id: { $in: governanceDocuments.map((document) => document.documentId) }, isFolder: false }).lean().exec();
    const byId = new Map(artifacts.map((artifact) => [artifact._id.toString(), artifact]));
    return governanceDocuments.map((governance) => {
      const document = byId.get(governance.documentId.toString());
      return { id: governance._id.toString(), programId: governance.programId.toString(), documentId: governance.documentId.toString(), workspaceId: governance.workspaceId.toString(), document: document ? { originalName: document.originalName, mimeType: document.mimeType, type: document.type, sourceUrl: document.sourceUrl, contentHash: document.contentHash, status: document.status, indexingStatus: document.indexingStatus, updatedAt: document.updatedAt } : undefined, governance: { status: governance.status, validity: governance.validity, tags: governance.tags, metadata: governance.metadata, ownerUserId: governance.ownerUserId?.toString(), ownerScopeId: governance.ownerScopeId?.toString(), updatedAt: governance.updatedAt } };
    });
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

  private buildChecks(scope: Record<string, unknown>, documents: Record<string, unknown>[], hasWorkspaceBinding: boolean, draftRevision: Record<string, unknown> | null, latestDryRun: Record<string, unknown> | null, memberships: Record<string, unknown>[], agents: Record<string, unknown>[]): GovernanceScopeOverviewCheck[] {
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
      this.check('knowledge_mapped', 'Knowledge mapped', hasWorkspaceBinding && documents.some((entry) => (entry.document as { status?: string; indexingStatus?: string } | undefined)?.status === 'completed' && (entry.document as { indexingStatus?: string } | undefined)?.indexingStatus === 'ready'), 'blocking', 'document'),
      this.check('ownership_assigned', 'Ownership assigned', ownershipAssigned, 'blocking', 'rule'),
      this.check('guardrails_reviewed', 'Guardrails reviewed', guardrailsReviewed, 'warning', 'agent'),
      this.check('draft_revision', 'Draft revision exists', Boolean(draftRevision), 'blocking', 'rule'),
      this.check('dry_run_passed', 'Dry-run passed', latestDryRun?.status === 'passed' && String(latestDryRun.revisionId) === String(draftRevision?._id), 'warning', 'dry_run'),
      this.check('audience_configured', 'Audience configured', audienceConfigured, 'warning', 'audience'),
      this.check('published_agent_roster_valid', 'Published assistant roster valid', rosterValid, 'blocking', 'agent'),
      this.check('published_workspace_set_valid', 'Published knowledge set valid', workspaceSetValid, 'blocking', 'workspace'),
      ...documents.map((document) => this.documentReviewCheck(document)),
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

  private deploymentToResponse(doc: Record<string, unknown>): Record<string, unknown> {
    return { id: String(doc._id), programId: String(doc.programId), scopeId: String(doc.scopeId), name: doc.name, status: doc.status, currentDraftRevisionId: this.optionalId(doc.currentDraftRevisionId), currentPublishedRevisionId: this.optionalId(doc.currentPublishedRevisionId), channels: doc.channels ?? {}, createdAt: this.toIso(doc.createdAt), updatedAt: this.toIso(doc.updatedAt) };
  }

  private revisionToResponse(doc: Record<string, unknown>, actors: Map<string, GovernanceActorSummary>): Record<string, unknown> {
    const allowedAgentIds = this.toStrings(doc.allowedAgentIds);
    const createdBy = String(doc.createdBy);
    const publishedBy = this.optionalId(doc.publishedBy);
    return { id: String(doc._id), deploymentId: String(doc.deploymentId), revisionNumber: doc.revisionNumber, status: doc.status, agentId: String(doc.agentId), allowedAgentIds: allowedAgentIds.length > 0 ? allowedAgentIds : [String(doc.agentId)], workspaceIds: this.toStrings(doc.workspaceIds), workspaceBindingSnapshot: doc.workspaceBindingSnapshot ?? {}, configurationFingerprint: doc.configurationFingerprint, scopeSnapshot: doc.scopeSnapshot ?? {}, audienceSnapshot: doc.audienceSnapshot ?? {}, previousAudienceSnapshot: doc.previousAudienceSnapshot ?? {}, createdBy, createdByUser: actors.get(createdBy), publishedBy, publishedByUser: publishedBy ? actors.get(publishedBy) : undefined, publishedAt: this.toOptionalIso(doc.publishedAt), createdAt: this.toIso(doc.createdAt), updatedAt: this.toIso(doc.updatedAt) };
  }

  private dryRunToResponse(doc: Record<string, unknown>): Record<string, unknown> {
    return { id: String(doc._id), programId: String(doc.programId), scopeId: String(doc.scopeId), deploymentId: String(doc.deploymentId), revisionId: String(doc.revisionId), conversationId: this.optionalId(doc.conversationId), testerId: String(doc.testerId), status: doc.status, testCases: doc.testCases ?? [], checks: doc.checks ?? {}, createdAt: this.toIso(doc.createdAt), updatedAt: this.toIso(doc.updatedAt) };
  }

  private toStrings(value: unknown): string[] { return Array.isArray(value) ? value.map((id) => id.toString()) : []; }
  private optionalId(value: unknown): string | undefined { return value ? value.toString() : undefined; }
  private toIso(value: unknown): string { return value instanceof Date ? value.toISOString() : String(value ?? ''); }
  private toOptionalIso(value: unknown): string | undefined { return value ? this.toIso(value) : undefined; }
}
