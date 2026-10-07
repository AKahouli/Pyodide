import { Injectable } from '@nestjs/common';
import { AuditLogService } from '@modules/authorization/services/audit-log.service';
import { ConversationService } from '@modules/conversation/services/conversation.service';
import { MessageService } from '@modules/conversation/services/message.service';
import { StreamService } from '@modules/conversation/services/stream.service';
import { BadRequestException, ConflictException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { CreateGovernanceDryRunDto, MarkGovernanceDryRunDto } from '../dto';
import {      type GovernanceDryRunRecord} from '../persistence';
import { GovernanceProgramService } from './governance-program.service';
import { GovernanceAccessService } from './governance-access.service';
import { PgDryRunStore } from '../persistence/postgres/pg-dry-run.store';
import { PgRevisionStore } from '../persistence/postgres/pg-revision.store';
import { PgDeploymentStore } from '../persistence/postgres/pg-deployment.store';

export interface GovernanceDryRunResponse {
  id: string;
  programId: string;
  scopeId: string;
  deploymentId: string;
  revisionId: string;
  conversationId?: string;
  testerId: string;
  status: 'running' | 'passed' | 'failed' | 'needs_review';
  executionMode: 'conversation' | 'manual';
  testCases: Record<string, unknown>[];
  checks: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class GovernanceDryRunService {
  constructor(
    private readonly dryRunStore: PgDryRunStore,
    private readonly deploymentStore: PgDeploymentStore,
    private readonly revisionStore: PgRevisionStore,
    private readonly programService: GovernanceProgramService,
    private readonly accessService: GovernanceAccessService,
    private readonly conversationService: ConversationService,
    private readonly messageService: MessageService,
    private readonly streamService: StreamService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async create(actorId: string, actorEmail: string, deploymentId: string, dto: CreateGovernanceDryRunDto): Promise<GovernanceDryRunResponse> {
    const deployment = await this.findOwnedDeployment(actorId, deploymentId);
    if (!deployment.currentDraftRevisionId) throw new ConflictException(ErrorCode.GOVERNANCE_NO_DRAFT_REVISION);
    const draftRevisionId = deployment.currentDraftRevisionId;
    const revision = await this.revisionStore.findById(draftRevisionId);
    if (!revision) throw new NotFoundException(ErrorCode.GOVERNANCE_REVISION_NOT_FOUND);
    const input = dto.input ?? this.firstTestCaseInput(dto.testCases) ?? '';
    const simulatedChannel = dto.simulatedChannel ?? 'api';
    const revisionWorkspaceIds = revision.workspaceIds;
    let workspaceIds = dto.workspaceIds?.length ? [...new Set(dto.workspaceIds)] : revisionWorkspaceIds;
    if (workspaceIds.some((workspaceId) => !revisionWorkspaceIds.includes(workspaceId))) {
      throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Dry-run workspaces must belong to the draft revision.');
    }
    // Which mapped agent to test — the panel lets the admin pick when several are mapped.
    // Falls back to the draft revision's primary agent when unspecified.
    const agentId = dto.agentId ?? revision.agentId ?? '';
    const revisionAgentIds = revision.allowedAgentIds?.length ? revision.allowedAgentIds : [revision.agentId ?? ''];
    if (!revisionAgentIds.includes(agentId)) {
      throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Dry-run agents must belong to the draft revision.');
    }
    if (dto.executionMode === 'manual') {
      await this.accessService.assertScopeRole(actorId, deployment.programId, deployment.scopeId, ['scope_admin', 'scope_editor', 'scope_reviewer']);
      if (dto.conversationId || input) {
        throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'A manual dry-run cannot include a conversation or test input.');
      }
      const dryRun = await this.dryRunStore.insert({
        programId: deployment.programId,
        scopeId: deployment.scopeId,
        deploymentId: deployment.id,
        revisionId: draftRevisionId,
        testerId: actorId,
        status: 'passed',
        executionMode: 'manual',
        testCases: [],
        checks: {
          ...(dto.checks ?? {}),
          draftRevisionId,
          agentId,
          workspaceIds,
          executionMode: 'manual',
          attestedAt: new Date().toISOString(),
        },
      });
      this.auditLogService.logSuccess({ actorId, actorEmail, action: 'governance.dry_run.manually_passed', targetType: 'governance_dry_run', targetId: dryRun.id, metadata: { deploymentId, revisionId: draftRevisionId, agentId, workspaceIds, executionMode: 'manual' } });
      return this.toResponse(dryRun);
    }
    let conversationId: string;
    if (dto.conversationId) {
      const existingDryRun = await this.dryRunStore.findContinuation(deployment.id, draftRevisionId, dto.conversationId, actorId);
      if (!existingDryRun) {
        throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Continue a dry-run conversation created for this draft.');
      }

      const priorChecks = existingDryRun.checks as Record<string, unknown> | undefined;
      const persistedWorkspaceIds = Array.isArray(priorChecks?.workspaceIds)
        ? priorChecks.workspaceIds.filter((workspaceId): workspaceId is string => typeof workspaceId === 'string')
        : revisionWorkspaceIds;
      if (persistedWorkspaceIds.some((workspaceId) => !revisionWorkspaceIds.includes(workspaceId))) {
        throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'The existing dry-run workspace scope is no longer valid for this draft.');
      }
      if (dto.workspaceIds?.length && !this.sameWorkspaceIds(workspaceIds, persistedWorkspaceIds)) {
        throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Continue a dry-run with the workspace selection used when it was started.');
      }

      const conversation = await this.conversationService.findById(dto.conversationId);
      if (!this.sameWorkspaceIds(conversation.workspaces, persistedWorkspaceIds)) {
        throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'The existing dry-run conversation no longer matches its workspace selection.');
      }
      workspaceIds = persistedWorkspaceIds;
      conversationId = dto.conversationId;
    } else {
      conversationId = (await this.conversationService.create(actorId, { title: 'Governance dry run', workspaces: workspaceIds })).id;
    }
    const requestId = `governance-dry-run:${draftRevisionId}:${Date.now()}`;
    const userMessage = await this.messageService.createUserMessage({ conversationId, senderId: actorId, content: input, agentIds: [agentId], requestId });
    const aiMessage = await this.messageService.createAIPlaceholder({ conversationId, questionMessageId: userMessage.id, requestId });
    const testCases = dto.testCases ?? [{ input, simulatedChannel, agentId, workspaceIds }];
    const dryRun = await this.dryRunStore.insert({
      programId: deployment.programId,
      scopeId: deployment.scopeId,
      deploymentId: deployment.id,
      revisionId: draftRevisionId,
      conversationId,
      testerId: actorId,
      status: 'running',
      executionMode: 'conversation',
      testCases,
      checks: { ...(dto.checks ?? {}), draftRevisionId, agentId, workspaceIds },
    });
    // Fire the stream non-blocking — mirrors MessageController so the POST returns
    // immediately (status 'running') and tokens are produced in the background. The
    // panel polls messages() for the reply and flips the readiness check once passed.
    void this.streamService
      .startStream(actorId, conversationId, aiMessage.id, { content: input, agentIds: [agentId] }, requestId, actorEmail)
      .then(() => this.finishDryRun(dryRun.id, 'passed', { runtime: 'completed', simulatedChannel }))
      .catch(async (error) => {
        await this.messageService.markStreamFailed(aiMessage.id).catch(() => undefined);
        await this.finishDryRun(dryRun.id, 'failed', { runtime: 'failed', simulatedChannel, error: error instanceof Error ? error.message : 'Unknown runtime failure' });
      });
    this.auditLogService.logSuccess({ actorId, actorEmail, action: 'governance.dry_run.created', targetType: 'governance_dry_run', targetId: dryRun.id, metadata: { deploymentId, revisionId: draftRevisionId, agentId, workspaceIds } });
    return this.toResponse(dryRun);
  }

  async list(actorId: string, deploymentId: string): Promise<GovernanceDryRunResponse[]> {
    await this.findOwnedDeployment(actorId, deploymentId);
    const dryRuns = await this.dryRunStore.listByDeployment(deploymentId);
    return dryRuns.map((dryRun) => this.toResponse(dryRun));
  }

  async findById(actorId: string, dryRunId: string): Promise<GovernanceDryRunResponse> {
    const dryRun = await this.findOwnedDryRun(actorId, dryRunId);
    return this.toResponse(dryRun);
  }

  async mark(actorId: string, actorEmail: string, dryRunId: string, dto: MarkGovernanceDryRunDto): Promise<GovernanceDryRunResponse> {
    const dryRun = await this.findOwnedDryRun(actorId, dryRunId);
    const updated = await this.dryRunStore.update(dryRun.id, { status: dto.status, ...(dto.checks !== undefined ? { checks: dto.checks } : {}) });
    if (!updated) throw new NotFoundException(ErrorCode.GOVERNANCE_DRY_RUN_NOT_FOUND);
    this.auditLogService.logSuccess({ actorId, actorEmail, action: 'governance.dry_run.marked', targetType: 'governance_dry_run', targetId: dryRunId, metadata: { status: dto.status } });
    return this.toResponse(updated);
  }

  async messages(actorId: string, dryRunId: string): Promise<Record<string, unknown>[]> {
    const dryRun = await this.findOwnedDryRun(actorId, dryRunId);
    if (dryRun.conversationId) {
      const page = await this.messageService.findByConversation(dryRun.conversationId, { page: 1, limit: 100 });
      return page.messages as unknown as Record<string, unknown>[];
    }
    return dryRun.testCases;
  }

  private async finishDryRun(dryRunId: string, status: 'passed' | 'failed', extraChecks: Record<string, unknown>): Promise<void> {
    const dryRun = await this.dryRunStore.findById(dryRunId);
    if (!dryRun) return;
    await this.dryRunStore.update(dryRunId, { status, checks: { ...dryRun.checks, ...extraChecks } });
  }

  private firstTestCaseInput(testCases?: Record<string, unknown>[]): string | undefined {
    const value = testCases?.find((testCase) => typeof testCase.input === 'string')?.input;
    return typeof value === 'string' ? value : undefined;
  }

  private sameWorkspaceIds(left: string[], right: string[]): boolean {
    return left.length === right.length && left.every((workspaceId) => right.includes(workspaceId));
  }

  private async findOwnedDeployment(actorId: string, deploymentId: string) {
    const deployment = await this.deploymentStore.findById(deploymentId);
    if (!deployment) throw new NotFoundException(ErrorCode.GOVERNANCE_DEPLOYMENT_NOT_FOUND);
    await this.programService.assertOwnedProgram(actorId, deployment.programId);
    await this.accessService.assertScopeAccess(actorId, deployment.programId, deployment.scopeId);
    return deployment;
  }

  private async findOwnedDryRun(actorId: string, dryRunId: string): Promise<GovernanceDryRunRecord> {
    const dryRun = await this.dryRunStore.findById(dryRunId);
    if (!dryRun) throw new NotFoundException(ErrorCode.GOVERNANCE_DRY_RUN_NOT_FOUND);
    await this.programService.assertOwnedProgram(actorId, dryRun.programId);
    await this.accessService.assertScopeAccess(actorId, dryRun.programId, dryRun.scopeId);
    return dryRun;
  }

  private toResponse(doc: GovernanceDryRunRecord): GovernanceDryRunResponse {
    return {
      id: doc.id,
      programId: doc.programId,
      scopeId: doc.scopeId,
      deploymentId: doc.deploymentId,
      revisionId: doc.revisionId,
      conversationId: doc.conversationId,
      testerId: doc.testerId,
      status: doc.status,
      executionMode: doc.executionMode === 'manual' ? 'manual' : 'conversation',
      testCases: doc.testCases ?? [],
      checks: doc.checks ?? {},
      createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : String(doc.createdAt),
      updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : String(doc.updatedAt),
    };
  }
}
