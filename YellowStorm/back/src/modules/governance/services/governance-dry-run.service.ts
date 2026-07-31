import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuditLogService } from '@modules/authorization/services/audit-log.service';
import { ConversationService } from '@modules/conversation/services/conversation.service';
import { MessageService } from '@modules/conversation/services/message.service';
import { StreamService } from '@modules/conversation/services/stream.service';
import { BadRequestException, ConflictException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { CreateGovernanceDryRunDto, MarkGovernanceDryRunDto } from '../dto';
import { GovernanceDeployment, GovernanceDeploymentDocument } from '../schemas/governance-deployment.schema';
import { GovernanceDeploymentRevision, GovernanceDeploymentRevisionDocument } from '../schemas/governance-deployment-revision.schema';
import { GovernanceDryRun, GovernanceDryRunDocument } from '../schemas/governance-dry-run.schema';
import { GovernanceProgramService } from './governance-program.service';
import { GovernanceAccessService } from './governance-access.service';

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
  testCases: Array<Record<string, unknown>>;
  checks: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class GovernanceDryRunService {
  constructor(
    @InjectModel(GovernanceDryRun.name) private readonly dryRunModel: Model<GovernanceDryRunDocument>,
    @InjectModel(GovernanceDeployment.name) private readonly deploymentModel: Model<GovernanceDeploymentDocument>,
    @InjectModel(GovernanceDeploymentRevision.name) private readonly revisionModel: Model<GovernanceDeploymentRevisionDocument>,
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
    const revision = await this.revisionModel.findById(deployment.currentDraftRevisionId).lean().exec();
    if (!revision) throw new NotFoundException(ErrorCode.GOVERNANCE_REVISION_NOT_FOUND);
    const input = dto.input ?? this.firstTestCaseInput(dto.testCases) ?? '';
    const simulatedChannel = dto.simulatedChannel ?? 'api';
    const revisionWorkspaceIds = revision.workspaceIds.map((id) => id.toString());
    let workspaceIds = dto.workspaceIds?.length ? [...new Set(dto.workspaceIds)] : revisionWorkspaceIds;
    if (workspaceIds.some((workspaceId) => !revisionWorkspaceIds.includes(workspaceId))) {
      throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Dry-run workspaces must belong to the draft revision.');
    }
    // Which mapped agent to test — the panel lets the admin pick when several are mapped.
    // Falls back to the draft revision's primary agent when unspecified.
    const agentId = dto.agentId ?? revision.agentId.toString();
    const revisionAgentIds = revision.allowedAgentIds?.length ? revision.allowedAgentIds.map((id) => id.toString()) : [revision.agentId.toString()];
    if (!revisionAgentIds.includes(agentId)) {
      throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Dry-run agents must belong to the draft revision.');
    }
    if (dto.executionMode === 'manual') {
      await this.accessService.assertScopeRole(actorId, deployment.programId.toString(), deployment.scopeId.toString(), ['scope_admin', 'scope_editor', 'scope_reviewer']);
      if (dto.conversationId || input) {
        throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'A manual dry-run cannot include a conversation or test input.');
      }
      const dryRun = await this.dryRunModel.create({
        programId: deployment.programId,
        scopeId: deployment.scopeId,
        deploymentId: deployment._id,
        revisionId: deployment.currentDraftRevisionId,
        testerId: new Types.ObjectId(actorId),
        status: 'passed',
        executionMode: 'manual',
        testCases: [],
        checks: {
          ...(dto.checks ?? {}),
          draftRevisionId: deployment.currentDraftRevisionId.toString(),
          agentId,
          workspaceIds,
          executionMode: 'manual',
          attestedAt: new Date().toISOString(),
        },
      });
      this.auditLogService.logSuccess({ actorId, actorEmail, action: 'governance.dry_run.manually_passed', targetType: 'governance_dry_run', targetId: dryRun._id.toString(), metadata: { deploymentId, revisionId: deployment.currentDraftRevisionId.toString(), agentId, workspaceIds, executionMode: 'manual' } });
      return this.toResponse(dryRun);
    }
    let conversationId: string;
    if (dto.conversationId) {
      const existingDryRun = await this.dryRunModel
        .findOne({
          deploymentId: deployment._id,
          revisionId: deployment.currentDraftRevisionId,
          conversationId: new Types.ObjectId(dto.conversationId),
          testerId: new Types.ObjectId(actorId),
        })
        .lean()
        .exec();
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
    const requestId = `governance-dry-run:${deployment.currentDraftRevisionId.toString()}:${Date.now()}`;
    const userMessage = await this.messageService.createUserMessage({ conversationId, senderId: actorId, content: input, agentIds: [agentId], requestId });
    const aiMessage = await this.messageService.createAIPlaceholder({ conversationId, questionMessageId: userMessage.id, requestId });
    const testCases = dto.testCases ?? [{ input, simulatedChannel, agentId, workspaceIds }];
    const dryRun = await this.dryRunModel.create({
      programId: deployment.programId,
      scopeId: deployment.scopeId,
      deploymentId: deployment._id,
      revisionId: deployment.currentDraftRevisionId,
      conversationId: new Types.ObjectId(conversationId),
      testerId: new Types.ObjectId(actorId),
      status: 'running',
      executionMode: 'conversation',
      testCases,
      checks: { ...(dto.checks ?? {}), draftRevisionId: deployment.currentDraftRevisionId.toString(), agentId, workspaceIds },
    });
    // Fire the stream non-blocking — mirrors MessageController so the POST returns
    // immediately (status 'running') and tokens are produced in the background. The
    // panel polls messages() for the reply and flips the readiness check once passed.
    void this.streamService
      .startStream(actorId, conversationId, aiMessage.id, { content: input, agentIds: [agentId] }, requestId, actorEmail)
      .then(() => this.finishDryRun(dryRun, 'passed', { runtime: 'completed', simulatedChannel }))
      .catch(async (error) => {
        await this.messageService.markStreamFailed(aiMessage.id).catch(() => undefined);
        await this.finishDryRun(dryRun, 'failed', { runtime: 'failed', simulatedChannel, error: error instanceof Error ? error.message : 'Unknown runtime failure' });
      });
    this.auditLogService.logSuccess({ actorId, actorEmail, action: 'governance.dry_run.created', targetType: 'governance_dry_run', targetId: dryRun._id.toString(), metadata: { deploymentId, revisionId: deployment.currentDraftRevisionId.toString(), agentId, workspaceIds } });
    return this.toResponse(dryRun);
  }

  async list(actorId: string, deploymentId: string): Promise<GovernanceDryRunResponse[]> {
    await this.findOwnedDeployment(actorId, deploymentId);
    const dryRuns = await this.dryRunModel.find({ deploymentId: new Types.ObjectId(deploymentId) }).sort({ createdAt: -1 }).lean().exec();
    return dryRuns.map((dryRun) => this.toResponse(dryRun));
  }

  async findById(actorId: string, dryRunId: string): Promise<GovernanceDryRunResponse> {
    const dryRun = await this.findOwnedDryRun(actorId, dryRunId);
    return this.toResponse(dryRun);
  }

  async mark(actorId: string, actorEmail: string, dryRunId: string, dto: MarkGovernanceDryRunDto): Promise<GovernanceDryRunResponse> {
    const dryRun = await this.findOwnedDryRunDocument(actorId, dryRunId);
    dryRun.status = dto.status;
    if (dto.checks !== undefined) dryRun.checks = dto.checks;
    await dryRun.save();
    this.auditLogService.logSuccess({ actorId, actorEmail, action: 'governance.dry_run.marked', targetType: 'governance_dry_run', targetId: dryRunId, metadata: { status: dto.status } });
    return this.toResponse(dryRun);
  }

  async messages(actorId: string, dryRunId: string): Promise<Array<Record<string, unknown>>> {
    const dryRun = await this.findOwnedDryRun(actorId, dryRunId);
    if (dryRun.conversationId) {
      const page = await this.messageService.findByConversation(dryRun.conversationId.toString(), { page: 1, limit: 100 });
      return page.messages as unknown as Array<Record<string, unknown>>;
    }
    return dryRun.testCases as Array<Record<string, unknown>>;
  }

  private async finishDryRun(dryRun: GovernanceDryRunDocument, status: 'passed' | 'failed', extraChecks: Record<string, unknown>): Promise<void> {
    dryRun.status = status;
    dryRun.checks = { ...dryRun.checks, ...extraChecks };
    await dryRun.save();
  }

  private firstTestCaseInput(testCases?: Array<Record<string, unknown>>): string | undefined {
    const value = testCases?.find((testCase) => typeof testCase.input === 'string')?.input;
    return typeof value === 'string' ? value : undefined;
  }

  private sameWorkspaceIds(left: string[], right: string[]): boolean {
    return left.length === right.length && left.every((workspaceId) => right.includes(workspaceId));
  }

  private async findOwnedDeployment(actorId: string, deploymentId: string): Promise<GovernanceDeploymentDocument> {
    const deployment = await this.deploymentModel.findById(deploymentId).exec();
    if (!deployment) throw new NotFoundException(ErrorCode.GOVERNANCE_DEPLOYMENT_NOT_FOUND);
    await this.programService.assertOwnedProgram(actorId, deployment.programId.toString());
    await this.accessService.assertScopeAccess(actorId, deployment.programId.toString(), deployment.scopeId.toString());
    return deployment;
  }

  private async findOwnedDryRun(actorId: string, dryRunId: string): Promise<Record<string, unknown>> {
    const dryRun = await this.dryRunModel.findById(dryRunId).lean().exec();
    if (!dryRun) throw new NotFoundException(ErrorCode.GOVERNANCE_DRY_RUN_NOT_FOUND);
    await this.programService.assertOwnedProgram(actorId, dryRun.programId.toString());
    await this.accessService.assertScopeAccess(actorId, dryRun.programId.toString(), dryRun.scopeId.toString());
    return dryRun;
  }

  private async findOwnedDryRunDocument(actorId: string, dryRunId: string): Promise<GovernanceDryRunDocument> {
    const dryRun = await this.dryRunModel.findById(dryRunId).exec();
    if (!dryRun) throw new NotFoundException(ErrorCode.GOVERNANCE_DRY_RUN_NOT_FOUND);
    await this.programService.assertOwnedProgram(actorId, dryRun.programId.toString());
    await this.accessService.assertScopeAccess(actorId, dryRun.programId.toString(), dryRun.scopeId.toString());
    return dryRun;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toResponse(doc: any): GovernanceDryRunResponse {
    return {
      id: doc._id?.toString() ?? '',
      programId: doc.programId?.toString() ?? '',
      scopeId: doc.scopeId?.toString() ?? '',
      deploymentId: doc.deploymentId?.toString() ?? '',
      revisionId: doc.revisionId?.toString() ?? '',
      conversationId: doc.conversationId?.toString(),
      testerId: doc.testerId?.toString() ?? '',
      status: doc.status as 'running' | 'passed' | 'failed' | 'needs_review',
      executionMode: doc.executionMode === 'manual' ? 'manual' : 'conversation',
      testCases: (doc.testCases as Array<Record<string, unknown>>) ?? [],
      checks: (doc.checks as Record<string, unknown>) ?? {},
      createdAt: this.toIso(doc.createdAt),
      updatedAt: this.toIso(doc.updatedAt),
    };
  }

  private toIso(value: unknown): string {
    return value instanceof Date ? value.toISOString() : String(value ?? '');
  }
}
