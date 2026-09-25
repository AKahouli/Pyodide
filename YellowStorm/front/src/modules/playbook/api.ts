/**
 * Playbook API Functions
 */

import apiClient, { type ApiResponse } from '@/lib/api/client';
import { API_CONFIG, API_ENDPOINTS, AUTH_STORAGE_KEYS } from '@/lib/api/config';
import type {
  Playbook,
  PlaybookSummary,
  PlaybookQueryParams,
  PlaybookExecution,
  PlaybookExecutionSummary,
  DesignMessage,
  DesignOperation,
  ClearDesignMessagesResult,
  CreatePlaybookData,
  GeneratePlaybookData,
  RewritePlaybookPromptData,
  RewritePlaybookPromptResult,
  DesignPlaybookData,
  UpdatePlaybookData,
  ExecutePlaybookData,
  ResumePlaybookData,
  RerunStepData,
  CloneShareResult,
  PlaybookTriggersData,
  SyncPlaybookMailSubscriptionData,
  UpsertPlaybookMailTriggerData,
  UpsertPlaybookScheduleData,
  ValidateTaskReplayData,
  ValidatedTaskReplay,
  UpdateTaskReplayFormatData,
  GrabOutputFormatTemplateData,
  UpdateOutputFormatTemplateData,
  OutputFormatTemplate,
  AdvisorRemediationItem,
  AdvisorRemediationPreviewRequest,
  AdvisorScriptReplacementApplyRequest,
  AdvisorScriptReplacementPreviewResponse,
  AdvisorScriptReplacementRequest,
  PlaybookEvaluationBaseline,
  PlaybookEvaluationExecution,
  PlaybookRepeatabilitySummary,
  RepeatabilityTaskExecutionSummary,
  RequestPlaybookIntentData,
  PlaybookIntentDesignResponse,
  PlaybookIntentTraceResponse,
  PlaybookIntentConstructionEvent,
  PlaybookIntentConstructionStartResponse,
  PlaybookAssistantTurnRequest,
  PlaybookAssistantTurnResponse,
  PlaybookAssistantHistory,
  PlaybookAssistantAttachmentUpload,
  RequestPlaybookNodeAdvisorData,
  PlaybookNodeAdvisorResponse,
  Flow,
  FlowSummary,
  FlowNode,
  ControlEdge,
  DataBinding,
  CreateFlowData,
  UpdateFlowData,
  FlowSettings,
  TaskTemplate,
  PlaybookTask,
  PlaybookEdge,
  PlaybookNodeType,
  PlaybookIteratorConfig,
  HumanApprovalConfig,
  RetryPolicy,
  AdvisorScoringMode,
  AdvisorRecommendedAction,
  RouterDecision,
  TaskResult,
  PatchPlaybookFlowDeltaData,
  PatchPlaybookFlowDeltaResult,
  PlaybookDeltaPatchFields,
  PlaybookDeltaNodePatch,
  PlaybookDeltaNodePositionUpdate,
  AssignablePlaybookPermission,
  PlaybookShareEntry,
  HitlBlockerRule,
  HitlEventLog,
  HitlFeedbackScope,
  HitlMemory,
  HitlPolicy,
} from './types';
import { parsePlaybookConstructionSseBlock } from './utils/playbook-construction-sse';
import {
  normalizePlaybook,
  taskToFlowNode,
} from './api.compat';

interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

