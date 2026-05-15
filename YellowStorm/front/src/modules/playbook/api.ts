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
  ApplyRemediationsData,
  PlaybookEvaluationBaseline,
  PlaybookEvaluationExecution,
  PlaybookRepeatabilitySummary,
  RepeatabilityTaskExecutionSummary,
  RequestPlaybookIntentData,
  PlaybookIntentResponse,
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
} from './types';

interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
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
          language: f.metadata.language,
          mimeType: f.metadata.mimeType,
        } : undefined,
      })),
      taskType: task.taskType,
      nodeType: task.nodeType,
      templateType: task.templateType,
      inputPorts: task.inputPorts,
      outputPorts: task.outputPorts,
      toolBindings: task.toolBindings,
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
      expectedResult: task.expectedResult,
      disableAdvisorEvaluation: task.disableAdvisorEvaluation,
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
    advisorAutopilotEnabled: data.advisorAutopilotEnabled,
    advisorAutopilotTargetScore: data.advisorAutopilotTargetScore,
    advisorAutopilotMaxTurns: data.advisorAutopilotMaxTurns,
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
    advisorAutopilotEnabled: data.advisorAutopilotEnabled,
    advisorAutopilotTargetScore: data.advisorAutopilotTargetScore,
    advisorAutopilotMaxTurns: data.advisorAutopilotMaxTurns,
  };
}

function sanitizeValidateReplayData(data: ValidateTaskReplayData): ValidateTaskReplayData {
  return {
    executionId: data.executionId,
    preserveOutputFormat: Boolean(data.preserveOutputFormat),
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
    templateType: (meta.templateType as string) ?? undefined,
    toolBindings: (meta.toolBindings as any) ?? undefined,
    evaluationConfig: (meta.evaluationConfig as any) ?? undefined,
    iteratorLayout: (meta.iteratorLayout as any) ?? undefined,
    containerConfig: (meta.containerConfig as any) ?? null,
    expectedResult: (meta.expectedResult as any) ?? undefined,
    disableAdvisorEvaluation: (meta.disableAdvisorEvaluation as boolean) ?? false,
    stepReplayMode: (meta.stepReplayMode as any) ?? undefined,
    nodeType: kindToNodeType(node.kind),
    iteratorConfig: node.iteratorConfig
      ? { source: node.iteratorConfig.collectionPath, batchSize: node.iteratorConfig.maxItems ?? undefined } as any
      : (meta.iteratorConfig as any) ?? null,
    routerConfig: node.routerConfig ?? (meta.routerConfig as any) ?? null,
    humanApprovalConfig: node.humanApprovalConfig ?? (meta.humanApprovalConfig as any) ?? null,
    ...(inputPorts ? { inputPorts } : {}),
    ...(outputPorts ? { outputPorts } : {}),
  };
}

function mapControlEdgeToPlaybookEdge(ce: ControlEdge): PlaybookEdge {
  return {
    id: ce.id,
    sourceId: ce.source,
    targetId: ce.target,
    sourceOutputPortId: undefined,
    targetInputPortId: undefined,
  };
}

