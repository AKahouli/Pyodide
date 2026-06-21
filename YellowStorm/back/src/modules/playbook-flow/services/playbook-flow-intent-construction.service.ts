import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { DEFAULT_PLAYBOOK_INTENT_NORMALIZATION_LIMITS } from '@modules/system/interfaces/playbook-settings.interface';
import { RequestPlaybookFlowIntentDto } from '../dto/request-playbook-flow-intent.dto';
import type { PlaybookIntentConstructionEvent, PlaybookIntentConstructionStartResult, PlaybookIntentConstructionStatus } from '../interfaces/playbook-flow-intent-construction.interface';
import { PlaybookFlowIntentService, type IntentNormalizationLimits, type PlaybookIntentSuggestion } from './playbook-flow-intent.service';
import { PlaybookIntentBlueprintParserService } from './playbook-intent-blueprint-parser.service';
import { PlaybookIntentGraphBuilderService } from './playbook-intent-graph-builder.service';
import { PlaybookIntentNodeBuildRegistryService } from './playbook-intent-node-build-registry.service';
import { PlaybookIntentGraphBindingResolverService } from './playbook-intent-graph-binding-resolver.service';

interface PlaybookIntentConstructionJob {
  id: string;
  flowId: string;
  ownerId: string;
  status: PlaybookIntentConstructionStatus;
  baseDefinitionRevision: number;
  events: PlaybookIntentConstructionEvent[];
  abortController: AbortController;
  waiters: Set<() => void>;
}

@Injectable()
export class PlaybookFlowIntentConstructionService {
  private static readonly JOB_RETENTION_MS = 5 * 60 * 1000;

  private readonly jobs = new Map<string, PlaybookIntentConstructionJob>();
  private readonly logger = new Logger(PlaybookFlowIntentConstructionService.name);

  constructor(
    private readonly intentService: PlaybookFlowIntentService,
    private readonly blueprintParser: PlaybookIntentBlueprintParserService = new PlaybookIntentBlueprintParserService(),
    private readonly graphBuilder: PlaybookIntentGraphBuilderService = new PlaybookIntentGraphBuilderService(
      new PlaybookIntentNodeBuildRegistryService(),
      new PlaybookIntentGraphBindingResolverService(),
    ),
  ) {}

  async start(flowId: string, ownerId: string, dto: RequestPlaybookFlowIntentDto): Promise<PlaybookIntentConstructionStartResult> {
    const normalizedFlowId = String(flowId);
    const normalizedOwnerId = String(ownerId);
    const context = await this.intentService.buildIntentAnalysisContext(flowId, ownerId, dto);
    const id = randomUUID();
    const job: PlaybookIntentConstructionJob = {
      id,
      flowId: normalizedFlowId,
      ownerId: normalizedOwnerId,
      status: 'queued',
      baseDefinitionRevision: Number(context.flow.definitionRevision ?? 0),
      events: [],
      abortController: new AbortController(),
      waiters: new Set(),
    };
    this.jobs.set(id, job);
    this.emit(job, { type: 'started', constructionId: id, playbookId: normalizedFlowId, model: context.model, baseDefinitionRevision: job.baseDefinitionRevision });
    void this.run(job, dto, context);
    return { constructionId: id, playbookId: normalizedFlowId, baseDefinitionRevision: job.baseDefinitionRevision };
  }

  async *stream(flowId: string, ownerId: string, constructionId: string, afterSequence: number): AsyncGenerator<PlaybookIntentConstructionEvent> {
    const job = this.getJob(String(flowId), String(ownerId), constructionId);
    let cursor = job.events.findIndex((event) => event.sequence > afterSequence);
    if (cursor < 0) cursor = job.events.length;

    while (true) {
      while (cursor < job.events.length) {
        yield job.events[cursor];
        cursor += 1;
      }
      if (['completed', 'failed', 'cancelled'].includes(job.status)) return;
      let waiter: (() => void) | null = null;
      await new Promise<void>((resolve) => {
        waiter = resolve;
        job.waiters.add(resolve);
      }).finally(() => {
        if (waiter) job.waiters.delete(waiter);
      });
    }
  }