function stableHash(value: unknown): string {
  const serialized = stableStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function measureSerializedBytes(value: unknown): number {
  return new TextEncoder().encode(stableStringify(value)).length;
}

export function sanitizePlaybookUpdate(data: UpdatePlaybookData): UpdatePlaybookData {
  const sanitizedTasks = data.tasks?.map((task) => ({
      id: task.id,
      title: task.title,
      description: task.description,
      assignedAgentId: task.assignedAgentId,
      executionMode: task.executionMode,
      selectedAction: task.selectedAction,
      executionOrder: task.executionOrder,
      positionX: task.positionX,
      positionY: task.positionY,
      interruptBefore: task.interruptBefore,
      interruptAfter: task.interruptAfter,
      allowClarification: task.allowClarification,
      clarificationPrompt: task.clarificationPrompt,
      maxClarifications: task.maxClarifications,
      inputKeys: task.inputKeys,
      outputKey: task.outputKey,
      enabled: task.enabled,
      notifyOnComplete: task.notifyOnComplete,
      notifyEmails: task.notifyEmails,
      stepReplayMode: task.stepReplayMode,
      inputFiles: task.inputFiles?.map((f) => ({
        type: f.type,
        id: f.id,
        name: f.name,
        workspaceId: f.workspaceId,
        portId: f.portId,
        metadata: f.metadata ? {
          workspaceId: f.metadata.workspaceId,
          documentId: f.metadata.documentId,
          filename: f.metadata.filename,
          filepath: f.metadata.filepath,
          folderpath: f.metadata.folderpath,
          language: f.metadata.language,
          mimeType: f.metadata.mimeType,
        } : undefined,
      })),
      taskType: task.taskType,
      nodeType: task.nodeType,
      nodeTemplateKey: task.nodeTemplateKey,
      inputPorts: task.inputPorts,
      outputPorts: task.outputPorts,
      toolBindings: task.toolBindings,
      skillBindings: task.skillBindings,
      evaluationConfig: task.evaluationConfig
        ? {
            expectation: task.evaluationConfig.expectation,
            referenceBaselineId: task.evaluationConfig.referenceBaselineId ?? null,
            passThreshold: task.evaluationConfig.passThreshold,
            warningThreshold: task.evaluationConfig.warningThreshold,
            weight: task.evaluationConfig.weight,
            rubricVersion: task.evaluationConfig.rubricVersion,
            weights: { ...task.evaluationConfig.weights },
          }
        : null,
      iteratorConfig: task.iteratorConfig
        ? {
            source: task.iteratorConfig.source,
            mode: task.iteratorConfig.mode,
            batchSize: task.iteratorConfig.batchSize ?? null,
            itemVariable: task.iteratorConfig.itemVariable ?? null,
            outputVariable: task.iteratorConfig.outputVariable ?? null,
            errorStrategy: task.iteratorConfig.errorStrategy ?? 'stop',
          }
        : null,
      iteratorLayout: task.iteratorLayout
        ? {
            width: task.iteratorLayout.width,
            height: task.iteratorLayout.height,
          }
        : null,
      containerConfig: task.containerConfig
        ? {
            parentIteratorId: task.containerConfig.parentIteratorId ?? null,
          }
        : null,
      routerConfig: task.routerConfig
        ? {
            outputLabels: [...task.routerConfig.outputLabels],
            maxIterations: task.routerConfig.maxIterations,
            defaultLabel: task.routerConfig.defaultLabel,
            mode: task.routerConfig.mode,
            prompt: task.routerConfig.prompt,
            conditions: task.routerConfig.conditions?.map((condition) => ({
              label: condition.label,
              sourceNode: condition.sourceNode,
              sourcePort: condition.sourcePort,
              path: condition.path,
              operator: condition.operator,
              value: condition.value,
            })),
          }
        : null,
      humanApprovalConfig: task.humanApprovalConfig
        ? {
            promptTemplate: task.humanApprovalConfig.promptTemplate,
            timeoutSeconds: task.humanApprovalConfig.timeoutSeconds ?? null,
          }
        : null,
      retryPolicy: task.retryPolicy
        ? {
            maxRetries: task.retryPolicy.maxRetries,
            delayMs: task.retryPolicy.delayMs,
          }
        : null,
      hitlPolicy: task.hitlPolicy ?? null,
      modelId: task.modelId ?? null,
      expectedResult: task.expectedResult,
      disableAdvisorEvaluation: task.disableAdvisorEvaluation,
      dynamicReasoning: task.dynamicReasoning?.enabled ? { enabled: true } : undefined,
    }));

  const sanitizedEdges = data.edges
    ?.filter((edge) => typeof edge.id === 'string' && edge.id)
    .map((edge) => ({
      id: edge.id,
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      sourceOutputPortId: edge.sourceOutputPortId,
      targetInputPortId: edge.targetInputPortId,
    }));

  return {
    name: data.name,
    description: data.description,
    designSettings: data.designSettings,
    tasks: sanitizedTasks,
    edges: sanitizedEdges,
    workspaces: data.workspaces,
    reflectionEnabled: data.reflectionEnabled,
    advisorScoringMode: data.advisorScoringMode,
    advisorAutopilotEnabled: data.advisorAutopilotEnabled,
    advisorAutopilotTargetScore: data.advisorAutopilotTargetScore,
    advisorAutopilotMaxTurns: data.advisorAutopilotMaxTurns,
    expectedDefinitionRevision: data.expectedDefinitionRevision,
    expectedUpdatedAt: data.expectedUpdatedAt,
    clientMutationId: data.clientMutationId,
  };
}

function sanitizePlaybookSettings(data: UpdatePlaybookData): UpdatePlaybookData {
  return {
    name: data.name,
    description: data.description,
    designSettings: data.designSettings
      ? {
          inferenceModelId: data.designSettings.inferenceModelId ?? null,
          nodeSuggestionsMode: data.designSettings.nodeSuggestionsMode,
          approvalSuggestionMode: data.designSettings.approvalSuggestionMode,
        }
      : undefined,
    tasks: data.tasks?.map((task) => ({
      ...task,
      evaluationConfig: task.evaluationConfig
        ? {
            expectation: task.evaluationConfig.expectation,
            referenceBaselineId: task.evaluationConfig.referenceBaselineId ?? null,
            passThreshold: task.evaluationConfig.passThreshold,
            warningThreshold: task.evaluationConfig.warningThreshold,
            weight: task.evaluationConfig.weight,
            rubricVersion: task.evaluationConfig.rubricVersion,
            weights: { ...task.evaluationConfig.weights },
          }
        : null,
    })),
    edges: data.edges,
    workspaces: data.workspaces,
    reflectionEnabled: data.reflectionEnabled,
    advisorScoringMode: data.advisorScoringMode,
    advisorAutopilotEnabled: data.advisorAutopilotEnabled,
    advisorAutopilotTargetScore: data.advisorAutopilotTargetScore,
    advisorAutopilotMaxTurns: data.advisorAutopilotMaxTurns,
    expectedDefinitionRevision: data.expectedDefinitionRevision,
    expectedUpdatedAt: data.expectedUpdatedAt,
    clientMutationId: data.clientMutationId,
  };
}

export function buildPlaybookUpdateRequestBody(data: UpdatePlaybookData): Record<string, unknown> {
  const sanitized = sanitizePlaybookSettings(sanitizePlaybookUpdate(data));

  const body: Record<string, unknown> = {
    name: sanitized.name,
    description: sanitized.description,
    workspaces: sanitized.workspaces,
  };

  if (sanitized.reflectionEnabled !== undefined) body.reflectionEnabled = sanitized.reflectionEnabled;
  if (sanitized.advisorScoringMode !== undefined) body.advisorScoringMode = sanitized.advisorScoringMode;
  if (sanitized.advisorAutopilotEnabled !== undefined) body.advisorAutopilotEnabled = sanitized.advisorAutopilotEnabled;
  if (sanitized.advisorAutopilotTargetScore !== undefined) body.advisorAutopilotTargetScore = sanitized.advisorAutopilotTargetScore;
  if (sanitized.advisorAutopilotMaxTurns !== undefined) body.advisorAutopilotMaxTurns = sanitized.advisorAutopilotMaxTurns;
  if (sanitized.expectedDefinitionRevision !== undefined) body.expectedDefinitionRevision = sanitized.expectedDefinitionRevision;
  if (sanitized.expectedUpdatedAt !== undefined) body.expectedUpdatedAt = sanitized.expectedUpdatedAt;
  if (sanitized.clientMutationId !== undefined) body.clientMutationId = sanitized.clientMutationId;

  if (data.settings) body.settings = data.settings;

  if (data.nodes !== undefined) {
    body.nodes = data.nodes;
  } else if (sanitized.tasks !== undefined) {
    body.nodes = sanitized.tasks.map(taskToFlowNode);
  }
  if (data.controlEdges !== undefined) {
    body.controlEdges = data.controlEdges;
  } else if (sanitized.edges !== undefined) {
    body.controlEdges = sanitized.edges
      .filter((edge) => !isLegacyMirroredBindingEdge(edge, data.dataBindings))
      .map((edge) => toControlEdgePayload(edge, sanitized.tasks));
  }
  if (data.dataBindings !== undefined) {
    body.dataBindings = data.dataBindings;
  }

  return body;
}

export function buildPlaybookBaselineRequestBody(data: UpdatePlaybookData): Record<string, unknown> {
  const {
    expectedDefinitionRevision: _expectedDefinitionRevision,
    expectedUpdatedAt: _expectedUpdatedAt,
    clientMutationId: _clientMutationId,
    ...body
  } = buildPlaybookUpdateRequestBody(data) as Record<string, unknown> & {
    expectedDefinitionRevision?: number;
    expectedUpdatedAt?: string;
    clientMutationId?: string;
  };

  return body;
}

function isEqualByStableStringify(left: unknown, right: unknown): boolean {
  return stableStringify(left) === stableStringify(right);
}

function buildDeltaPatchFields(
  previous: UpdateFlowData,
  current: UpdateFlowData,
): PlaybookDeltaPatchFields | undefined {
  const fields: PlaybookDeltaPatchFields = {};

  if (!isEqualByStableStringify(previous.name, current.name)) fields.name = current.name;
  if (!isEqualByStableStringify(previous.description, current.description)) fields.description = current.description;
  if (!isEqualByStableStringify(previous.designSettings, current.designSettings)) fields.designSettings = current.designSettings;
  if (!isEqualByStableStringify(previous.settings, current.settings)) fields.settings = current.settings;
  if (!isEqualByStableStringify(previous.reflectionEnabled, current.reflectionEnabled)) fields.reflectionEnabled = current.reflectionEnabled;
  if (!isEqualByStableStringify(previous.advisorScoringMode, current.advisorScoringMode)) fields.advisorScoringMode = current.advisorScoringMode;
  if (!isEqualByStableStringify(previous.advisorAutopilotEnabled, current.advisorAutopilotEnabled)) fields.advisorAutopilotEnabled = current.advisorAutopilotEnabled;
  if (!isEqualByStableStringify(previous.advisorAutopilotTargetScore, current.advisorAutopilotTargetScore)) {
    fields.advisorAutopilotTargetScore = current.advisorAutopilotTargetScore;
  }
  if (!isEqualByStableStringify(previous.advisorAutopilotMaxTurns, current.advisorAutopilotMaxTurns)) {
    fields.advisorAutopilotMaxTurns = current.advisorAutopilotMaxTurns;
  }
  if (!isEqualByStableStringify(previous.workspaces, current.workspaces)) fields.workspaces = current.workspaces;

  return Object.keys(fields).length > 0 ? fields : undefined;
}

function buildNodeDeltaPatch(
  previousNodes: FlowNode[] | undefined,
  currentNodes: FlowNode[] | undefined,
): PlaybookDeltaNodePatch | undefined {
  if (currentNodes === undefined) {
    return undefined;
  }

  if (previousNodes === undefined) {
    return currentNodes.length > 0 ? { upserts: currentNodes } : undefined;
  }

  const previousList = previousNodes;
  const currentList = currentNodes;
  const previousById = new Map(previousList.map((node) => [node.id, node]));
  const currentIds = new Set(currentList.map((node) => node.id));
  const deleteIds = previousList
    .filter((node) => !currentIds.has(node.id))
    .map((node) => node.id);
  const upserts: FlowNode[] = [];
  const positionUpdates: PlaybookDeltaNodePositionUpdate[] = [];

  for (const currentNode of currentList) {
    const previousNode = previousById.get(currentNode.id);
    if (!previousNode) {
      upserts.push(currentNode);
      continue;
    }

    const previousMetadata = { ...(previousNode.metadata ?? {}) } as Record<string, unknown>;
    const currentMetadata = { ...(currentNode.metadata ?? {}) } as Record<string, unknown>;
    const previousX = previousMetadata.positionX;
    const previousY = previousMetadata.positionY;
    const currentX = currentMetadata.positionX;
    const currentY = currentMetadata.positionY;

    delete previousMetadata.positionX;
    delete previousMetadata.positionY;
    delete currentMetadata.positionX;
    delete currentMetadata.positionY;

    const previousComparable = { ...previousNode, metadata: previousMetadata };
    const currentComparable = { ...currentNode, metadata: currentMetadata };
    if (!isEqualByStableStringify(previousComparable, currentComparable)) {
      upserts.push(currentNode);
      continue;
    }

    if (previousX !== currentX || previousY !== currentY) {
      positionUpdates.push({
        id: currentNode.id,
        positionX: typeof currentX === 'number' ? currentX : 0,
        positionY: typeof currentY === 'number' ? currentY : 0,
      });
    }
  }

  if (upserts.length === 0 && deleteIds.length === 0 && positionUpdates.length === 0) {
    return undefined;
  }

  return {
    ...(positionUpdates.length > 0 ? { positionUpdates } : {}),
    ...(upserts.length > 0 ? { upserts } : {}),
    ...(deleteIds.length > 0 ? { deleteIds } : {}),
  };
}

export function buildPlaybookDeltaPatch(
  previous: UpdateFlowData,
  current: UpdateFlowData,
  options: {
    expectedDefinitionRevision: number;
    payloadHash?: string;
    basePayloadHash?: string;
    clientMutationId?: string;
  },
): PatchPlaybookFlowDeltaData | null {
  const fields = buildDeltaPatchFields(previous, current);
  const nodes = buildNodeDeltaPatch(previous.nodes, current.nodes);
  const controlEdgesChanged = current.controlEdges !== undefined
    && !isEqualByStableStringify(previous.controlEdges, current.controlEdges);
  const dataBindingsChanged = current.dataBindings !== undefined
    && !isEqualByStableStringify(previous.dataBindings, current.dataBindings);

  if (!fields && !nodes && !controlEdgesChanged && !dataBindingsChanged) {
    return null;
  }

  return {
    expectedDefinitionRevision: options.expectedDefinitionRevision,
    ...(options.payloadHash ? { payloadHash: options.payloadHash } : {}),
    ...(options.basePayloadHash ? { basePayloadHash: options.basePayloadHash } : {}),
    ...(options.clientMutationId ? { clientMutationId: options.clientMutationId } : {}),
    patch: {
      ...(fields ? { fields } : {}),
      ...(nodes ? { nodes } : {}),
      ...(controlEdgesChanged ? { controlEdges: current.controlEdges ?? [] } : {}),
      ...(dataBindingsChanged ? { dataBindings: current.dataBindings ?? [] } : {}),
    },
  };
}

export function getPlaybookUpdateTelemetry(data: UpdatePlaybookData): { payloadBytes: number; payloadHash: string } {
  const body = buildPlaybookBaselineRequestBody(data);
  return {
    payloadBytes: measureSerializedBytes(body),
    payloadHash: stableHash(body),
  };
}

function sanitizeValidateReplayData(data: ValidateTaskReplayData): ValidateTaskReplayData {
  return {
    executionId: data.executionId,
    ...(typeof data.iteration === 'number' ? { iteration: data.iteration } : {}),
    ...(data.mode ? { mode: data.mode } : {}),
    preserveOutputFormat: Boolean(data.preserveOutputFormat),
    ...(data.replayConfig ? { replayConfig: data.replayConfig } : {}),
  };
}

export async function getPlaybooks(
  query?: PlaybookQueryParams,
): Promise<{ playbooks: PlaybookSummary[]; pagination: PaginatedResponse<PlaybookSummary>['pagination'] }> {
  const response = await apiClient.get<
    ApiResponse<{ items: any[]; pagination: PaginatedResponse<PlaybookSummary>['pagination'] }>
  >(API_ENDPOINTS.playbooks.list, { params: query });
  const { items, pagination } = response.data.data;
  return { playbooks: items, pagination };
}

function kindToNodeType(kind: string): PlaybookNodeType | undefined {
  switch (kind) {
    case 'step': return 'action';
    case 'router': return 'router';
    case 'iterator': return 'iterator';
    case 'human_approval': return 'human_approval';
    default: return undefined;
  }
}

function mapFlowNodeToPlaybookTask(node: FlowNode, index: number): PlaybookTask {
  const meta = (node.metadata ?? {}) as Record<string, unknown>;
  const inputPorts = node.input?.ports?.map((p) => ({
    id: p.id,
    name: p.label ?? p.id,
    artifactKind: (p.type ?? 'text') as any,
    required: p.required ?? false,
  }));
  const outputPorts = node.output?.ports?.map((p) => ({
    id: p.id,
    name: p.label ?? p.id,
    artifactKind: (p.type ?? 'text') as any,
  }));
  return {
    id: node.id,
    title: node.label ?? '',
    description: (meta.description as string) ?? '',
    assignedAgentId: (meta.assignedAgentId as string | null) ?? null,
    executionOrder: (meta.executionOrder as number) ?? index,
    positionX: (meta.positionX as number) ?? 0,
    positionY: (meta.positionY as number) ?? 0,
    interruptBefore: (meta.interruptBefore as boolean) ?? false,
    interruptAfter: (meta.interruptAfter as boolean) ?? false,
    allowClarification: (meta.allowClarification as boolean) ?? false,
    clarificationPrompt: (meta.clarificationPrompt as string) ?? '',
    maxClarifications: (meta.maxClarifications as number) ?? 0,
    inputKeys: (meta.inputKeys as string[]) ?? [],
    outputKey: (meta.outputKey as string) ?? '',
    enabled: (meta.enabled as boolean) ?? true,
    notifyOnComplete: (meta.notifyOnComplete as boolean) ?? false,
    notifyEmails: (meta.notifyEmails as string[]) ?? [],
    inputFiles: (meta.inputFiles as any[]) ?? [],
    selectedAction: (meta.selectedAction as any) ?? undefined,
    executionMode: (meta.executionMode as any) ?? undefined,
    taskType: (meta.taskType as string) ?? undefined,
    nodeTemplateKey: (meta.nodeTemplateKey as string) ?? undefined,
    toolBindings: (meta.toolBindings as any) ?? undefined,
    skillBindings: (meta.skillBindings as any) ?? undefined,
    evaluationConfig: (meta.evaluationConfig as any) ?? undefined,
    iteratorLayout: (meta.iteratorLayout as any) ?? undefined,
    containerConfig: (meta.containerConfig as any) ?? null,
    expectedResult: (meta.expectedResult as any) ?? undefined,
    disableAdvisorEvaluation: (meta.disableAdvisorEvaluation as boolean) ?? false,
    stepReplayMode: (meta.stepReplayMode as any) ?? undefined,
    nodeType: (meta.nodeType as import('./types').PlaybookNodeType) ?? kindToNodeType(node.kind),
    iteratorConfig: buildPlaybookIteratorConfig(node.iteratorConfig, meta),
    routerConfig: node.routerConfig ?? (meta.routerConfig as any) ?? null,
    humanApprovalConfig: buildPlaybookHumanApprovalConfig(node.humanApprovalConfig, meta),
    retryPolicy: node.retryPolicy ?? (meta.retryPolicy as any) ?? null,
    modelId: node.modelId || (meta.modelId as string | null | undefined) || null,
    ...(inputPorts ? { inputPorts } : {}),
    ...(outputPorts ? { outputPorts } : {}),
  };
}

function buildPlaybookIteratorConfig(
  iteratorConfig: { collectionPath: string; maxItems?: number } | undefined,
  meta: Record<string, unknown>,
): PlaybookIteratorConfig | null {
  if (!iteratorConfig) {
    return (meta.iteratorConfig as PlaybookIteratorConfig | null | undefined) ?? null;
  }
  const iteratorMeta = meta.iteratorConfig as Partial<PlaybookIteratorConfig> | undefined;
  return {
    source: iteratorConfig.collectionPath,
    mode: iteratorMeta?.mode ?? 'item',
    batchSize: iteratorConfig.maxItems ?? undefined,
    itemVariable: iteratorMeta?.itemVariable ?? 'item',
    outputVariable: iteratorMeta?.outputVariable ?? 'processed_items',
    errorStrategy: iteratorMeta?.errorStrategy ?? 'stop',
  };
}

function buildPlaybookHumanApprovalConfig(
  approvalConfig: HumanApprovalConfig | undefined,
  meta: Record<string, unknown>,
): HumanApprovalConfig | null {
  if (!approvalConfig) {
    return (meta.humanApprovalConfig as HumanApprovalConfig | null | undefined) ?? null;
  }
  return {
    ...approvalConfig,
    timeoutSeconds:
      meta.humanApprovalTimeoutUnlimited === true && approvalConfig.timeoutSeconds === 0
        ? null
        : approvalConfig.timeoutSeconds,
  };
}

function mapControlEdgeToPlaybookEdge(ce: ControlEdge): PlaybookEdge {
  return {
    id: ce.id,
    sourceId: ce.source,
    targetId: ce.target,
    // Old flows may only have routerLabel, so preserve it as the source port fallback.
    sourceOutputPortId: ce.sourceOutputPortId ?? ce.routerLabel ?? 'default',
    targetInputPortId: ce.targetInputPortId ?? 'default',
  };
}

function toControlEdgePayload(edge: PlaybookEdge, tasks: PlaybookTask[] | undefined): ControlEdge {
  const sourceTask = tasks?.find((task) => task.id === edge.sourceId);
  const sourceOutputPortId = edge.sourceOutputPortId || 'default';
  return {
    id: edge.id,
    kind: sourceTask?.nodeType === 'router' ? 'conditional' : 'sequential',
    source: edge.sourceId,
    target: edge.targetId,
    sourceOutputPortId,
    targetInputPortId: edge.targetInputPortId || 'default',
    ...(sourceTask?.nodeType === 'router' ? { routerLabel: sourceOutputPortId } : {}),
  };
}

function isLegacyMirroredBindingEdge(edge: PlaybookEdge, dataBindings: DataBinding[] | undefined): boolean {
  if (!dataBindings || dataBindings.length === 0) {
    return false;
  }

  const sourceOutputPortId = edge.sourceOutputPortId || 'default';
  const targetInputPortId = edge.targetInputPortId || 'default';

  return dataBindings.some((binding) => {
    if (binding.targetNode !== edge.targetId || binding.targetPort !== targetInputPortId) {
      return false;
    }

    return binding.sourceKind === 'trigger'
      && edge.sourceId === '__trigger__'
      && (binding.triggerPath || 'default') === sourceOutputPortId;
  });
}

function toNullableString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') {
    try { return JSON.stringify(value, null, 2); } catch { return null; }
  }
  return null;
}

function toNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

type JsonRecord = Record<string, unknown>;

type JudgeHistoryEntry = NonNullable<TaskResult['judgeHistory']>[number];

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function parseNumberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function parseNullableNumberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function parseStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function parseEnum<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  if (typeof value !== 'string') return undefined;
  return (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

function normalizeJudgeScoringMode(rawScoringMode: unknown, model: string | null): 'heuristic' | 'llm' {
  if (rawScoringMode === 'heuristic') return 'heuristic';
  if (rawScoringMode === 'llm') return 'llm';
  return model === 'deterministic-execution-advisor' ? 'heuristic' : 'llm';
}

function normalizeJudgeAvailableActions(value: unknown): { optimizeStep: true; optimizePlaybook: true } | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const optimizeStep = parseBoolean(record.optimizeStep ?? record.optimize_step, false);
  const optimizePlaybook = parseBoolean(record.optimizePlaybook ?? record.optimize_playbook, false);
  return optimizeStep && optimizePlaybook ? { optimizeStep: true, optimizePlaybook: true } : undefined;
}

function normalizeJudgeUsage(rawUsage: unknown): JudgeHistoryEntry['usage'] {
  const record = asRecord(rawUsage);
  if (!record) return null;
  return {
    inputTokens: parseNullableNumberValue(record.inputTokens ?? record.input_tokens),
    outputTokens: parseNullableNumberValue(record.outputTokens ?? record.output_tokens),
    totalTokens: parseNullableNumberValue(record.totalTokens ?? record.total_tokens),
    model: toNullableString(record.model),
  };
}

