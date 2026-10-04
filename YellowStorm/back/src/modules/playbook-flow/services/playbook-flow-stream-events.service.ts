import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PlaybookFlowStreamGatewayService } from './playbook-flow-stream-gateway.service';
import type {
  FlowExecutionJudgeHistoryEntry,
  FlowExecutionJudgeResult,
} from '../interfaces/playbook-flow-execution-advisor.interface';
import { ExecutionRepository } from '../persistence/execution.repository';
import { TaskResultRepository } from '../persistence/task-result.repository';
import {
  DynamicReasoningAttemptRepository,
  toDynamicReasoningAttemptJson,
} from '../persistence/dynamic-reasoning-attempt.repository';

@Injectable()
export class PlaybookFlowStreamEventsService {
  private readonly logger = new Logger(PlaybookFlowStreamEventsService.name);
  private executionOwnerCache = new Map<string, string>();
  private queuePositionEmissionCache = new Map<string, { position: number; emittedAt: number }>();

  constructor(
    private readonly streamGateway: PlaybookFlowStreamGatewayService,
    private readonly executionRepository: ExecutionRepository,
    private readonly configService: ConfigService,
    @Optional()
    private readonly taskResultRepository?: TaskResultRepository,
    @Optional()
    private readonly dynamicReasoningAttemptRepository?: DynamicReasoningAttemptRepository,
  ) {}

  cacheOwner(executionId: string, ownerId: string): void {
    this.executionOwnerCache.set(executionId, ownerId);
  }

  releaseOwner(executionId: string): void {
    this.executionOwnerCache.delete(executionId);
  }

  emitPlaybookShared(userId: string, playbookId: string): void {
    this.streamGateway.sendToUser(userId, {
      type: 'playbook_shared',
      data: { playbookId },
    });
  }

  async emitExecutionStart(
    executionId: string,
    flowId: string,
    ownerId: string,
    payload?: {
      executionMode?: 'live' | 'inherit' | 'replay_strict' | 'replay_flex' | 'replay_adaptive';
      stepExecutionModes?: Record<string, 'live' | 'replay_strict' | 'replay_flex' | 'replay_adaptive'>;
      reflectionEnabled?: boolean;
      advisorScoringMode?: 'llm' | 'heuristic';
      advisorAutopilotEnabled?: boolean;
      advisorAutopilotTargetScore?: number;
      advisorAutopilotMaxTurns?: number;
      singleStepTaskId?: string | null;
      replayPlanningByTask?: Record<string, unknown> | null;
    },
  ): Promise<void> {
    const count = await this.executionRepository.countByFlow(flowId);
    this.cacheOwner(executionId, ownerId);

    this.streamGateway.sendToUser(ownerId, {
      type: 'playbook_execution_start',
      data: {
        executionId,
        playbookId: flowId,
        executionNumber: count,
        status: 'running',
        executionMode: payload?.executionMode ?? 'live',
        ...(payload?.stepExecutionModes !== undefined ? { stepExecutionModes: payload.stepExecutionModes } : {}),
        ...(payload?.reflectionEnabled !== undefined ? { reflectionEnabled: payload.reflectionEnabled } : {}),
        ...(payload?.advisorScoringMode !== undefined ? { advisorScoringMode: payload.advisorScoringMode } : {}),
        ...(payload?.advisorAutopilotEnabled !== undefined ? { advisorAutopilotEnabled: payload.advisorAutopilotEnabled } : {}),
        ...(payload?.advisorAutopilotTargetScore !== undefined ? { advisorAutopilotTargetScore: payload.advisorAutopilotTargetScore } : {}),
        ...(payload?.advisorAutopilotMaxTurns !== undefined ? { advisorAutopilotMaxTurns: payload.advisorAutopilotMaxTurns } : {}),
        ...(payload?.singleStepTaskId !== undefined ? { singleStepTaskId: payload.singleStepTaskId } : {}),
        ...(payload?.replayPlanningByTask !== undefined ? { replayPlanningByTask: payload.replayPlanningByTask } : {}),
        taskResults: [],
      },
    });
  }

