import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PlaybookFlowStreamGatewayService } from './playbook-flow-stream-gateway.service';
import {
  FlowExecution,
  FlowExecutionDocument,
} from '../schemas/playbook-flow-execution.schema';
import type {
  FlowExecutionJudgeHistoryEntry,
  FlowExecutionJudgeResult,
} from '../interfaces/playbook-flow-execution-advisor.interface';

@Injectable()
export class PlaybookFlowStreamEventsService {
  private readonly logger = new Logger(PlaybookFlowStreamEventsService.name);
  private executionOwnerCache = new Map<string, string>();

  constructor(
    private readonly streamGateway: PlaybookFlowStreamGatewayService,
    @InjectModel(FlowExecution.name)
    private readonly executionModel: Model<FlowExecutionDocument>,
  ) {}

  cacheOwner(executionId: string, ownerId: string): void {
    this.executionOwnerCache.set(executionId, ownerId);
  }

  releaseOwner(executionId: string): void {
    this.executionOwnerCache.delete(executionId);
  }

  async emitExecutionStart(
    executionId: string,
    flowId: string,
    ownerId: string,
    payload?: {
      executionMode?: 'live' | 'inherit' | 'replay_strict' | 'replay_flex' | 'replay_adaptive';
      reflectionEnabled?: boolean;
      advisorScoringMode?: 'llm' | 'heuristic';
      advisorAutopilotEnabled?: boolean;
      advisorAutopilotTargetScore?: number;
      advisorAutopilotMaxTurns?: number;
      singleStepTaskId?: string | null;
    },
  ): Promise<void> {
    const count = await this.executionModel.countDocuments({ flowId });
    this.cacheOwner(executionId, ownerId);

    this.streamGateway.sendToUser(ownerId, {
      type: 'playbook_execution_start',
      data: {
        executionId,
        playbookId: flowId,
        executionNumber: count,
        status: 'running',
        executionMode: payload?.executionMode ?? 'live',
        ...(payload?.reflectionEnabled !== undefined ? { reflectionEnabled: payload.reflectionEnabled } : {}),
        ...(payload?.advisorScoringMode !== undefined ? { advisorScoringMode: payload.advisorScoringMode } : {}),
        ...(payload?.advisorAutopilotEnabled !== undefined ? { advisorAutopilotEnabled: payload.advisorAutopilotEnabled } : {}),
        ...(payload?.advisorAutopilotTargetScore !== undefined ? { advisorAutopilotTargetScore: payload.advisorAutopilotTargetScore } : {}),
        ...(payload?.advisorAutopilotMaxTurns !== undefined ? { advisorAutopilotMaxTurns: payload.advisorAutopilotMaxTurns } : {}),
        ...(payload?.singleStepTaskId !== undefined ? { singleStepTaskId: payload.singleStepTaskId } : {}),
        taskResults: [],
      },
    });
  }

  async emitExecutionComplete(executionId: string, status: string, error?: string, durationMs?: number): Promise<void> {
    const ownerId = this.executionOwnerCache.get(executionId);
    if (!ownerId) return;

    try {
      const execution = await this.executionModel.findById(executionId).lean();
      if (!execution) return;

      if (ownerId) {
        this.streamGateway.sendToUser(ownerId, {
          type: status === 'completed' ? 'playbook_execution_complete' : 'playbook_execution_error',
          data: {
            executionId,
            status,
            error: error !== undefined ? error : execution.error,
            durationMs: durationMs !== undefined ? durationMs : undefined,
          },
        });
      }
    } finally {
      this.releaseOwner(executionId);
    }
  }

  emitStepStart(executionId: string, nodeId: string): void {
    const ownerId = this.executionOwnerCache.get(executionId);
    if (!ownerId) return;

    this.streamGateway.sendToUser(ownerId, {
      type: 'playbook_step_start',
      data: {
        executionId,
        taskId: nodeId,
        status: 'running',
      },
    });
  }

  emitStepUpdate(executionId: string, nodeId: string, output?: string): void {
    const ownerId = this.executionOwnerCache.get(executionId);
    if (!ownerId) return;

    this.streamGateway.sendToUser(ownerId, {
      type: 'playbook_step_update',
      data: {
        executionId,
        taskId: nodeId,
        status: 'running',
        ...(output !== undefined ? { output } : {}),
      },
    });
  }