function normalizeJudgeResultScores(record: JsonRecord) {
  return {
    accuracyScore: parseNumberValue(record.accuracyScore ?? record.accuracy_score) ?? 0,
    completenessScore: parseNumberValue(record.completenessScore ?? record.completeness_score) ?? 0,
    resultMatchingScore: parseNumberValue(record.resultMatchingScore ?? record.result_matching_score) ?? 0,
    overallScore: parseNumberValue(record.overallScore ?? record.overall_score) ?? 0,
    confidence: parseNumberValue(record.confidence) ?? 0,
    toolUsageScore: parseNumberValue(record.toolUsageScore ?? record.tool_usage_score) ?? 0,
    relevanceScore: parseNumberValue(record.relevanceScore ?? record.relevance_score),
    specificityScore: parseNumberValue(record.specificityScore ?? record.specificity_score),
    formatComplianceScore: parseNumberValue(record.formatComplianceScore ?? record.format_compliance_score),
    evidenceGroundingScore: parseNumberValue(record.evidenceGroundingScore ?? record.evidence_grounding_score),
    handoffReadinessScore: parseNumberValue(record.handoffReadinessScore ?? record.handoff_readiness_score),
    hitlAppropriatenessScore: parseNumberValue(record.hitlAppropriatenessScore ?? record.hitl_appropriateness_score),
    determinismScore: parseNumberValue(record.determinismScore ?? record.determinism_score),
    costEfficiencyScore: parseNumberValue(record.costEfficiencyScore ?? record.cost_efficiency_score),
    stepOptimizationPriority: parseNumberValue(record.stepOptimizationPriority ?? record.step_optimization_priority),
    playbookOptimizationPriority: parseNumberValue(record.playbookOptimizationPriority ?? record.playbook_optimization_priority),
    costOptimizationPriority: parseNumberValue(record.costOptimizationPriority ?? record.cost_optimization_priority),
    estimatedTokenReductionPct: parseNumberValue(record.estimatedTokenReductionPct ?? record.estimated_token_reduction_pct),
    estimatedLatencyReductionPct: parseNumberValue(record.estimatedLatencyReductionPct ?? record.estimated_latency_reduction_pct),
    blockingIssueCount: parseNumberValue(record.blockingIssueCount ?? record.blocking_issue_count),
  };
}

function normalizeJudgeResultMetadata(record: JsonRecord) {
  return {
    expectedResultSource: parseEnum(record.expectedResultSource ?? record.expected_result_source, ['node_field', 'golden_baseline', 'none']) ?? 'none',
    expectedResultType: parseEnum(
      record.expectedResultType ?? record.expected_result_type,
      ['exact_value', 'semantic_description', 'numeric_presentation', 'document_generation', 'baseline_comparison', 'none'],
    ) ?? 'none',
    expectedResultMatched: parseBoolean(record.expectedResultMatched ?? record.expected_result_matched, false),
    expectedResultReason: toNullableString(record.expectedResultReason ?? record.expected_result_reason) ?? '',
    missingFacts: parseStringArray(record.missingFacts ?? record.missing_facts),
    incoherences: parseStringArray(record.incoherences),
    unsupportedClaims: parseStringArray(record.unsupportedClaims ?? record.unsupported_claims),
    handoffRisks: parseStringArray(record.handoffRisks ?? record.handoff_risks),
    rewriteHints: parseStringArray(record.rewriteHints ?? record.rewrite_hints),
    toolSelectionIssues: parseStringArray(record.toolSelectionIssues ?? record.tool_selection_issues),
    missingToolCalls: parseStringArray(record.missingToolCalls ?? record.missing_tool_calls),
    redundantToolCalls: parseStringArray(record.redundantToolCalls ?? record.redundant_tool_calls),
    toolOutputUseIssues: parseStringArray(record.toolOutputUseIssues ?? record.tool_output_use_issues),
    toolSequencingIssues: parseStringArray(record.toolSequencingIssues ?? record.tool_sequencing_issues),
    toolUsageStrengths: parseStringArray(record.toolUsageStrengths ?? record.tool_usage_strengths),
    toolUsageRecommendation: toNullableString(record.toolUsageRecommendation ?? record.tool_usage_recommendation) ?? '',
    costOptimizationHints: parseStringArray(record.costOptimizationHints ?? record.cost_optimization_hints),
    scriptReplacementHints: parseStringArray(record.scriptReplacementHints ?? record.script_replacement_hints),
    llmStillRequiredReasons: parseStringArray(record.llmStillRequiredReasons ?? record.llm_still_required_reasons),
    reason: toNullableString(record.reason) ?? '',
  };
}

function normalizeJudgeResultConfig(record: JsonRecord) {
  return {
    riskSeverity: parseEnum(record.riskSeverity ?? record.risk_severity, ['low', 'medium', 'high', 'critical']),
    downstreamImpactLevel: parseEnum(record.downstreamImpactLevel ?? record.downstream_impact_level, ['none', 'low', 'medium', 'high']),
    recommendedAction: parseEnum(
      record.recommendedAction ?? record.recommended_action,
      [
        'optimize_step',
        'optimize_playbook',
        'review_only',
        'add_hitl_guard',
        'improve_tooling',
        'improve_output_contract',
        'optimize_prompt_cost',
        'switch_to_cheaper_model',
        'add_result_cache',
        'replace_with_deterministic_script',
      ] as const,
    ) as AdvisorRecommendedAction | undefined,
    availableActions: normalizeJudgeAvailableActions(record.availableActions ?? record.available_actions),
    safeAutoFixType: parseEnum(record.safeAutoFixType ?? record.safe_auto_fix_type, ['optimize_step', 'none']) ?? 'none',
    recommendation: parseEnum(
      record.recommendation,
      ['none', 'update_current_playbook', 'generate_new_optimized_playbook'],
    ) ?? 'none',
  };
}

export function normalizeJudgeResult(raw: unknown): NonNullable<TaskResult['judgeResult']> {
  const record = asRecord(raw) ?? {};
  return {
    ...normalizeJudgeResultScores(record),
    ...normalizeJudgeResultMetadata(record),
    ...normalizeJudgeResultConfig(record),
  };
}

export function normalizeJudgeHistoryEntry(raw: unknown, index = 0): JudgeHistoryEntry {
  const record = asRecord(raw) ?? {};
  const model = toNullableString(record.model) ?? null;
  return {
    id: toNullableString(record.id) ?? `judge-${index + 1}`,
    createdAt: toNullableString(record.createdAt ?? record.created_at) ?? '',
    attemptNumber: parseNullableNumberValue(record.attemptNumber ?? record.attempt_number),
    model,
    scoringMode: normalizeJudgeScoringMode(record.scoringMode ?? record.scoring_mode, model),
    usage: normalizeJudgeUsage(record.usage),
    llmPromptTrace: Array.isArray(record.llmPromptTrace ?? record.llm_prompt_trace)
      ? (record.llmPromptTrace ?? record.llm_prompt_trace) as import('./types').LLMPromptTraceItem[]
      : [],
    judgeResult: normalizeJudgeResult(record.judgeResult ?? record.judge_result ?? {}),
  };
}

function normalizeTaskArtifact(raw: unknown): import('./types').TaskArtifact | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const metadata = record.metadata && typeof record.metadata === 'object'
    ? { ...(record.metadata as Record<string, unknown>) }
    : {};
  if (record.data !== undefined) {
    metadata.data = record.data;
  }

  return {
    portId: toNullableString(record.portId ?? record.port_id) ?? 'default',
    artifactId: toNullableString(record.artifactId ?? record.artifact_id) ?? undefined,
    artifactKind: (toNullableString(record.artifactKind ?? record.artifact_kind) ?? 'text') as import('./types').ArtifactKind,
    content: toNullableString(record.content) ?? undefined,
    filename: toNullableString(record.filename) ?? undefined,
    mimeType: toNullableString(record.mimeType ?? record.mime_type) ?? undefined,
    url: toNullableString(record.url) ?? undefined,
    size: toNullableNumber(record.size) ?? undefined,
    availability: toNullableString(record.availability) ?? undefined,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  };
}

export function normalizeTaskArtifacts(raw: unknown): import('./types').TaskArtifact[] {
  return Array.isArray(raw)
    ? raw.map(normalizeTaskArtifact).filter((item): item is import('./types').TaskArtifact => item !== null)
    : [];
}

function computeDurationMs(startedAt: string | null, completedAt: string | null): number | null {
  if (!startedAt || !completedAt) return null;
  const start = Date.parse(startedAt);
  const end = Date.parse(completedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, end - start);
}

function safeParseRecord(value: string | null | undefined): Record<string, unknown> | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function normalizeIteratorChildResult(raw: Record<string, unknown>): import('./types').IteratorChildResult {
  return {
    taskId: toNullableString(raw.taskId ?? raw.task_id) ?? '',
    taskTitle: toNullableString(raw.taskTitle ?? raw.task_title) ?? '',
    status: (raw.status as import('./types').StepStatus | undefined) ?? 'pending',
    output: toNullableString(raw.output),
    error: toNullableString(raw.error),
    components: Array.isArray(raw.components) ? raw.components as import('./types').PlaybookComponent[] : [],
    toolTrace: Array.isArray(raw.toolTrace ?? raw.tool_trace) ? (raw.toolTrace ?? raw.tool_trace) as import('./types').ToolTraceItem[] : [],
    reasoningChain: Array.isArray(raw.reasoningChain ?? raw.reasoning_chain) ? (raw.reasoningChain ?? raw.reasoning_chain) as import('./types').PublicReasoningTraceItem[] : [],
    llmPromptTrace: Array.isArray(raw.llmPromptTrace ?? raw.llm_prompt_trace) ? (raw.llmPromptTrace ?? raw.llm_prompt_trace) as import('./types').LLMPromptTraceItem[] : [],
    artifacts: normalizeTaskArtifacts(raw.artifacts),
  };
}

function normalizeIteratorIterations(raw: Record<string, unknown>): import('./types').IteratorIterationResult[] {
  const parsedOutput = safeParseRecord(toNullableString(raw.output));
  const candidate = [
    raw.iteratorIterations,
    raw.iterator_iterations,
    parsedOutput?.iteratorIterations,
    parsedOutput?.iterator_iterations,
  ].find((value) => Array.isArray(value) && value.length > 0)
    ?? [raw.iteratorIterations, raw.iterator_iterations, parsedOutput?.iteratorIterations, parsedOutput?.iterator_iterations]
      .find(Array.isArray);

  if (!Array.isArray(candidate)) return [];

  return candidate
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
    .map((entry, index) => {
      const childResults = entry.childResults ?? entry.child_results;
      return {
        index: typeof entry.index === 'number' ? entry.index : index,
        status: (entry.status as import('./types').StepStatus | undefined) ?? 'pending',
        itemPreview: toNullableString(entry.itemPreview ?? entry.item_preview),
        output: toNullableString(entry.output),
        error: toNullableString(entry.error),
        childResults: Array.isArray(childResults)
          ? childResults
              .filter((child): child is Record<string, unknown> => Boolean(child) && typeof child === 'object' && !Array.isArray(child))
              .map(normalizeIteratorChildResult)
          : [],
        artifacts: normalizeTaskArtifacts(entry.artifacts),
      };
    });
}

function deriveExecutionNumber(
  index: number,
  pagination?: PaginatedResponse<PlaybookExecutionSummary>['pagination'],
): number {
  if (!pagination) return index + 1;
  const offset = (pagination.page - 1) * pagination.limit;
  return Math.max(1, pagination.total - offset - index);
}

function normalizeTaskResult(raw: any, index: number): import('./types').TaskResult {
  const startedAt = toNullableString(raw.startedAt);
  const completedAt = toNullableString(raw.completedAt ?? raw.endedAt);

  return {
    taskId: toNullableString(raw.taskId) ?? `task-${index + 1}`,
    nodeTitle: toNullableString(raw.nodeTitle) ?? toNullableString(raw.taskTitle) ?? toNullableString(raw.taskId) ?? '',
    agentName: toNullableString(raw.agentName) ?? '',
    order: typeof raw.order === 'number' ? raw.order : index + 1,
    iteration: toNullableNumber(raw.iteration) ?? undefined,
    status: raw.status ?? 'pending',
    output: toNullableString(raw.output),
    displayText: toNullableString(raw.displayText ?? raw.display_text),
    error: toNullableString(raw.error),
    durationMs: toNullableNumber(raw.durationMs) ?? computeDurationMs(startedAt, completedAt),
    startedAt,
    completedAt,
    components: Array.isArray(raw.components) ? raw.components : [],
    toolTrace: Array.isArray(raw.toolTrace) ? raw.toolTrace : [],
    reasoningChain: Array.isArray(raw.reasoningChain) ? raw.reasoningChain : [],
    llmPromptTrace: Array.isArray(raw.llmPromptTrace) ? raw.llmPromptTrace : [],
    inputTokens: toNullableNumber(raw.inputTokens),
    outputTokens: toNullableNumber(raw.outputTokens),
    totalTokens: toNullableNumber(raw.totalTokens),
    modelName: toNullableString(raw.modelName),
    semanticMatch: raw.semanticMatch ?? null,
    traceMetadata: raw.traceMetadata ?? null,
    judgeStatus: raw.judgeStatus ?? 'idle',
    judgeScoringMode: raw.judgeScoringMode === 'heuristic' ? 'heuristic' : raw.judgeScoringMode === 'llm' ? 'llm' : null,
    judgeResult: (raw.judgeResult ?? raw.judge_result)
      ? normalizeJudgeResult(raw.judgeResult ?? raw.judge_result)
      : null,
    judgeError: toNullableString(raw.judgeError),
    judgeHistory: Array.isArray(raw.judgeHistory ?? raw.judge_history)
      ? (raw.judgeHistory ?? raw.judge_history).map(normalizeJudgeHistoryEntry)
      : [],
    advisorTurnCount: toNullableNumber(raw.advisorTurnCount) ?? undefined,
    advisorTurnHistory: Array.isArray(raw.advisorTurnHistory) ? raw.advisorTurnHistory : [],
    advisorOptimizationHistory: Array.isArray(raw.advisorOptimizationHistory) ? raw.advisorOptimizationHistory : [],
    lastAdvisorAction: toNullableString(raw.lastAdvisorAction),
    lastAdvisorScoreDelta: toNullableNumber(raw.lastAdvisorScoreDelta) ?? undefined,
    advisorStopReason: toNullableString(raw.advisorStopReason),
    attemptNumber: toNullableNumber(raw.attemptNumber) ?? undefined,
    isStale: Boolean(raw.isStale),
    staleReason: toNullableString(raw.staleReason),
    invalidatedByTaskId: toNullableString(raw.invalidatedByTaskId),
    artifacts: normalizeTaskArtifacts(raw.artifacts),
    hitlHistory: Array.isArray(raw.hitlHistory)
      ? raw.hitlHistory.map((entry: any) => entry?.interruptId ? entry : normalizeHitlEvent(entry as HitlEventLog))
      : [],
    iteratorIterations: normalizeIteratorIterations(raw),
    parentTaskId: toNullableString(raw.parentTaskId ?? raw.parent_task_id) ?? undefined,
    runtimeSubgraphId: toNullableString(raw.runtimeSubgraphId ?? raw.runtime_subgraph_id) ?? undefined,
    generatedLocalNodeId: toNullableString(raw.generatedLocalNodeId ?? raw.generated_local_node_id) ?? undefined,
    generatedNodeTitle: toNullableString(raw.generatedNodeTitle ?? raw.generated_node_title) ?? undefined,
  };
}

