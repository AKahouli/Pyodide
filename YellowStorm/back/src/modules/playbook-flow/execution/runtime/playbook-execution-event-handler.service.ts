import { forwardRef, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { FlowExecution, FlowExecutionDocument } from '../../schemas/playbook-flow-execution.schema';
import { FlowRouterDecision, FlowRouterDecisionDocument } from '../../schemas/playbook-flow-router-decision.schema';
import { FlowTaskResult, FlowTaskResultDocument } from '../../schemas/playbook-flow-task-result.schema';
import { RESERVED_LABELS } from '../../constants/reserved-labels';
import { PlaybookFlowExecutionAdvisorService } from '../../services/advisor/playbook-flow-execution-advisor.service';
import { PlaybookFlowObservabilityService } from '../../services/observability/playbook-flow-observability.service';
import { PlaybookFlowStreamEventsService } from '../../services/playbook-flow-stream-events.service';
import { PlaybookFlowTokenBufferService } from '../../services/playbook-flow-token-buffer.service';
import { fromGrpcValue } from '../grpc/grpc-struct.mapper';
import { PlaybookExecutionNodeEventHandlerService } from './playbook-execution-node-event-handler.service';
import { PlaybookExecutionReplayRuntimeService } from './playbook-execution-replay-runtime.service';
import { PlaybookDynamicReasoningEventHandlerService } from './playbook-dynamic-reasoning-event-handler.service';

const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'] as const;

export interface PlaybookRunEventContext {
  executionId: string;
  event: Record<string, unknown>;
  releaseExecutionLease: () => Promise<void>;
  scheduleQueueDrain: (ownerId: string) => void;
}

@Injectable()
export class PlaybookExecutionEventHandlerService {
  private readonly logger = new Logger(PlaybookExecutionEventHandlerService.name);

  constructor(
    @InjectModel(FlowExecution.name)
    private readonly executionModel: Model<FlowExecutionDocument>,
    @InjectModel(FlowTaskResult.name)
    private readonly taskResultModel: Model<FlowTaskResultDocument>,
    @InjectModel(FlowRouterDecision.name)
    private readonly routerDecisionModel: Model<FlowRouterDecisionDocument>,
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
    return this.nodeEventHandler ?? new PlaybookExecutionNodeEventHandlerService(
      this.executionModel,
      this.taskResultModel,
      this.streamEvents,
      this.observabilityService,
      this.advisorService,
      this.replayRuntime,
      this.tokenBufferService,
    );
  }

  private async handleRouterDecision(
    context: PlaybookRunEventContext,
    taskNodeId: string,
    iteration: number,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const { executionId } = context;
    const label = String(payload.label || '');
    await this.routerDecisionModel.create({
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

    const result = await this.executionModel
      .updateOne(
        { _id: executionId, status: { $nin: TERMINAL_STATUSES as unknown as string[] } },
        { status: terminalStatus, error: errorMsg, endedAt: new Date() },
      )
      .exec();

    if (!(result as { modifiedCount?: number }).modifiedCount) return;

    await this.tokenBufferService?.flushExecution(executionId);
    await context.releaseExecutionLease();
    this.streamEvents.emitExecutionComplete(executionId, terminalStatus, errorMsg);

    const execution = await this.executionModel.findById(executionId, { ownerId: 1 }).lean();
    const owner = execution ? (execution as unknown as Record<string, unknown>).ownerId as string : undefined;
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
    const result = await this.executionModel
      .updateOne(
        { _id: executionId, status: { $nin: TERMINAL_STATUSES as unknown as string[] } },
        {
          status: 'pending_approval',
          pendingApproval: {
            nodeId: String(payload.node_id || taskNodeId),
            iteration,
            prompt: String(payload.prompt || ''),
            requestedAt: new Date(),
            interruptType: 'approval_request',
            resumableActions: ['approve', 'reject'],
          },
        },
      )
      .exec();
    if ((result as { modifiedCount?: number }).modifiedCount) {
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
    const result = await this.executionModel
      .updateOne(
        { _id: executionId, status: { $nin: TERMINAL_STATUSES as unknown as string[] } },
        { status: 'completed', endedAt: new Date() },
      )
      .exec();
    await this.taskResultModel.updateMany(
      { executionId, status: { $in: ['pending', 'running', 'interrupted'] } },
      { status: 'completed' },
    );
    if ((result as { modifiedCount?: number }).modifiedCount) {
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
    const errorMessage = String(payload.error || 'Execution failed');
    const result = await this.executionModel
      .updateOne(
        { _id: executionId, status: { $nin: TERMINAL_STATUSES as unknown as string[] } },
        { status: 'failed', error: errorMessage, endedAt: new Date() },
      )
      .exec();
    await this.taskResultModel.updateMany(
      { executionId, status: { $in: ['pending', 'running', 'interrupted'] } },
      { status: 'failed' },
    );
    if ((result as { modifiedCount?: number }).modifiedCount) {
      await context.releaseExecutionLease();
      this.streamEvents.emitExecutionComplete(executionId, 'failed', errorMessage);
    }
  }
}
