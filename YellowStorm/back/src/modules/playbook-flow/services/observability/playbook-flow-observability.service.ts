import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConversationSettingsService } from '@modules/system/conversation-settings.service';
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
import { normalizePlaybookComponents } from './playbook-flow-citation.mapper';
import { PlaybookFlowPublicReasoningParserService } from './playbook-flow-public-reasoning-parser.service';
import { PlaybookFlowTraceRedactionService } from './playbook-flow-trace-redaction.service';
import { sanitizePlaybookPublicValue } from '../../utils/playbook-artifact';

export interface FlowTraceUpdatePayload {
  toolTrace?: FlowCompletedResultPayload['toolTrace'];
  llmPromptTrace?: FlowCompletedResultPayload['llmPromptTrace'];
  usage?: FlowCompletedResultPayload['usage'];
  traceMetadata?: FlowCompletedResultPayload['traceMetadata'];
}

@Injectable()
export class PlaybookFlowObservabilityService {
  private readonly logger = new Logger(PlaybookFlowObservabilityService.name);

  constructor(
    private readonly traceRedactionService: PlaybookFlowTraceRedactionService,
    private readonly publicReasoningParser: PlaybookFlowPublicReasoningParserService,
    @Optional() private readonly conversationSettings?: ConversationSettingsService,
  ) {}

  async shouldRedactSensitiveText(): Promise<boolean> {
    if (!this.conversationSettings) return true;
    try {
      return (await this.conversationSettings.getSettings()).redactSensitiveText;
    } catch (error) {
      this.logger.warn(`Failed to load sensitive-text redaction setting; defaulting to redaction: ${error instanceof Error ? error.message : String(error)}`);
      return true;
    }
  }

  extractCompletedResultPayload(
    payload: Record<string, unknown>,
    context: { executionId: string; taskId: string },
    redactSensitiveText = true,
  ): FlowCompletedResultPayload {
    const cleanOutput = payload.output ?? payload;
    const rawDisplayText = typeof payload.display_text === 'string'
      ? payload.display_text
      : typeof payload.displayText === 'string'
        ? payload.displayText
        : typeof cleanOutput === 'string'
          ? cleanOutput
          : undefined;
    const rawLlmOutput = typeof payload.raw_llm_output === 'string' ? payload.raw_llm_output : null;
    const rawOutput = typeof cleanOutput === 'string'
      ? cleanOutput
      : typeof rawDisplayText === 'string' && rawDisplayText
        ? rawDisplayText
        : cleanOutput && typeof cleanOutput === 'object'
          ? JSON.stringify(cleanOutput)
          : String(cleanOutput ?? '');
    const inBandReasoning = Array.isArray(payload.reasoning_trace)
      ? this.publicReasoningParser.normalizeReasoningTrace(payload.reasoning_trace, context)
      : null;
    const reasoningSource = rawLlmOutput ?? rawOutput;
    const publicReasoning = inBandReasoning
      ? { output: rawOutput, reasoningChain: inBandReasoning, markerFound: false, parseError: undefined }
      : this.publicReasoningParser.parse(reasoningSource, context);
    const outputText = (rawLlmOutput && !inBandReasoning)
      ? this.publicReasoningParser.parse(rawOutput, context).output
      : publicReasoning.output;
    const displayText = rawDisplayText === rawOutput
      ? outputText
      : this.sanitizeDisplayText(rawDisplayText, context);
    const artifacts = Array.isArray(payload.artifacts)
      ? payload.artifacts as Record<string, unknown>[]
      : undefined;
    const rawComponents = Array.isArray(payload.components)
      ? payload.components as Record<string, unknown>[]
      : undefined;
    const components = normalizePlaybookComponents(
      rawComponents,
      payload.citation_sources ?? payload.citationSources,
    );
    const outputs = payload.outputs && typeof payload.outputs === 'object'
      ? payload.outputs as Record<string, unknown>
      : undefined;
    if (payload.outputs !== undefined && outputs === undefined) {
      this.logger.warn(`Dropping invalid outputs payload for execution=${context.executionId} task=${context.taskId} (type=${typeof payload.outputs})`);
    }
    const toolTrace = this.traceRedactionService.redactToolTrace(mapToolTrace(payload.tool_trace ?? payload.toolTrace), redactSensitiveText);
    const llmPromptTrace = this.traceRedactionService.redactPromptTrace(mapPromptTrace(payload.llm_prompt_trace ?? payload.llmPromptTrace), redactSensitiveText);
    const usage = mapUsage(payload.usage);
    const semanticMatch = mapSemanticMatch(payload.semantic_match ?? payload.semanticMatch);
    const traceMetadata = this.traceRedactionService.redactRecord(mapTraceMetadata(payload.trace_metadata ?? payload.traceMetadata), redactSensitiveText);

    this.warnOnInvalidObservabilityPayload(payload, context, toolTrace.length, llmPromptTrace.length);

    return {
      output: outputText,
      displayText,
      outputs,
      artifacts,
      components,
      toolTrace,
      reasoningChain: publicReasoning.reasoningChain,
      llmPromptTrace,
      usage,
      semanticMatch,
      traceMetadata: {
        ...(traceMetadata ?? {}),
        publicReasoning: {
          markerFound: publicReasoning.markerFound,
          parseError: publicReasoning.parseError,
          itemCount: publicReasoning.reasoningChain.length,
        },
      },
      iteratorIterations: this.normalizeIteratorIterations(payload),
    };
  }