export async function requestPlaybookArtifactAccess(
  executionId: string,
  artifactId: string,
  action: 'view' | 'download',
): Promise<{ url: string; expiresAt: string }> {
  const response = await apiClient.post<ApiResponse<{ token: string; expiresAt: string }>>(
    API_ENDPOINTS.playbookFlows.executionArtifactAccess(executionId, artifactId),
    { action },
  );
  const { token, expiresAt } = response.data.data;
  return {
    url: `${API_CONFIG.baseURL}${API_ENDPOINTS.playbookFlows.artifactContent}?token=${encodeURIComponent(token)}`,
    expiresAt,
  };
}

function normalizeDynamicReasoningAttempts(
  rawAttempts: unknown,
  executionId: string,
): import('./types').DynamicReasoningAttempt[] {
  if (!Array.isArray(rawAttempts)) return [];

  return rawAttempts
    .filter((attempt): attempt is Record<string, unknown> => Boolean(attempt) && typeof attempt === 'object')
    .map((attempt) => {
      const status = attempt.status;
      return {
        id: toNullableString(attempt.id ?? attempt._id) ?? undefined,
        executionId: toNullableString(attempt.executionId ?? attempt.execution_id) ?? executionId,
        flowId: toNullableString(attempt.flowId ?? attempt.flow_id) ?? undefined,
        parentTaskId: toNullableString(attempt.parentTaskId ?? attempt.parent_task_id) ?? '',
        parentIteration: toNullableNumber(attempt.parentIteration ?? attempt.parent_iteration) ?? 0,
        attempt: toNullableNumber(attempt.attempt) ?? 0,
        subgraphId: toNullableString(attempt.subgraphId ?? attempt.subgraph_id) ?? undefined,
        status: status === 'direct' || status === 'running' || status === 'completed' || status === 'failed'
          ? status
          : 'planning',
        decision: attempt.decision && typeof attempt.decision === 'object'
          ? attempt.decision as Record<string, unknown>
          : undefined,
        revisions: Array.isArray(attempt.revisions)
          ? attempt.revisions.filter((revision): revision is Record<string, unknown> => Boolean(revision) && typeof revision === 'object')
          : [],
        acceptedRevision: toNullableNumber(attempt.acceptedRevision ?? attempt.accepted_revision) ?? undefined,
        acceptedPlan: (attempt.acceptedPlan ?? attempt.accepted_plan) as import('./types').DynamicReasoningAttempt['acceptedPlan'] | undefined,
        inputContextSummary: attempt.inputContextSummary && typeof attempt.inputContextSummary === 'object'
          ? attempt.inputContextSummary as Record<string, unknown>
          : undefined,
        fallbackReason: toNullableString(attempt.fallbackReason ?? attempt.fallback_reason) ?? undefined,
        error: attempt.error && typeof attempt.error === 'object'
          ? attempt.error as Record<string, unknown>
          : undefined,
      };
    });
}

function normalizeHitlEvent(event: HitlEventLog): import('./types').HitlHistoryEntry {
  const payload = event.payload || {};
  const response = event.response || null;
  return {
    interruptId: event.interruptId,
    taskId: event.nodeId,
    type: event.type,
    taskTitle: toNullableString(payload.task_title ?? payload.taskTitle) ?? '',
    message: event.prompt,
    taskDescription: toNullableString(payload.task_description ?? payload.taskDescription) ?? '',
    result: toNullableString(payload.result) ?? '',
    round: event.iteration,
    payloadJson: toNullableString(payload.conversation_json ?? payload.payloadJson) ?? '',
    resumableActions: Array.isArray(payload.resumable_actions)
      ? payload.resumable_actions as string[]
      : Array.isArray(payload.resumableActions)
        ? payload.resumableActions as string[]
        : [],
    status: event.status === 'answered' ? 'answered' : 'pending',
    responseAction: response?.action ?? null,
    responseMessage: response?.message ?? null,
    responseApproved: response?.approved ?? null,
    responseReason: response?.reason ?? null,
    responseFeedback: response?.feedback ?? null,
    responseScope: response?.scope ?? null,
    responseRemember: response?.remember ?? null,
    blockerRuleId: event.blockerRuleId ?? null,
    blockerKind: event.blockerKind ?? null,
    reasonCode: event.reasonCode ?? null,
    riskLevel: event.riskLevel ?? null,
    downstreamNodeIds: event.downstreamNodeIds ?? [],
    feedbackScopeDefault: (payload.feedback_scope_default ?? payload.feedbackScopeDefault) as HitlFeedbackScope | undefined,
    memoryCandidate: false,
    respondedBy: null,
    respondedAt: event.respondedAt ?? null,
    createdAt: event.createdAt,
  };
}

