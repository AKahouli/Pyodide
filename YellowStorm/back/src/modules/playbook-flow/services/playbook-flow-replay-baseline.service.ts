import { Injectable } from '@nestjs/common';
import { stripLeadingTrailingChar } from '@common/utils';
import type {
  FlowTaskJudgeResult,
  FlowTaskPublicReasoningTraceItem,
  FlowTaskToolTraceItem,
} from '../schemas/playbook-flow-task-result.schema';
import type {
  ReplayAcceptedExample,
  ReplayContextVariable,
  ReplayDriftPolicy,
  ReplayReasoningStage,
  ReplaySemanticChecklistItem,
  ReplayToolTraceTemplateItem,
} from '../interfaces/playbook-flow-replay-template.interface';
import {
  type BuildValidatedReplayBaselineInput,
  type FlowReplayOutputContract,
  type FlowReplayFingerprints,
  type FlowReplayHitlMemorySnapshot,
  normalizeReplayMode,
  type ValidatedReplayBaselineFields,
} from '../schemas/playbook-flow-validated-replay.schema';
import { PlaybookFlowReplayHashService } from './playbook-flow-replay-hash.service';
import { PlaybookFlowOutputContractService } from './playbook-flow-output-contract.service';

@Injectable()
export class PlaybookFlowReplayBaselineService {
  constructor(
    private readonly replayHashService: PlaybookFlowReplayHashService,
    private readonly outputContractService: PlaybookFlowOutputContractService,
  ) {}

  buildValidatedReplayBaseline(params: BuildValidatedReplayBaselineInput): ValidatedReplayBaselineFields {
    const mode = normalizeReplayMode(params.mode);
    const outputContract = this.buildOutputContractFromReplay({
      output: params.taskResult.output,
      preserveOutputFormat: params.preserveOutputFormat ?? false,
      outputFormatGuide: params.outputFormatGuide ?? null,
      existingOutputContract: null,
    });
    const intent = this.buildReplayIntent({
      taskId: params.taskId,
      taskTitle: params.taskTitle ?? null,
      nodeSnapshot: params.nodeSnapshot,
    });
    const reasoningOutline = this.buildReasoningOutline(params.taskResult.reasoningChain ?? []);
    const stableReasoningRules = this.buildStableReasoningRules(reasoningOutline, params.taskResult.judgeResult ?? null);
    const toolTraceTemplate = this.buildToolTraceTemplate(params.taskResult.toolTrace ?? []);

    return {
      mode,
      fingerprints: this.replayHashService.buildReplayFingerprints({
        inputContext: params.inputContext,
        flowSnapshot: params.flowSnapshot,
        nodeSnapshot: params.nodeSnapshot,
        agentConfig: this.extractAgentConfig(params.nodeSnapshot),
        modelConfig: this.extractModelConfig(params.nodeSnapshot),
        toolConfig: this.extractToolConfig(params.nodeSnapshot),
        outputContract,
      }),
      behaviorBaseline: this.buildBehaviorBaseline(params.taskResult.reasoningChain ?? [], params.taskResult.judgeResult ?? null),
      toolPolicy: this.buildToolPolicy(params.taskResult.toolTrace ?? [], mode),
      outputContract,
      intentKey: intent.intentKey,
      intentLabel: intent.intentLabel,
      reasoningOutline,
      stableReasoningRules,
      contextVariableSchema: this.buildContextVariableSchema({
        taskTitle: params.taskTitle ?? intent.intentLabel,
        taskDescription: params.taskDescription ?? null,
        inputContext: params.inputContext,
        toolTrace: params.taskResult.toolTrace ?? [],
      }),
      toolTraceTemplate,
      semanticChecklist: this.buildSemanticChecklist({
        intentLabel: intent.intentLabel,
        taskDescription: params.taskDescription ?? null,
        reasoningOutline,
        qualityChecks: this.buildBehaviorBaseline(params.taskResult.reasoningChain ?? [], params.taskResult.judgeResult ?? null).qualityChecks,
        outputContract,
        contextVariableSchema: this.buildContextVariableSchema({
          taskTitle: params.taskTitle ?? intent.intentLabel,
          taskDescription: params.taskDescription ?? null,
          inputContext: params.inputContext,
          toolTrace: params.taskResult.toolTrace ?? [],
        }),
      }),
      driftPolicy: this.buildDriftPolicy(mode),
      acceptedExamples: this.buildAcceptedExamples({
        referenceExecutionId: params.referenceExecutionId,
        referenceExecutionNumber: params.referenceExecutionNumber,
        output: params.taskResult.output,
        taskTitle: params.taskTitle ?? intent.intentLabel,
      }),
      hitlMemorySnapshots: this.buildHitlMemorySnapshots({
        taskId: params.taskId,
        iteration: params.iteration ?? 0,
        inputContext: params.inputContext,
        nodeSnapshot: params.nodeSnapshot,
        hitlEvents: params.hitlEvents ?? [],
      }),
    };
  }