function normalizePlaybook(raw: any): Playbook {
  return {
    ...raw,
    tasks: raw.tasks ?? raw.nodes?.map(mapFlowNodeToPlaybookTask) ?? [],
    edges: raw.edges ?? raw.controlEdges?.map(mapControlEdgeToPlaybookEdge) ?? [],
    triggers: raw.triggers ?? [],
    executionSchedule: raw.executionSchedule ?? null,
    isFavorite: raw.isFavorite ?? false,
    isActive: raw.isActive ?? true,
    automatedTriggerType: raw.automatedTriggerType ?? null,
    createdBy: raw.createdBy ?? raw.ownerId ?? '',
    reflectionEnabled: raw.reflectionEnabled ?? false,
    designSettings: raw.designSettings ?? {
      inferenceModelId: null,
      nodeSuggestionsMode: 'inherit',
      approvalSuggestionMode: 'inherit',
    },
    effectiveDesignSettings: raw.effectiveDesignSettings ?? raw.designSettings ?? {
      inferenceModelId: null,
      nodeSuggestionsMode: 'inherit',
      approvalSuggestionMode: 'inherit',
    },
    advisorAutopilotEnabled: raw.advisorAutopilotEnabled ?? false,
  } as Playbook;
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

function computeDurationMs(startedAt: string | null, completedAt: string | null): number | null {
  if (!startedAt || !completedAt) return null;
  const start = Date.parse(startedAt);
  const end = Date.parse(completedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, end - start);
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
    status: raw.status ?? 'pending',
    output: toNullableString(raw.output),
    error: toNullableString(raw.error),
    durationMs: toNullableNumber(raw.durationMs) ?? computeDurationMs(startedAt, completedAt),
    startedAt,
    completedAt,
    components: Array.isArray(raw.components) ? raw.components : [],
    toolTrace: Array.isArray(raw.toolTrace) ? raw.toolTrace : [],
    llmPromptTrace: Array.isArray(raw.llmPromptTrace) ? raw.llmPromptTrace : [],
    inputTokens: toNullableNumber(raw.inputTokens),
    outputTokens: toNullableNumber(raw.outputTokens),
    totalTokens: toNullableNumber(raw.totalTokens),
    modelName: toNullableString(raw.modelName),
    artifacts: Array.isArray(raw.artifacts) ? raw.artifacts : [],
    iteratorIterations: Array.isArray(raw.iteratorIterations) ? raw.iteratorIterations : [],
  };
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

  return {
    ...summary,
    taskResults: Array.isArray(raw.taskResults) ? raw.taskResults.map(normalizeTaskResult) : [],
    threadId: toNullableString(raw.threadId),
    interruptPayload: raw.interruptPayload ?? null,
    waitingForHumanInput: Boolean(raw.waitingForHumanInput ?? raw.pendingApproval),
    currentInterruptId: toNullableString(raw.currentInterruptId),
    currentInterruptTaskId: toNullableString(raw.currentInterruptTaskId ?? raw.pendingApproval?.nodeId),
    hitlHistory: Array.isArray(raw.hitlHistory) ? raw.hitlHistory : [],
    playbookSnapshot: raw.playbookSnapshot ?? null,
    totalInputTokens: toNullableNumber(raw.totalInputTokens) ?? 0,
    totalOutputTokens: toNullableNumber(raw.totalOutputTokens) ?? 0,
    totalTokens: toNullableNumber(raw.totalTokens) ?? 0,
    queuePosition: toNullableNumber(raw.queuePosition),
    totalQueueSize: toNullableNumber(raw.totalQueueSize),
    recursionBudgetUsed: toNullableNumber(raw.recursionBudgetUsed),
    recursionBudgetMax: toNullableNumber(raw.recursionBudgetMax) ?? toNullableNumber(raw.recursionLimit),
    error: summary.error,
  };
}

function nodeTypeToKind(nodeType?: PlaybookNodeType | null): string {
  switch (nodeType) {
    case 'action':
    case 'agent':
    case 'evaluation':
      return 'step';
    case 'router': return 'router';
    case 'iterator': return 'iterator';
    case 'human_approval': return 'human_approval';
    default: return 'step';
  }
}