function mergeHitlHistory(
  primary: import('./types').HitlHistoryEntry[],
  fallback: import('./types').HitlHistoryEntry[],
) {
  const entries = new Map<string, import('./types').HitlHistoryEntry>();
  for (const entry of fallback) entries.set(entry.interruptId, entry);
  for (const entry of primary) entries.set(entry.interruptId, entry);
  return Array.from(entries.values()).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

function normalizeExecutionSummary(
  raw: any,
  index = 0,
  pagination?: PaginatedResponse<PlaybookExecutionSummary>['pagination'],
): PlaybookExecutionSummary {
  const startedAt = toNullableString(raw.startedAt ?? raw.createdAt);
  const completedAt = toNullableString(raw.completedAt ?? raw.endedAt);

  return {
    id: toNullableString(raw.id ?? raw._id) ?? '',
    playbookId: toNullableString(raw.playbookId ?? raw.flowId) ?? '',
    executedBy: toNullableString(raw.executedBy ?? raw.ownerId) ?? '',
    executionNumber: typeof raw.executionNumber === 'number' ? raw.executionNumber : deriveExecutionNumber(index, pagination),
    currentAttemptNumber: typeof raw.currentAttemptNumber === 'number' ? raw.currentAttemptNumber : undefined,
    status: raw.status ?? 'queued',
    executionTrigger: raw.executionTrigger === 'scheduled' ? 'scheduled' : 'manual',
    error: toNullableString(raw.error),
    durationMs: toNullableNumber(raw.durationMs) ?? computeDurationMs(startedAt, completedAt),
    startedAt,
    completedAt,
    singleStepTaskId: toNullableString(raw.singleStepTaskId),
    createdAt: toNullableString(raw.createdAt) ?? startedAt ?? '',
    updatedAt: toNullableString(raw.updatedAt) ?? completedAt ?? startedAt ?? '',
  };
}

function normalizeExecution(raw: any): PlaybookExecution {
  const summary = normalizeExecutionSummary(raw);
  const hitlEvents = Array.isArray(raw.hitlEvents) ? raw.hitlEvents as HitlEventLog[] : [];
  const normalizedHitlHistory = mergeHitlHistory(
    Array.isArray(raw.hitlHistory) ? raw.hitlHistory : [],
    hitlEvents.map(normalizeHitlEvent),
  );
  const stepExecutionModes = raw.stepExecutionModes ?? raw.step_execution_modes;
  const replayPlanningByTask = raw.replayPlanningByTask;
  const isTerminal = summary.status === 'completed' || summary.status === 'failed' || summary.status === 'cancelled';
  const pendingApprovalType = raw.pendingApproval?.interruptType === 'human_approval'
    ? 'approval_request'
    : raw.pendingApproval?.interruptType;
  const interruptPayload = isTerminal ? null : raw.interruptPayload ?? (raw.pendingApproval
    ? {
        type: pendingApprovalType ?? 'approval_request',
        taskId: raw.pendingApproval.nodeId,
        taskTitle: raw.pendingApproval.taskTitle ?? '',
        message: raw.pendingApproval.prompt ?? '',
        threadId: raw.threadId ?? '',
        interruptId: raw.pendingApproval.interruptId ?? '',
        round: raw.pendingApproval.iteration ?? 0,
        payloadJson: raw.pendingApproval.payloadJson ?? '',
        resumableActions: raw.pendingApproval.resumableActions ?? [],
        taskDescription: raw.pendingApproval.taskDescription ?? '',
        result: raw.pendingApproval.result ?? '',
      }
    : null);
  const pendingInterrupts = Array.isArray(raw.pendingInterrupts)
    ? raw.pendingInterrupts
    : interruptPayload
      ? [interruptPayload]
      : [];

  return {
    ...summary,
    executionMode: raw.executionMode || 'live',
    stepExecutionModes:
      stepExecutionModes && typeof stepExecutionModes === 'object'
        ? stepExecutionModes
        : undefined,
    taskResults: Array.isArray(raw.taskResults)
      ? raw.taskResults.map((result: any, index: number) => {
          const taskResult = normalizeTaskResult(result, index);
          const taskIteration = taskResult.iteration ?? 0;
          return {
            ...taskResult,
            hitlHistory: normalizedHitlHistory.filter((entry) => entry.taskId === taskResult.taskId && entry.round === taskIteration),
          };
        })
      : [],
    threadId: toNullableString(raw.threadId),
    interruptPayload,
    pendingInterrupts: isTerminal ? [] : pendingInterrupts,
    waitingForHumanInput: isTerminal ? false : Boolean(raw.waitingForHumanInput ?? raw.pendingApproval),
    currentInterruptId: isTerminal ? null : toNullableString(raw.currentInterruptId),
    currentInterruptTaskId: isTerminal ? null : toNullableString(raw.currentInterruptTaskId ?? raw.pendingApproval?.nodeId),
    hitlHistory: normalizedHitlHistory,
    hitlEvents,
    snapshot: raw.snapshot && typeof raw.snapshot === 'object' ? raw.snapshot : null,
    playbookSnapshot: raw.playbookSnapshot ?? null,
    totalInputTokens: toNullableNumber(raw.totalInputTokens) ?? 0,
    totalOutputTokens: toNullableNumber(raw.totalOutputTokens) ?? 0,
    totalTokens: toNullableNumber(raw.totalTokens) ?? 0,
    queuePosition: toNullableNumber(raw.queuePosition),
    totalQueueSize: toNullableNumber(raw.totalQueueSize),
    recursionBudgetUsed: toNullableNumber(raw.recursionBudgetUsed),
    recursionBudgetMax: toNullableNumber(raw.recursionBudgetMax) ?? toNullableNumber(raw.recursionLimit),
    reflectionEnabled: raw.reflectionEnabled !== false,
    advisorScoringMode: raw.advisorScoringMode === 'heuristic' ? 'heuristic' : 'llm',
    advisorAutopilotEnabled: Boolean(raw.advisorAutopilotEnabled),
    advisorAutopilotTargetScore: toNullableNumber(raw.advisorAutopilotTargetScore) ?? undefined,
    advisorAutopilotMaxTurns: toNullableNumber(raw.advisorAutopilotMaxTurns) ?? undefined,
    advisorAutopilotStatus: raw.advisorAutopilotStatus ?? undefined,
    advisorAutopilotTaskId: toNullableString(raw.advisorAutopilotTaskId),
    advisorAutopilotAttemptCount: toNullableNumber(raw.advisorAutopilotAttemptCount) ?? undefined,
    advisorAutopilotLastError: toNullableString(raw.advisorAutopilotLastError),
    judgeSummaryStatus: raw.judgeSummaryStatus ?? 'idle',
    judgeSummary: raw.judgeSummary ?? null,
    replaySource:
      raw.replaySource && typeof raw.replaySource === 'object'
        ? {
            executionId: toNullableString(raw.replaySource.executionId) ?? '',
            taskId: toNullableString(raw.replaySource.taskId) ?? '',
            iteration: toNullableNumber(raw.replaySource.iteration) ?? undefined,
          }
        : null,
    replaySourceByTask: raw.replaySourceByTask ?? null,
    replayPlanningByTask:
      replayPlanningByTask && typeof replayPlanningByTask === 'object'
        ? replayPlanningByTask
        : null,
    dynamicReasoningAttempts: normalizeDynamicReasoningAttempts(
      raw.dynamicReasoningAttempts ?? raw.dynamic_reasoning_attempts,
      summary.id,
    ),
    error: summary.error,
  };
}

function normalizeValidatedTaskReplay(raw: any): ValidatedTaskReplay {
  return {
    ...raw,
    id: toNullableString(raw.id ?? raw._id) ?? '',
    playbookId: toNullableString(raw.playbookId ?? raw.flowId) ?? '',
    taskId: toNullableString(raw.taskId) ?? '',
    taskTitle: toNullableString(raw.taskTitle) ?? '',
    agentName: toNullableString(raw.agentName) ?? '',
    createdBy: toNullableString(raw.createdBy) ?? '',
    referenceExecutionId: toNullableString(raw.referenceExecutionId) ?? '',
    referenceExecutionNumber: toNullableNumber(raw.referenceExecutionNumber) ?? 0,
    validationVersion: toNullableNumber(raw.validationVersion) ?? 0,
    referenceOutput: toNullableString(raw.referenceOutput),
    outputContract: raw.outputContract ?? null,
    intentKey: toNullableString(raw.intentKey),
    intentLabel: toNullableString(raw.intentLabel),
    reasoningOutline: Array.isArray(raw.reasoningOutline) ? raw.reasoningOutline : [],
    stableReasoningRules: Array.isArray(raw.stableReasoningRules) ? raw.stableReasoningRules : [],
    contextVariableSchema: Array.isArray(raw.contextVariableSchema) ? raw.contextVariableSchema : [],
    toolTraceTemplate: Array.isArray(raw.toolTraceTemplate) ? raw.toolTraceTemplate : [],
    driftPolicy: raw.driftPolicy ?? null,
    acceptedExamples: Array.isArray(raw.acceptedExamples) ? raw.acceptedExamples : [],
    hitlMemorySnapshots: Array.isArray(raw.hitlMemorySnapshots) ? raw.hitlMemorySnapshots : [],
  };
}

type RunAdvisorEvaluationResponse = {
  executionId: string;
  taskId: string;
  taskResult: TaskResult;
  judgeSummaryStatus?: PlaybookExecution['judgeSummaryStatus'];
  judgeSummary?: PlaybookExecution['judgeSummary'];
};

export async function getPlaybook(id: string): Promise<Playbook> {
  const response = await apiClient.get<ApiResponse<Playbook>>(
    API_ENDPOINTS.playbooks.byId(id),
  );
  return normalizePlaybook(response.data.data);
}

export async function createPlaybook(data: CreatePlaybookData): Promise<Playbook> {
  const response = await apiClient.post<ApiResponse<Playbook>>(
    API_ENDPOINTS.playbooks.list,
    data,
  );
  return response.data.data;
}

export async function generatePlaybook(
  data: GeneratePlaybookData,
): Promise<{ id: string }> {
  const response = await apiClient.post<ApiResponse<{ id: string }>>(
    API_ENDPOINTS.playbooks.generate,
    data,
  );
  return response.data.data;
}

export async function rewritePlaybookPrompt(
  data: RewritePlaybookPromptData,
): Promise<RewritePlaybookPromptResult> {
  const response = await apiClient.post<ApiResponse<RewritePlaybookPromptResult>>(
    API_ENDPOINTS.playbooks.rewritePrompt,
    data,
  );
  return response.data.data;
}

export async function rewritePlaybookPromptStream(
  data: RewritePlaybookPromptData,
  onChunk: (chunk: string) => void,
): Promise<RewritePlaybookPromptResult> {
  const token = localStorage.getItem(AUTH_STORAGE_KEYS.accessToken);
  const response = await fetch(`${API_CONFIG.baseURL}${API_ENDPOINTS.playbooks.rewritePrompt}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(data),
    credentials: 'include',
  });

  if (!response.ok || !response.body) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  // The endpoint returns a single JSON envelope { prompt: "..." }. The caller
  // treats this as a stream, so we read the full body, unwrap the prompt value,
  // and forward it as a single chunk. This keeps the textarea free of the raw
  // JSON envelope.
  const raw = await response.text();
  const prompt = unwrapRewritePromptPayload(raw);
  onChunk(prompt);
  return { prompt };
}

function unwrapRewritePromptPayload(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) return trimmed;

  try {
    const parsed = JSON.parse(trimmed) as { prompt?: unknown };
    if (typeof parsed.prompt === 'string') return parsed.prompt;
  } catch {
    // Fall through to the trimmed raw body if the payload is not valid JSON.
  }

  return trimmed;
}

export async function updatePlaybook(
  id: string,
  data: UpdatePlaybookData,
): Promise<Playbook> {
  const body = buildPlaybookUpdateRequestBody(data);

  const response = data.assistantOperationId
    ? await apiClient.post<ApiResponse<Playbook>>(
        data.assistantOperationTarget === 'advisor_preview'
          ? API_ENDPOINTS.playbooks.intentConstructionApply(id, data.assistantOperationId)
          : API_ENDPOINTS.playbooks.intentConstructionCommit(id, data.assistantOperationId),
        body,
      )
    : await apiClient.patch<ApiResponse<Playbook>>(
        API_ENDPOINTS.playbooks.byId(id),
        body,
      );
  return normalizePlaybook(response.data.data);
}

export async function assessPlaybookIntentDesign(
  playbookId: string,
  data: RequestPlaybookIntentData,
): Promise<PlaybookIntentDesignResponse> {
  const response = await apiClient.post<ApiResponse<PlaybookIntentDesignResponse>>(
    API_ENDPOINTS.playbooks.intentDesign(playbookId),
    data,
    { timeout: 180000 },
  );
  return response.data.data;
}

export async function fetchPlaybookIntentTraces(
  playbookId: string,
): Promise<PlaybookIntentTraceResponse> {
  const response = await apiClient.get<ApiResponse<PlaybookIntentTraceResponse>>(
    API_ENDPOINTS.playbooks.intentTraces(playbookId),
  );
  return response.data.data;
}

export async function startPlaybookIntentConstruction(
  playbookId: string,
  data: RequestPlaybookIntentData,
  options?: { signal?: AbortSignal },
): Promise<PlaybookIntentConstructionStartResponse> {
  const response = await apiClient.post<ApiResponse<PlaybookIntentConstructionStartResponse>>(
    API_ENDPOINTS.playbooks.intentConstructions(playbookId),
    data,
    options?.signal ? { signal: options.signal } : undefined,
  );
  return response.data.data;
}

export async function runPlaybookAssistantTurn(
  playbookId: string,
  data: PlaybookAssistantTurnRequest,
): Promise<PlaybookAssistantTurnResponse> {
  const response = await apiClient.post<ApiResponse<PlaybookAssistantTurnResponse>>(
    API_ENDPOINTS.playbooks.assistantTurns(playbookId),
    data,
    { timeout: 180000 },
  );
  return response.data.data;
}

export async function getPlaybookAssistantMessages(
  playbookId: string,
  conversationId?: string,
): Promise<PlaybookAssistantHistory> {
  const response = await apiClient.get<ApiResponse<PlaybookAssistantHistory>>(
    API_ENDPOINTS.playbooks.assistantMessages(playbookId),
    conversationId ? { params: { conversationId } } : undefined,
  );
  return response.data.data;
}

export async function uploadPlaybookAssistantAttachment(
  playbookId: string,
  requestId: string,
  expectedDefinitionRevision: number,
  file: File,
): Promise<string> {
  const initialized = await apiClient.post<ApiResponse<PlaybookAssistantAttachmentUpload>>(
    API_ENDPOINTS.playbooks.assistantAttachments(playbookId),
    { requestId, expectedDefinitionRevision, mediaType: file.type, size: file.size },
  );
  const { attachmentId, uploadUrl } = initialized.data.data;
  const uploadResponse = await fetch(uploadUrl, { method: 'PUT', body: file });
  if (!uploadResponse.ok) throw new Error('Assistant image upload failed');
  await apiClient.post(
    API_ENDPOINTS.playbooks.assistantAttachmentConfirm(playbookId, attachmentId),
    {},
  );
  return attachmentId;
}

export async function fetchPlaybookIntentConstruction(playbookId: string, constructionId: string): Promise<PlaybookIntentConstructionStartResponse> {
  const response = await apiClient.get<ApiResponse<PlaybookIntentConstructionStartResponse>>(
    API_ENDPOINTS.playbooks.intentConstruction(playbookId, constructionId),
  );
  return response.data.data;
}

export async function startAdvisorRemediationConstruction(
  playbookId: string,
  data: AdvisorRemediationPreviewRequest & { selectedTaskId?: string; expectedDefinitionRevision: number },
): Promise<PlaybookIntentConstructionStartResponse> {
  const response = await apiClient.post<ApiResponse<PlaybookIntentConstructionStartResponse>>(
    API_ENDPOINTS.playbooks.advisorRemediationConstructions(playbookId),
    {
      executionId: data.executionId,
      selectedTaskId: data.selectedTaskId ?? data.targetTaskId,
      mode: data.mode,
      items: data.items,
      expectedDefinitionRevision: data.expectedDefinitionRevision,
    },
  );
  return response.data.data;
}

export async function discardPlaybookIntentConstruction(playbookId: string, constructionId: string): Promise<{ discarded: true }> {
  const response = await apiClient.post<ApiResponse<{ discarded: true }>>(
    API_ENDPOINTS.playbooks.intentConstructionDiscard(playbookId, constructionId),
    {},
  );
  return response.data.data;
}

export async function revertPlaybookIntentConstruction(playbookId: string, constructionId: string): Promise<Playbook> {
  const response = await apiClient.post<ApiResponse<Playbook>>(
    API_ENDPOINTS.playbooks.intentConstructionRevert(playbookId, constructionId),
    {},
  );
  return normalizePlaybook(response.data.data);
}

class ConstructionEventCallbackError extends Error {
  constructor(readonly originalError: unknown) {
    super('Construction event callback failed');
  }
}

export async function streamPlaybookIntentConstruction(
  playbookId: string,
  constructionId: string,
  options: { after?: number; signal?: AbortSignal; onEvent: (event: PlaybookIntentConstructionEvent) => void },
): Promise<void> {
  const token = localStorage.getItem(AUTH_STORAGE_KEYS.accessToken);
  let lastSequence = options.after ?? 0;
  let attempts = 0;

  while (!options.signal?.aborted) {
    const params = lastSequence > 0 ? `?after=${encodeURIComponent(String(lastSequence))}` : '';
    try {
      const response = await fetch(`${API_CONFIG.baseURL}${API_ENDPOINTS.playbooks.intentConstructionStream(playbookId, constructionId)}${params}`, {
        method: 'GET',
        headers: token ? { Authorization: `Bearer ${token}`, 'Last-Event-ID': String(lastSequence) } : { 'Last-Event-ID': String(lastSequence) },
        credentials: 'include',
        signal: options.signal,
      });
      if (!response.ok || !response.body) throw new Error(`Request failed with status ${response.status}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const flushBlock = (block: string) => {
        const event = parsePlaybookConstructionSseBlock(block);
        if (!event) return;
        if (event.sequence <= lastSequence) return;
        lastSequence = event.sequence;
        try {
          options.onEvent(event);
        } catch (error) {
          throw new ConstructionEventCallbackError(error);
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() ?? '';
        blocks.forEach(flushBlock);
      }
      buffer += decoder.decode();
      flushBlock(buffer);
      return;
    } catch (error) {
      if (options.signal?.aborted) throw error;
      if (error instanceof ConstructionEventCallbackError) throw error.originalError;
      attempts += 1;
      if (attempts >= 3) {
        throw new Error(error instanceof Error ? `Construction stream failed: ${error.message}` : 'Construction stream failed');
      }
      await new Promise((resolve) => setTimeout(resolve, attempts * 500));
    }
  }
}

export async function cancelPlaybookIntentConstruction(playbookId: string, constructionId: string): Promise<{ cancelled: boolean }> {
  const response = await apiClient.post<ApiResponse<{ cancelled: boolean }>>(
    API_ENDPOINTS.playbooks.cancelIntentConstruction(playbookId, constructionId),
    {},
  );
  return response.data.data;
}

export async function requestPlaybookNodeAdvisor(
  playbookId: string,
  taskId: string,
  data: RequestPlaybookNodeAdvisorData,
): Promise<PlaybookNodeAdvisorResponse> {
  const response = await apiClient.post<ApiResponse<PlaybookNodeAdvisorResponse>>(
    API_ENDPOINTS.playbooks.nodeAdvisor(playbookId, taskId),
    data,
  );
  return response.data.data;
}

export async function fetchAdvisorRemediations(
  playbookId: string,
  executionId: string,
  taskId?: string,
): Promise<AdvisorRemediationItem[]> {
  const params = taskId ? { taskId } : {};
  const response = await apiClient.get<ApiResponse<AdvisorRemediationItem[]>>(
    `${API_ENDPOINTS.playbooks.byId(playbookId)}/executions/${executionId}/advisor-remediations`,
    { params },
  );
  return response.data.data;
}

export async function previewAdvisorScriptReplacement(
  playbookId: string,
  data: AdvisorScriptReplacementRequest,
): Promise<AdvisorScriptReplacementPreviewResponse> {
  const response = await apiClient.post<ApiResponse<AdvisorScriptReplacementPreviewResponse>>(
    API_ENDPOINTS.playbooks.advisorScriptPreview(playbookId),
    data,
    { timeout: 180000 },
  );
  return response.data.data;
}

export async function applyAdvisorScriptReplacement(
  playbookId: string,
  data: AdvisorScriptReplacementApplyRequest,
): Promise<{ targetTaskId: string; scriptHash: string; definitionRevision: number }> {
  const response = await apiClient.post<ApiResponse<{ targetTaskId: string; scriptHash: string; definitionRevision: number }>>(
    API_ENDPOINTS.playbooks.advisorScriptApply(playbookId),
    data,
    { timeout: 180000 },
  );
  return response.data.data;
}

export async function reapplyOptimization(
  playbookId: string,
  executionId: string,
  taskId: string,
  historyIndex: number,
  direction: 'after' | 'before',
): Promise<Playbook> {
  const response = await apiClient.post<ApiResponse<Playbook>>(
    `${API_ENDPOINTS.playbooks.byId(playbookId)}/executions/${executionId}/tasks/${taskId}/reapply-optimization`,
    { historyIndex, direction },
  );
  return response.data.data;
}

export async function deletePlaybook(id: string): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.playbooks.byId(id));
}