  buildCurrentReplayFingerprints(params: {
    inputContext?: unknown;
    flowSnapshot?: unknown;
    nodeSnapshot?: Record<string, unknown> | null;
    outputContract?: FlowReplayOutputContract | null;
  }): FlowReplayFingerprints {
    return this.replayHashService.buildReplayFingerprints({
      inputContext: params.inputContext,
      flowSnapshot: params.flowSnapshot,
      nodeSnapshot: params.nodeSnapshot,
      agentConfig: this.extractAgentConfig(params.nodeSnapshot),
      modelConfig: this.extractModelConfig(params.nodeSnapshot),
      toolConfig: this.extractToolConfig(params.nodeSnapshot),
      outputContract: params.outputContract ?? null,
    });
  }

  buildReplayIntent(params: {
    taskId: string;
    taskTitle?: string | null;
    nodeSnapshot?: Record<string, unknown> | null;
  }): { intentKey: string | null; intentLabel: string } {
    const nodeMetadata = this.asRecord(params.nodeSnapshot?.metadata);
    const parts = [
      this.cleanText(params.taskTitle),
      this.cleanText(nodeMetadata?.['taskType']),
      this.cleanText(nodeMetadata?.['nodeTemplateKey']) || this.cleanText(nodeMetadata?.['templateType']),
      this.cleanText(nodeMetadata?.['selectedAction']),
      this.cleanText(nodeMetadata?.['executionMode']),
    ].filter((value): value is string => Boolean(value));
    const intentLabel = parts[0] ?? params.taskId;
    return { intentKey: this.toSlug(parts.length > 0 ? parts.join(' ') : params.taskId), intentLabel };
  }

  buildOutputContractFromReplay(params: {
    output: unknown;
    preserveOutputFormat: boolean;
    outputFormatGuide: string | null;
    existingOutputContract: FlowReplayOutputContract | null;
  }): FlowReplayOutputContract | null {
    return this.outputContractService.buildOutputContractFromReplay(params);
  }

  buildOutputContractHash(outputContract: FlowReplayOutputContract | null): string | null {
    if (!outputContract) {
      return null;
    }

    return this.replayHashService.buildHash(outputContract);
  }

  buildHitlContextFingerprint(params: {
    inputContext?: unknown;
    nodeSnapshot?: Record<string, unknown> | null;
    reasonCode?: string | null;
    prompt?: string | null;
    downstreamNodeIds?: string[];
  }): string {
    return this.replayHashService.buildHash({
      inputContext: params.inputContext ?? null,
      nodeSnapshot: params.nodeSnapshot ?? null,
      reasonCode: params.reasonCode ?? null,
      prompt: params.prompt ?? null,
      downstreamNodeIds: params.downstreamNodeIds ?? [],
    });
  }

  private buildReasoningOutline(reasoningChain: FlowTaskPublicReasoningTraceItem[]): ReplayReasoningStage[] {
    return reasoningChain
      .map((item, index) => {
        const label = item.label?.trim() || item.type?.trim() || `stage-${index + 1}`;
        const description = item.description?.trim() || '';
        return {
          stageKey: this.toSlug(`${item.type || 'stage'} ${label}`) || `stage-${index + 1}`,
          stageType: item.type?.trim() || 'unknown',
          label,
          description,
          confidence: item.confidence ?? null,
        };
      })
      .filter((item, index, items) => item.label !== '' && items.findIndex((other) => other.stageKey === item.stageKey) === index)
      .slice(0, 8);
  }

  private buildStableReasoningRules(reasoningOutline: ReplayReasoningStage[], judgeResult: FlowTaskJudgeResult | null): string[] {
    return this.collectUniqueStrings([
      ...reasoningOutline.map((item) => `Preserve ${item.label.toLowerCase()}.`),
      ...(judgeResult?.missingFacts ?? []).map((item) => `Carry forward required fact coverage: ${item}`),
      ...(judgeResult?.toolUsageStrengths ?? []).map((item) => `Keep tool usage strength: ${item}`),
      ...(judgeResult?.rewriteHints ?? []).map((item) => `Maintain rewrite quality: ${item}`),
    ]).slice(0, 8);
  }

