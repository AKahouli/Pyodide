import { Injectable, Logger } from '@nestjs/common';
import {
  FlowCompletedResultPayload,
} from '../../interfaces/playbook-flow-observability.interface';
import {
  flattenUsage,
  mapPromptTrace,
  mapSemanticMatch,
  mapToolTrace,
  mapTraceMetadata,
  mapUsage,
} from './playbook-flow-observability.mapper';
import { PlaybookFlowTraceRedactionService } from './playbook-flow-trace-redaction.service';

@Injectable()
export class PlaybookFlowObservabilityService {
  private readonly logger = new Logger(PlaybookFlowObservabilityService.name);

  constructor(
    private readonly traceRedactionService: PlaybookFlowTraceRedactionService,
  ) {}

  extractCompletedResultPayload(
    payload: Record<string, unknown>,
    context: { executionId: string; taskId: string },
  ): FlowCompletedResultPayload {
    const cleanOutput = payload.output ?? payload;
    const displayText = typeof payload.display_text === 'string'
      ? payload.display_text
      : typeof payload.displayText === 'string'
        ? payload.displayText
        : typeof cleanOutput === 'string'
          ? cleanOutput
          : undefined;
    const output = typeof cleanOutput === 'string'
      ? cleanOutput
      : typeof displayText === 'string' && displayText
        ? displayText
        : cleanOutput && typeof cleanOutput === 'object'
          ? JSON.stringify(cleanOutput)
          : String(cleanOutput ?? '');
    const artifacts = Array.isArray(payload.artifacts)
      ? payload.artifacts as Array<Record<string, unknown>>
      : undefined;
    const components = Array.isArray(payload.components)
      ? payload.components as Array<Record<string, unknown>>
      : undefined;
    const outputs = payload.outputs && typeof payload.outputs === 'object'
      ? payload.outputs as Record<string, unknown>
      : undefined;
    if (payload.outputs !== undefined && outputs === undefined) {
      this.logger.warn(`Dropping invalid outputs payload for execution=${context.executionId} task=${context.taskId} (type=${typeof payload.outputs})`);
    }
    const toolTrace = this.traceRedactionService.redactToolTrace(mapToolTrace(payload.tool_trace ?? payload.toolTrace));
    const llmPromptTrace = this.traceRedactionService.redactPromptTrace(mapPromptTrace(payload.llm_prompt_trace ?? payload.llmPromptTrace));
    const usage = mapUsage(payload.usage);
    const semanticMatch = mapSemanticMatch(payload.semantic_match ?? payload.semanticMatch);
    const traceMetadata = this.traceRedactionService.redactRecord(mapTraceMetadata(payload.trace_metadata ?? payload.traceMetadata));

    this.warnOnInvalidObservabilityPayload(payload, context, toolTrace.length, llmPromptTrace.length);

    return {
      output,
      displayText,
      outputs,
      artifacts,
      components,
      toolTrace,
      llmPromptTrace,
      usage,
      semanticMatch,
      traceMetadata,
    };
  }

  toStreamPayload(payload: FlowCompletedResultPayload) {
    return {
      ...flattenUsage(payload),
      toolTrace: payload.toolTrace,
      llmPromptTrace: payload.llmPromptTrace,
      semanticMatch: payload.semanticMatch ?? null,
      traceMetadata: payload.traceMetadata ?? {},
    };
  }

  private warnOnInvalidObservabilityPayload(
    payload: Record<string, unknown>,
    context: { executionId: string; taskId: string },
    toolTraceCount: number,
    promptTraceCount: number,
  ): void {
    if (payload.tool_trace != null && toolTraceCount === 0) {
      this.logger.warn(`Dropped invalid tool_trace payload for execution ${context.executionId} task ${context.taskId}`);
    }
    if (payload.llm_prompt_trace != null && promptTraceCount === 0) {
      this.logger.warn(`Dropped invalid llm_prompt_trace payload for execution ${context.executionId} task ${context.taskId}`);
    }
  }
}
