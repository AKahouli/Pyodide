import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ClassificationRun,
  ClassificationRunDocument,
  ClassificationRunStatus,
} from '../schemas/classification-run.schema';
import { Flow, FlowDocument } from '../../playbook-flow/schemas/playbook-flow.schema';
import { WorkspaceDoc, WorkspaceDocumentDoc } from '../../workspace/schemas/workspace-document.schema';
import {
  ClassifierFileAssignment,
  ClassifierFileAssignmentDocument,
} from '../schemas/classifier-file-assignment.schema';
import { StartRunDto } from '../dto/start-run.dto';
import { ListRunsQueryDto } from '../dto/list-runs-query.dto';
import { IClassificationRunResponse } from '../interfaces/classifier.interface';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { LoggerService } from '../../logger';
import { ClassifierAccessService } from './classifier-access.service';
import { ClassifierRuleService } from './classifier-rule.service';

@Injectable()
export class ClassifierRunService {
  constructor(
    @InjectModel(ClassificationRun.name)
    private readonly runModel: Model<ClassificationRunDocument>,
    @InjectModel(Flow.name)
    private readonly playbookModel: Model<FlowDocument>,
    @InjectModel(WorkspaceDoc.name)
    private readonly documentModel: Model<WorkspaceDocumentDoc>,
    @InjectModel(ClassifierFileAssignment.name)
    private readonly assignmentModel: Model<ClassifierFileAssignmentDocument>,
    private readonly access: ClassifierAccessService,
    private readonly ruleService: ClassifierRuleService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(ClassifierRunService.name);
  }

  async start(
    userId: string,
    workspaceId: string,
    dto: StartRunDto,
  ): Promise<IClassificationRunResponse> {
    await this.access.assertWorkspaceAccess(workspaceId, userId);

    if (!Types.ObjectId.isValid(dto.playbookId)) {
      throw new BadRequestException(ErrorCode.CLASSIFIER_RUN_PLAYBOOK_INVALID);
    }
    const playbook = await this.playbookModel
      .findById(dto.playbookId)
      .select({ _id: 1, createdBy: 1 })
      .lean()
      .exec();
    if (!playbook) {
      throw new BadRequestException(ErrorCode.CLASSIFIER_RUN_PLAYBOOK_INVALID);
    }

    const wsObjectId = new Types.ObjectId(workspaceId);

    // Count candidate files: all workspace docs (excluding folders), minus
    // already-classified ones when overwrite is false.
    const baseFilter = { workspaceId: wsObjectId, isFolder: { $ne: true } };
    const totalDocuments = await this.documentModel.countDocuments(baseFilter).exec();

    let candidateCount = totalDocuments;
    if (!dto.overwrite) {
      const classifiedDocIds = await this.assignmentModel
        .find({ workspaceId: wsObjectId, folderId: { $ne: null } })
        .select({ documentId: 1 })
        .lean()
        .exec();
      candidateCount = totalDocuments - classifiedDocIds.length;
      if (candidateCount < 0) candidateCount = 0;
    }

    const activeRules = await this.ruleService.getActiveForWorkspace(userId, workspaceId);
    const composedHint = this.composeHint(dto.hint, activeRules.map((r) => r.text));

    const run = await this.runModel.create({
      workspaceId: wsObjectId,
      status: ClassificationRunStatus.QUEUED,
      playbookId: new Types.ObjectId(dto.playbookId),
      hint: composedHint,
      overwriteExisting: dto.overwrite ?? false,
      totalFiles: candidateCount,
      classifiedFiles: 0,
      triggeredBy: new Types.ObjectId(userId),
    });

    this.logger.log('Classification run created', {
      runId: run._id.toString(),
      workspaceId,
      playbookId: dto.playbookId,
      candidateCount,
      userId,
    });

    // NOTE: actual playbook invocation is delegated to a dedicated executor
    // (gRPC trigger, ADK callback writing back results). Wiring lives outside
    // the POC path so this controller stays synchronous and safe to call.

    return this.toResponse(run);
  }