  private buildToolTraceTemplate(toolTrace: FlowTaskToolTraceItem[]): ReplayToolTraceTemplateItem[] {
    return toolTrace
      .filter((item) => item.toolName && (item.status == null || item.status === 'completed'))
      .map((item, index) => ({
        stepIndex: index + 1,
        toolName: item.toolName.trim(),
        purpose: item.outputSummary?.trim() || `Use ${item.toolName.trim()} to advance the validated task intent.`,
        argumentShape: this.describeValueShape(item.args ?? {}),
        required: true,
      }))
      .filter((item, index, items) => item.toolName !== '' && items.findIndex((other) => other.stepIndex === item.stepIndex) === index)
      .slice(0, 10);
  }

  private buildContextVariableSchema(params: {
    taskTitle: string;
    taskDescription: string | null;
    inputContext?: unknown;
    toolTrace: FlowTaskToolTraceItem[];
  }): ReplayContextVariable[] {
    const variables: ReplayContextVariable[] = [
      { key: 'taskTitle', label: 'Task title', source: 'task', valueType: 'string', required: true, exampleValue: params.taskTitle },
    ];

    if (params.taskDescription) {
      variables.push({
        key: 'taskDescription',
        label: 'Task description',
        source: 'task',
        valueType: 'string',
        required: false,
        exampleValue: params.taskDescription,
      });
    }

    const inputContext = this.asRecord(params.inputContext);
    if (inputContext) {
      for (const [key, value] of Object.entries(inputContext)) {
        variables.push(this.buildContextVariable(key, value, 'input_context', true));
      }
    }

    for (const traceItem of params.toolTrace) {
      const args = this.asRecord(traceItem.args);
      if (!args) continue;
      for (const [key, value] of Object.entries(args)) {
        variables.push(this.buildContextVariable(`${traceItem.toolName}.${key}`, value, 'tool_args', false));
      }
    }

    return variables
      .filter((item, index, items) => items.findIndex((other) => other.key === item.key) === index)
      .slice(0, 12);
  }

  private buildDriftPolicy(mode: 'replay_strict' | 'replay_flex' | 'replay_adaptive'): ReplayDriftPolicy {
    return {
      requireSameIntent: true,
      requireSameReasoningStages: mode !== 'replay_adaptive',
      requireSameToolOrder: mode === 'replay_strict',
      allowAdditionalTools: mode !== 'replay_strict',
      allowArgumentValueChanges: true,
      enforceOutputContract: true,
    };
  }

  private buildAcceptedExamples(params: {
    referenceExecutionId: string;
    referenceExecutionNumber: number;
    output?: unknown;
    taskTitle: string;
  }): ReplayAcceptedExample[] {
    return [{
      referenceExecutionId: params.referenceExecutionId,
      referenceExecutionNumber: params.referenceExecutionNumber,
      summary: `Validated replay baseline for ${params.taskTitle}.`,
      outputPreview: this.toPreview(params.output),
    }];
  }

  private buildHitlMemorySnapshots(params: {
    taskId: string;
    iteration: number;
    inputContext?: unknown;
    nodeSnapshot?: Record<string, unknown> | null;
    hitlEvents: NonNullable<Parameters<PlaybookFlowReplayBaselineService['buildValidatedReplayBaseline']>[0]['hitlEvents']>;
  }): FlowReplayHitlMemorySnapshot[] {
    return params.hitlEvents
      .filter((event) => event.status === 'answered' && event.nodeId === params.taskId && (event.iteration ?? 0) === params.iteration && event.interruptId && event.response?.action)
      .map((event) => {
        const responseMessage = event.response?.feedback ?? event.response?.message ?? null;
        const responseScope = event.response?.scope ?? 'step_only';
        return {
          interruptId: String(event.interruptId),
          nodeId: params.taskId,
          iteration: event.iteration ?? 0,
          type: this.normalizeHitlType(event.type),
          blockerKind: event.blockerKind ?? null,
          reasonCode: event.reasonCode || 'unknown',
          prompt: event.prompt || '',
          responseAction: event.response?.action ?? 'reply',
          responseMessage,
          responseScope,
          downstreamNodeIds: event.downstreamNodeIds ?? [],
          reusableInReplay: this.isReusableInReplay(event.type, responseScope, Boolean(event.response?.remember)),
          contextFingerprint: this.buildHitlContextFingerprint({
            inputContext: params.inputContext ?? null,
            nodeSnapshot: params.nodeSnapshot ?? null,
            reasonCode: event.reasonCode ?? null,
            prompt: event.prompt ?? null,
            downstreamNodeIds: event.downstreamNodeIds ?? [],
          }),
        };
      });
  }