  cancel(flowId: string, ownerId: string, constructionId: string, reason?: string): { cancelled: boolean } {
    const job = this.getJob(String(flowId), String(ownerId), constructionId);
    if (['completed', 'failed', 'cancelled'].includes(job.status)) return { cancelled: false };
    job.abortController.abort();
    job.status = 'cancelled';
    this.emit(job, { type: 'cancelled', constructionId, playbookId: flowId, reason });
    this.scheduleCleanup(job);
    return { cancelled: true };
  }

  private async run(job: PlaybookIntentConstructionJob, dto: RequestPlaybookFlowIntentDto, context: Awaited<ReturnType<PlaybookFlowIntentService['buildIntentAnalysisContext']>>): Promise<void> {
    job.status = 'running';
    try {
      this.emit(job, { type: 'progress', constructionId: job.id, playbookId: job.flowId, phase: 'planning', message: 'Planning workflow construction' });
      const useBlueprint = context.effectiveSettings.useDeterministicBlueprintBuilder;
      const response = await context.httpClient.post('/v1/chat/completions', {
        model: context.model,
        temperature: 0.2,
        stream: true,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: context.systemPrompt }, { role: 'user', content: context.userPrompt }],
      }, { timeout: 180000, signal: job.abortController.signal, responseType: 'stream' });
      if (job.abortController.signal.aborted) return;

      let raw = '';
      let emittedDeltaCount = 0;
      for await (const content of this.readChatCompletionStream(response.data)) {
        if (job.abortController.signal.aborted) return;
        raw += content;
        if (useBlueprint) continue;
        const partialSuggestions = this.normalizePartialSuggestions(raw, dto, context);
        emittedDeltaCount = await this.emitSuggestions(job, partialSuggestions, emittedDeltaCount);
      }