export async function executePlaybook(
  id: string,
  data?: ExecutePlaybookData,
): Promise<{ executionId: string }> {
  const payload = buildExecutionRequestPayload(data);
  const response = await apiClient.post<ApiResponse<{ executionId: string }>>(
    API_ENDPOINTS.playbookFlows.execute(id),
    payload,
  );
  return response.data.data;
}

export async function fetchRecentPlaybookArtifacts(limit = 6): Promise<import('./types').RecentPlaybookArtifact[]> {
  const response = await apiClient.get<ApiResponse<import('./types').RecentPlaybookArtifact[]>>(
    API_ENDPOINTS.playbooks.recentArtifacts,
    { params: { limit } },
  );
  return response.data.data;
}

function buildExecutionRequestPayload(data?: ExecutePlaybookData): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (data?.singleStepTaskId) payload.singleStepTaskId = data.singleStepTaskId;
  if (data?.executionMode) payload.executionMode = data.executionMode;
  if (data?.stepExecutionModes && Object.keys(data.stepExecutionModes).length > 0) payload.stepExecutionModes = data.stepExecutionModes;
  if (data?.advisorAutopilotEnabled !== undefined) payload.advisorAutopilotEnabled = data.advisorAutopilotEnabled;
  if (data?.advisorAutopilotTargetScore !== undefined) payload.advisorAutopilotTargetScore = data.advisorAutopilotTargetScore;
  if (data?.advisorAutopilotMaxTurns !== undefined) payload.advisorAutopilotMaxTurns = data.advisorAutopilotMaxTurns;
  if (data?.runNodeReflection !== undefined) payload.reflectionEnabled = data.runNodeReflection;
  if (data?.advisorScoringMode !== undefined) payload.advisorScoringMode = data.advisorScoringMode;
  if (data?.modelIdOverride) payload.modelIdOverride = data.modelIdOverride;
  return payload;
}

export async function getPlaybookIntegrationToken(id: string): Promise<{ token: string }> {
  const response = await apiClient.post<ApiResponse<{ token: string }>>(
    API_ENDPOINTS.playbooks.integrationLink(id),
  );
  return response.data.data;
}

export async function resumePlaybook(
  id: string,
  data: ResumePlaybookData,
): Promise<{ status: string }> {
  const response = await apiClient.post<ApiResponse<{ status: string }>>(
    API_ENDPOINTS.playbooks.resume(id),
    data,
  );
  return response.data.data;
}

export async function stopPlaybook(
  id: string,
  data: { executionId: string },
): Promise<{ status: string }> {
  const response = await apiClient.post<ApiResponse<{ status: string }>>(
    API_ENDPOINTS.playbooks.stop(id),
    data,
  );
  return response.data.data;
}

export async function skipPlaybookStep(
  id: string,
  data: { executionId: string; taskId: string },
): Promise<{ status: string }> {
  const response = await apiClient.post<ApiResponse<{ status: string }>>(
    API_ENDPOINTS.playbooks.skipStep(id),
    data,
  );
  return response.data.data;
}

export async function rerunPlaybookStep(
  playbookId: string,
  executionId: string,
  data: RerunStepData,
): Promise<{ status: string; executionId: string }> {
  const response = await apiClient.post<ApiResponse<{ status: string; executionId: string }>>(
    API_ENDPOINTS.playbooks.rerunStep(playbookId, executionId),
    data,
  );
  return response.data.data;
}

export async function runPlaybookFromStep(
  playbookId: string,
  executionId: string,
  data: { taskId: string; iteration?: number },
): Promise<{ executionId: string }> {
  const response = await apiClient.post<ApiResponse<{ executionId: string }>>(
    API_ENDPOINTS.playbooks.runFromStep(playbookId, executionId),
    data,
  );
  return response.data.data;
}

export async function resumePlaybookFromStep(
  playbookId: string,
  executionId: string,
  data: {
    taskId: string;
    streaming?: boolean;
    action?: 'reply' | 'approve' | 'reject' | 'skip';
    interruptId?: string;
    iteration?: number;
    message?: string;
    approved?: boolean;
    reason?: string;
    feedback?: string;
    scope?: HitlFeedbackScope;
    remember?: boolean;
    payload?: Record<string, unknown>;
  },
): Promise<{ status: string; executionId: string }> {
  const response = await apiClient.post<ApiResponse<{ status: string; executionId: string }>>(
    API_ENDPOINTS.playbooks.resumeFromStep(playbookId, executionId),
    data,
  );
  return response.data.data;
}

export async function getHitlPolicy(playbookId: string): Promise<HitlPolicy> {
  const response = await apiClient.get<ApiResponse<HitlPolicy>>(API_ENDPOINTS.playbooks.hitlPolicy(playbookId));
  return response.data.data;
}

export async function updateHitlPolicy(playbookId: string, data: Partial<HitlPolicy>): Promise<HitlPolicy> {
  const response = await apiClient.patch<ApiResponse<HitlPolicy>>(API_ENDPOINTS.playbooks.hitlPolicy(playbookId), data);
  return response.data.data;
}

export async function getNodeHitlPolicy(playbookId: string, nodeId: string): Promise<HitlPolicy> {
  const response = await apiClient.get<ApiResponse<HitlPolicy>>(API_ENDPOINTS.playbooks.hitlNodePolicy(playbookId, nodeId));
  return response.data.data;
}

export async function updateNodeHitlPolicy(playbookId: string, nodeId: string, data: Partial<HitlPolicy>): Promise<HitlPolicy> {
  const response = await apiClient.patch<ApiResponse<HitlPolicy>>(API_ENDPOINTS.playbooks.hitlNodePolicy(playbookId, nodeId), data);
  return response.data.data;
}

export async function getHitlBlockers(playbookId: string): Promise<HitlBlockerRule[]> {
  const response = await apiClient.get<ApiResponse<HitlBlockerRule[]>>(API_ENDPOINTS.playbooks.hitlBlockers(playbookId));
  return response.data.data;
}

export async function createHitlBlocker(
  playbookId: string,
  data: Omit<Partial<HitlBlockerRule>, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'> & Pick<HitlBlockerRule, 'kind' | 'label' | 'description' | 'action'>,
): Promise<HitlBlockerRule> {
  const response = await apiClient.post<ApiResponse<HitlBlockerRule>>(API_ENDPOINTS.playbooks.hitlBlockers(playbookId), data);
  return response.data.data;
}

export async function normalizeHitlBlocker(
  playbookId: string,
  data: { description: string; nodeId?: string | null },
): Promise<Partial<HitlBlockerRule>> {
  const response = await apiClient.post<ApiResponse<Partial<HitlBlockerRule>>>(API_ENDPOINTS.playbooks.hitlBlockerNormalize(playbookId), data);
  return response.data.data;
}

export async function updateHitlBlocker(
  playbookId: string,
  blockerId: string,
  data: Partial<HitlBlockerRule>,
): Promise<HitlBlockerRule> {
  const response = await apiClient.patch<ApiResponse<HitlBlockerRule>>(API_ENDPOINTS.playbooks.hitlBlocker(playbookId, blockerId), data);
  return response.data.data;
}

export async function deleteHitlBlocker(playbookId: string, blockerId: string): Promise<{ deleted: true }> {
  const response = await apiClient.delete<ApiResponse<{ deleted: true }>>(API_ENDPOINTS.playbooks.hitlBlocker(playbookId, blockerId));
  return response.data.data;
}

export async function getHitlMemories(playbookId: string): Promise<HitlMemory[]> {
  const response = await apiClient.get<ApiResponse<HitlMemory[]>>(API_ENDPOINTS.playbooks.hitlMemories(playbookId));
  return response.data.data;
}

export async function saveHitlMemory(
  playbookId: string,
  data: Omit<Partial<HitlMemory>, 'id' | 'ownerId' | 'flowId' | 'createdAt' | 'updatedAt'> & Pick<HitlMemory, 'title' | 'content' | 'normalizedInstruction'>,
): Promise<HitlMemory> {
  const response = await apiClient.post<ApiResponse<HitlMemory>>(API_ENDPOINTS.playbooks.hitlMemories(playbookId), data);
  return response.data.data;
}

export async function getHitlEvents(executionId: string): Promise<HitlEventLog[]> {
  const response = await apiClient.get<ApiResponse<HitlEventLog[]>>(API_ENDPOINTS.playbooks.hitlEvents(executionId));
  return response.data.data;
}

export async function getPendingHitlInterrupt(executionId: string): Promise<Record<string, unknown> | null> {
  const response = await apiClient.get<ApiResponse<Record<string, unknown> | null>>(API_ENDPOINTS.playbooks.hitlPending(executionId));
  return response.data.data;
}

export async function resumeHitlInterrupt(
  executionId: string,
  interruptId: string,
  data: {
    action?: 'reply' | 'approve' | 'reject' | 'skip';
    message?: string;
    reason?: string;
    feedback?: string;
    scope?: HitlFeedbackScope;
    remember?: boolean;
    payload?: Record<string, unknown>;
  },
): Promise<{ status: string; executionId: string }> {
  const response = await apiClient.post<ApiResponse<{ status: string; executionId: string }>>(
    API_ENDPOINTS.playbooks.hitlResume(executionId, interruptId),
    data,
  );
  return response.data.data;
}

export async function disableHitlBlocker(executionId: string, interruptId: string): Promise<{ disabled: boolean }> {
  const response = await apiClient.post<ApiResponse<{ disabled: boolean }>>(API_ENDPOINTS.playbooks.hitlDisableBlocker(executionId, interruptId));
  return response.data.data;
}

export async function validateTaskReplay(
  playbookId: string,
  taskId: string,
  data: ValidateTaskReplayData,
): Promise<ValidatedTaskReplay> {
  const response = await apiClient.post<ApiResponse<ValidatedTaskReplay>>(
    API_ENDPOINTS.playbooks.validateReplay(playbookId, taskId),
    sanitizeValidateReplayData(data),
  );
  return normalizeValidatedTaskReplay(response.data.data);
}

export async function getTaskReplays(
  playbookId: string,
  taskId: string,
): Promise<ValidatedTaskReplay[]> {
  const response = await apiClient.get<ApiResponse<ValidatedTaskReplay[]>>(
    API_ENDPOINTS.playbooks.replays(playbookId, taskId),
  );
  return response.data.data.map(normalizeValidatedTaskReplay);
}

export async function activateTaskReplay(
  playbookId: string,
  taskId: string,
  replayId: string,
): Promise<ValidatedTaskReplay> {
  const response = await apiClient.post<ApiResponse<ValidatedTaskReplay>>(
    API_ENDPOINTS.playbooks.activateReplay(playbookId, taskId, replayId),
  );
  return normalizeValidatedTaskReplay(response.data.data);
}

export async function updateTaskReplayFormatGuide(
  playbookId: string,
  taskId: string,
  replayId: string,
  data: UpdateTaskReplayFormatData,
): Promise<ValidatedTaskReplay> {
  const response = await apiClient.patch<ApiResponse<ValidatedTaskReplay>>(
    API_ENDPOINTS.playbooks.updateReplayFormatGuide(playbookId, taskId, replayId),
    data,
  );
  return normalizeValidatedTaskReplay(response.data.data);
}

export async function updateTaskReplayLabel(
  playbookId: string,
  taskId: string,
  replayId: string,
  label: string | null,
): Promise<ValidatedTaskReplay> {
  const response = await apiClient.patch<ApiResponse<ValidatedTaskReplay>>(
    API_ENDPOINTS.playbooks.updateReplayLabel(playbookId, taskId, replayId),
    { label },
  );
  return normalizeValidatedTaskReplay(response.data.data);
}

export async function deleteTaskReplay(
  playbookId: string,
  taskId: string,
  replayId: string,
): Promise<{ removed: boolean; wasActive: boolean }> {
  const response = await apiClient.delete<ApiResponse<{ removed: boolean; wasActive: boolean }>>(
    API_ENDPOINTS.playbooks.deleteReplay(playbookId, taskId, replayId),
  );
  return response.data.data;
}

export async function getReplayReports(
  playbookId: string,
  taskId: string,
  query?: { executionId?: string; iteration?: number; limit?: number; offset?: number },
): Promise<import('./types').ReplayRunReport[]> {
  const response = await apiClient.get<ApiResponse<import('./types').ReplayRunReport[]>>(
    API_ENDPOINTS.playbookFlows.replayReports(playbookId, taskId),
    { params: query ?? {} },
  );
  return response.data.data;
}

export async function grabOutputFormatTemplate(
  playbookId: string,
  taskId: string,
  data: GrabOutputFormatTemplateData,
): Promise<OutputFormatTemplate> {
  const response = await apiClient.post<ApiResponse<OutputFormatTemplate>>(
    API_ENDPOINTS.playbooks.grabOutputFormatTemplate(playbookId, taskId),
    data,
  );
  return response.data.data;
}

export async function getOutputFormatTemplate(
  playbookId: string,
  taskId: string,
): Promise<OutputFormatTemplate | null> {
  const response = await apiClient.get<ApiResponse<OutputFormatTemplate | null>>(
    API_ENDPOINTS.playbooks.outputFormatTemplate(playbookId, taskId),
  );
  return response.data.data;
}

export async function updateOutputFormatTemplate(
  playbookId: string,
  taskId: string,
  data: UpdateOutputFormatTemplateData,
): Promise<OutputFormatTemplate> {
  const response = await apiClient.patch<ApiResponse<OutputFormatTemplate>>(
    API_ENDPOINTS.playbooks.outputFormatTemplate(playbookId, taskId),
    data,
  );
  return response.data.data;
}

export async function getEvaluationExecutions(playbookId: string, taskId?: string): Promise<PlaybookEvaluationExecution[]> {
  const response = await apiClient.get<ApiResponse<PlaybookEvaluationExecution[]>>(
    `${API_ENDPOINTS.playbooks.byId(playbookId)}/evaluations`,
    { params: taskId ? { taskId } : {} },
  );
  return response.data.data;
}

