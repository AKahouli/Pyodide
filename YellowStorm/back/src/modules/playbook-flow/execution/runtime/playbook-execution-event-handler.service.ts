import { forwardRef, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { RESERVED_LABELS } from '../../constants/reserved-labels';
import { EXECUTION_OPEN_STATUSES, ExecutionRepository } from '../../persistence/execution.repository';
import { RouterDecisionRepository } from '../../persistence/router-decision.repository';
import { TASK_RESULT_OPEN_STATUSES, TaskResultRepository } from '../../persistence/task-result.repository';
import { PlaybookFlowExecutionAdvisorService } from '../../services/advisor/playbook-flow-execution-advisor.service';
import { PlaybookFlowObservabilityService } from '../../services/observability/playbook-flow-observability.service';
import { PlaybookFlowStreamEventsService } from '../../services/playbook-flow-stream-events.service';
import { PlaybookFlowTokenBufferService } from '../../services/playbook-flow-token-buffer.service';
import { sanitizePlaybookPublicValue } from '../../utils/playbook-artifact';
import { fromGrpcValue } from '../grpc/grpc-struct.mapper';
import { PlaybookExecutionNodeEventHandlerService } from './playbook-execution-node-event-handler.service';
import { PlaybookExecutionReplayRuntimeService } from './playbook-execution-replay-runtime.service';
import { PlaybookDynamicReasoningEventHandlerService } from './playbook-dynamic-reasoning-event-handler.service';

export interface PlaybookRunEventContext {
  executionId: string;
  event: Record<string, unknown>;
  releaseExecutionLease: () => Promise<void>;
  scheduleQueueDrain: (ownerId: string) => void;
}

@Injectable()
export class PlaybookExecutionEventHandlerService {
  private readonly logger = new Logger(PlaybookExecutionEventHandlerService.name);
  private fallbackNodeEventHandler?: PlaybookExecutionNodeEventHandlerService;

  constructor(
    private readonly executionRepository: ExecutionRepository,
    private readonly taskResultRepository: TaskResultRepository,
    private readonly routerDecisionRepository: RouterDecisionRepository,
    private readonly streamEvents: PlaybookFlowStreamEventsService,
    private readonly observabilityService: PlaybookFlowObservabilityService,
    @Inject(forwardRef(() => PlaybookFlowExecutionAdvisorService))
    private readonly advisorService: PlaybookFlowExecutionAdvisorService,
    private readonly replayRuntime: PlaybookExecutionReplayRuntimeService,
    @Optional() private readonly nodeEventHandler?: PlaybookExecutionNodeEventHandlerService,
    @Optional() private readonly tokenBufferService?: PlaybookFlowTokenBufferService,
    @Optional() private readonly dynamicReasoningHandler?: PlaybookDynamicReasoningEventHandlerService,
  ) {}

  async handleRunEvent(context: PlaybookRunEventContext): Promise<void> {
    const { executionId, event } = context;
    const eventType = event.event_type as string;
    const rawPayload = (event.payload as Record<string, unknown>) || {};
    const payload = (fromGrpcValue(rawPayload) as Record<string, unknown>) || {};
    const taskNodeId = event.node_id as string;
    const iteration = Number(event.iteration ?? payload.iteration ?? 0);

    this.logger.debug(`Received playbook flow event ${eventType} for execution ${executionId}`);

    if (this.dynamicReasoningHandler?.supports(eventType)) {
      await this.dynamicReasoningHandler.handle(executionId, eventType, taskNodeId, iteration, payload);
    } else if (eventType === 'NodeStarted') {
      await this.getNodeHandler().handleStarted(executionId, taskNodeId, iteration, payload);
    } else if (eventType === 'NodeToken') {
      await this.getNodeHandler().handleToken(executionId, taskNodeId, iteration, payload);
    } else if (eventType === 'NodeTraceUpdate') {
      await this.getNodeHandler().handleTraceUpdate(executionId, taskNodeId, iteration, payload);
    } else if (eventType === 'NodeCompleted') {
      await this.getNodeHandler().handleCompleted(executionId, taskNodeId, iteration, payload);
    } else if (eventType === 'NodeFailed') {
      await this.getNodeHandler().handleFailed(executionId, taskNodeId, iteration, payload);
    } else if (eventType === 'NodeSkipped') {
      await this.getNodeHandler().handleSkipped(executionId, taskNodeId, iteration);
    } else if (eventType === 'NodeSuspended') {
      await this.getNodeHandler().handleSuspended(executionId, taskNodeId, iteration, payload);
    } else if (eventType === 'IteratorChildStepStarted') {
      await this.getNodeHandler().handleIteratorChildStarted(executionId, taskNodeId, iteration, payload);
    } else if (eventType === 'IteratorChildStepCompleted') {
      await this.getNodeHandler().handleIteratorChildCompleted(executionId, taskNodeId, iteration, payload);
    } else if (eventType === 'RouterDecision') {
      await this.handleRouterDecision(context, taskNodeId, iteration, payload);
    } else if (eventType === 'ApprovalRequested') {
      await this.handleApprovalRequested(executionId, taskNodeId, iteration, payload);
    } else if (eventType === 'ExecutionCompleted') {
      await this.handleExecutionCompleted(context);
    } else if (eventType === 'ExecutionFailed') {
      await this.handleExecutionFailed(context, payload);
    }
  }

  private getNodeHandler(): PlaybookExecutionNodeEventHandlerService {
    if (this.nodeEventHandler) return this.nodeEventHandler;
    this.fallbackNodeEventHandler ??= new PlaybookExecutionNodeEventHandlerService(
      this.executionRepository,
      this.taskResultRepository,
      this.streamEvents,
      this.observabilityService,
      this.advisorService,
      this.replayRuntime,
      this.tokenBufferService,
    );
    return this.fallbackNodeEventHandler;
  }

  private async handleRouterDecision(
    context: PlaybookRunEventContext,
    taskNodeId: string,
    iteration: number,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const { executionId } = context;
    const label = String(payload.label || '');
    await this.routerDecisionRepository.create({
      executionId,
      routerNodeId: taskNodeId,
      iteration,
      label,
      decidedAt: new Date(),
    });
    this.streamEvents.emitRouterDecision(executionId, taskNodeId, label, iteration);

    if (!RESERVED_LABELS.includes(label as any)) return;

    this.logger.warn(
      `Execution ${executionId} reached reserved label '${label}' via router ${taskNodeId} iteration ${iteration}`,
    );

    const terminalStatus = label === '__error__' ? 'failed' : 'cancelled';
    const errorMsg = label === '__error__' ? `Router ${taskNodeId} returned __error__` : `Router ${taskNodeId} returned __cancelled__`;

    const ended = await this.executionRepository.transition(executionId, {
      from: EXECUTION_OPEN_STATUSES,
      patch: { status: terminalStatus, error: errorMsg, endedAt: new Date() },
    });

    if (!ended) return;

    await this.tokenBufferService?.flushExecution(executionId);
    await context.releaseExecutionLease();
    this.streamEvents.emitExecutionComplete(executionId, terminalStatus, errorMsg);

    const execution = await this.executionRepository.findById(executionId);
    const owner = execution?.ownerId;
    if (owner) {
      context.scheduleQueueDrain(owner);
    }
  }

  private async handleApprovalRequested(
    executionId: string,
    taskNodeId: string,
    iteration: number,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const paused = await this.executionRepository.setPendingApproval(executionId, {
      nodeId: String(payload.node_id || taskNodeId),
      iteration,
      prompt: String(payload.prompt || ''),
      requestedAt: new Date(),
      interruptType: 'approval_request',
      resumableActions: ['approve', 'reject'],
    });
    if (paused) {
      this.streamEvents.emitInterrupt(
        executionId,
        String(payload.node_id || taskNodeId),
        String(payload.prompt || ''),
        iteration,
        executionId,
        {
          interruptType: 'approval_request',
          resumableActions: ['approve', 'reject'],
        },
      );
    }
  }

  private async handleExecutionCompleted(context: PlaybookRunEventContext): Promise<void> {
    const { executionId } = context;
    await this.tokenBufferService?.flushExecution(executionId);
    this.getNodeHandler().discardExecutionTokens(executionId);
    const failedTask = await this.taskResultRepository.findLatestFailed(executionId);
    if (failedTask) {
      await this.handleExecutionFailed(context, {
        error: failedTask.error || 'Execution failed because a task failed',
      });
      return;
    }
    const completed = await this.executionRepository.transition(executionId, {
      from: EXECUTION_OPEN_STATUSES,
      patch: { status: 'completed', endedAt: new Date() },
    });
    await this.taskResultRepository.updateManyForExecution(executionId, { statuses: TASK_RESULT_OPEN_STATUSES }, { status: 'completed' });
    if (completed) {
      await context.releaseExecutionLease();
      this.streamEvents.emitExecutionComplete(executionId, 'completed');
    }
  }

  private async handleExecutionFailed(
    context: PlaybookRunEventContext,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const { executionId } = context;
    await this.tokenBufferService?.flushExecution(executionId);
    this.getNodeHandler().discardExecutionTokens(executionId);
    const errorMessage = String(sanitizePlaybookPublicValue(payload.error || 'Execution failed'));
    const failed = await this.executionRepository.transition(executionId, {
      from: EXECUTION_OPEN_STATUSES,
      patch: { status: 'failed', error: errorMessage, endedAt: new Date() },
    });
    await this.taskResultRepository.updateManyForExecution(executionId, { statuses: TASK_RESULT_OPEN_STATUSES }, { status: 'failed' });
    if (failed) {
      await context.releaseExecutionLease();
      this.streamEvents.emitExecutionComplete(executionId, 'failed', errorMessage);
    }
  }
}