      if (useBlueprint) {
        const suggestions = this.buildBlueprintSuggestions(raw, context, dto);
        await this.emitSuggestions(job, suggestions);
        if (job.abortController.signal.aborted) return;
        job.status = 'completed';
        this.emit(job, { type: 'completed', constructionId: job.id, playbookId: job.flowId, model: context.model, finalSuggestionCount: suggestions.length });
      } else {
        const suggestions = this.normalizeRawSuggestions(raw, dto, context);
        await this.emitSuggestions(job, suggestions, emittedDeltaCount);
        if (job.abortController.signal.aborted) return;
        job.status = 'completed';
        this.emit(job, { type: 'completed', constructionId: job.id, playbookId: job.flowId, model: context.model, finalSuggestionCount: suggestions.length });
      }
      this.scheduleCleanup(job);
    } catch (error) {
      if (job.abortController.signal.aborted) return;
      job.status = 'failed';
      const message = error instanceof Error ? error.message : 'Intent construction failed';
      this.logger.error(`playbook_intent_construction_failed constructionId=${job.id} playbookId=${job.flowId} message=${message}`);
      this.emit(job, { type: 'failed', constructionId: job.id, playbookId: job.flowId, message, recoverable: true });
      this.scheduleCleanup(job);
    }
  }

  private buildBlueprintSuggestions(
    raw: string,
    context: Awaited<ReturnType<PlaybookFlowIntentService['buildIntentAnalysisContext']>>,
    dto: RequestPlaybookFlowIntentDto,
  ): PlaybookIntentSuggestion[] {
    if (!this.blueprintParser.hasBlueprintShape(raw)) {
      return this.normalizeRawSuggestions(raw, dto, context);
    }
    const parsed = this.blueprintParser.parse(raw);
    if (!parsed) {
      return this.normalizeRawSuggestions(raw, dto, context);
    }
    try {
      const built = this.graphBuilder.build({
        blueprint: parsed.blueprint,
        context: context.validationContext,
        limits: context.limits,
        templates: context.nodeTemplates,
        selectedNodeId: context.selectedNodeId,
      });
      if (built.dropped.length) {
        this.logger.warn(`playbook_intent_builder_dropped items=${built.dropped.map((drop) => `${drop.rule}:${drop.itemId}`).join(',')}`);
      }
      return [built.suggestion];
    } catch (error) {
      this.logger.error(`playbook_intent_builder_failed message=${error instanceof Error ? error.message : 'unknown'}`);
      return this.normalizeRawSuggestions(raw, dto, context);
    }
  }

  private async emitSuggestions(job: PlaybookIntentConstructionJob, suggestions: PlaybookIntentSuggestion[], emittedDeltaCount = 0): Promise<number> {
    const deltas = suggestions.flatMap((suggestion) => this.buildSuggestionDeltas(suggestion));
    for (let index = emittedDeltaCount; index < deltas.length; index += 1) {
      if (job.abortController.signal.aborted) return emittedDeltaCount;
      const suggestion = deltas[index];
      const changes = suggestion.kind === 'workflow_plan' ? suggestion.changes : [];
      const latestChange = changes[changes.length - 1];
      const hasNode = suggestion.kind === 'single_change' || latestChange?.type === 'create_node' || latestChange?.type === 'update_node' || latestChange?.type === 'delete_node';
      const type = hasNode ? 'node_delta' : latestChange?.type.includes('data_binding') ? 'data_binding_delta' : 'edge_delta';
      this.emit(job, { type, constructionId: job.id, playbookId: job.flowId, suggestion, nodeIndex: type === 'node_delta' ? index + 1 : undefined, totalNodes: type === 'node_delta' ? deltas.length : undefined } as PlaybookIntentConstructionEvent);
      await this.waitForNextDelta(job.abortController.signal);
    }
    return Math.max(emittedDeltaCount, deltas.length);
  }

  private normalizeRawSuggestions(raw: string, dto: RequestPlaybookFlowIntentDto, context: Awaited<ReturnType<PlaybookFlowIntentService['buildIntentAnalysisContext']>>): PlaybookIntentSuggestion[] {
    return this.intentService.normalizeConstructionSuggestions({
      raw,
      dto,
      selectedNodeId: context.selectedNodeId,
      limits: this.getConstructionLimits(context.limits),
      validationContext: context.validationContext,
      includeFallback: false,
    });
  }

  private normalizePartialSuggestions(raw: string, dto: RequestPlaybookFlowIntentDto, context: Awaited<ReturnType<PlaybookFlowIntentService['buildIntentAnalysisContext']>>): PlaybookIntentSuggestion[] {
    const changes = this.extractCompleteChanges(raw);
    if (changes.length === 0) return [];
    return this.normalizeRawSuggestions(JSON.stringify({
      suggestions: [{
        kind: 'workflow_plan',
        label: this.extractStringField(raw, 'label') || 'Realtime workflow construction',
        summary: this.extractStringField(raw, 'summary') || '',
        reason: this.extractStringField(raw, 'reason') || '',
        confidence: 0.8,
        changes,
      }],
    }), dto, context);
  }

  private getConstructionLimits(limits: IntentNormalizationLimits): IntentNormalizationLimits {
    return {
      ...limits,
      maxWorkflowPlanChanges: Math.max(
        limits.maxWorkflowPlanChanges,
        DEFAULT_PLAYBOOK_INTENT_NORMALIZATION_LIMITS.maxWorkflowPlanChanges,
      ),
    };
  }

  private async *readChatCompletionStream(stream: AsyncIterable<Buffer | string>): AsyncGenerator<string> {
    let buffer = '';
    for await (const chunk of stream) {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        const content = this.extractStreamLineContent(line);
        if (content) yield content;
      }
    }

    const content = this.extractStreamLineContent(buffer);
    if (content) yield content;
  }

  private extractStreamLineContent(line: string): string {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return '';
    const data = trimmed.slice(5).trim();
    if (!data || data === '[DONE]') return '';
    return this.extractStreamContent(data);
  }

  private extractStreamContent(data: string): string {
    try {
      const parsed = JSON.parse(data) as { choices?: Array<{ delta?: { content?: unknown }; message?: { content?: unknown } }> };
      const content = parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.message?.content;
      return typeof content === 'string' ? content : '';
    } catch {
      return '';
    }
  }

  private extractCompleteChanges(raw: string): Array<Record<string, unknown>> {
    const changesKeyIndex = raw.indexOf('"changes"');
    if (changesKeyIndex < 0) return [];
    const arrayStart = raw.indexOf('[', changesKeyIndex);
    if (arrayStart < 0) return [];

    const changes: Array<Record<string, unknown>> = [];
    let objectStart = -1;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = arrayStart + 1; index < raw.length; index += 1) {
      const char = raw[index];
      if (inString) {
        escaped = !escaped && char === '\\';
        if (!escaped && char === '"') inString = false;
        if (char !== '\\') escaped = false;
        continue;
      }
      if (char === '"') {
        inString = true;
        continue;
      }
      if (char === '{') {
        if (depth === 0) objectStart = index;
        depth += 1;
      }
      if (char === '}') {
        depth -= 1;
        if (depth === 0 && objectStart >= 0) {
          try {
            changes.push(JSON.parse(raw.slice(objectStart, index + 1)) as Record<string, unknown>);
          } catch {
            return changes;
          }
          objectStart = -1;
        }
      }
      if (char === ']' && depth === 0) break;
    }
    return changes;
  }

  private extractStringField(raw: string, field: string): string {
    const match = raw.match(new RegExp(`"${field}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`));
    if (!match) return '';
    try {
      return JSON.parse(`"${match[1]}"`) as string;
    } catch {
      return '';
    }
  }

  private buildSuggestionDeltas(suggestion: PlaybookIntentSuggestion): PlaybookIntentSuggestion[] {
    if (suggestion.kind !== 'workflow_plan' || suggestion.changes.length <= 1) {
      return [suggestion];
    }

    return suggestion.changes.map((_, index) => {
      const changes = suggestion.changes.slice(0, index + 1);
      return {
        ...suggestion,
        changes,
        impact: {
          ...suggestion.impact,
          nodesToCreate: changes.filter((change) => change.type === 'create_node').length,
          nodesToUpdate: changes.filter((change) => change.type === 'update_node').length,
          nodesToDelete: changes.filter((change) => change.type === 'delete_node').length,
          edgesToCreate: changes.filter((change) => change.type === 'create_edge').length,
          edgesToDelete: changes.filter((change) => change.type === 'delete_edge').length,
          dataBindingsToCreate: changes.filter((change) => change.type === 'create_data_binding').length,
          dataBindingsToDelete: changes.filter((change) => change.type === 'delete_data_binding').length,
        },
      };
    });
  }

  private async waitForNextDelta(signal: AbortSignal): Promise<void> {
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 250);
      signal.addEventListener('abort', () => {
        clearTimeout(timeout);
        resolve();
      }, { once: true });
    });
  }

  private emit(job: PlaybookIntentConstructionJob, event: Record<string, unknown> & { type: PlaybookIntentConstructionEvent['type']; constructionId: string; playbookId: string }): void {
    job.events.push({ ...event, sequence: job.events.length + 1, createdAt: new Date().toISOString() } as PlaybookIntentConstructionEvent);
    for (const waiter of job.waiters) waiter();
    job.waiters.clear();
  }

  private getJob(flowId: string, ownerId: string, constructionId: string): PlaybookIntentConstructionJob {
    const job = this.jobs.get(constructionId);
    if (!job || job.flowId !== flowId || job.ownerId !== ownerId) {
      throw new NotFoundException(ErrorCode.NOT_FOUND, 'Intent construction not found');
    }
    return job;
  }

  private extractChatCompletionText(responseData: unknown): string {
    return this.intentService.extractChatCompletionText(responseData);
  }

  private scheduleCleanup(job: PlaybookIntentConstructionJob): void {
    setTimeout(() => {
      this.jobs.delete(job.id);
      job.waiters.clear();
    }, PlaybookFlowIntentConstructionService.JOB_RETENTION_MS).unref?.();
  }
}