export async function getEvaluationBaseline(playbookId: string, taskId: string): Promise<PlaybookEvaluationBaseline | null> {
  const response = await apiClient.get<ApiResponse<PlaybookEvaluationBaseline | null>>(
    `${API_ENDPOINTS.playbooks.byId(playbookId)}/evaluation-tasks/${taskId}/baseline`,
  );
  return response.data.data;
}

export async function createEvaluationBaselineFromExecution(playbookId: string, taskId: string, executionId: string): Promise<PlaybookEvaluationBaseline> {
  const response = await apiClient.post<ApiResponse<PlaybookEvaluationBaseline>>(
    `${API_ENDPOINTS.playbooks.byId(playbookId)}/evaluation-tasks/${taskId}/baseline/from-execution`,
    { executionId },
  );
  return response.data.data;
}

export async function createEvaluationBaselineFromCurrentExecution(
  playbookId: string,
  taskId: string,
  executionId: string,
  evaluationExecutionId: string,
): Promise<PlaybookEvaluationBaseline> {
  const response = await apiClient.post<ApiResponse<PlaybookEvaluationBaseline>>(
    `${API_ENDPOINTS.playbooks.byId(playbookId)}/evaluation-tasks/${taskId}/baseline/from-current-execution`,
    { executionId, evaluationExecutionId },
  );
  return response.data.data;
}

export async function deleteOutputFormatTemplate(
  playbookId: string,
  taskId: string,
): Promise<{ removed: boolean }> {
  const response = await apiClient.delete<ApiResponse<{ removed: boolean }>>(
    API_ENDPOINTS.playbooks.outputFormatTemplate(playbookId, taskId),
  );
  return response.data.data;
}

export async function designPlaybook(
  id: string,
  data: DesignPlaybookData,
): Promise<{ playbook: Playbook | null; message: DesignMessage }> {
  const response = await apiClient.post<ApiResponse<{ playbook: Playbook | null; message: DesignMessage }>>(
    API_ENDPOINTS.playbooks.design(id),
    data,
  );
  return response.data.data;
}

export async function getDesignMessages(id: string): Promise<DesignMessage[]> {
  const response = await apiClient.get<ApiResponse<DesignMessage[]>>(
    API_ENDPOINTS.playbooks.designMessages(id),
  );
  return response.data.data;
}

export async function appendDesignMessage(
  id: string,
  data: { userQuery: string; aiSummary: string; status?: 'completed' | 'failed'; error?: string | null },
): Promise<DesignMessage> {
  const response = await apiClient.post<ApiResponse<DesignMessage>>(
    API_ENDPOINTS.playbooks.designMessages(id),
    data,
  );
  return response.data.data;
}

export async function clearDesignMessages(id: string): Promise<ClearDesignMessagesResult> {
  const response = await apiClient.delete<ApiResponse<ClearDesignMessagesResult>>(
    API_ENDPOINTS.playbooks.clearDesignMessages(id),
  );
  return response.data.data;
}

export async function revertToSnapshot(
  id: string,
  msgId: string,
): Promise<{ playbook: Playbook; message: DesignMessage }> {
  const response = await apiClient.post<ApiResponse<{ playbook: Playbook; message: DesignMessage }>>(
    API_ENDPOINTS.playbooks.revertDesign(id, msgId),
  );
  return response.data.data;
}

export async function getExecutions(
  playbookId: string,
  query?: Record<string, unknown>,
): Promise<{ executions: PlaybookExecutionSummary[]; pagination: PaginatedResponse<PlaybookExecutionSummary>['pagination'] }> {
  const response = await apiClient.get<
    ApiResponse<{ items?: any[]; executions?: any[]; pagination: PaginatedResponse<PlaybookExecutionSummary>['pagination'] }>
  >(API_ENDPOINTS.playbooks.executions(playbookId), { params: query });
  const items = response.data.data.items ?? response.data.data.executions ?? [];
  const { pagination } = response.data.data;
  return {
    executions: items.map((item, index) => normalizeExecutionSummary(item, index, pagination)),
    pagination,
  };
}

export async function getExecution(
  _playbookId: string,
  executionId: string,
): Promise<PlaybookExecution> {
  const response = await apiClient.get<ApiResponse<any>>(
    API_ENDPOINTS.playbookFlows.executionDetail(executionId),
  );
  return normalizeExecution(response.data.data);
}

export async function runAdvisorEvaluation(
  executionId: string,
  taskId: string,
  iteration?: number,
  advisorScoringMode?: AdvisorScoringMode,
): Promise<RunAdvisorEvaluationResponse> {
  const payload = {
    ...(iteration !== undefined ? { iteration } : {}),
    ...(advisorScoringMode !== undefined ? { advisorScoringMode } : {}),
  };
  const response = await apiClient.post<ApiResponse<any>>(
    API_ENDPOINTS.playbookFlows.runAdvisorEvaluation(executionId, taskId),
    Object.keys(payload).length > 0 ? payload : undefined,
  );
  const data = response.data.data;
  const hasJudgeSummaryStatus = Object.prototype.hasOwnProperty.call(data, 'judgeSummaryStatus');
  const hasJudgeSummary = Object.prototype.hasOwnProperty.call(data, 'judgeSummary');
  return {
    executionId: toNullableString(data.executionId) ?? executionId,
    taskId: toNullableString(data.taskId) ?? taskId,
    taskResult: normalizeTaskResult(data.taskResult ?? {}, 0),
    ...(hasJudgeSummaryStatus ? { judgeSummaryStatus: data.judgeSummaryStatus ?? 'idle' } : {}),
    ...(hasJudgeSummary ? { judgeSummary: data.judgeSummary ?? null } : {}),
  };
}

export async function deleteExecution(
  playbookId: string,
  executionId: string,
): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.playbooks.deleteExecution(playbookId, executionId));
}

export async function deleteStepExecution(
  playbookId: string,
  executionId: string,
  taskId: string,
  stepExecutionId: string,
): Promise<void> {
  await apiClient.delete(
    API_ENDPOINTS.playbooks.deleteStepExecution(playbookId, executionId, taskId, stepExecutionId),
  );
}

export async function deleteAllExecutions(
  playbookId: string,
): Promise<{ deleted: number; kept: number }> {
  const response = await apiClient.delete<ApiResponse<{ deleted: number; kept: number }>>(
    API_ENDPOINTS.playbooks.deleteAllExecutions(playbookId),
  );
  return response.data.data;
}

export async function toggleFavorite(id: string): Promise<{ isFavorite: boolean }> {
  const response = await apiClient.post<ApiResponse<{ isFavorite: boolean }>>(
    API_ENDPOINTS.playbooks.favorite(id),
  );
  return response.data.data;
}

export async function bulkDeletePlaybooks(ids: string[]): Promise<{ deleted: number }> {
  const response = await apiClient.post<ApiResponse<{ deleted: number }>>(
    API_ENDPOINTS.playbooks.bulkDelete,
    { ids },
  );
  return response.data.data;
}

export async function getActiveExecutions(): Promise<PlaybookExecution[]> {
  const response = await apiClient.get<ApiResponse<any[]>>(
    API_ENDPOINTS.playbooks.activeExecutions,
  );
  return Array.isArray(response.data.data) ? response.data.data.map(normalizeExecution) : [];
}

export async function upsertPlaybookTriggerSchedule(
  playbookId: string,
  data: UpsertPlaybookScheduleData,
): Promise<Playbook> {
  const response = await apiClient.put<ApiResponse<Playbook>>(
    API_ENDPOINTS.playbooks.triggerSchedule(playbookId),
    data,
  );
  return normalizePlaybook(response.data.data);
}

export async function clearPlaybookTriggerSchedule(playbookId: string): Promise<Playbook> {
  const response = await apiClient.delete<ApiResponse<Playbook>>(
    API_ENDPOINTS.playbooks.triggerSchedule(playbookId),
  );
  return normalizePlaybook(response.data.data);
}

export async function getPlaybookTriggers(playbookId: string): Promise<PlaybookTriggersData> {
  const response = await apiClient.get<ApiResponse<PlaybookTriggersData>>(
    API_ENDPOINTS.playbooks.triggers(playbookId),
  );
  return response.data.data;
}

export async function upsertPlaybookTriggerMail(
  playbookId: string,
  data: UpsertPlaybookMailTriggerData,
): Promise<Playbook> {
  const response = await apiClient.put<ApiResponse<Playbook>>(
    API_ENDPOINTS.playbooks.triggerMail(playbookId),
    data,
  );
  return normalizePlaybook(response.data.data);
}

export async function clearPlaybookTriggerMail(playbookId: string): Promise<Playbook> {
  const response = await apiClient.delete<ApiResponse<Playbook>>(
    API_ENDPOINTS.playbooks.triggerMail(playbookId),
  );
  return normalizePlaybook(response.data.data);
}

export async function syncPlaybookTriggerMailSubscription(
  playbookId: string,
  data: SyncPlaybookMailSubscriptionData,
): Promise<Record<string, unknown>> {
  const response = await apiClient.post<ApiResponse<Record<string, unknown>>>(
    API_ENDPOINTS.playbooks.syncMailSubscription(playbookId),
    data,
  );
  return response.data.data;
}

export async function cloneSharePlaybook(
  id: string,
  emails: string[],
): Promise<CloneShareResult> {
  const response = await apiClient.post<ApiResponse<CloneShareResult>>(
    API_ENDPOINTS.playbooks.cloneShare(id),
    { emails },
  );
  return response.data.data;
}

export async function sharePlaybook(
  id: string,
  emails: string[],
  permission: AssignablePlaybookPermission,
): Promise<PlaybookShareEntry[]> {
  const response = await apiClient.post<ApiResponse<PlaybookShareEntry[]>>(
    API_ENDPOINTS.playbooks.shares(id),
    { emails, permission },
  );
  return response.data.data;
}

export async function getPlaybookShares(id: string): Promise<PlaybookShareEntry[]> {
  const response = await apiClient.get<ApiResponse<PlaybookShareEntry[]>>(
    API_ENDPOINTS.playbooks.shares(id),
  );
  return response.data.data;
}

export async function updatePlaybookSharePermission(
  id: string,
  shareId: string,
  permission: AssignablePlaybookPermission,
): Promise<PlaybookShareEntry> {
  const response = await apiClient.patch<ApiResponse<PlaybookShareEntry>>(
    API_ENDPOINTS.playbooks.share(id, shareId),
    { permission },
  );
  return response.data.data;
}

export async function revokePlaybookShare(id: string, shareId: string): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.playbooks.share(id, shareId));
}

export async function clonePlaybook(id: string): Promise<Playbook> {
  const response = await apiClient.post<ApiResponse<Playbook>>(
    API_ENDPOINTS.playbooks.clone(id),
  );
  return normalizePlaybook(response.data.data);
}

export async function getPlaybookNodeTemplates(): Promise<{ items: Array<{
  id: string;
  key: string;
  nodeType: 'agent' | 'action' | 'evaluation' | 'iterator';
  title: string;
  description?: string;
  icon?: string;
  color?: string;
  category: string;
  inputPorts: Array<{ id: string; name: string; artifactKind: string; required?: boolean; description?: string }>;
  outputPorts: Array<{ id: string; name: string; artifactKind: string; description?: string }>;
  promptTemplate: string;
  recommendedAgentTypeSlug: string | null;
  requiredToolNames: string[];
  assignedAgentId?: string | null;
  selectedAction?: string | null;
  iteratorConfig?: PlaybookIteratorConfig | null;
}> }> {
  const response = await apiClient.get<ApiResponse<{ items: Array<{
    id: string;
    key: string;
    nodeType: 'agent' | 'action' | 'evaluation' | 'iterator';
    title: string;
    description?: string;
    icon?: string;
    color?: string;
    category: string;
    inputPorts: Array<{ id: string; name: string; artifactKind: string; required?: boolean; description?: string }>;
    outputPorts: Array<{ id: string; name: string; artifactKind: string; description?: string }>;
    promptTemplate: string;
    recommendedAgentTypeSlug: string | null;
    requiredToolNames: string[];
    assignedAgentId?: string | null;
    selectedAction?: string | null;
    iteratorConfig?: PlaybookIteratorConfig | null;
  }> }>>(
    API_ENDPOINTS.playbookNodeTemplates.list,
  );
  return response.data.data;
}

export async function deleteEvaluationBaseline(playbookId: string, taskId: string): Promise<{ removed: boolean }> {
  const response = await apiClient.delete<ApiResponse<{ removed: boolean }>>(
    API_ENDPOINTS.playbooks.evaluationBaseline(playbookId, taskId),
  );
  return response.data.data;
}

export async function getPlaybookRepeatability(
  playbookId: string,
  limit = 5,
  offset = 0,
): Promise<PlaybookRepeatabilitySummary> {
  const response = await apiClient.get<ApiResponse<PlaybookRepeatabilitySummary>>(
    API_ENDPOINTS.playbooks.repeatability(playbookId),
    { params: { limit, offset } },
  );
  return response.data.data;
}

export async function getTaskRepeatability(
  playbookId: string,
  taskId: string,
  limit = 5,
): Promise<RepeatabilityTaskExecutionSummary[]> {
  const response = await apiClient.get<ApiResponse<RepeatabilityTaskExecutionSummary[]>>(
    API_ENDPOINTS.playbooks.repeatabilityTask(playbookId, taskId),
    { params: { limit } },
  );
  return response.data.data;
}

// ===== Phase 4: Flow API Functions =====

export async function getFlows(
  query?: PlaybookQueryParams,
): Promise<{ flows: FlowSummary[]; pagination: PaginatedResponse<FlowSummary>['pagination'] }> {
  const response = await apiClient.get<
    ApiResponse<{ items: any[]; pagination: PaginatedResponse<FlowSummary>['pagination'] }>
  >(API_ENDPOINTS.playbookFlows.list, { params: query });
  const { items, pagination } = response.data.data;
  return { flows: items, pagination };
}

export async function getFlow(id: string, options?: { view?: 'base' | 'enriched' }): Promise<Playbook> {
  const response = await apiClient.get<ApiResponse<any>>(
    API_ENDPOINTS.playbookFlows.byId(id),
    { params: options?.view ? { view: options.view } : undefined },
  );
  return normalizePlaybook(response.data.data);
}

