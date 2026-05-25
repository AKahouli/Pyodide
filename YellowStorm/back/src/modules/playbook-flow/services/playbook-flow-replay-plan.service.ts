import { Injectable } from '@nestjs/common';
import type {
  BuildReplayPlanningInput,
  ReplayContextMappingEntry,
  ReplayExecutionPlan,
  ReplayPlanToolStep,
  ReplayPlanningSummary,
} from '../interfaces/playbook-flow-replay-plan.interface';
import type { FlowReplayToolCall } from '../schemas/playbook-flow-validated-replay.schema';
import type { ReplaySemanticChecklistItem, ReplayToolTraceTemplateItem } from '../interfaces/playbook-flow-replay-template.interface';

@Injectable()
export class PlaybookFlowReplayPlanService {
  private static readonly REQUIRED_CONFIDENCE_THRESHOLD = 0.8;

  buildReplayPlanning(input: BuildReplayPlanningInput): ReplayPlanningSummary {
    const contextMapping = this.buildContextMapping(input);
    return {
      replayId: input.replayId,
      validationVersion: input.validationVersion,
      intentKey: input.intentKey ?? null,
      intentLabel: input.intentLabel ?? null,
      contextMapping,
      executionPlan: this.buildExecutionPlan(input, contextMapping),
    };
  }

  private buildContextMapping(input: BuildReplayPlanningInput): ReplayContextMappingEntry[] {
    const inputContext = input.inputContext ?? {};
    return (input.contextVariableSchema ?? []).map((variable) => {
      const baselineValue = typeof variable.exampleValue === 'string' && variable.exampleValue.trim().length > 0
        ? variable.exampleValue
        : null;
      const resolved = this.resolveVariableValue({
        key: variable.key,
        source: variable.source,
        valueType: variable.valueType,
        baselineValue,
        inputContext,
        taskTitle: input.taskTitle ?? null,
        taskDescription: input.taskDescription ?? null,
      });

      return {
        variableKey: variable.key,
        key: variable.key,
        label: variable.label,
        source: resolved.source,
        valueType: variable.valueType,
        required: variable.required,
        baselineValue,
        currentValue: resolved.currentValue,
        confidence: resolved.confidence,
        reason: resolved.reason,
        value: resolved.currentValue,
        matched: resolved.matched,
      };
    });
  }

  private buildExecutionPlan(
    input: BuildReplayPlanningInput,
    contextMapping: ReplayContextMappingEntry[],
  ): ReplayExecutionPlan {
    const requiredStageLabels = (input.reasoningOutline ?? []).map((stage) => stage.label).filter(Boolean);
    const plannedToolSteps = this.buildToolSteps(input, contextMapping);
    const requiredOutputChecks = this.buildOutputChecks(input);

    return {
      taskId: input.taskId,
      replayId: input.replayId,
      validationVersion: input.validationVersion,
      intentKey: input.intentKey ?? null,
      intentLabel: input.intentLabel ?? null,
      matchedContextCount: contextMapping.filter((entry) => entry.matched).length,
      missingRequiredContextCount: contextMapping.filter((entry) => this.isRequiredContextUnresolved(entry)).length,
      requiredStageLabels,
      requiredOutputChecks,
      plannedToolSteps,
      semanticChecklist: this.instantiateSemanticChecklist(input.semanticChecklist ?? [], contextMapping),
    };
  }

  private instantiateSemanticChecklist(
    checklist: ReplaySemanticChecklistItem[],
    contextMapping: ReplayContextMappingEntry[],
  ): ReplaySemanticChecklistItem[] {
    return checklist.map((item) => {
      let description = item.description;
      for (const variableKey of item.variables) {
        const mapping = contextMapping.find((entry) => entry.variableKey === variableKey && entry.currentValue !== null);
        if (!mapping || mapping.currentValue === null) {
          continue;
        }
        if (mapping.baselineValue) {
          description = description.replaceAll(mapping.baselineValue, String(mapping.currentValue));
        }
      }
      return { ...item, description };
    });
  }

  hasUnresolvedRequiredContext(contextMapping: ReplayContextMappingEntry[]): boolean {
    return contextMapping.some((entry) => this.isRequiredContextUnresolved(entry));
  }

  private isRequiredContextUnresolved(entry: ReplayContextMappingEntry): boolean {
    return entry.required && (!entry.matched || entry.confidence < PlaybookFlowReplayPlanService.REQUIRED_CONFIDENCE_THRESHOLD);
  }