  async emitExecutionComplete(executionId: string, status: string, error?: string, durationMs?: number): Promise<void> {
    const ownerId = this.executionOwnerCache.get(executionId);
    if (!ownerId) return;

    try {
      const execution = await this.executionRepository.findById(executionId);
      if (!execution) return;

      if (ownerId) {
        this.streamGateway.sendToUser(ownerId, {
          type: status === 'completed' ? 'playbook_execution_complete' : 'playbook_execution_error',
          data: {
            executionId,
            status,
            error: error !== undefined ? error : execution.error ?? undefined,
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

  emitStepUpdate(
    executionId: string,
    nodeId: string,
    output?: string,
    observability?: {
      toolTrace?: unknown[];
      llmPromptTrace?: unknown[];
      traceMetadata?: Record<string, unknown>;
      inputTokens?: number | null;
      outputTokens?: number | null;
      totalTokens?: number | null;
      modelName?: string | null;
    },
  ): void {
    const ownerId = this.executionOwnerCache.get(executionId);
    if (!ownerId) return;

    this.streamGateway.sendToUser(ownerId, {
      type: 'playbook_step_update',
      data: {
        executionId,
        taskId: nodeId,
        status: 'running',
        ...(output !== undefined ? { output } : {}),
        ...(observability?.toolTrace !== undefined ? { toolTrace: observability.toolTrace } : {}),
        ...(observability?.llmPromptTrace !== undefined ? { llmPromptTrace: observability.llmPromptTrace } : {}),
        ...(observability?.traceMetadata !== undefined ? { traceMetadata: observability.traceMetadata } : {}),
        ...(observability?.inputTokens !== undefined ? { inputTokens: observability.inputTokens } : {}),
        ...(observability?.outputTokens !== undefined ? { outputTokens: observability.outputTokens } : {}),
        ...(observability?.totalTokens !== undefined ? { totalTokens: observability.totalTokens } : {}),
        ...(observability?.modelName !== undefined ? { modelName: observability.modelName } : {}),
      },
    });
  }

  emitDynamicReasoningUpdate(
    executionId: string,
    phase: string,
    parentTaskId: string,
    parentIteration: number,
    payload: Record<string, unknown>,
  ): void {
    const ownerId = this.executionOwnerCache.get(executionId);
    if (!ownerId) return;
    const topologyEvent = phase === 'RuntimeSubgraphCreated'
      ? 'playbook_runtime_subgraph_created'
      : phase === 'RuntimeSubgraphCompleted'
        ? 'playbook_runtime_subgraph_completed'
        : phase === 'RuntimeSubgraphFailed'
          ? 'playbook_runtime_subgraph_failed'
          : 'playbook_dynamic_reasoning_update';
    this.streamGateway.sendToUser(ownerId, {
      type: topologyEvent,
      data: { executionId, parentTaskId, parentIteration, phase, ...payload },
    });
  }

  emitStepComplete(
    executionId: string,
    nodeId: string,
    output?: string,
    error?: string,
    iteration?: number,
    artifacts?: Record<string, unknown>[],
    components?: Record<string, unknown>[],
    observability?: {
      toolTrace?: unknown[];
      reasoningChain?: unknown[];
      llmPromptTrace?: unknown[];
      inputTokens?: number | null;
      outputTokens?: number | null;
      totalTokens?: number | null;
      modelName?: string | null;
      semanticMatch?: unknown;
      traceMetadata?: Record<string, unknown>;
      iteratorIterations?: Record<string, unknown>[];
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
    if (observability?.reasoningChain !== undefined) data.reasoningChain = observability.reasoningChain;
    if (observability?.llmPromptTrace !== undefined) data.llmPromptTrace = observability.llmPromptTrace;
    if (observability?.inputTokens !== undefined) data.inputTokens = observability.inputTokens;
    if (observability?.outputTokens !== undefined) data.outputTokens = observability.outputTokens;
    if (observability?.totalTokens !== undefined) data.totalTokens = observability.totalTokens;
    if (observability?.modelName !== undefined) data.modelName = observability.modelName;
    if (observability?.semanticMatch !== undefined) data.semanticMatch = observability.semanticMatch;
    if (observability?.traceMetadata !== undefined) data.traceMetadata = observability.traceMetadata;
    if (observability?.iteratorIterations !== undefined) data.iteratorIterations = observability.iteratorIterations;

    this.streamGateway.sendToUser(ownerId, {
      type: 'playbook_step_complete',
      data,
    });
  }

  emitIteratorChildStepStarted(
    executionId: string,
    iteratorNodeId: string,
    child: { iterationIndex: number; taskId: string; taskTitle?: string; status: string },
  ): void {
    const ownerId = this.executionOwnerCache.get(executionId);
    if (!ownerId) return;

    this.streamGateway.sendToUser(ownerId, {
      type: 'playbook_iterator_child_step_start',
      data: {
        executionId,
        parentIteratorId: iteratorNodeId,
        iterationIndex: child.iterationIndex,
        taskId: child.taskId,
        ...(child.taskTitle !== undefined ? { taskTitle: child.taskTitle } : {}),
        status: child.status,
      },
    });
  }

  emitIteratorChildStepCompleted(
    executionId: string,
    iteratorNodeId: string,
    child: {
      iterationIndex: number;
      taskId: string;
      taskTitle?: string;
      status: string;
      output?: string;
      error?: string;
      components?: Record<string, unknown>[];
      artifacts?: Record<string, unknown>[];
    },
  ): void {
    const ownerId = this.executionOwnerCache.get(executionId);
    if (!ownerId) return;

    this.streamGateway.sendToUser(ownerId, {
      type: 'playbook_iterator_child_step_complete',
      data: {
        executionId,
        parentIteratorId: iteratorNodeId,
        iterationIndex: child.iterationIndex,
        taskId: child.taskId,
        ...(child.taskTitle !== undefined ? { taskTitle: child.taskTitle } : {}),
        status: child.status,
        ...(child.output !== undefined ? { output: child.output } : {}),
        ...(child.error !== undefined ? { error: child.error } : {}),
        ...(child.components !== undefined ? { components: child.components } : {}),
        ...(child.artifacts !== undefined ? { artifacts: child.artifacts } : {}),
      },
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
    extra?: {
      interruptType?: string;
      interruptId?: string;
      taskDescription?: string;
      result?: string;
      payloadJson?: string;
      resumableActions?: string[];
      blockerRuleId?: string;
      blockerKind?: string;
      reasonCode?: string;
      riskLevel?: string;
      confidence?: number;
      downstreamNodeIds?: string[];
      feedbackScopeDefault?: string;
    },
  ): void {
    const ownerId = this.executionOwnerCache.get(executionId);
    if (!ownerId) return;

    this.streamGateway.sendToUser(ownerId, {
      type: 'playbook_interrupt',
      data: {
        executionId,
        taskId: nodeId,
        type: extra?.interruptType ?? 'human_approval',
        message: prompt,
        iteration,
        threadId: threadId ?? executionId,
        round: iteration,
        interruptId: extra?.interruptId,
        taskDescription: extra?.taskDescription,
        result: extra?.result,
        payloadJson: extra?.payloadJson,
        resumableActions: extra?.resumableActions,
        blockerRuleId: extra?.blockerRuleId,
        blockerKind: extra?.blockerKind,
        reasonCode: extra?.reasonCode,
        riskLevel: extra?.riskLevel,
        confidence: extra?.confidence,
        downstreamNodeIds: extra?.downstreamNodeIds,
        feedbackScopeDefault: extra?.feedbackScopeDefault,
      },
    });

    this.streamGateway.sendToUser(ownerId, {
      type: 'playbook_hitl_interrupt_created',
      data: {
        executionId,
        taskId: nodeId,
        type: extra?.interruptType ?? 'human_approval',
        message: prompt,
        iteration,
        threadId: threadId ?? executionId,
        interruptId: extra?.interruptId,
        blockerRuleId: extra?.blockerRuleId,
        blockerKind: extra?.blockerKind,
        reasonCode: extra?.reasonCode,
        riskLevel: extra?.riskLevel,
        confidence: extra?.confidence,
        downstreamNodeIds: extra?.downstreamNodeIds ?? [],
        feedbackScopeDefault: extra?.feedbackScopeDefault,
        resumableActions: extra?.resumableActions ?? [],
      },
    });
  }

  emitHitlInterruptResolved(
    executionId: string,
    interruptId: string,
    payload: { action: string; taskId?: string; scope?: string; remember?: boolean },
  ): void {
    const ownerId = this.executionOwnerCache.get(executionId);
    if (!ownerId) return;

    this.streamGateway.sendToUser(ownerId, {
      type: 'playbook_hitl_interrupt_resolved',
      data: {
        executionId,
        interruptId,
        action: payload.action,
        taskId: payload.taskId,
        scope: payload.scope,
        remember: payload.remember,
      },
    });
  }

  emitHitlInterruptUpdated(executionId: string, interruptId: string, payload: Record<string, unknown>): void {
    this.sendHitlEvent(executionId, 'playbook_hitl_interrupt_updated', { executionId, interruptId, ...payload });
  }

  emitHitlMemorySuggested(executionId: string, payload: Record<string, unknown>): void {
    this.sendHitlEvent(executionId, 'playbook_hitl_memory_suggested', { executionId, ...payload });
  }

  emitHitlMemorySaved(executionId: string, payload: Record<string, unknown>): void {
    this.sendHitlEvent(executionId, 'playbook_hitl_memory_saved', { executionId, ...payload });
  }

  emitHitlBlockerDisabled(executionId: string, blockerId: string, payload: Record<string, unknown> = {}): void {
    this.sendHitlEvent(executionId, 'playbook_hitl_blocker_disabled', { executionId, blockerId, ...payload });
  }

  emitHitlPolicyUpdated(executionId: string, payload: Record<string, unknown>): void {
    this.sendHitlEvent(executionId, 'playbook_hitl_policy_updated', { executionId, ...payload });
  }

  emitReplayHitlSummaryUpdated(executionId: string, payload: Record<string, unknown>): void {
    this.sendHitlEvent(executionId, 'playbook_replay_hitl_summary_updated', { executionId, ...payload });
  }

  async emitConnected(userId: string): Promise<void> {
    // Oldest first, the order clients have always received them in.
    const activeExecutions = (await this.executionRepository.listActive(userId)).reverse();
    const activeExecutionIds = activeExecutions.map((execution) => execution.id);
    const [activeTaskResults, activeDynamicAttempts] = await Promise.all([
      this.taskResultRepository
        ? this.taskResultRepository.listForExecutions(activeExecutionIds, { light: true, with: ['output'] })
        : Promise.resolve([]),
      this.dynamicReasoningAttemptRepository
        ? this.dynamicReasoningAttemptRepository.listForExecutions(activeExecutionIds)
        : Promise.resolve([]),
    ]);

    this.streamGateway.sendToUser(userId, {
      type: 'playbook_connected',
      data: {
        connectionId: `${userId}:${Date.now()}`,
        activeExecutions: activeExecutions.map((execution) => ({
          id: execution.id,
          playbookId: execution.flowId,
          executedBy: '',
          executionNumber: 0,
          status: execution.status,
          executionMode: execution.executionMode ?? 'live',
          executionTrigger: 'manual',
          stepExecutionModes: execution.stepExecutionModes ?? {},
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
          replayPlanningByTask: execution.replayPlanningByTask ?? null,
          taskResults: activeTaskResults
            .filter((result) => result.executionId === execution.id)
            .map((result) => ({
              taskId: result.taskId,
              iteration: result.iteration,
              status: result.status,
              output: result.output ?? null,
              error: result.error ?? null,
              parentTaskId: result.parentTaskId ?? undefined,
              runtimeSubgraphId: result.runtimeSubgraphId ?? undefined,
              generatedLocalNodeId: result.generatedLocalNodeId ?? undefined,
              generatedNodeTitle: result.generatedNodeTitle ?? undefined,
            })),
          dynamicReasoningAttempts: activeDynamicAttempts
            .filter((attempt) => attempt.executionId === execution.id)
            .map(toDynamicReasoningAttemptJson),
          threadId: execution.threadId ?? null,
          interruptPayload: execution.pendingApproval
            ? {
                type: execution.pendingApproval.interruptType ?? 'approval_request',
                message: execution.pendingApproval.prompt,
                taskId: execution.pendingApproval.nodeId,
                taskTitle: execution.pendingApproval.taskTitle ?? '',
                iteration: execution.pendingApproval.iteration,
                round: execution.pendingApproval.iteration,
                interruptId: execution.pendingApproval.interruptId ?? '',
                taskDescription: execution.pendingApproval.taskDescription ?? '',
                result: execution.pendingApproval.result ?? '',
                payloadJson: execution.pendingApproval.payloadJson ?? '',
                resumableActions: execution.pendingApproval.resumableActions ?? [],
                blockerRuleId: execution.pendingApproval.blockerRuleId,
                blockerKind: execution.pendingApproval.blockerKind,
                reasonCode: execution.pendingApproval.reasonCode,
                riskLevel: execution.pendingApproval.riskLevel,
                confidence: execution.pendingApproval.confidence,
                downstreamNodeIds: execution.pendingApproval.downstreamNodeIds ?? [],
                feedbackScopeDefault: execution.pendingApproval.feedbackScopeDefault,
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

    const throttleMs = this.configService.get<number>('playbook-flow.queuePositionUpdateThrottleMs', 500);
    const cached = this.queuePositionEmissionCache.get(executionId);
    const now = Date.now();
    if (cached && cached.position === queuePosition && now - cached.emittedAt < throttleMs) {
      return;
    }
    this.queuePositionEmissionCache.set(executionId, { position: queuePosition, emittedAt: now });

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

  private sendHitlEvent(executionId: string, type: string, data: Record<string, unknown>): void {
    const ownerId = this.executionOwnerCache.get(executionId);
    if (!ownerId) return;
    this.streamGateway.sendToUser(ownerId, { type, data });
  }
}