  private normalizeHitlType(value: unknown): FlowReplayHitlMemorySnapshot['type'] {
    if (value === 'approval_request' || value === 'review_request') {
      return value;
    }
    return 'clarification';
  }

  private isReusableInReplay(type: unknown, scope: string, remember: boolean): boolean {
    if (type === 'approval_request') {
      return remember && (scope === 'future_node_runs' || scope === 'future_workflow_runs');
    }
    return scope !== 'step_only';
  }

  private buildSemanticChecklist(params: {
    intentLabel: string;
    taskDescription: string | null;
    reasoningOutline: ReplayReasoningStage[];
    qualityChecks: string[];
    outputContract: FlowReplayOutputContract | null;
    contextVariableSchema: ReplayContextVariable[];
  }): ReplaySemanticChecklistItem[] {
    const checklist: ReplaySemanticChecklistItem[] = [
      {
        key: 'intent',
        description: `Preserve the validated task intent: ${params.intentLabel}.`,
        variables: [],
        severity: 'warning',
        source: 'intent',
      },
    ];

    if (params.taskDescription) {
      checklist.push({
        key: 'task_description',
        description: params.taskDescription,
        variables: [],
        severity: 'info',
        source: 'intent',
      });
    }

    for (const stage of params.reasoningOutline.slice(0, 4)) {
      checklist.push({
        key: `reasoning:${stage.stageKey}`,
        description: `Include the reasoning stage: ${stage.label}.`,
        variables: [],
        severity: 'info',
        source: 'reasoning',
      });
    }

    for (const check of params.qualityChecks.slice(0, 4)) {
      checklist.push({
        key: `quality:${this.toSlug(check)}`,
        description: check,
        variables: [],
        severity: 'warning',
        source: 'quality_check',
      });
    }

    for (const variable of params.contextVariableSchema.filter((item) => item.required && item.exampleValue).slice(0, 4)) {
      checklist.push({
        key: `context:${variable.key}`,
        description: `Use ${variable.label}: ${variable.exampleValue}.`,
        variables: [variable.key],
        severity: 'fail',
        source: 'context',
      });
    }

    for (const section of params.outputContract?.requiredSections ?? []) {
      checklist.push({
        key: `section:${this.toSlug(section)}`,
        description: `Include section: ${section}.`,
        variables: [],
        severity: 'fail',
        source: 'output_contract',
      });
    }

    return checklist.filter((item, index, items) => items.findIndex((other) => other.key === item.key) === index).slice(0, 12);
  }

  private buildBehaviorBaseline(reasoningChain: FlowTaskPublicReasoningTraceItem[], judgeResult: FlowTaskJudgeResult | null) {
    const decisionInvariants = reasoningChain
      .map((item) => this.toStableBullet(item))
      .filter((value, index, items) => value !== '' && items.indexOf(value) === index)
      .slice(0, 6);

    const qualityChecks = this.collectUniqueStrings([
      ...(judgeResult?.missingFacts ?? []).map((item) => `Cover required fact: ${item}`),
      ...(judgeResult?.toolUsageStrengths ?? []).map((item) => `Keep tool usage strength: ${item}`),
      ...(judgeResult?.rewriteHints ?? []).map((item) => `Check rewrite quality: ${item}`),
      judgeResult?.expectedResultMatched === true ? 'Match the validated expected result class.' : '',
    ]).slice(0, 6);

    const knownFailureModes = this.collectUniqueStrings([
      ...(judgeResult?.incoherences ?? []).map((item) => `Avoid incoherence: ${item}`),
      ...(judgeResult?.unsupportedClaims ?? []).map((item) => `Avoid unsupported claim: ${item}`),
      ...(judgeResult?.toolSelectionIssues ?? []).map((item) => `Avoid tool selection issue: ${item}`),
      ...(judgeResult?.missingToolCalls ?? []).map((item) => `Avoid missing tool call: ${item}`),
      ...(judgeResult?.toolSequencingIssues ?? []).map((item) => `Avoid tool sequencing issue: ${item}`),
    ]).slice(0, 6);

    return {
      decisionInvariants,
      qualityChecks,
      knownFailureModes,
      behaviorSummary: decisionInvariants[0] ?? '',
    };
  }