export async function getPlaybookInputContract(id: string): Promise<import('./types').PlaybookInputContract> {
  const response = await apiClient.get<ApiResponse<import('./types').PlaybookInputContract>>(
    API_ENDPOINTS.playbookFlows.inputContract(id),
  );
  return response.data.data;
}

export async function createFlow(data: CreateFlowData): Promise<Flow> {
  const response = await apiClient.post<ApiResponse<Flow>>(
    API_ENDPOINTS.playbookFlows.list,
    data,
  );
  return response.data.data;
}

export async function updateFlow(id: string, data: UpdateFlowData, idempotencyKey?: string): Promise<Flow> {
  const response = await apiClient.patch<ApiResponse<Flow>>(
    API_ENDPOINTS.playbookFlows.byId(id),
    data,
    idempotencyKey
      ? { headers: { 'Idempotency-Key': idempotencyKey } }
      : undefined,
  );
  return response.data.data;
}

export async function patchFlowDelta(
  id: string,
  data: PatchPlaybookFlowDeltaData,
  idempotencyKey?: string,
): Promise<PatchPlaybookFlowDeltaResult> {
  const response = await apiClient.patch<ApiResponse<PatchPlaybookFlowDeltaResult>>(
    API_ENDPOINTS.playbookFlows.delta(id),
    data,
    idempotencyKey
      ? { headers: { 'Idempotency-Key': idempotencyKey } }
      : undefined,
  );
  return response.data.data;
}

export async function deleteFlow(id: string): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.playbookFlows.byId(id));
}

export async function startFlowExecution(
  flowId: string,
  inputContext?: Record<string, unknown>,
  idempotencyKey?: string,
  options?: ExecutePlaybookData,
): Promise<{ executionId: string }> {
  const response = await apiClient.post<ApiResponse<{ executionId: string }>>(
    API_ENDPOINTS.playbookFlows.execute(flowId),
    {
      inputContext,
      ...buildExecutionRequestPayload(options),
    },
    idempotencyKey
      ? { headers: { 'Idempotency-Key': idempotencyKey } }
      : undefined,
  );
  return response.data.data;
}

export async function getFlowExecutions(
  flowId: string,
  page?: number,
  limit?: number,
): Promise<{ executions: PlaybookExecution[]; pagination: PaginatedResponse<PlaybookExecution>['pagination'] }> {
  const response = await apiClient.get<
    ApiResponse<{ executions: PlaybookExecution[]; pagination: PaginatedResponse<PlaybookExecution>['pagination'] }>
  >(API_ENDPOINTS.playbookFlows.executions(flowId), { params: { page, limit } });
  return response.data.data;
}

export async function getFlowExecutionDetail(executionId: string): Promise<PlaybookExecution> {
  const response = await apiClient.get<ApiResponse<PlaybookExecution>>(
    API_ENDPOINTS.playbookFlows.executionDetail(executionId),
  );
  return response.data.data;
}

export async function cancelFlowExecution(executionId: string): Promise<void> {
  await apiClient.post(API_ENDPOINTS.playbookFlows.cancelExecution(executionId));
}

export async function resumeFlowApproval(
  executionId: string,
  decision: string,
  payload?: Record<string, unknown>,
): Promise<void> {
  await apiClient.post(API_ENDPOINTS.playbookFlows.resumeApproval(executionId), {
    decision,
    payload,
  });
}

export async function getFlowRouterDecisions(
  executionId: string,
): Promise<Array<{ nodeId: string; label: string; iteration: number }>> {
  const response = await apiClient.get<
    ApiResponse<Array<{ nodeId: string; label: string; iteration: number }>>
  >(API_ENDPOINTS.playbookFlows.routerDecisions(executionId));
  return response.data.data;
}

export async function getFlowNodeTemplates(): Promise<{
  items: TaskTemplate[];
}> {
  const response = await apiClient.get<ApiResponse<{ items: TaskTemplate[] }>>(
    API_ENDPOINTS.playbookFlowTemplates.list,
  );
  return response.data.data;
}

export async function getFlowNodeTemplatesEnabled(): Promise<{
  items: TaskTemplate[];
}> {
  const response = await apiClient.get<ApiResponse<{ items: TaskTemplate[] }>>(
    API_ENDPOINTS.playbookFlowTemplates.enabled,
  );
  return response.data.data;
}

export async function getFlowNodeKinds(): Promise<{
  kinds: Array<{ kind: string; label: string }>;
}> {
  const response = await apiClient.get<ApiResponse<{ kinds: Array<{ kind: string; label: string }> }>>(
    API_ENDPOINTS.playbookFlowTemplates.nodeKinds,
  );
  return response.data.data;
}

export async function createFlowNodeTemplate(data: Partial<TaskTemplate>): Promise<TaskTemplate> {
  const response = await apiClient.post<ApiResponse<TaskTemplate>>(
    API_ENDPOINTS.playbookFlowTemplates.list,
    data,
  );
  return response.data.data;
}

export async function updateFlowNodeTemplate(id: string, data: Partial<TaskTemplate>): Promise<TaskTemplate> {
  const response = await apiClient.patch<ApiResponse<TaskTemplate>>(
    API_ENDPOINTS.playbookFlowTemplates.byId(id),
    data,
  );
  return response.data.data;
}

export async function deleteFlowNodeTemplate(id: string): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.playbookFlowTemplates.byId(id));
}

export async function traceReplayExecution(executionId: string): Promise<Array<Record<string, unknown>>> {
  const response = await apiClient.post<ApiResponse<Array<Record<string, unknown>>>>(
    API_ENDPOINTS.playbookFlows.traceReplay(executionId),
  );
  return response.data.data;
}

export async function reExecuteExecution(
  executionId: string,
): Promise<{ executionId: string; divergenceWarning: boolean }> {
  const response = await apiClient.post<ApiResponse<{ executionId: string; divergenceWarning: boolean }>>(
    API_ENDPOINTS.playbookFlows.reExecute(executionId),
  );
  return response.data.data;
}

export async function getFlowEvaluationExecutions(flowId: string, taskId?: string): Promise<any[]> {
  const response = await apiClient.get<ApiResponse<any[]>>(
    API_ENDPOINTS.playbookFlows.evaluations(flowId),
    { params: taskId ? { taskId } : undefined },
  );
  return response.data.data;
}

export async function getFlowEvaluationBaseline(flowId: string, taskId: string): Promise<any> {
  const response = await apiClient.get<ApiResponse<any>>(
    API_ENDPOINTS.playbookFlows.evaluationBaseline(flowId, taskId),
  );
  return response.data.data;
}

export async function createFlowEvaluationBaselineFromExecution(
  flowId: string, taskId: string, executionId: string, iteration?: number,
): Promise<any> {
  const response = await apiClient.post<ApiResponse<any>>(
    API_ENDPOINTS.playbookFlows.evaluationBaselineFromExecution(flowId, taskId),
    { executionId, iteration },
  );
  return response.data.data;
}

export async function createFlowEvaluationBaselineFromCurrentExecution(
  flowId: string, taskId: string, executionId: string, evaluationExecutionId: string, iteration?: number,
): Promise<any> {
  const response = await apiClient.post<ApiResponse<any>>(
    API_ENDPOINTS.playbookFlows.evaluationBaselineFromCurrentExecution(flowId, taskId),
    { executionId, evaluationExecutionId, iteration },
  );
  return response.data.data;
}

export async function deleteFlowEvaluationBaseline(flowId: string, taskId: string): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.playbookFlows.deleteEvaluationBaseline(flowId, taskId));
}

export async function getFlowRepeatability(flowId: string): Promise<any> {
  const response = await apiClient.get<ApiResponse<any>>(
    API_ENDPOINTS.playbookFlows.repeatability(flowId),
  );
  return response.data.data;
}

export async function getFlowTaskRepeatability(flowId: string, taskId: string): Promise<any> {
  const response = await apiClient.get<ApiResponse<any>>(
    API_ENDPOINTS.playbookFlows.repeatabilityTask(flowId, taskId),
  );
  return response.data.data;
}

export async function getFlowTriggers(flowId: string): Promise<any> {
  const response = await apiClient.get<ApiResponse<any>>(
    API_ENDPOINTS.playbookFlows.triggers(flowId),
  );
  return response.data.data;
}

export async function upsertFlowTriggerSchedule(flowId: string, data: Record<string, unknown>): Promise<any> {
  const response = await apiClient.patch<ApiResponse<any>>(
    API_ENDPOINTS.playbookFlows.triggerSchedule(flowId),
    data,
  );
  return response.data.data;
}

export async function upsertFlowTriggerMail(flowId: string, data: Record<string, unknown>): Promise<any> {
  const response = await apiClient.patch<ApiResponse<any>>(
    API_ENDPOINTS.playbookFlows.triggerMail(flowId),
    data,
  );
  return response.data.data;
}

export async function syncFlowMailSubscription(flowId: string, data: Record<string, unknown>): Promise<any> {
  const response = await apiClient.post<ApiResponse<any>>(
    API_ENDPOINTS.playbookFlows.syncMailSubscription(flowId),
    data,
  );
  return response.data.data;
}

// ===== Phase 6c: Additional Flow API Functions =====

export async function generateFlow(data: { name: string; prompt: string; workspaceIds?: string[] }): Promise<{ id: string }> {
  const response = await apiClient.post<ApiResponse<{ id: string }>>(
    API_ENDPOINTS.playbookFlows.generate,
    data,
  );
  return response.data.data;
}

export async function rewriteFlowPrompt(data: { prompt: string }): Promise<{ prompt: string }> {
  const response = await apiClient.post<ApiResponse<{ prompt: string }>>(
    API_ENDPOINTS.playbookFlows.rewritePrompt,
    data,
  );
  return response.data.data;
}

export async function designFlow(id: string, data: { query: string }): Promise<any> {
  const response = await apiClient.post<ApiResponse<any>>(
    API_ENDPOINTS.playbookFlows.design(id),
    data,
  );
  return response.data.data;
}

export async function startDesignOperation(
  id: string,
  data: { query: string; idempotencyKey?: string },
): Promise<DesignOperation> {
  const response = await apiClient.post<ApiResponse<DesignOperation>>(
    API_ENDPOINTS.playbookFlows.designOperations(id),
    data,
  );
  return response.data.data;
}

export async function getDesignOperation(id: string, operationId: string): Promise<DesignOperation> {
  const response = await apiClient.get<ApiResponse<DesignOperation>>(
    API_ENDPOINTS.playbookFlows.designOperation(id, operationId),
  );
  return response.data.data;
}

export async function cancelDesignOperation(id: string, operationId: string): Promise<DesignOperation> {
  const response = await apiClient.post<ApiResponse<DesignOperation>>(
    API_ENDPOINTS.playbookFlows.cancelDesignOperation(id, operationId),
  );
  return response.data.data;
}

export async function cloneFlow(id: string): Promise<any> {
  const response = await apiClient.post<ApiResponse<any>>(
    API_ENDPOINTS.playbookFlows.clone(id),
  );
  return response.data.data;
}

export async function validateFlowTaskReplay(
  flowId: string, taskId: string,
  data: { executionId: string; iteration?: number; preserveOutputFormat?: boolean },
): Promise<any> {
  const response = await apiClient.post<ApiResponse<any>>(
    API_ENDPOINTS.playbookFlows.validateReplay(flowId, taskId),
    data,
  );
  return response.data.data;
}

export async function getFlowTaskReplays(flowId: string, taskId: string): Promise<any[]> {
  const response = await apiClient.get<ApiResponse<any[]>>(
    API_ENDPOINTS.playbookFlows.replays(flowId, taskId),
  );
  return response.data.data;
}

export async function activateFlowTaskReplay(flowId: string, taskId: string, replayId: string): Promise<any> {
  const response = await apiClient.post<ApiResponse<any>>(
    API_ENDPOINTS.playbookFlows.activateReplay(flowId, taskId, replayId),
  );
  return response.data.data;
}

export async function updateFlowTaskReplayFormatGuide(
  flowId: string, taskId: string, replayId: string,
  data: { preserveOutputFormat?: boolean; outputFormatGuide?: string },
): Promise<any> {
  const response = await apiClient.patch<ApiResponse<any>>(
    API_ENDPOINTS.playbookFlows.updateReplayFormatGuide(flowId, taskId, replayId),
    data,
  );
  return response.data.data;
}

export async function renameFlowTaskReplay(
  flowId: string, taskId: string, replayId: string, label: string,
): Promise<any> {
  const response = await apiClient.patch<ApiResponse<any>>(
    API_ENDPOINTS.playbookFlows.updateReplay(flowId, taskId, replayId),
    { label },
  );
  return response.data.data;
}

export async function deleteFlowTaskReplay(flowId: string, taskId: string, replayId: string): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.playbookFlows.deleteReplay(flowId, taskId, replayId));
}

export async function grabFlowOutputFormatTemplate(
  flowId: string, taskId: string, data: { executionId: string },
): Promise<any> {
  const response = await apiClient.post<ApiResponse<any>>(
    API_ENDPOINTS.playbookFlows.grabOutputFormatTemplate(flowId, taskId),
    data,
  );
  return response.data.data;
}

export async function getFlowOutputFormatTemplate(flowId: string, taskId: string): Promise<any> {
  const response = await apiClient.get<ApiResponse<any>>(
    API_ENDPOINTS.playbookFlows.outputFormatTemplate(flowId, taskId),
  );
  return response.data.data;
}

export async function updateFlowOutputFormatTemplate(
  flowId: string, taskId: string,
  data: { formatGuide?: string; preserveOutputFormat?: boolean },
): Promise<any> {
  const response = await apiClient.patch<ApiResponse<any>>(
    API_ENDPOINTS.playbookFlows.updateOutputFormatTemplate(flowId, taskId),
    data,
  );
  return response.data.data;
}

export async function deleteFlowOutputFormatTemplate(flowId: string, taskId: string): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.playbookFlows.deleteOutputFormatTemplate(flowId, taskId));
}