  toStreamPayload(payload: FlowCompletedResultPayload, redactSensitiveText = true) {
    return sanitizePlaybookPublicValue({
      ...flattenUsage(payload),
      toolTrace: payload.toolTrace,
      reasoningChain: payload.reasoningChain ?? [],
      llmPromptTrace: payload.llmPromptTrace,
      semanticMatch: payload.semanticMatch ?? null,
      traceMetadata: payload.traceMetadata ?? {},
      iteratorIterations: payload.iteratorIterations,
    }, false, redactSensitiveText) as ReturnType<typeof flattenUsage> & Record<string, unknown>;
  }

  extractTraceUpdatePayload(
    payload: Record<string, unknown>,
    context: { executionId: string; taskId: string },
    redactSensitiveText = true,
  ): FlowTraceUpdatePayload {
    const toolTrace = this.traceRedactionService.redactToolTrace(mapToolTrace(payload.tool_trace ?? payload.toolTrace), redactSensitiveText);
    const llmPromptTrace = this.traceRedactionService.redactPromptTrace(mapPromptTrace(payload.llm_prompt_trace ?? payload.llmPromptTrace), redactSensitiveText);
    const usage = mapUsage(payload.usage);
    const traceMetadata = this.traceRedactionService.redactRecord(mapTraceMetadata(payload.trace_metadata ?? payload.traceMetadata), redactSensitiveText);

    this.warnOnInvalidObservabilityPayload(payload, context, toolTrace.length, llmPromptTrace.length);

    return {
      toolTrace,
      llmPromptTrace,
      usage,
      traceMetadata,
    };
  }

  private normalizeIteratorIterations(payload: Record<string, unknown>): Record<string, unknown>[] | undefined {
    const raw = payload.iterator_iterations ?? payload.iteratorIterations;
    if (!Array.isArray(raw)) return undefined;
    return raw.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item));
  }

  private warnOnInvalidObservabilityPayload(
    payload: Record<string, unknown>,
    context: { executionId: string; taskId: string },
    toolTraceCount: number,
    promptTraceCount: number,
  ): void {
    if (Array.isArray(payload.tool_trace) && payload.tool_trace.length > 0 && toolTraceCount === 0) {
      this.logger.warn(`Dropped invalid tool_trace payload for execution ${context.executionId} task ${context.taskId}`);
    }
    if (Array.isArray(payload.llm_prompt_trace) && payload.llm_prompt_trace.length > 0 && promptTraceCount === 0) {
      this.logger.warn(`Dropped invalid llm_prompt_trace payload for execution ${context.executionId} task ${context.taskId}`);
    }
  }

  private sanitizeDisplayText(
    displayText: string | undefined,
    context: { executionId: string; taskId: string },
  ): string | undefined {
    if (typeof displayText !== 'string') {
      return undefined;
    }

    return this.publicReasoningParser.parse(displayText, context).output;
  }
}