  emitStepComplete(
    executionId: string,
    nodeId: string,
    output?: string,
    error?: string,
    iteration?: number,
    artifacts?: Array<Record<string, unknown>>,
    components?: Array<Record<string, unknown>>,
    observability?: {
      toolTrace?: unknown[];
      llmPromptTrace?: unknown[];
      inputTokens?: number | null;
      outputTokens?: number | null;
      totalTokens?: number | null;
      modelName?: string | null;
      semanticMatch?: unknown;
      traceMetadata?: Record<string, unknown>;
    },
  ): void {
    const ownerId = this.executionOwnerCache.get(executionId);
    if (!ownerId) return;

    const data: Record<string, unknown> = {
      executionId,
      taskId: nodeId,
      status: error ? 'failed' : 'completed',
    };

    if (output !== undefined) data.output = output;
    if (error !== undefined) data.error = error;
    if (iteration !== undefined) data.iteration = iteration;
    if (artifacts !== undefined) data.artifacts = artifacts;
    if (components !== undefined) data.components = components;
    if (observability?.toolTrace !== undefined) data.toolTrace = observability.toolTrace;
    if (observability?.llmPromptTrace !== undefined) data.llmPromptTrace = observability.llmPromptTrace;
    if (observability?.inputTokens !== undefined) data.inputTokens = observability.inputTokens;
    if (observability?.outputTokens !== undefined) data.outputTokens = observability.outputTokens;
    if (observability?.totalTokens !== undefined) data.totalTokens = observability.totalTokens;
    if (observability?.modelName !== undefined) data.modelName = observability.modelName;
    if (observability?.semanticMatch !== undefined) data.semanticMatch = observability.semanticMatch;
    if (observability?.traceMetadata !== undefined) data.traceMetadata = observability.traceMetadata;

    this.streamGateway.sendToUser(ownerId, {
      type: 'playbook_step_complete',
      data,
    });
  }

  emitStepJudgeStarted(
    ownerId: string,
    executionId: string,
    taskId: string,
    iteration?: number,
    advisorScoringMode?: 'llm' | 'heuristic',
  ): void {
    this.streamGateway.sendToUser(ownerId, {
      type: 'playbook_step_judge_started',
      data: {
        executionId,
        taskId,
        ...(iteration !== undefined ? { iteration } : {}),
        ...(advisorScoringMode !== undefined ? { advisorScoringMode } : {}),
        judgeStatus: 'evaluating',
      },
    });
  }

  emitStepJudgeUpdated(
    ownerId: string,
    executionId: string,
    taskId: string,
    payload: {
      judgeStatus: 'idle' | 'evaluating' | 'evaluated' | 'failed';
      advisorScoringMode?: 'llm' | 'heuristic';
      judgeResult?: FlowExecutionJudgeResult | null;
      judgeError?: string | null;
      judgeHistoryEntry?: FlowExecutionJudgeHistoryEntry;
    },
    iteration?: number,
  ): void {
    this.streamGateway.sendToUser(ownerId, {
      type: 'playbook_step_judge_updated',
      data: {
        executionId,
        taskId,
        ...(iteration !== undefined ? { iteration } : {}),
        judgeStatus: payload.judgeStatus,
        ...(payload.advisorScoringMode !== undefined ? { advisorScoringMode: payload.advisorScoringMode } : {}),
        ...(payload.judgeResult !== undefined ? { judgeResult: payload.judgeResult } : {}),
        ...(payload.judgeError !== undefined ? { judgeError: payload.judgeError } : {}),
        ...(payload.judgeHistoryEntry !== undefined ? { judgeHistoryEntry: payload.judgeHistoryEntry } : {}),
      },
    });
  }

  emitRouterDecision(executionId: string, nodeId: string, label: string, iteration: number): void {
    const ownerId = this.executionOwnerCache.get(executionId);
    if (!ownerId) return;

    this.streamGateway.sendToUser(ownerId, {
      type: 'playbook_step_update',
      data: {
        executionId,
        taskId: nodeId,
        status: 'running',
        routerDecision: { label, iteration },
      },
    });
  }