  private buildToolSteps(
    input: BuildReplayPlanningInput,
    contextMapping: ReplayContextMappingEntry[],
  ): ReplayPlanToolStep[] {
    return (input.toolTraceTemplate ?? []).map((step, index): ReplayPlanToolStep => {
      const baselineToolCall = this.resolveBaselineToolCall(input.toolCalls ?? [], step, index);
      const expectedArgs = this.applyContextSubstitutions(baselineToolCall?.args ?? {}, contextMapping, step.toolName);
      return {
        stepIndex: step.stepIndex,
        toolName: step.toolName,
        purpose: step.purpose,
        required: step.required,
        argumentShape: step.argumentShape ?? {},
        argumentShapeKeys: Object.keys(step.argumentShape ?? {}),
        expectedArgs,
        sourceCallIndex: baselineToolCall?.callIndex ?? null,
      };
    });
  }

  private resolveBaselineToolCall(
    toolCalls: FlowReplayToolCall[],
    step: ReplayToolTraceTemplateItem,
    index: number,
  ): FlowReplayToolCall | null {
    const byIndex = toolCalls.find((call) => call.callIndex === step.stepIndex);
    if (byIndex && this.normalizeKey(byIndex.toolName) === this.normalizeKey(step.toolName)) {
      return byIndex;
    }
    const byOrder = toolCalls[index];
    if (byOrder && this.normalizeKey(byOrder.toolName) === this.normalizeKey(step.toolName)) {
      return byOrder;
    }
    return null;
  }

  private applyContextSubstitutions(
    args: Record<string, unknown>,
    contextMapping: ReplayContextMappingEntry[],
    toolName: string,
  ): Record<string, unknown> {
    const clonedArgs = this.cloneValue(args);
    if (!clonedArgs || typeof clonedArgs !== 'object' || Array.isArray(clonedArgs)) {
      return {};
    }

    for (const entry of contextMapping) {
      if (!entry.matched || entry.currentValue === null) {
        continue;
      }
      const explicitArgKey = this.resolveExplicitToolArgKey(entry.variableKey, toolName);
      if (explicitArgKey) {
        this.applyExplicitArgOverride(clonedArgs as Record<string, unknown>, explicitArgKey, entry.currentValue);
        continue;
      }
      if (entry.baselineValue !== null) {
        this.replaceExactPrimitiveValue(clonedArgs, entry.baselineValue, entry.currentValue);
      }
      this.applyNormalizedKeyOverride(clonedArgs as Record<string, unknown>, entry.variableKey, entry.currentValue);
    }

    return clonedArgs as Record<string, unknown>;
  }

  private resolveExplicitToolArgKey(variableKey: string, toolName: string): string | null {
    const directPrefix = `${toolName}.`;
    if (variableKey.startsWith(directPrefix)) {
      return variableKey.slice(directPrefix.length);
    }
    const genericPrefix = 'tool_args.';
    if (variableKey.startsWith(genericPrefix)) {
      return variableKey.slice(genericPrefix.length);
    }
    return null;
  }

  private applyExplicitArgOverride(target: Record<string, unknown>, path: string, value: unknown): void {
    const segments = path.split('.').filter(Boolean);
    if (segments.length === 0) {
      return;
    }
    let current: Record<string, unknown> = target;
    for (let index = 0; index < segments.length - 1; index += 1) {
      const segment = segments[index];
      const next = current[segment];
      if (!next || typeof next !== 'object' || Array.isArray(next)) {
        current[segment] = {};
      }
      current = current[segment] as Record<string, unknown>;
    }
    current[segments[segments.length - 1]] = this.cloneValue(value);
  }