function taskToFlowNode(task: PlaybookTask): FlowNode {
  const node: FlowNode = {
    id: task.id,
    kind: nodeTypeToKind(task.nodeType) as any,
    label: task.title,
    metadata: {},
  };

  if (task.routerConfig) node.routerConfig = task.routerConfig;
  if (task.iteratorConfig) {
    node.iteratorConfig = {
      collectionPath: task.iteratorConfig.source,
      maxItems: task.iteratorConfig.batchSize ?? undefined,
    };
  }
  if (task.humanApprovalConfig) node.humanApprovalConfig = task.humanApprovalConfig;

  if (task.inputPorts && task.inputPorts.length > 0) {
    node.input = {
      ports: task.inputPorts.map((p) => ({
        id: p.id,
        label: p.name,
        type: p.artifactKind,
        required: p.required,
      })),
    };
  }

  if (task.outputPorts && task.outputPorts.length > 0) {
    node.output = {
      ports: task.outputPorts.map((p) => ({
        id: p.id,
        label: p.name,
        type: p.artifactKind,
      })),
    };
  }

  const meta: Record<string, unknown> = {};
  if (task.description) meta.description = task.description;
  if (task.assignedAgentId) meta.assignedAgentId = task.assignedAgentId;
  if (task.executionOrder !== undefined) meta.executionOrder = task.executionOrder;
  if (task.positionX !== undefined) meta.positionX = task.positionX;
  if (task.positionY !== undefined) meta.positionY = task.positionY;
  if (task.interruptBefore) meta.interruptBefore = true;
  if (task.interruptAfter) meta.interruptAfter = true;
  if (task.allowClarification) meta.allowClarification = true;
  if (task.clarificationPrompt) meta.clarificationPrompt = task.clarificationPrompt;
  if (task.maxClarifications > 0) meta.maxClarifications = task.maxClarifications;
  if (task.inputKeys.length > 0) meta.inputKeys = task.inputKeys;
  if (task.outputKey) meta.outputKey = task.outputKey;
  if (task.enabled !== undefined) meta.enabled = task.enabled;
  if (task.selectedAction) meta.selectedAction = task.selectedAction;
  if (task.executionMode) meta.executionMode = task.executionMode;
  if (task.taskType) meta.taskType = task.taskType;
  if (task.templateType) meta.templateType = task.templateType;
  if (task.toolBindings) meta.toolBindings = task.toolBindings;
  if (task.evaluationConfig) meta.evaluationConfig = task.evaluationConfig;
  if (task.iteratorLayout) meta.iteratorLayout = task.iteratorLayout;
  if (task.containerConfig) meta.containerConfig = task.containerConfig;
  if (task.expectedResult) meta.expectedResult = task.expectedResult;
  if (task.disableAdvisorEvaluation) meta.disableAdvisorEvaluation = true;
  if (task.notifyOnComplete) meta.notifyOnComplete = true;
  if (task.notifyEmails.length > 0) meta.notifyEmails = task.notifyEmails;
  if (task.stepReplayMode) meta.stepReplayMode = task.stepReplayMode;
  if (task.inputFiles.length > 0) meta.inputFiles = task.inputFiles;
  if (Object.keys(meta).length > 0) node.metadata = meta;

  return node;
}

function edgeToControlEdge(edge: PlaybookEdge): ControlEdge {
  // An edge from a router node uses the output port id as the label; treat it as conditional.
  const hasRouterLabel = edge.sourceOutputPortId && edge.sourceOutputPortId !== 'default';
  return {
    id: edge.id,
    kind: hasRouterLabel ? 'conditional' : 'sequential',
    source: edge.sourceId,
    target: edge.targetId,
    ...(hasRouterLabel ? { routerLabel: edge.sourceOutputPortId } : {}),
  };
}

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

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    if (!chunk) continue;
    fullText += chunk;
    onChunk(chunk);
  }

  fullText += decoder.decode();
  return { prompt: fullText.trim() };
}

export async function updatePlaybook(
  id: string,
  data: UpdatePlaybookData,
): Promise<Playbook> {
  const sanitized = sanitizePlaybookSettings(sanitizePlaybookUpdate(data));

  const body: Record<string, unknown> = {
    name: sanitized.name,
    description: sanitized.description,
    workspaces: sanitized.workspaces,
  };

  if (data.settings) body.settings = data.settings;

  const tasks = sanitized.tasks;
  const edges = sanitized.edges;
  const bindings = data.dataBindings;

  if (tasks && tasks.length > 0) {
    body.nodes = tasks.map(taskToFlowNode);
  }
  if (edges && edges.length > 0) {
    body.controlEdges = edges.map(edgeToControlEdge);
  }
  if (bindings && bindings.length > 0) {
    body.dataBindings = bindings;
  }

  console.log('[DEBUG] updatePlaybook body:', JSON.stringify(body));
  const response = await apiClient.patch<ApiResponse<Playbook>>(
    API_ENDPOINTS.playbooks.byId(id),
    body,
  );
  return normalizePlaybook(response.data.data);
}