  emitIterationIncrement(executionId: string, nodeId: string, iteration: number): void {
    const ownerId = this.executionOwnerCache.get(executionId);
    if (!ownerId) return;

    this.streamGateway.sendToUser(ownerId, {
      type: 'playbook_step_update',
      data: {
        executionId,
        taskId: nodeId,
        status: 'running',
        iteration,
      },
    });
  }

  emitInterrupt(
    executionId: string,
    nodeId: string,
    prompt: string,
    iteration: number,
    threadId?: string,
  ): void {
    const ownerId = this.executionOwnerCache.get(executionId);
    if (!ownerId) return;

    this.streamGateway.sendToUser(ownerId, {
      type: 'playbook_interrupt',
      data: {
        executionId,
        taskId: nodeId,
        type: 'human_approval',
        message: prompt,
        iteration,
        threadId: threadId ?? executionId,
        round: iteration,
      },
    });
  }

  async emitConnected(userId: string): Promise<void> {
    const activeExecutions = await this.executionModel.find(
      {
        ownerId: userId,
        status: { $in: ['queued', 'running', 'pending_approval'] },
      },
      'flowId status startedAt createdAt updatedAt threadId singleStepTaskId pendingApproval advisorAutopilotEnabled advisorAutopilotTargetScore advisorAutopilotMaxTurns reflectionEnabled advisorScoringMode',
    ).lean().exec();

    this.streamGateway.sendToUser(userId, {
      type: 'playbook_connected',
      data: {
        connectionId: `${userId}:${Date.now()}`,
        activeExecutions: activeExecutions.map((execution) => ({
          id: execution._id.toString(),
          playbookId: execution.flowId,
          executedBy: '',
          executionNumber: 0,
          status: execution.status,
          executionMode: 'live',
          executionTrigger: 'manual',
          reflectionEnabled: execution.reflectionEnabled ?? false,
          advisorScoringMode: execution.advisorScoringMode ?? 'llm',
          advisorAutopilotEnabled: execution.advisorAutopilotEnabled ?? false,
          advisorAutopilotTargetScore: execution.advisorAutopilotTargetScore ?? 90,
          advisorAutopilotMaxTurns: execution.advisorAutopilotMaxTurns ?? 4,
          advisorAutopilotStatus: 'idle',
          advisorAutopilotTaskId: null,
          advisorAutopilotAttemptCount: 0,
          advisorAutopilotLastError: null,
          judgeSummaryStatus: 'idle',
          judgeSummary: null,
          replaySourceByTask: null,
          taskResults: [],
          threadId: execution.threadId ?? null,
          interruptPayload: execution.pendingApproval
            ? {
                type: 'approval_request',
                message: execution.pendingApproval.prompt,
                taskId: execution.pendingApproval.nodeId,
                iteration: execution.pendingApproval.iteration,
              }
            : null,
          waitingForHumanInput: execution.status === 'pending_approval',
          currentInterruptId: null,
          currentInterruptTaskId: execution.pendingApproval?.nodeId ?? null,
          hitlHistory: [],
          error: null,
          durationMs: null,
          startedAt: execution.startedAt ?? execution.createdAt,
          completedAt: null,
          singleStepTaskId: execution.singleStepTaskId ?? null,
          playbookSnapshot: null,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalTokens: 0,
          createdAt: execution.createdAt,
          updatedAt: execution.updatedAt,
        })),
      },
    });
  }

  emitExecutionQueued(executionId: string, flowId: string, queuePosition: number): void {
    const ownerId = this.executionOwnerCache.get(executionId);
    if (!ownerId) return;

    this.streamGateway.sendToUser(ownerId, {
      type: 'playbook_execution_queued',
      data: { executionId, playbookId: flowId, status: 'queued', queuePosition },
    });
  }

  emitQueuePositionUpdate(executionId: string, queuePosition: number): void {
    const ownerId = this.executionOwnerCache.get(executionId);
    if (!ownerId) return;

    this.streamGateway.sendToUser(ownerId, {
      type: 'playbook_execution_queue_update',
      data: { executionId, queuePosition },
    });
  }

  emitExecutionCancelled(executionId: string): void {
    const ownerId = this.executionOwnerCache.get(executionId);
    if (!ownerId) return;

    this.streamGateway.sendToUser(ownerId, {
      type: 'playbook_execution_complete',
      data: {
        executionId,
        status: 'cancelled',
      },
    });
  }
}
