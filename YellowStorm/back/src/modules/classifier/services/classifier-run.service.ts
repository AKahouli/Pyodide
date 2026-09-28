import { Injectable } from '@nestjs/common';
import { isObjectId } from '@common/postgres';
import { ClassificationRunRepository, type RunStatusPatch } from '../persistence/classification-run.repository';
import { ClassifierAssignmentRepository } from '../persistence/classifier-assignment.repository';
import type { ClassificationRunRecord } from '../classifier.types';
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
import { PgFlowReadAdapter } from '../../playbook-flow/ports/pg-flow-read.adapter';
import { PgWorkspaceDocumentReadAdapter } from '../../workspace/persistence/postgres/pg-workspace-document-read.adapter';

@Injectable()
export class ClassifierRunService {
  constructor(
    private readonly runs: ClassificationRunRepository,
    private readonly flowReadPort: PgFlowReadAdapter,
    private readonly documentReadPort: PgWorkspaceDocumentReadAdapter,
    private readonly assignments: ClassifierAssignmentRepository,
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

    if (!isObjectId(dto.playbookId)) {
      throw new BadRequestException(ErrorCode.CLASSIFIER_RUN_PLAYBOOK_INVALID);
    }
    const playbook = await this.flowReadPort.findById(dto.playbookId);
    if (!playbook) {
      throw new BadRequestException(ErrorCode.CLASSIFIER_RUN_PLAYBOOK_INVALID);
    }

    // Count candidate files: all workspace docs (excluding folders), minus
    // already-classified ones when overwrite is false.
    const totalDocuments = await this.documentReadPort.countDocuments({ workspaceId, isFolder: false });

    let candidateCount = totalDocuments;
    if (!dto.overwrite) {
      candidateCount = totalDocuments - (await this.assignments.countClassified(workspaceId));
      if (candidateCount < 0) candidateCount = 0;
    }

    const activeRules = await this.ruleService.getActiveForWorkspace(userId, workspaceId);
    const composedHint = this.composeHint(dto.hint, activeRules.map((r) => r.text));

    const run = await this.runs.create({
      workspaceId,
      playbookId: dto.playbookId,
      hint: composedHint ?? null,
      overwriteExisting: dto.overwrite ?? false,
      totalFiles: candidateCount,
      triggeredBy: userId,
    });

    this.logger.log('Classification run created', {
      runId: run.id,
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

    const { items, total } = await this.runs.listByWorkspace(workspaceId, page, limit);

    return {
      items: items.map((r) => this.toResponse(r)),
      total,
      page,
      limit,
    };
  }

  async findById(userId: string, runId: string): Promise<IClassificationRunResponse> {
    if (!isObjectId(runId)) {
      throw new NotFoundException(ErrorCode.CLASSIFIER_RUN_NOT_FOUND);
    }
    const run = await this.runs.findById(runId);
    if (!run) {
      throw new NotFoundException(ErrorCode.CLASSIFIER_RUN_NOT_FOUND);
    }
    try {
      await this.access.assertWorkspaceAccess(run.workspaceId, userId);
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
  async updateStatus(runId: string, patch: RunStatusPatch): Promise<void> {
    await this.runs.updateStatus(runId, patch);
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

  private toResponse(run: ClassificationRunRecord): IClassificationRunResponse {
    return {
      id: run.id,
      workspaceId: run.workspaceId,
      status: run.status,
      playbookId: run.playbookId,
      playbookExecutionId: run.playbookExecutionId,
      hint: run.hint,
      overwrite: run.overwriteExisting,
      totalFiles: run.totalFiles,
      classifiedFiles: run.classifiedFiles,
      error: run.error,
      startedAt: run.startedAt ? run.startedAt.toISOString() : null,
      finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
      triggeredBy: run.triggeredBy,
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
    };
  }
}