  async listByWorkspace(
    userId: string,
    workspaceId: string,
    query: ListRunsQueryDto,
  ): Promise<{ items: IClassificationRunResponse[]; total: number; page: number; limit: number }> {
    await this.access.assertWorkspaceAccess(workspaceId, userId);

    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const wsObjectId = new Types.ObjectId(workspaceId);

    const [items, total] = await Promise.all([
      this.runModel
        .find({ workspaceId: wsObjectId })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.runModel.countDocuments({ workspaceId: wsObjectId }).exec(),
    ]);

    return {
      items: items.map((r) => this.toResponse(r)),
      total,
      page,
      limit,
    };
  }

  async findById(userId: string, runId: string): Promise<IClassificationRunResponse> {
    if (!Types.ObjectId.isValid(runId)) {
      throw new NotFoundException(ErrorCode.CLASSIFIER_RUN_NOT_FOUND);
    }
    const run = await this.runModel.findById(runId).lean().exec();
    if (!run) {
      throw new NotFoundException(ErrorCode.CLASSIFIER_RUN_NOT_FOUND);
    }
    try {
      await this.access.assertWorkspaceAccess(run.workspaceId.toString(), userId);
    } catch (err) {
      if (err instanceof ForbiddenException) {
        throw new ForbiddenException(ErrorCode.CLASSIFIER_RUN_FORBIDDEN);
      }
      throw err;
    }
    return this.toResponse(run);
  }

  /**
   * Used by the playbook executor / callback to update a run's lifecycle.
   * Not exposed via HTTP.
   */
  async updateStatus(
    runId: string,
    patch: Partial<{
      status: ClassificationRunStatus;
      playbookExecutionId: string;
      classifiedFiles: number;
      error: string;
      startedAt: Date;
      finishedAt: Date;
    }>,
  ): Promise<void> {
    await this.runModel.updateOne({ _id: new Types.ObjectId(runId) }, { $set: patch }).exec();
  }

  // ───────── helpers ─────────

  private composeHint(
    userHint: string | undefined,
    activeRuleTexts: string[],
  ): string | undefined {
    const trimmedHint = userHint?.trim() || '';
    const cleanRules = activeRuleTexts
      .map((r) => r.trim())
      .filter((r) => r.length > 0);

    if (!trimmedHint && cleanRules.length === 0) {
      return undefined;
    }

    const parts: string[] = [];
    if (trimmedHint) {
      parts.push(trimmedHint);
    }
    if (cleanRules.length > 0) {
      const rulesBlock = ['Règles à respecter :', ...cleanRules.map((r) => `- ${r}`)].join('\n');
      parts.push(rulesBlock);
    }

    return parts.join('\n\n');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toResponse(doc: any): IClassificationRunResponse {
    return {
      id: (doc._id as { toString(): string }).toString(),
      workspaceId: (doc.workspaceId as { toString(): string }).toString(),
      status: doc.status as IClassificationRunResponse['status'],
      playbookId: (doc.playbookId as { toString(): string }).toString(),
      playbookExecutionId: (doc.playbookExecutionId as string | undefined) ?? null,
      hint: (doc.hint as string | undefined) ?? null,
      overwrite: Boolean(doc.overwriteExisting),
      totalFiles: (doc.totalFiles as number) ?? 0,
      classifiedFiles: (doc.classifiedFiles as number) ?? 0,
      error: (doc.error as string | undefined) ?? null,
      startedAt: doc.startedAt instanceof Date ? doc.startedAt.toISOString() : null,
      finishedAt: doc.finishedAt instanceof Date ? doc.finishedAt.toISOString() : null,
      triggeredBy: (doc.triggeredBy as { toString(): string }).toString(),
      createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : doc.createdAt,
      updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : doc.updatedAt,
    };
  }
}
