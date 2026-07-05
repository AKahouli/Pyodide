import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuditLogService } from '@modules/authorization/services/audit-log.service';
import { ConversationService } from '@modules/conversation/services/conversation.service';
import { MessageService } from '@modules/conversation/services/message.service';
import { StreamService } from '@modules/conversation/services/stream.service';
import { ConflictException, NotFoundException } from '@modules/exceptions';
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
    const conversation = await this.conversationService.create(actorId, { title: 'Governance dry run', workspaces: revision.workspaceIds.map((id) => id.toString()) });
    const requestId = `governance-dry-run:${deployment.currentDraftRevisionId.toString()}`;
    const userMessage = await this.messageService.createUserMessage({ conversationId: conversation.id, senderId: actorId, content: input, agentIds: [revision.agentId.toString()], requestId });
    const aiMessage = await this.messageService.createAIPlaceholder({ conversationId: conversation.id, questionMessageId: userMessage.id, requestId });
    const testCases = dto.testCases ?? [{ input, simulatedChannel }];
    const dryRun = await this.dryRunModel.create({
      programId: deployment.programId,
      scopeId: deployment.scopeId,
      deploymentId: deployment._id,
      revisionId: deployment.currentDraftRevisionId,
      conversationId: new Types.ObjectId(conversation.id),
      testerId: new Types.ObjectId(actorId),
      status: 'running',
      testCases,
      checks: dto.checks ?? { draftRevisionId: deployment.currentDraftRevisionId.toString() },
    });
    try {
      await this.streamService.startStream(actorId, conversation.id, aiMessage.id, { content: input, agentIds: [revision.agentId.toString()] }, requestId, actorEmail);
      dryRun.status = 'passed';
      dryRun.checks = { ...dryRun.checks, runtime: 'completed', simulatedChannel };
    } catch (error) {
      dryRun.status = 'failed';
      dryRun.checks = { ...dryRun.checks, runtime: 'failed', simulatedChannel, error: error instanceof Error ? error.message : 'Unknown runtime failure' };
    }
    await dryRun.save();
    this.auditLogService.logSuccess({ actorId, actorEmail, action: 'governance.dry_run.created', targetType: 'governance_dry_run', targetId: dryRun._id.toString(), metadata: { deploymentId, revisionId: deployment.currentDraftRevisionId.toString() } });
    return this.toResponse(dryRun);
  }

  async list(actorId: string, deploymentId: string): Promise<GovernanceDryRunResponse[]> {
    await this.findOwnedDeployment(actorId, deploymentId);
    const dryRuns = await this.dryRunModel.find({ deploymentId }).sort({ createdAt: -1 }).lean().exec();
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

  private firstTestCaseInput(testCases?: Array<Record<string, unknown>>): string | undefined {
    const value = testCases?.find((testCase) => typeof testCase.input === 'string')?.input;
    return typeof value === 'string' ? value : undefined;
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