export async function requestPlaybookIntent(
  playbookId: string,
  data: RequestPlaybookIntentData,
): Promise<PlaybookIntentResponse> {
  const response = await apiClient.post<ApiResponse<PlaybookIntentResponse>>(
    API_ENDPOINTS.playbooks.intent(playbookId),
    data,
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

export async function updatePlaybookFromJudge(id: string, executionId: string): Promise<Playbook> {
  const response = await apiClient.post<ApiResponse<Playbook>>(
    `${API_ENDPOINTS.playbooks.byId(id)}/judge/update-current`,
    { executionId },
  );
  return response.data.data;
}

export async function generatePlaybookFromJudge(id: string, executionId: string): Promise<Playbook> {
  const response = await apiClient.post<ApiResponse<Playbook>>(
    `${API_ENDPOINTS.playbooks.byId(id)}/judge/generate-new`,
    { executionId },
  );
  return response.data.data;
}

export async function optimizeStepFromJudge(id: string, executionId: string, taskId: string): Promise<Playbook> {
  const response = await apiClient.post<ApiResponse<Playbook>>(
    `${API_ENDPOINTS.playbooks.byId(id)}/judge/optimize-step`,
    { executionId, taskId },
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

export async function applyAdvisorRemediations(
  playbookId: string,
  executionId: string,
  data: ApplyRemediationsData,
): Promise<Playbook> {
  const response = await apiClient.post<ApiResponse<Playbook>>(
    `${API_ENDPOINTS.playbooks.byId(playbookId)}/executions/${executionId}/advisor-remediations/apply`,
    data,
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
  const response = await apiClient.post<ApiResponse<{ executionId: string }>>(
    API_ENDPOINTS.playbookFlows.execute(id),
    data || {},
  );
  return response.data.data;
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

export async function resumePlaybookFromStep(
  playbookId: string,
  executionId: string,
  data: { taskId: string; streaming?: boolean },
): Promise<{ status: string; executionId: string }> {
  const response = await apiClient.post<ApiResponse<{ status: string; executionId: string }>>(
    API_ENDPOINTS.playbooks.resumeFromStep(playbookId, executionId),
    data,
  );
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
  return response.data.data;
}

export async function getTaskReplays(
  playbookId: string,
  taskId: string,
): Promise<ValidatedTaskReplay[]> {
  const response = await apiClient.get<ApiResponse<ValidatedTaskReplay[]>>(
    API_ENDPOINTS.playbooks.replays(playbookId, taskId),
  );
  return response.data.data;
}

export async function activateTaskReplay(
  playbookId: string,
  taskId: string,
  replayId: string,
): Promise<ValidatedTaskReplay> {
  const response = await apiClient.post<ApiResponse<ValidatedTaskReplay>>(
    API_ENDPOINTS.playbooks.activateReplay(playbookId, taskId, replayId),
  );
  return response.data.data;
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
  return response.data.data;
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
  return response.data.data;
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
  return response.data.data;
}

export async function clearPlaybookTriggerSchedule(playbookId: string): Promise<Playbook> {
  const response = await apiClient.delete<ApiResponse<Playbook>>(
    API_ENDPOINTS.playbooks.triggerSchedule(playbookId),
  );
  return response.data.data;
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
  return response.data.data;
}

export async function clearPlaybookTriggerMail(playbookId: string): Promise<Playbook> {
  const response = await apiClient.delete<ApiResponse<Playbook>>(
    API_ENDPOINTS.playbooks.triggerMail(playbookId),
  );
  return response.data.data;
}

export async function syncPlaybookTriggerMailSubscription(
  playbookId: string,
  data: SyncPlaybookMailSubscriptionData,
): Promise<Record<string, unknown>> {
  const response = await apiClient.post<ApiResponse<Record<string, unknown>>>(
    API_ENDPOINTS.playbooks.triggerMail(playbookId) + '/sync-subscription',
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

export async function clonePlaybook(id: string): Promise<Playbook> {
  const response = await apiClient.post<ApiResponse<Playbook>>(
    API_ENDPOINTS.playbooks.clone(id),
  );
  return response.data.data;
}

export async function getPlaybookNodeTemplates(): Promise<{ items: Array<{
  id: string;
  key: string;
  type: string;
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
  executionMode?: string;
  assignedAgentId?: string | null;
  selectedAction?: string | null;
}> }> {
  const response = await apiClient.get<ApiResponse<{ items: Array<{
    id: string;
    key: string;
    type: string;
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
    executionMode?: string;
    assignedAgentId?: string | null;
    selectedAction?: string | null;
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

export async function getFlow(id: string): Promise<Flow> {
  const response = await apiClient.get<ApiResponse<Flow>>(
    API_ENDPOINTS.playbookFlows.byId(id),
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

export async function deleteFlow(id: string): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.playbookFlows.byId(id));
}

export async function startFlowExecution(
  flowId: string,
  inputContext?: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<{ executionId: string }> {
  const response = await apiClient.post<ApiResponse<{ executionId: string }>>(
    API_ENDPOINTS.playbookFlows.execute(flowId),
    { inputContext },
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
