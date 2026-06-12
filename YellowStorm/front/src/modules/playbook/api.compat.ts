/**
 * Compatibility helpers for mapping between legacy Playbook shapes and new Flow shapes.
 * These exist only to bridge old consumers during the rewrite; delete once all callers
 * are retargeted to first-class Flow types and APIs.
 */

import type {
  Playbook,
  PlaybookNodeType,
  FlowNode,
  ControlEdge,
  PlaybookTask,
  PlaybookEdge,
  PlaybookIteratorConfig,
  HumanApprovalConfig,
  RetryPolicy,
} from './types';

export function kindToNodeType(kind: string): PlaybookNodeType | undefined {
  switch (kind) {
    case 'step': return 'action';
    case 'router': return 'router';
    case 'iterator': return 'iterator';
    case 'human_approval': return 'human_approval';
    default: return undefined;
  }
}

export function mapFlowNodeToPlaybookTask(
  node: FlowNode,
  index: number,
  activeReplays?: Record<string, {
    id: string;
    validationVersion: number;
    isStale: boolean;
    staleReasons: string[];
    preserveOutputFormat: boolean;
    outputFormatGuide: string | null;
    formatGuideStatus: string | null;
    label: string | null;
    latestOverallScore: number | null;
  }>,
): PlaybookTask {
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
    hasValidatedReplay: activeReplays ? node.id in activeReplays : (meta.hasValidatedReplay as boolean) ?? false,
    activeReplayId: activeReplays?.[node.id]?.id ?? (meta.activeReplayId as string | null) ?? null,
    activeReplayVersion: activeReplays?.[node.id]?.validationVersion ?? (meta.activeReplayVersion as number | null) ?? null,
    activeReplayIsStale: activeReplays?.[node.id]?.isStale ?? (meta.activeReplayIsStale as boolean | undefined) ?? undefined,
    activeReplayStaleReasons: activeReplays?.[node.id]?.staleReasons ?? (meta.activeReplayStaleReasons as string[] | undefined) ?? undefined,
    activeReplayPreserveOutputFormat: activeReplays?.[node.id]?.preserveOutputFormat ?? (meta.activeReplayPreserveOutputFormat as boolean | undefined) ?? undefined,
    activeReplayFormatGuideStatus: activeReplays?.[node.id]?.formatGuideStatus as PlaybookTask['activeReplayFormatGuideStatus'] ?? (meta.activeReplayFormatGuideStatus as any) ?? undefined,
    activeReplayLabel: activeReplays?.[node.id]?.label ?? (meta.activeReplayLabel as string | null | undefined) ?? undefined,
    activeReplayOverallScore: activeReplays?.[node.id]?.latestOverallScore ?? (meta.activeReplayOverallScore as number | null | undefined) ?? undefined,
    stepReplayMode: (meta.stepReplayMode as any) ?? undefined,
    nodeType: (meta.nodeType as import('./types').PlaybookNodeType) ?? kindToNodeType(node.kind),
    iteratorConfig: buildPlaybookIteratorConfig(node.iteratorConfig, meta),
    routerConfig: node.routerConfig ?? (meta.routerConfig as any) ?? null,
    humanApprovalConfig: buildPlaybookHumanApprovalConfig(node.humanApprovalConfig, meta),
    hitlPolicy: node.hitlPolicy ?? null,
    retryPolicy: node.retryPolicy ?? (meta.retryPolicy as RetryPolicy | null | undefined) ?? null,
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

export function mapControlEdgeToPlaybookEdge(ce: ControlEdge): PlaybookEdge {
  return {
    id: ce.id,
    sourceId: ce.source,
    targetId: ce.target,
    // Old flows may only have routerLabel, so preserve it as the source port fallback.
    sourceOutputPortId: ce.sourceOutputPortId ?? ce.routerLabel ?? 'default',
    targetInputPortId: ce.targetInputPortId ?? 'default',
  };
}

export function normalizeTriggerFields(raw: any): Pick<Playbook, 'triggers' | 'executionSchedule' | 'automatedTriggerType'> {
  const hasTriggerConfig = raw.triggerConfig && typeof raw.triggerConfig === 'object';

  if (!hasTriggerConfig && (raw.triggers || raw.executionSchedule || raw.automatedTriggerType !== undefined)) {
    return {
      triggers: raw.triggers ?? [],
      executionSchedule: raw.executionSchedule ?? null,
      automatedTriggerType: raw.automatedTriggerType ?? null,
    };
  }

  const triggerConfig = raw.triggerConfig as { kind?: string; params?: Record<string, unknown> } | null | undefined;
  const params = triggerConfig?.params ?? {};
  const kind = triggerConfig?.kind;
  const enabled = params['enabled'] === true;

  if (kind === 'schedule') {
    const executionSchedule = {
      enabled,
      timezone: typeof params['timezone'] === 'string' ? params['timezone'] : 'UTC',
      type: (params['type'] as any) ?? 'daily',
      lastScheduledRunAt: (params['lastScheduledRunAt'] as string | null | undefined) ?? null,
      daily: (params['daily'] as any) ?? null,
      weekly: (params['weekly'] as any) ?? null,
      monthly: (params['monthly'] as any) ?? null,
      advanced: (params['advanced'] as any) ?? null,
    };

    return {
      triggers: [{ type: 'schedule', enabled, schedule: executionSchedule }],
      executionSchedule,
      automatedTriggerType: enabled ? 'schedule' : null,
    };
  }

  if (kind === 'mail') {
    return {
      triggers: [{
        type: 'mail',
        enabled,
        available: true,
        config: {
          enabled,
          mailboxAppKey: (params['mailboxAppKey'] as string | null | undefined) ?? null,
          notificationUrl: (params['notificationUrl'] as string | null | undefined) ?? null,
          autoRenewUntil: (params['autoRenewUntil'] as string | null | undefined) ?? null,
          attachmentImportEnabled: params['attachmentImportEnabled'] === true,
          allowedAttachmentExtensions: Array.isArray(params['allowedAttachmentExtensions']) ? params['allowedAttachmentExtensions'] as string[] : [],
          filters: {
            from: Array.isArray((params['filters'] as Record<string, unknown> | undefined)?.from) ? ((params['filters'] as Record<string, unknown>).from as string[]) : [],
            subjectContains: Array.isArray((params['filters'] as Record<string, unknown> | undefined)?.subjectContains) ? ((params['filters'] as Record<string, unknown>).subjectContains as string[]) : [],
            bodyContains: Array.isArray((params['filters'] as Record<string, unknown> | undefined)?.bodyContains) ? ((params['filters'] as Record<string, unknown>).bodyContains as string[]) : [],
            hasAttachments: (((params['filters'] as Record<string, unknown> | undefined)?.hasAttachments) as boolean | null | undefined) ?? null,
          },
          runtimeEnabled: enabled,
          subscriptionId: (params['subscriptionId'] as string | null | undefined) ?? null,
          subscriptionClientState: (params['subscriptionClientState'] as string | null | undefined) ?? null,
          subscriptionExpiresAt: (params['subscriptionExpiresAt'] as string | null | undefined) ?? null,
          runtimePayloadSchema: null,
        },
      }],
      executionSchedule: null,
      automatedTriggerType: enabled ? 'mail' : null,
    };
  }

  return {
    triggers: [],
    executionSchedule: null,
    automatedTriggerType: null,
  };
}

function isFlowNodeArray(value: unknown): value is FlowNode[] {
  return Array.isArray(value) && value.some((item) => {
    const node = item as Partial<FlowNode> | null;
    return Boolean(node?.id && node.kind && !('title' in node));
  });
}

function normalizePlaybookTasks(raw: any, activeReplays: Record<string, any>): PlaybookTask[] {
  if (isFlowNodeArray(raw.tasks)) {
    const flowTasks = raw.tasks as FlowNode[];
    return flowTasks.map((node: FlowNode, index: number) =>
      mapFlowNodeToPlaybookTask(node, index, activeReplays),
    );
  }
  if (Array.isArray(raw.tasks)) {
    return raw.tasks;
  }
  return raw.nodes?.map((node: FlowNode, index: number) =>
    mapFlowNodeToPlaybookTask(node, index, activeReplays),
  ) ?? [];
}

export function normalizePlaybook(raw: any): Playbook {
  const triggerFields = normalizeTriggerFields(raw);
  const activeReplays: Record<string, any> = raw.activeReplays ?? {};

  return {
    ...raw,
    definitionRevision: typeof raw.definitionRevision === 'number' ? raw.definitionRevision : 0,
    tasks: normalizePlaybookTasks(raw, activeReplays),
    edges: raw.edges ?? raw.controlEdges?.map(mapControlEdgeToPlaybookEdge) ?? [],
    triggers: triggerFields.triggers,
    executionSchedule: triggerFields.executionSchedule,
    isFavorite: raw.isFavorite ?? false,
    isActive: raw.isActive ?? true,
    automatedTriggerType: triggerFields.automatedTriggerType,
    createdBy: raw.createdBy ?? raw.ownerId ?? '',
    reflectionEnabled: raw.reflectionEnabled ?? false,
    advisorScoringMode: raw.advisorScoringMode === 'heuristic' ? 'heuristic' : 'llm',
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

export function nodeTypeToKind(nodeType?: PlaybookNodeType | null): string {
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

export function taskToFlowNode(task: PlaybookTask): FlowNode {
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
  if (task.humanApprovalConfig) {
    const timeoutSeconds = task.humanApprovalConfig.timeoutSeconds;
    node.humanApprovalConfig = {
      promptTemplate: task.humanApprovalConfig.promptTemplate,
      timeoutSeconds: timeoutSeconds ?? 0,
    };
  }
  if (task.hitlPolicy) node.hitlPolicy = task.hitlPolicy;
  if (task.retryPolicy) node.retryPolicy = task.retryPolicy;
  if (task.modelId) node.modelId = task.modelId;

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
  if (task.nodeType) meta.nodeType = task.nodeType;
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
  if (task.iteratorConfig) {
    meta.iteratorConfig = {
      mode: task.iteratorConfig.mode,
      itemVariable: task.iteratorConfig.itemVariable ?? null,
      outputVariable: task.iteratorConfig.outputVariable ?? null,
      errorStrategy: task.iteratorConfig.errorStrategy ?? 'stop',
    };
  }
  if (task.humanApprovalConfig && task.humanApprovalConfig.timeoutSeconds == null) {
    meta.humanApprovalTimeoutUnlimited = true;
  }
  if (Object.keys(meta).length > 0) node.metadata = meta;

  return node;
}

export function edgeToControlEdge(
  edge: PlaybookEdge,
  sourceNodeType?: PlaybookNodeType | null,
): ControlEdge {
  return {
    id: edge.id,
    kind: sourceNodeType === 'router' ? 'conditional' : 'sequential',
    source: edge.sourceId,
    target: edge.targetId,
    sourceOutputPortId: edge.sourceOutputPortId || 'default',
    targetInputPortId: edge.targetInputPortId || 'default',
    ...(sourceNodeType === 'router' ? { routerLabel: edge.sourceOutputPortId || 'default' } : {}),
  };
}
