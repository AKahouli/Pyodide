import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  PlaybookExecution,
  PlaybookExecutionDocument,
} from '../schemas/playbook-execution.schema';
import { PlaybookStreamGatewayService } from './playbook-stream-gateway.service';

const ADVISOR_AUTOPILOT_DEFAULT_TARGET_SCORE = 80;
const ADVISOR_AUTOPILOT_DEFAULT_MAX_TURNS = 2;

type AdvisorAutopilotStatus =
  | 'idle'
  | 'running'
  | 'judging'
  | 'optimizing'
  | 'rerunning'
  | 'completed'
  | 'stopped'
  | 'failed';

export interface AdvisorAutopilotConfig {
  enabled: boolean;
  targetScore: number;
  maxTurns: number;
}

@Injectable()
export class PlaybookExecutionAdvisorService {
  constructor(
    @InjectModel(PlaybookExecution.name)
    private readonly executionModel: Model<PlaybookExecutionDocument>,
    private readonly streamGateway: PlaybookStreamGatewayService,
  ) {}

  normalizeAdvisorAutopilotConfig(
    enabled: boolean,
    targetScore?: number | null,
    maxTurns?: number | null,
  ): AdvisorAutopilotConfig {
    const normalizedTarget = Number.isFinite(Number(targetScore))
      ? Math.max(1, Math.min(100, Number(targetScore)))
      : ADVISOR_AUTOPILOT_DEFAULT_TARGET_SCORE;
    const normalizedMaxTurns = Number.isFinite(Number(maxTurns))
      ? Math.max(0, Math.min(5, Math.floor(Number(maxTurns))))
      : ADVISOR_AUTOPILOT_DEFAULT_MAX_TURNS;

    return {
      enabled,
      targetScore: normalizedTarget,
      maxTurns: normalizedMaxTurns,
    };
  }

  resolveAdvisorAutopilotFixType(judgeResult: any): 'optimize_step' | 'none' {
    if (judgeResult?.safeAutoFixType === 'optimize_step') {
      return 'optimize_step';
    }

    const hasRewriteHints =
      Array.isArray(judgeResult?.rewriteHints) && judgeResult.rewriteHints.length > 0;
    if (judgeResult?.recommendation === 'update_current_playbook' && hasRewriteHints) {
      return 'optimize_step';
    }

    return 'none';
  }

  async updateAdvisorAutopilotState(
    userId: string,
    executionId: string,
    patch: {
      status?: AdvisorAutopilotStatus;
      attemptCount?: number;
      lastError?: string | null;
      taskId?: string | null;
    },
  ): Promise<void> {
    await this.executionModel
      .findByIdAndUpdate(executionId, {
        $set: {
          ...(patch.status !== undefined ? { advisorAutopilotStatus: patch.status } : {}),
          ...(patch.attemptCount !== undefined
            ? { advisorAutopilotAttemptCount: patch.attemptCount }
            : {}),
          ...(patch.lastError !== undefined ? { advisorAutopilotLastError: patch.lastError } : {}),
          ...(patch.taskId !== undefined ? { advisorAutopilotTaskId: patch.taskId } : {}),
          updatedAt: new Date(),
        },
      })
      .exec();

    this.streamGateway.sendToUser(userId, {
      type: 'playbook_advisor_autopilot_updated',
      data: {
        executionId,
        advisorAutopilotStatus: patch.status,
        advisorAutopilotAttemptCount: patch.attemptCount,
        advisorAutopilotLastError: patch.lastError,
        advisorAutopilotTaskId: patch.taskId,
      },
    });
  }

  async appendAdvisorTurnHistory(
    userId: string,
    executionId: string,
    taskId: string,
    entry: {
      turn: number;
      score: number | null;
      recommendation: string | null;
      safeAutoFixType: string | null;
      actionType: 'evaluate' | 'optimize_step' | 'stop';
      stopReason?: string | null;
      scoreDelta?: number | null;
    },
  ): Promise<void> {
    const historyEntry = {
      turn: entry.turn,
      createdAt: new Date(),
      score: entry.score,
      recommendation: entry.recommendation,
      safeAutoFixType: entry.safeAutoFixType,
      actionType: entry.actionType,
      stopReason: entry.stopReason ?? null,
    };

    await this.executionModel
      .updateOne(
        { _id: new Types.ObjectId(executionId), 'taskResults.taskId': taskId },
        {
          $set: {
            'taskResults.$.advisorTurnCount': entry.turn,
            'taskResults.$.lastAdvisorAction': entry.actionType,
            'taskResults.$.lastAdvisorScoreDelta': entry.scoreDelta ?? null,
            'taskResults.$.advisorStopReason': entry.stopReason ?? null,
            updatedAt: new Date(),
          },
          $push: {
            'taskResults.$.advisorTurnHistory': {
              $each: [historyEntry],
              $slice: -25,
            },
          },
        },
      )
      .exec();

    const taskResult = await this.getExecutionTaskResult(executionId, taskId);

    this.streamGateway.sendToUser(userId, {
      type: 'playbook_advisor_autopilot_updated',
      data: {
        executionId,
        taskId,
        advisorTurnCount: entry.turn,
        lastAdvisorAction: entry.actionType,
        lastAdvisorScoreDelta: entry.scoreDelta ?? null,
        advisorStopReason: entry.stopReason ?? null,
        advisorTurnHistoryEntry: {
          ...historyEntry,
          createdAt: historyEntry.createdAt.toISOString(),
        },
        advisorOptimizationHistoryEntry: taskResult?.advisorOptimizationHistory?.length
          ? (() => {
              const latestOptimization =
                taskResult.advisorOptimizationHistory[
                  taskResult.advisorOptimizationHistory.length - 1
                ];
              return {
                turn: latestOptimization.turn,
                createdAt:
                  latestOptimization.createdAt?.toISOString?.() || latestOptimization.createdAt,
                changedFields: latestOptimization.changedFields || [],
                beforeTask: latestOptimization.beforeTask || {},
                afterTask: latestOptimization.afterTask || {},
              };
            })()
          : null,
      },
    });
  }

  async getExecutionTaskResult(executionId: string, taskId: string): Promise<any | null> {
    const execution = await this.executionModel
      .findById(executionId)
      .select(
        'taskResults.taskId taskResults.judgeResult taskResults.advisorTurnCount taskResults.advisorTurnHistory taskResults.lastAdvisorAction taskResults.lastAdvisorScoreDelta taskResults.advisorStopReason taskResults.advisorOptimizationHistory',
      )
      .lean()
      .exec();
    return (execution?.taskResults || []).find((item: any) => item.taskId === taskId) || null;
  }
}