  private buildToolPolicy(toolTrace: FlowTaskToolTraceItem[], mode: 'replay_strict' | 'replay_flex' | 'replay_adaptive') {
    const completedToolNames = toolTrace
      .filter((item) => item.toolName && (item.status == null || item.status === 'completed'))
      .map((item) => item.toolName.trim())
      .filter((item, index, items) => item !== '' && items.indexOf(item) === index);

    const sequencingRules = mode === 'replay_strict' && completedToolNames.length > 1
      ? completedToolNames.slice(0, -1).map((toolName, index) => `Call ${toolName} before ${completedToolNames[index + 1]}.`)
      : [];

    return {
      requiredTools: completedToolNames,
      forbiddenTools: [],
      sequencingRules,
      requireSameOrder: mode === 'replay_strict' && completedToolNames.length > 1,
    };
  }

  private extractAgentConfig(nodeSnapshot?: Record<string, unknown> | null): Record<string, unknown> | null {
    if (!nodeSnapshot) {
      return null;
    }

    const metadata = this.asRecord(nodeSnapshot.metadata);
    if (!metadata) {
      return null;
    }

    return this.pickRecord(metadata, ['agent_id', 'agent_name', 'agent_type', 'agent_prompt', 'agent_params']);
  }

  private extractModelConfig(nodeSnapshot?: Record<string, unknown> | null): Record<string, unknown> | null {
    if (!nodeSnapshot) {
      return null;
    }

    const metadata = this.asRecord(nodeSnapshot.metadata);
    return {
      modelId: typeof nodeSnapshot.modelId === 'string' ? nodeSnapshot.modelId : null,
      ...(metadata ? this.pickRecord(metadata, ['agent_model']) : {}),
    };
  }

  private extractToolConfig(nodeSnapshot?: Record<string, unknown> | null): Record<string, unknown> | null {
    const metadata = this.asRecord(nodeSnapshot?.metadata);
    const configuredTools = Array.isArray(metadata?.['agent_tools']) ? metadata?.['agent_tools'] : [];
    const tools = configuredTools.filter((value, index, items) => items.indexOf(value) === index);

    return tools.length > 0 ? { tools } : null;
  }

  private buildContextVariable(
    key: string,
    value: unknown,
    source: ReplayContextVariable['source'],
    required: boolean,
  ): ReplayContextVariable {
    return {
      key,
      label: key,
      source,
      valueType: this.getValueType(value),
      required,
      exampleValue: this.toPreview(value),
    };
  }

  private describeValueShape(value: unknown): Record<string, unknown> {
    if (Array.isArray(value)) {
      return { type: 'array', itemShape: value.length > 0 ? this.describeValueShape(value[0]) : 'unknown' };
    }
    if (!value || typeof value !== 'object') {
      return { type: this.getValueType(value) };
    }
    return Object.entries(value as Record<string, unknown>).reduce<Record<string, unknown>>((acc, [key, itemValue]) => {
      acc[key] = Array.isArray(itemValue) || (itemValue && typeof itemValue === 'object')
        ? this.describeValueShape(itemValue)
        : this.getValueType(itemValue);
      return acc;
    }, {});
  }

  private getValueType(value: unknown): ReplayContextVariable['valueType'] {
    if (Array.isArray(value)) return 'array';
    if (value === null || value === undefined) return 'unknown';
    if (typeof value === 'object') return 'object';
    if (typeof value === 'string') return 'string';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'boolean';
    return 'unknown';
  }

  private toPreview(value: unknown): string | null {
    if (value == null) return null;
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return text.length > 160 ? `${text.slice(0, 157)}...` : text;
  }

  private toStableBullet(item: FlowTaskPublicReasoningTraceItem): string {
    const parts = [item.label?.trim(), item.description?.trim()].filter(Boolean);
    if (parts.length === 0) {
      return '';
    }

    return parts.join(': ');
  }

  private collectUniqueStrings(values: string[]): string[] {
    return values
      .map((value) => value.trim())
      .filter((value, index, items) => value !== '' && items.indexOf(value) === index);
  }

  private cleanText(value: unknown): string | null {
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
  }

  private toSlug(value: string): string {
    return stripLeadingTrailingChar(
      value.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      '-',
    ).slice(0, 120);
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    return value as Record<string, unknown>;
  }

  private pickRecord(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
    return keys.reduce<Record<string, unknown>>((acc, key) => {
      if (source[key] !== undefined) {
        acc[key] = source[key];
      }
      return acc;
    }, {});
  }
}
