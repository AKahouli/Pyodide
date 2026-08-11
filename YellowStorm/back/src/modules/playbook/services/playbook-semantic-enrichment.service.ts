import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { LoggerService } from '../../logger';
import { PlaybookExecution, PlaybookExecutionDocument, StepStatus } from '../schemas/playbook-execution.schema';
import { PlaybookReplayService } from './playbook-replay.service';
import { PlaybookEvaluationService } from './playbook-evaluation.service';
import { PlaybookStreamGatewayService } from './playbook-stream-gateway.service';
import { pLimit } from '../utils/execution.utils';

@Injectable()
export class PlaybookSemanticEnrichmentService {
  private readonly runLimited = pLimit(2);

  constructor(
    @InjectModel(PlaybookExecution.name)
    private readonly executionModel: Model<PlaybookExecutionDocument>,
    private readonly replayService: PlaybookReplayService,
    private readonly evaluationService: PlaybookEvaluationService,
    private readonly streamGateway: PlaybookStreamGatewayService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('PlaybookSemanticEnrichmentService');
  }

  schedule(userId: string, executionId: string, taskId: string): void {
    void this.runLimited(async () => {
      await this.evaluateAndPersist(userId, executionId, taskId);
    }).catch((error) => {
      this.logger.warn('Async semantic enrichment failed', {
        executionId,
        taskId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    });
  }

  async evaluateNow(userId: string, executionId: string, taskId: string): Promise<void> {
    await this.evaluateAndPersist(userId, executionId, taskId);
  }

  private async evaluateAndPersist(userId: string, executionId: string, taskId: string): Promise<void> {
    const execution = await this.executionModel.findById(executionId).lean().exec();
    if (!execution) {
      return;
    }

    const playbookId = execution.playbookId?.toString();
    if (!playbookId) {
      return;
    }

    const taskResult = (execution.taskResults || []).find((item: any) => item.taskId === taskId);
    if (!taskResult || taskResult.status !== StepStatus.COMPLETED || !taskResult.output) {
      return;
    }

    const activeReplay = await this.replayService.getActiveReplay(playbookId, taskId);
    if (!activeReplay?.referenceOutput) {
      return;
    }

    const snapshotTask = (execution.playbookSnapshot as any)?.tasks?.find((task: any) => task.id === taskId);

    const semanticMatch = await this.evaluationService.evaluateSemanticMatch({
      userId,
      baselineOutput: activeReplay.referenceOutput,
      currentOutput: taskResult.output,
      taskTitle: snapshotTask?.title || taskResult.nodeTitle || '',
      taskDescription: snapshotTask?.description || '',
      baselineToolSummaries: (activeReplay.toolCalls || [])
        .map((call: any) => String(call.outputSummary || '').trim())
        .filter(Boolean),
      currentToolSummaries: (taskResult.toolTrace || [])
        .map((call: any) => String(call.outputSummary || '').trim())
        .filter(Boolean),
    });

    if (!semanticMatch) {
      return;
    }

    const evaluationEntry = {
      id: new Types.ObjectId().toString(),
      createdAt: new Date(),
      attemptNumber: taskResult.attemptNumber ?? execution.currentAttemptNumber ?? null,
      trigger: execution.singleStepTaskId === taskId ? 'manual' as const : 'auto' as const,
      baselineReplayId: activeReplay.id?.toString?.() || activeReplay.id || null,
      baselineValidationVersion: activeReplay.validationVersion ?? null,
      semanticMatch,
    };

    await this.executionModel.updateOne(
      { _id: new Types.ObjectId(executionId), 'taskResults.taskId': taskId },
      {
        $set: {
          'taskResults.$.semanticMatch': semanticMatch,
          updatedAt: new Date(),
        },
        $push: {
          'taskResults.$.evaluationHistory': {
            $each: [evaluationEntry],
            $slice: -25,
          },
        },
      },
    );

    this.streamGateway.sendToUser(userId, {
      type: 'playbook_step_evaluation_updated',
      data: {
        executionId,
        taskId,
        semanticMatch,
        evaluationEntry: {
          ...evaluationEntry,
          createdAt: evaluationEntry.createdAt.toISOString(),
        },
      },
    });

    this.logger.log('Async semantic evaluation persisted', {
      executionId,
      taskId,
      matchScore: semanticMatch.matchScore,
    });
  }
}
