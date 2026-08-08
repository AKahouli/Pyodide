import { forwardRef, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { FlowExecution, FlowExecutionDocument } from '../../schemas/playbook-flow-execution.schema';
import { FlowTaskResult, FlowTaskResultDocument } from '../../schemas/playbook-flow-task-result.schema';
import { FlowCompletedResultPayload } from '../../interfaces/playbook-flow-observability.interface';
import { PlaybookFlowExecutionAdvisorService } from '../../services/advisor/playbook-flow-execution-advisor.service';
import { PlaybookFlowObservabilityService } from '../../services/observability/playbook-flow-observability.service';
import { PlaybookFlowStreamEventsService } from '../../services/playbook-flow-stream-events.service';
import { PlaybookFlowTokenBufferService } from '../../services/playbook-flow-token-buffer.service';
import { PlaybookExecutionReplayRuntimeService } from './playbook-execution-replay-runtime.service';

const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'] as const;

@Injectable()
export class PlaybookExecutionNodeEventHandlerService {
  private readonly logger = new Logger(PlaybookExecutionNodeEventHandlerService.name);

  constructor(
    @InjectModel(FlowExecution.name)
    private readonly executionModel: Model<FlowExecutionDocument>,
    @InjectModel(FlowTaskResult.name)
    private readonly taskResultModel: Model<FlowTaskResultDocument>,
    private readonly streamEvents: PlaybookFlowStreamEventsService,
    private readonly observabilityService: PlaybookFlowObservabilityService,
    @Inject(forwardRef(() => PlaybookFlowExecutionAdvisorService))
    private readonly advisorService: PlaybookFlowExecutionAdvisorService,
    private readonly replayRuntime: PlaybookExecutionReplayRuntimeService,
    @Optional() private readonly tokenBufferService?: PlaybookFlowTokenBufferService,
  ) {}

  async handleStarted(executionId: string, taskNodeId: string, iteration: number, payload: Record<string, unknown> = {}): Promise<void> {
    if (this.replayRuntime.hasTrackedTask(executionId, taskNodeId)) {
      try {
        await this.replayRuntime.ensureIterationReportMaterialized(executionId, taskNodeId, iteration);
      } catch (err) {
        this.logger.warn(`Failed to materialize replay report for execution ${executionId} task ${taskNodeId} iteration ${iteration}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    await this.taskResultModel.updateOne(
      { executionId, taskId: taskNodeId, iteration },
      {
        $set: {
          status: 'running',
          startedAt: new Date(),
        },
        $setOnInsert: {
          executionId,
          taskId: taskNodeId,
          iteration,
        },
      },
      { upsert: true },
    );
    this.streamEvents.emitStepStart(executionId, taskNodeId);
  }

  async handleToken(executionId: string, taskNodeId: string, iteration: number, payload: Record<string, unknown>): Promise<void> {
    const token = String(payload.token ?? '');
    if (!token) return;

    if (this.tokenBufferService?.isEnabled()) {
      await this.tokenBufferService.appendToken({ executionId, taskId: taskNodeId, iteration }, token);
      return;
    }

    await this.taskResultModel.updateOne(
      { executionId, taskId: taskNodeId, iteration },
      [
        {
          $set: {
            status: 'running',
            output: {
              $concat: [{ $ifNull: ['$output', ''] }, token],
            },
          },
        },
      ],
      { upsert: true },
    );
    this.streamEvents.emitStepUpdate(executionId, taskNodeId, token);
  }

  async handleTraceUpdate(executionId: string, taskNodeId: string, iteration: number, payload: Record<string, unknown>): Promise<void> {
    const tracePayload = this.observabilityService.extractTraceUpdatePayload(payload, {
      executionId,
      taskId: taskNodeId,
    });

    await this.taskResultModel.updateOne(
      { executionId, taskId: taskNodeId, iteration },
      {
        $set: {
          toolTrace: tracePayload.toolTrace,
          llmPromptTrace: tracePayload.llmPromptTrace,
          usage: tracePayload.usage,
          traceMetadata: tracePayload.traceMetadata,
        },
        $setOnInsert: {
          executionId,
          taskId: taskNodeId,
          iteration,
          startedAt: new Date(),
          ...(payload.parent_node_id ? {
            parentTaskId: String(payload.parent_node_id),
            runtimeSubgraphId: String(payload.runtime_subgraph_id || ''),
            generatedLocalNodeId: String(payload.generated_local_node_id || ''),
            generatedNodeTitle: String(payload.generated_title || ''),
          } : {}),
        },
      },
      { upsert: true },
    );

    this.streamEvents.emitStepUpdate(executionId, taskNodeId, undefined, {
      toolTrace: tracePayload.toolTrace,
      llmPromptTrace: tracePayload.llmPromptTrace,
      traceMetadata: tracePayload.traceMetadata,
      inputTokens: tracePayload.usage?.inputTokens ?? null,
      outputTokens: tracePayload.usage?.outputTokens ?? null,
      totalTokens: tracePayload.usage?.totalTokens ?? null,
      modelName: tracePayload.usage?.model ?? null,
    });
  }

  async handleCompleted(executionId: string, taskNodeId: string, iteration: number, payload: Record<string, unknown>): Promise<void> {
    await this.tokenBufferService?.flushTask({ executionId, taskId: taskNodeId, iteration });
    const resultPayload = this.observabilityService.extractCompletedResultPayload(payload, {
      executionId,
      taskId: taskNodeId,
    });

    await this.taskResultModel.updateOne(
      { executionId, taskId: taskNodeId, iteration },
      {
        $set: {
          status: 'completed',
          output: resultPayload.output,
          displayText: resultPayload.displayText,
          outputs: resultPayload.outputs,
          artifacts: resultPayload.artifacts,
          components: resultPayload.components,
          iteratorIterations: resultPayload.iteratorIterations,
          toolTrace: resultPayload.toolTrace,
          reasoningChain: resultPayload.reasoningChain ?? [],
          llmPromptTrace: resultPayload.llmPromptTrace,
          usage: resultPayload.usage,
          semanticMatch: resultPayload.semanticMatch,
          traceMetadata: resultPayload.traceMetadata,
          error: null,
          endedAt: new Date(),
          ...(payload.parent_node_id ? {
            parentTaskId: String(payload.parent_node_id),
            runtimeSubgraphId: String(payload.runtime_subgraph_id || ''),
            generatedLocalNodeId: String(payload.generated_local_node_id || ''),
            generatedNodeTitle: String(payload.generated_title || ''),
          } : {}),
        },
        $setOnInsert: {
          executionId,
          taskId: taskNodeId,
          iteration,
          startedAt: new Date(),
        },
      },
      { upsert: true },
    );
    await this.persistReplayDrift(executionId, taskNodeId, iteration, resultPayload);
    this.streamEvents.emitStepComplete(
      executionId,
      taskNodeId,
      resultPayload.displayText ?? resultPayload.output,
      undefined,
      iteration,
      resultPayload.artifacts,
      resultPayload.components,
      this.observabilityService.toStreamPayload(resultPayload),
    );

    const execDoc = await this.executionModel.findById(executionId, 'ownerId advisorAutopilotEnabled reflectionEnabled advisorScoringMode').lean().exec();
    if (!taskNodeId.includes('::dynamic-reasoning::') && execDoc?.ownerId && (execDoc.advisorAutopilotEnabled || execDoc.reflectionEnabled)) {
      this.advisorService.runTaskEvaluation(executionId, taskNodeId, String(execDoc.ownerId), {
        iteration,
        advisorScoringMode: execDoc.advisorScoringMode,
      }).catch((err) => {
        this.logger.warn(`Auto-advisor evaluation failed for ${executionId}:${taskNodeId}: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  }

  async handleFailed(executionId: string, taskNodeId: string, iteration: number, payload: Record<string, unknown>): Promise<void> {
    await this.tokenBufferService?.flushTask({ executionId, taskId: taskNodeId, iteration });
    const errorMessage = String(payload.error || 'Node execution failed');
    await this.taskResultModel.updateOne(
      { executionId, taskId: taskNodeId, iteration },
      {
        $set: {
          status: 'failed',
          error: errorMessage,
          endedAt: new Date(),
        },
        $setOnInsert: {
          executionId,
          taskId: taskNodeId,
          iteration,
          startedAt: new Date(),
        },
      },
      { upsert: true },
    );
    this.streamEvents.emitStepComplete(executionId, taskNodeId, undefined, errorMessage, iteration);
  }

  async handleSkipped(executionId: string, taskNodeId: string, iteration: number): Promise<void> {
    await this.taskResultModel.updateOne(
      { executionId, taskId: taskNodeId, iteration },
      {
        $set: {
          status: 'skipped',
          endedAt: new Date(),
        },
        $setOnInsert: {
          executionId,
          taskId: taskNodeId,
          iteration,
          startedAt: new Date(),
        },
      },
      { upsert: true },
    );
    this.streamEvents.emitStepComplete(executionId, taskNodeId, undefined, undefined, iteration);
  }

  async handleSuspended(executionId: string, taskNodeId: string, iteration: number, payload: Record<string, unknown>): Promise<void> {
    const interruptType = String(payload.type || 'human_approval');
    const interruptMessage = String(payload.message || '');
    const interruptId = String(payload.interrupt_id || payload.interruptId || '');
    const taskDescription = String(payload.task_description || '');
    const result = String(payload.result || '');
    const payloadJson = String(payload.conversation_json || payload.payloadJson || '');
    const resumableActions: string[] = Array.isArray(payload.resumable_actions || payload.resumableActions)
      ? (payload.resumable_actions || payload.resumableActions) as string[]
      : [];
    const downstreamNodeIds: string[] = Array.isArray(payload.downstream_node_ids || payload.downstreamNodeIds)
      ? (payload.downstream_node_ids || payload.downstreamNodeIds) as string[]
      : [];
    const blockerRuleId = String(payload.blocker_rule_id || payload.blockerRuleId || '');
    const blockerKind = String(payload.blocker_kind || payload.blockerKind || '');
    const reasonCode = String(payload.reason_code || payload.reasonCode || '');
    const riskLevel = String(payload.risk_level || payload.riskLevel || '');
    const feedbackScopeDefault = String(payload.feedback_scope_default || payload.feedbackScopeDefault || '');
    const confidence = typeof payload.confidence === 'number' ? payload.confidence : undefined;
    const hitlEventType = interruptType === 'review_request'
      ? 'review_request'
      : interruptType === 'clarification'
        ? 'clarification'
        : 'approval_request';

    const staleInterrupt = await this.executionModel.exists({
      _id: executionId,
      $or: [
        { status: { $in: TERMINAL_STATUSES as unknown as string[] } },
        { hitlEvents: { $elemMatch: { interruptId, status: 'answered' } } },
      ],
    }).exec();
    if (staleInterrupt) {
      this.logger.warn(`Ignoring stale HITL interrupt ${interruptId || '<none>'} for execution ${executionId}`);
      return;
    }

    await this.taskResultModel.updateOne(
      { executionId, taskId: taskNodeId, iteration },
      {
        $set: {
          status: 'interrupted',
        },
        $setOnInsert: {
          executionId,
          taskId: taskNodeId,
          iteration,
          startedAt: new Date(),
        },
      },
      { upsert: true },
    );

    const updateResult = await this.executionModel
      .updateOne(
        { _id: executionId, status: { $nin: TERMINAL_STATUSES as unknown as string[] } },
        {
          $set: {
            status: 'pending_approval',
            pendingApproval: {
              nodeId: taskNodeId,
              iteration,
              prompt: interruptMessage,
              requestedAt: new Date(),
              interruptType,
              interruptId,
              taskTitle: String(payload.task_title || payload.taskTitle || ''),
              taskDescription,
              result,
              payloadJson,
              resumableActions,
              ...(blockerRuleId ? { blockerRuleId } : {}),
              ...(blockerKind ? { blockerKind } : {}),
              ...(reasonCode ? { reasonCode } : {}),
              ...(riskLevel ? { riskLevel } : {}),
              ...(confidence !== undefined ? { confidence } : {}),
              ...(downstreamNodeIds.length > 0 ? { downstreamNodeIds } : {}),
              ...(feedbackScopeDefault ? { feedbackScopeDefault } : {}),
              interruptPayload: payload,
            },
          },
          $push: {
            hitlEvents: {
              id: new Types.ObjectId().toString(),
              nodeId: taskNodeId,
              iteration,
              interruptId,
              type: hitlEventType,
              blockerRuleId: blockerRuleId || null,
              blockerKind: blockerKind || null,
              reasonCode: reasonCode || 'runtime_interrupt',
              riskLevel: riskLevel || 'medium',
              prompt: interruptMessage,
              payload,
              status: 'pending',
              response: null,
              downstreamNodeIds,
              createdAt: new Date(),
              respondedAt: null,
            },
          },
        },
      )
      .exec();

    if (!(updateResult as { modifiedCount?: number; upsertedCount?: number }).modifiedCount) {
      return;
    }

    this.streamEvents.emitInterrupt(
      executionId,
      taskNodeId,
      interruptMessage,
      iteration,
      executionId,
      {
        interruptType,
        interruptId,
        taskDescription,
        result,
        payloadJson,
        resumableActions,
        ...(blockerRuleId ? { blockerRuleId } : {}),
        ...(blockerKind ? { blockerKind } : {}),
        ...(reasonCode ? { reasonCode } : {}),
        ...(riskLevel ? { riskLevel } : {}),
        ...(confidence !== undefined ? { confidence } : {}),
        ...(downstreamNodeIds.length > 0 ? { downstreamNodeIds } : {}),
        ...(feedbackScopeDefault ? { feedbackScopeDefault } : {}),
      },
    );
  }

  private async persistReplayDrift(executionId: string, taskNodeId: string, iteration: number, resultPayload: FlowCompletedResultPayload): Promise<void> {
    try {
      const replayArtifacts = await this.replayRuntime.resolveArtifactsForCompletedTask(executionId, taskNodeId, iteration);
      if (replayArtifacts) {
        await this.replayRuntime.persistStructuralDrift({
          executionId,
          taskId: taskNodeId,
          iteration,
          output: resultPayload.output,
          toolTrace: resultPayload.toolTrace ?? [],
          reasoningChain: resultPayload.reasoningChain ?? [],
          semanticMatch: resultPayload.semanticMatch ?? null,
          replayArtifacts,
          traceMetadata: resultPayload.traceMetadata,
        });
        this.replayRuntime.triggerPostRunEvaluation(executionId, replayArtifacts, taskNodeId, iteration, resultPayload).catch((postErr) => {
          this.logger.warn(`Post-run evaluation failed for ${executionId}:${taskNodeId}: ${postErr instanceof Error ? postErr.message : String(postErr)}`);
        });
      } else if (resultPayload.semanticMatch) {
        try {
          await this.replayRuntime.backfillSemanticMatch(executionId, taskNodeId, iteration, resultPayload.semanticMatch);
        } catch (smErr) {
          this.logger.warn(`Failed to backfill semanticMatch for non-applied replay task ${taskNodeId}: ${smErr instanceof Error ? smErr.message : String(smErr)}`);
        }
      }
    } catch (err) {
      this.logger.warn(`Failed to resolve replay artifacts for task ${taskNodeId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
