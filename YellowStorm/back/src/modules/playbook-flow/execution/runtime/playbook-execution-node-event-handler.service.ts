import { forwardRef, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { newObjectId } from '@common/postgres';
import { FlowCompletedResultPayload } from '../../interfaces/playbook-flow-observability.interface';
import { ExecutionRepository } from '../../persistence/execution.repository';
import { TaskResultRepository, type TaskResultPatch } from '../../persistence/task-result.repository';
import { PlaybookFlowExecutionAdvisorService } from '../../services/advisor/playbook-flow-execution-advisor.service';
import { PlaybookFlowObservabilityService } from '../../services/observability/playbook-flow-observability.service';
import { PlaybookFlowStreamEventsService } from '../../services/playbook-flow-stream-events.service';
import { PlaybookFlowTokenBufferService } from '../../services/playbook-flow-token-buffer.service';
import { PlaybookFlowArtifactService } from '../../services/playbook-flow-artifact.service';
import { PlaybookTokenStreamRedactor, publicPlaybookTaskResult, sanitizePlaybookPublicValue } from '../../utils/playbook-artifact';
import { PlaybookExecutionReplayRuntimeService } from './playbook-execution-replay-runtime.service';

type Json = Record<string, unknown>;

/** The generated-node columns of a dynamic-reasoning child task, when the event carries them. */
function runtimeSubgraphFields(payload: Record<string, unknown>): TaskResultPatch {
  return payload.parent_node_id ? {
    parentTaskId: String(payload.parent_node_id),
    runtimeSubgraphId: String(payload.runtime_subgraph_id || ''),
    generatedLocalNodeId: String(payload.generated_local_node_id || ''),
    generatedNodeTitle: String(payload.generated_title || ''),
  } : {};
}

@Injectable()
export class PlaybookExecutionNodeEventHandlerService {
  private readonly logger = new Logger(PlaybookExecutionNodeEventHandlerService.name);
  private readonly directStreamRedactor = new PlaybookTokenStreamRedactor();

  constructor(
    private readonly executionRepository: ExecutionRepository,
    private readonly taskResultRepository: TaskResultRepository,
    private readonly streamEvents: PlaybookFlowStreamEventsService,
    private readonly observabilityService: PlaybookFlowObservabilityService,
    @Inject(forwardRef(() => PlaybookFlowExecutionAdvisorService))
    private readonly advisorService: PlaybookFlowExecutionAdvisorService,
    private readonly replayRuntime: PlaybookExecutionReplayRuntimeService,
    @Optional() private readonly tokenBufferService?: PlaybookFlowTokenBufferService,
    @Optional() private readonly artifactService?: PlaybookFlowArtifactService,
  ) {}

  async handleStarted(executionId: string, taskNodeId: string, iteration: number, payload: Record<string, unknown> = {}): Promise<void> {
    if (this.replayRuntime.hasTrackedTask(executionId, taskNodeId)) {
      try {
        await this.replayRuntime.ensureIterationReportMaterialized(executionId, taskNodeId, iteration);
      } catch (err) {
        this.logger.warn(`Failed to materialize replay report for execution ${executionId} task ${taskNodeId} iteration ${iteration}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    await this.taskResultRepository.upsert(
      { executionId, taskId: taskNodeId, iteration },
      { status: 'running', startedAt: new Date() },
    );
    this.streamEvents.emitStepStart(executionId, taskNodeId);
  }

  async handleToken(executionId: string, taskNodeId: string, iteration: number, payload: Record<string, unknown>): Promise<void> {
    const token = String(payload.token ?? '');
    if (!token) return;

    const tokenBuffer = this.tokenBufferService;
    if (tokenBuffer && (await tokenBuffer.isEnabled())) {
      await tokenBuffer.appendToken({ executionId, taskId: taskNodeId, iteration }, token);
      return;
    }

    await this.taskResultRepository.appendOutput({ executionId, taskId: taskNodeId, iteration }, token);
    const publicToken = this.directStreamRedactor.push(this.tokenKey(executionId, taskNodeId, iteration), token);
    if (publicToken) this.streamEvents.emitStepUpdate(executionId, taskNodeId, publicToken);
  }

  async handleTraceUpdate(executionId: string, taskNodeId: string, iteration: number, payload: Record<string, unknown>): Promise<void> {
    const redactSensitiveText = await this.observabilityService.shouldRedactSensitiveText();
    const tracePayload = sanitizePlaybookPublicValue(
      this.observabilityService.extractTraceUpdatePayload(payload, {
        executionId,
        taskId: taskNodeId,
      }, redactSensitiveText),
      false,
      redactSensitiveText,
    ) as ReturnType<PlaybookFlowObservabilityService['extractTraceUpdatePayload']>;

    await this.taskResultRepository.upsert(
      { executionId, taskId: taskNodeId, iteration },
      {
        toolTrace: tracePayload.toolTrace as unknown as Json[] | undefined,
        llmPromptTrace: tracePayload.llmPromptTrace as unknown as Json[] | undefined,
        usage: tracePayload.usage as unknown as Json | null | undefined,
        traceMetadata: tracePayload.traceMetadata,
      },
      { startedAt: new Date(), ...runtimeSubgraphFields(payload) },
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
    await this.flushTokenStream(executionId, taskNodeId, iteration);
    const redactSensitiveText = await this.observabilityService.shouldRedactSensitiveText();
    const extractedResultPayload = this.observabilityService.extractCompletedResultPayload(payload, {
      executionId,
      taskId: taskNodeId,
    }, redactSensitiveText);
    const sanitizedTrace = sanitizePlaybookPublicValue({
      toolTrace: extractedResultPayload.toolTrace,
      llmPromptTrace: extractedResultPayload.llmPromptTrace,
      traceMetadata: extractedResultPayload.traceMetadata,
    }, false, redactSensitiveText) as Pick<FlowCompletedResultPayload, 'toolTrace' | 'llmPromptTrace' | 'traceMetadata'>;
    const resultPayload: FlowCompletedResultPayload = {
      ...extractedResultPayload,
      ...sanitizedTrace,
    };

    await this.taskResultRepository.upsert(
      { executionId, taskId: taskNodeId, iteration },
      {
        status: 'completed',
        output: resultPayload.output,
        displayText: resultPayload.displayText,
        outputs: resultPayload.outputs,
        artifacts: resultPayload.artifacts,
        components: resultPayload.components,
        iteratorIterations: resultPayload.iteratorIterations,
        toolTrace: resultPayload.toolTrace as unknown as Json[] | undefined,
        reasoningChain: (resultPayload.reasoningChain ?? []) as unknown as Json[],
        llmPromptTrace: resultPayload.llmPromptTrace as unknown as Json[] | undefined,
        usage: resultPayload.usage as unknown as Json | null | undefined,
        semanticMatch: resultPayload.semanticMatch as unknown as Json | null | undefined,
        traceMetadata: resultPayload.traceMetadata,
        error: null,
        endedAt: new Date(),
        ...runtimeSubgraphFields(payload),
      },
      { startedAt: new Date() },
    );
    await this.persistReplayDrift(executionId, taskNodeId, iteration, resultPayload);
    const execDoc = await this.executionRepository.findById(executionId);
    const rawPublicResult = { ...resultPayload, taskId: taskNodeId, iteration };
    const publicResultPayload = (this.artifactService
      ? await this.artifactService.projectPublicTaskResult(
        rawPublicResult,
        String(execDoc?.ownerId || ''),
        executionId,
        redactSensitiveText,
      )
      : publicPlaybookTaskResult(
        rawPublicResult,
        String(execDoc?.ownerId || ''),
        executionId,
        new Set(),
        redactSensitiveText,
      )) as unknown as FlowCompletedResultPayload;
    this.streamEvents.emitStepComplete(
      executionId,
      taskNodeId,
      publicResultPayload.displayText ?? publicResultPayload.output,
      undefined,
      iteration,
      publicResultPayload.artifacts,
      publicResultPayload.components,
      this.observabilityService.toStreamPayload(publicResultPayload, redactSensitiveText),
    );

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
    await this.flushTokenStream(executionId, taskNodeId, iteration);
    const errorMessage = String(sanitizePlaybookPublicValue(payload.error || 'Node execution failed'));
    await this.taskResultRepository.upsert(
      { executionId, taskId: taskNodeId, iteration },
      { status: 'failed', error: errorMessage, endedAt: new Date() },
      { startedAt: new Date() },
    );
    this.streamEvents.emitStepComplete(executionId, taskNodeId, undefined, errorMessage, iteration);
  }

  async handleSkipped(executionId: string, taskNodeId: string, iteration: number): Promise<void> {
    await this.flushTokenStream(executionId, taskNodeId, iteration);
    await this.taskResultRepository.upsert(
      { executionId, taskId: taskNodeId, iteration },
      { status: 'skipped', endedAt: new Date() },
      { startedAt: new Date() },
    );
    this.streamEvents.emitStepComplete(executionId, taskNodeId, undefined, undefined, iteration);
  }

  async handleIteratorChildStarted(executionId: string, iteratorNodeId: string, iteration: number, payload: Record<string, unknown>): Promise<void> {
    const child = await this.sanitizeIteratorChildPayload(payload, 'running');
    await this.mergeIteratorChildIntoTaskResult(executionId, iteratorNodeId, iteration, child);
    this.streamEvents.emitIteratorChildStepStarted(executionId, iteratorNodeId, child);
  }

  async handleIteratorChildCompleted(executionId: string, iteratorNodeId: string, iteration: number, payload: Record<string, unknown>): Promise<void> {
    const child = await this.sanitizeIteratorChildPayload(payload, 'completed');
    await this.mergeIteratorChildIntoTaskResult(executionId, iteratorNodeId, iteration, child);
    this.streamEvents.emitIteratorChildStepCompleted(executionId, iteratorNodeId, child);
  }

  discardExecutionTokens(executionId: string): void {
    this.directStreamRedactor.discardExecution(executionId);
  }

  private async sanitizeIteratorChildPayload(payload: Record<string, unknown>, fallbackStatus: string) {
    const redactSensitiveText = await this.observabilityService.shouldRedactSensitiveText();
    const sanitize = (value: unknown) => sanitizePlaybookPublicValue(value, false, redactSensitiveText);
    return {
      iterationIndex: Number(payload.iterationIndex ?? 0) || 0,
      taskId: String(payload.taskId ?? ''),
      taskTitle: payload.taskTitle === undefined ? undefined : String(payload.taskTitle),
      status: String(payload.status ?? fallbackStatus),
      output: typeof payload.output === 'string' ? sanitize(payload.output) as string : undefined,
      error: typeof payload.error === 'string' ? sanitize(payload.error) as string : undefined,
      components: Array.isArray(payload.components) ? sanitize(payload.components) as Array<Record<string, unknown>> : undefined,
      artifacts: Array.isArray(payload.artifacts) ? sanitize(payload.artifacts) as Array<Record<string, unknown>> : undefined,
    };
  }

  // Merges a streamed child result into the iterator task's iteratorIterations so
  // pollers and reconnects see the same partial progress as SSE consumers.
  private async mergeIteratorChildIntoTaskResult(
    executionId: string,
    iteratorNodeId: string,
    iteration: number,
    child: Awaited<ReturnType<PlaybookExecutionNodeEventHandlerService['sanitizeIteratorChildPayload']>>,
  ): Promise<void> {
    const doc = await this.taskResultRepository.find(
      { executionId, taskId: iteratorNodeId, iteration },
      { light: true, with: ['iteratorIterations'] },
    );
    const iterations: Array<Record<string, any>> = [...(doc?.iteratorIterations ?? [])];
    const index = iterations.findIndex((entry) => Number(entry?.index ?? -1) === child.iterationIndex);
    const iterationEntry: Record<string, any> = index >= 0
      ? { ...iterations[index] }
      : { index: child.iterationIndex, status: 'running', output: null, error: null, childResults: [] };
    const childResults: Array<Record<string, any>> = [...(Array.isArray(iterationEntry.childResults) ? iterationEntry.childResults : [])];
    const childIndex = childResults.findIndex((entry) => entry?.taskId === child.taskId);
    const previous = childIndex >= 0 ? childResults[childIndex] : null;
    const merged: Record<string, any> = {
      taskId: child.taskId,
      taskTitle: child.taskTitle || previous?.taskTitle || '',
      status: child.status,
      output: child.output ?? previous?.output ?? null,
      error: child.error ?? previous?.error ?? null,
      components: child.components ?? previous?.components ?? [],
      artifacts: child.artifacts ?? previous?.artifacts ?? [],
    };
    if (childIndex >= 0) childResults[childIndex] = merged;
    else childResults.push(merged);
    iterationEntry.childResults = childResults;
    iterationEntry.status = childResults.some((entry) => entry?.status === 'running' || entry?.status === 'interrupted')
      ? 'running'
      : childResults.some((entry) => entry?.status === 'failed')
        ? 'failed'
        : 'completed';
    if (index >= 0) iterations[index] = iterationEntry;
    else iterations.push(iterationEntry);

    await this.taskResultRepository.upsert(
      { executionId, taskId: iteratorNodeId, iteration },
      { iteratorIterations: iterations },
      { startedAt: new Date(), status: 'running' },
    );
  }

  private async flushTokenStream(executionId: string, taskNodeId: string, iteration: number): Promise<void> {
    const key = { executionId, taskId: taskNodeId, iteration };
    const tokenBuffer = this.tokenBufferService;
    if (tokenBuffer && (await tokenBuffer.isEnabled())) {
      await tokenBuffer.flushTask(key);
      return;
    }
    const publicToken = this.directStreamRedactor.flush(this.tokenKey(executionId, taskNodeId, iteration));
    if (publicToken) this.streamEvents.emitStepUpdate(executionId, taskNodeId, publicToken);
  }

  private tokenKey(executionId: string, taskNodeId: string, iteration: number): string {
    return `${executionId}:${taskNodeId}:${iteration}`;
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

    const staleInterrupt = await this.executionRepository.isInterruptStale(executionId, interruptId);
    if (staleInterrupt) {
      this.logger.warn(`Ignoring stale HITL interrupt ${interruptId || '<none>'} for execution ${executionId}`);
      return;
    }

    await this.taskResultRepository.upsert(
      { executionId, taskId: taskNodeId, iteration },
      { status: 'interrupted' },
      { startedAt: new Date() },
    );

    const paused = await this.executionRepository.setPendingApproval(
      executionId,
      {
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
      {
        id: newObjectId(),
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
    );

    if (!paused) {
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