  private applyNormalizedKeyOverride(target: Record<string, unknown>, variableKey: string, value: unknown): void {
    const normalizedVariableKey = this.normalizeKey(variableKey);
    for (const key of Object.keys(target)) {
      if (this.normalizeKey(key) === normalizedVariableKey) {
        target[key] = this.cloneValue(value);
      }
      const nested = target[key];
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        this.applyNormalizedKeyOverride(nested as Record<string, unknown>, variableKey, value);
      }
    }
  }

  private replaceExactPrimitiveValue(target: unknown, baselineValue: string, currentValue: unknown): void {
    if (Array.isArray(target)) {
      for (let index = 0; index < target.length; index += 1) {
        if (target[index] === baselineValue) {
          target[index] = this.cloneValue(currentValue);
          continue;
        }
        this.replaceExactPrimitiveValue(target[index], baselineValue, currentValue);
      }
      return;
    }

    if (!target || typeof target !== 'object') {
      return;
    }
    for (const [key, value] of Object.entries(target as Record<string, unknown>)) {
      if (value === baselineValue) {
        (target as Record<string, unknown>)[key] = this.cloneValue(currentValue);
        continue;
      }
      this.replaceExactPrimitiveValue(value, baselineValue, currentValue);
    }
  }

  private cloneValue<T>(value: T): T {
    if (Array.isArray(value)) {
      return value.map((entry) => this.cloneValue(entry)) as T;
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, this.cloneValue(entry)]),
      ) as T;
    }
    return value;
  }

  private buildOutputChecks(input: BuildReplayPlanningInput): string[] {
    const checks: string[] = [];
    const outputContract = input.outputContract;

    if (input.outputFormatGuide) {
      checks.push('Preserve the validated output format guide.');
    }
    for (const section of outputContract?.requiredSections ?? []) {
      checks.push(`Include section: ${section}`);
    }
    for (const section of outputContract?.forbiddenSections ?? []) {
      checks.push(`Do not include section: ${section}`);
    }
    if (outputContract?.citationPolicy === 'required') {
      checks.push('Citations or source references are required.');
    }
    if (outputContract?.citationPolicy === 'forbidden') {
      checks.push('Do not include citations or source references.');
    }
    if (outputContract?.jsonSchema && typeof outputContract.jsonSchema === 'object') {
      const propertyKeys = Object.keys((outputContract.jsonSchema.properties as Record<string, unknown>) ?? {});
      if (propertyKeys.length > 0) {
        checks.push(`Return JSON with keys: ${propertyKeys.join(', ')}`);
      }
    }

    return checks;
  }

  private resolveVariableValue(params: {
    key: string;
    source: 'task' | 'input_context' | 'tool_args' | 'unknown';
    valueType: ReplayContextMappingEntry['valueType'];
    baselineValue: string | null;
    inputContext: Record<string, unknown>;
    taskTitle: string | null;
    taskDescription: string | null;
  }): {
    currentValue: string | number | boolean | Record<string, unknown> | unknown[] | null;
    confidence: number;
    matched: boolean;
    source: ReplayContextMappingEntry['source'];
    reason: string;
  } {
    if (params.source === 'task') {
      return this.findTaskValue(params.key, params.taskTitle, params.taskDescription);
    }

    const directValue = params.inputContext[params.key];
    if (this.isSupportedContextValue(directValue)) {
      return {
        currentValue: directValue,
        confidence: 1,
        matched: true,
        source: params.source,
        reason: 'matched_input_context',
      };
    }

    const normalizedKey = this.normalizeKey(params.key);
    for (const [candidateKey, candidateValue] of Object.entries(params.inputContext)) {
      if (this.normalizeKey(candidateKey) === normalizedKey && this.isSupportedContextValue(candidateValue)) {
        return {
          currentValue: candidateValue,
          confidence: 1,
          matched: true,
          source: params.source,
          reason: 'matched_normalized_input_context',
        };
      }
    }

    const extracted = this.extractFromTaskText({
      key: params.key,
      valueType: params.valueType,
      baselineValue: params.baselineValue,
      taskTitle: params.taskTitle,
      taskDescription: params.taskDescription,
    });
    if (extracted) {
      return extracted;
    }

    return {
      currentValue: null,
      confidence: 0,
      matched: false,
      source: params.source,
      reason: 'deterministic_mapping_not_found',
    };
  }

  private findTaskValue(
    key: string,
    taskTitle: string | null,
    taskDescription: string | null,
  ): {
    currentValue: string | null;
    confidence: number;
    matched: boolean;
    source: ReplayContextMappingEntry['source'];
    reason: string;
  } {
    const normalizedKey = this.normalizeKey(key);
    if (normalizedKey.includes('title') || normalizedKey.includes('task')) {
      const currentValue = taskTitle && taskTitle.trim().length > 0 ? taskTitle : null;
      return {
        currentValue,
        confidence: currentValue ? 1 : 0,
        matched: currentValue !== null,
        source: 'task_title',
        reason: currentValue ? 'matched_task_title' : 'task_title_missing',
      };
    }
    if (normalizedKey.includes('description') || normalizedKey.includes('prompt')) {
      const currentValue = taskDescription && taskDescription.trim().length > 0 ? taskDescription : null;
      return {
        currentValue,
        confidence: currentValue ? 1 : 0,
        matched: currentValue !== null,
        source: 'task_description',
        reason: currentValue ? 'matched_task_description' : 'task_description_missing',
      };
    }
    return {
      currentValue: null,
      confidence: 0,
      matched: false,
      source: 'task',
      reason: 'unsupported_task_variable',
    };
  }

  private extractFromTaskText(params: {
    key: string;
    valueType: ReplayContextMappingEntry['valueType'];
    baselineValue: string | null;
    taskTitle: string | null;
    taskDescription: string | null;
  }): {
    currentValue: string;
    confidence: number;
    matched: boolean;
    source: ReplayContextMappingEntry['source'];
    reason: string;
  } | null {
    const text = [params.taskTitle, params.taskDescription]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .join(' ')
      .trim();
    if (!text) {
      return null;
    }

    const normalizedKey = this.normalizeKey(params.key);
    if (params.valueType === 'string' && (normalizedKey.includes('ticker') || normalizedKey.includes('symbol'))) {
      const ticker = this.extractTicker(text, params.baselineValue);
      if (ticker) {
        return {
          currentValue: ticker,
          confidence: 0.95,
          matched: true,
          source: 'task_text',
          reason: 'matched_task_text_ticker',
        };
      }
    }

    if (params.valueType === 'string' && (normalizedKey.includes('date') || normalizedKey.includes('range') || normalizedKey.includes('period') || normalizedKey.includes('quarter') || normalizedKey.includes('year'))) {
      const period = this.extractDateLikeValue(text);
      if (period) {
        return {
          currentValue: period,
          confidence: 0.9,
          matched: true,
          source: 'task_text',
          reason: 'matched_task_text_date',
        };
      }
    }

    if (params.valueType === 'string' && normalizedKey.includes('id')) {
      const identifier = this.extractIdentifier(text);
      if (identifier) {
        return {
          currentValue: identifier,
          confidence: 0.85,
          matched: true,
          source: 'task_text',
          reason: 'matched_task_text_identifier',
        };
      }
    }

    if (params.valueType === 'string' && normalizedKey.includes('name')) {
      const entityName = this.extractEntityName(text, params.baselineValue);
      if (entityName) {
        return {
          currentValue: entityName,
          confidence: 0.85,
          matched: true,
          source: 'task_text',
          reason: 'matched_task_text_entity',
        };
      }
    }

    return null;
  }

  private extractTicker(text: string, baselineValue: string | null): string | null {
    const matches = text.match(/\b[A-Z]{2,5}\b/g) ?? [];
    const filtered = matches.filter((match) => match !== baselineValue && !this.isCommonUppercaseWord(match));
    return filtered[0] ?? null;
  }

  private extractDateLikeValue(text: string): string | null {
    const quarter = text.match(/\bQ[1-4]\s+20\d{2}\b/i)?.[0];
    if (quarter) {
      return quarter;
    }
    const monthYear = text.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|January|February|March|April|June|July|August|September|October|November|December)\s+20\d{2}\b/i)?.[0];
    if (monthYear) {
      return monthYear;
    }
    const yearRange = text.match(/\b20\d{2}\s*(?:-|to)\s*20\d{2}\b/i)?.[0];
    if (yearRange) {
      return yearRange;
    }
    return text.match(/\b20\d{2}\b/)?.[0] ?? null;
  }

  private extractIdentifier(text: string): string | null {
    return text.match(/\b[A-Za-z]{2,6}-\d{2,}|\b[A-Z]{2,}\d{3,}\b|\b\d{5,}\b/)?.[0] ?? null;
  }

  private extractEntityName(text: string, baselineValue: string | null): string | null {
    const matches = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/g) ?? [];
    const filtered = matches.filter((match) => match !== baselineValue);
    return filtered[0] ?? null;
  }

  private isCommonUppercaseWord(value: string): boolean {
    return new Set(['AND', 'THE', 'FOR', 'WITH', 'FROM', 'INTO', 'Q1', 'Q2', 'Q3', 'Q4']).has(value);
  }

  private normalizeKey(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  private isSupportedContextValue(
    value: unknown,
  ): value is string | number | boolean | Record<string, unknown> | unknown[] {
    if (
      typeof value === 'string'
      || typeof value === 'number'
      || typeof value === 'boolean'
    ) {
      return true;
    }

    if (Array.isArray(value)) {
      return true;
    }

    return value !== null && typeof value === 'object';
  }
}
