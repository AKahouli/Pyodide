import { Injectable } from '@nestjs/common';
import { NotFoundException, ServiceUnavailableException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { LiteLLMConnectionService } from '@modules/models/litellm-connection.service';
import { AgentService } from '@modules/agent/agent.service';
import { RequestPlaybookFlowIntentDto } from '../dto/request-playbook-flow-intent.dto';
import { PlaybookFlowService } from './playbook-flow.service';
import { PlaybookFlowSettingsService } from './playbook-flow-settings.service';
import { PlaybookFlowPromptTemplateService } from './playbook-flow-prompt-template.service';
import { PlaybookFlowPromptRendererService } from './playbook-flow-prompt-renderer.service';
import { PlaybookFlowNodeTemplateService } from './playbook-flow-node-template.service';
import type { EffectiveFlowDesignSettings } from '../interfaces/playbook-flow-settings.interface';

type IntentNormalizationLimits = EffectiveFlowDesignSettings['intentNormalizationLimits'];

type PlaybookIntentOperationType =
  | 'create_node'
  | 'insert_before'
  | 'insert_after'
  | 'update_node'
  | 'delete_node'
  | 'update_hitl_policy'
  | 'create_blocker_rule'
  | 'update_blocker_rule'
  | 'delete_blocker_rule'
  | 'create_hitl_memory';

interface IntentWorkflowValidationContext {
  existingTaskIds: Set<string>;
  existingTaskTitles: Map<string, string>;
  existingTaskAgents: Map<string, string | null>;
  inputPortsByTaskId: Map<string, Map<string, string>>;
  outputPortsByTaskId: Map<string, Map<string, string>>;
  existingBindingTargets: Set<string>;
}

interface PlaybookIntentTaskDraft {
  title: string;
  description: string;
  agentSlug?: string | null;
  templateType?: string | null;
  inputPorts?: Array<{
    id: string;
    name?: string | null;
    artifactKind: 'text' | 'document' | 'code' | 'image' | 'data' | 'dashboard';
    required?: boolean;
  }>;
  outputPorts?: Array<{
    id: string;
    name?: string | null;
    artifactKind: 'text' | 'document' | 'code' | 'image' | 'data' | 'dashboard';
  }>;
  iteratorBody?: {
    steps: Array<{
      nodeRef: string;
      title: string;
      description: string;
      agentSlug?: string | null;
      templateType?: string | null;
      inputPorts?: Array<{
        id: string;
        name?: string | null;
        artifactKind: 'text' | 'document' | 'code' | 'image' | 'data' | 'dashboard';
        required?: boolean;
      }>;
      outputPorts?: Array<{
        id: string;
        name?: string | null;
        artifactKind: 'text' | 'document' | 'code' | 'image' | 'data' | 'dashboard';
      }>;
    }>;
    edges: Array<{
      sourceNodeRef: string;
      targetNodeRef: string;
      sourceOutputPortId?: string | null;
      targetInputPortId?: string | null;
    }>;
  };
}

interface PlaybookIntentSingleChangeSuggestion {
  id: string;
  kind: 'single_change';
  label: string;
  summary: string;
  reason: string;
  confidence: number;
  operationType: PlaybookIntentOperationType;
  task: PlaybookIntentTaskDraft | Partial<PlaybookIntentTaskDraft> | null;
  targetTaskId: string | null;
  isDirectIntentFallback: boolean;
}

type PlaybookIntentWorkflowChange =
  | {
    type: 'create_node';
    nodeRef: string;
    anchor: {
      mode: 'append' | 'before' | 'after' | 'as_input';
      targetTaskId: string | null;
      nodeRef: string | null;
      targetTaskIds?: string[];
      nodeRefs?: string[];
      sourceOutputPortId?: string | null;
      targetInputPortId?: string | null;
    };
    task: PlaybookIntentTaskDraft;
  }
  | {
    type: 'update_node';
    targetTaskId: string;
    task: Partial<PlaybookIntentTaskDraft>;
  }
  | {
    type: 'delete_node';
    targetTaskId: string;
  }
  | {
    type: 'create_edge' | 'delete_edge';
    sourceTaskId: string | null;
    sourceNodeRef: string | null;
    targetTaskId: string | null;
    targetNodeRef: string | null;
    sourceOutputPortId?: string | null;
    targetInputPortId?: string | null;
  }
  | {
    type: 'create_data_binding';
    targetTaskId: string | null;
    targetNodeRef: string | null;
    targetPort: string;
    sourceKind: 'node-output';
    sourceTaskId: string | null;
    sourceNodeRef: string | null;
    sourcePort: string | null;
    iteration?: 'current' | 'previous';
  }
  | {
    type: 'delete_data_binding';
    targetTaskId: string | null;
    targetNodeRef: string | null;
    targetPort: string;
    sourceTaskId?: string | null;
    sourceNodeRef?: string | null;
    sourcePort?: string | null;
  };

interface PlaybookIntentWorkflowPlanSuggestion {
  id: string;
  kind: 'workflow_plan';
  label: string;
  summary: string;
  reason: string;
  confidence: number;
  impact: {
    nodesToCreate: number;
    nodesToUpdate: number;
    nodesToDelete: number;
    edgesToCreate: number;
    edgesToDelete: number;
    dataBindingsToCreate: number;
    dataBindingsToDelete: number;
    affectedTaskIds: string[];
    businessOutcome: string;
  };
  changes: PlaybookIntentWorkflowChange[];
  isDirectIntentFallback: false;
}

type PlaybookIntentSuggestion = PlaybookIntentSingleChangeSuggestion | PlaybookIntentWorkflowPlanSuggestion;

export interface PlaybookFlowIntentResponse {
  suggestions: PlaybookIntentSuggestion[];
  model: string;
  settings: EffectiveFlowDesignSettings;
}

@Injectable()
export class PlaybookFlowIntentService {
  constructor(
    private readonly flowService: PlaybookFlowService,
    private readonly settingsService: PlaybookFlowSettingsService,
    private readonly promptService: PlaybookFlowPromptTemplateService,
    private readonly promptRenderer: PlaybookFlowPromptRendererService,
    private readonly agentService: AgentService,
    private readonly nodeTemplateService: PlaybookFlowNodeTemplateService,
    private readonly liteLLMConnectionService: LiteLLMConnectionService,
  ) {}

  async analyze(flowId: string, ownerId: string, dto: RequestPlaybookFlowIntentDto): Promise<PlaybookFlowIntentResponse> {
    const httpClient = this.liteLLMConnectionService.getHttpClient();
    if (!httpClient) {
      throw new ServiceUnavailableException(ErrorCode.AI_SERVICE_ERROR);
    }

    const flow = await this.flowService.findOne(flowId, ownerId);
    const selectedNode = dto.selectedTaskId
      ? (flow.nodes as Array<{ id: string; label?: string; description?: string; metadata?: Record<string, unknown> }>).find((n) => n.id === dto.selectedTaskId) || null
      : null;

    if (dto.selectedTaskId && !selectedNode) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_NODE_NOT_FOUND);
    }

    const effectiveSettings = await this.settingsService.resolveEffectiveSettings(
      (flow as any).designSettings,
    );
    const model = await this.settingsService.resolveInferenceModel(
      (flow as any).designSettings,
    );
    const prompt = await this.promptService.findByKey('intent.analyze');
    const defaultAgents = await this.agentService.findDefaultAgents({ page: 1, limit: 100, isActive: true });
    const nodeTemplates = await this.nodeTemplateService.findEnabled();
    const systemPrompt = prompt?.systemTemplate?.trim() || 'Return JSON only with a top-level suggestions array.';
    const userPrompt = this.promptRenderer.render(prompt?.userTemplate || '', {
      playbook_name: flow.name,
      playbook_description: (flow as any).description || '',
      workflow_summary: JSON.stringify(this.buildWorkflowSummary(flow, dto.selectedTaskId || null), null, 2),
      default_agents: JSON.stringify(defaultAgents.data.map((agent) => ({
        agentSlug: agent.slug,
        name: agent.name,
        role: agent.role,
      })), null, 2),
      node_templates: JSON.stringify(nodeTemplates.items.map((template) => ({
        type: template.type,
        title: template.title,
        description: template.description || '',
        category: template.category,
        nodeType: template.nodeType,
        executionMode: template.executionMode,
        inputPorts: template.inputPorts.map((port) => ({
          id: port.id,
          artifactKind: port.artifactKind,
          required: port.required === true,
        })),
        outputPorts: template.outputPorts.map((port) => ({
          id: port.id,
          artifactKind: port.artifactKind,
        })),
        recommendedAgentTypeSlug: template.recommendedAgentTypeSlug,
      })), null, 2),
      intent_text: dto.intent.trim(),
      selected_task_title: selectedNode?.label || '',
      selected_task_description: selectedNode?.description || (selectedNode?.metadata as Record<string, unknown> | undefined)?.description as string || '',
      selected_task_id: selectedNode?.id || '',
      selected_task_context: JSON.stringify(this.buildSelectedNodeContext(flow, selectedNode?.id || null), null, 2),
    });

    const response = await httpClient.post('/v1/chat/completions', {
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }, { timeout: 180000 });

    const validationContext = this.buildValidationContext(flow);

    return {
      suggestions: this.normalizeSuggestions(
        this.extractChatCompletionText(response.data),
        dto,
        selectedNode?.id || null,
        effectiveSettings.intentNormalizationLimits,
        validationContext,
      ),
      model,
      settings: effectiveSettings,
    };
  }

  private buildValidationContext(flow: any): IntentWorkflowValidationContext {
    const nodes: Array<{ id: string; label?: string; metadata?: { agentSlug?: string }; input?: { ports?: Array<{ id: string; type?: string }> }; output?: { ports?: Array<{ id: string; type?: string }> } }> = flow.nodes || [];
    const bindings: Array<{ targetNode: string; targetPort: string }> = flow.dataBindings || [];

    const existingTaskIds = new Set<string>();
    const existingTaskTitles = new Map<string, string>();
    const existingTaskAgents = new Map<string, string | null>();
    const inputPortsByTaskId = new Map<string, Map<string, string>>();
    const outputPortsByTaskId = new Map<string, Map<string, string>>();
    const existingBindingTargets = new Set<string>();

    for (const node of nodes) {
      existingTaskIds.add(node.id);
      existingTaskTitles.set(node.id, (node.label || '').trim().toLowerCase().replace(/\s+/g, ' '));
      existingTaskAgents.set(node.id, node.metadata?.agentSlug || null);

      const inputMap = new Map<string, string>();
      for (const p of node.input?.ports || []) {
        if (p.id && p.type) inputMap.set(p.id, p.type);
      }
      inputPortsByTaskId.set(node.id, inputMap);

      const outputMap = new Map<string, string>();
      for (const p of node.output?.ports || []) {
        if (p.id && p.type) outputMap.set(p.id, p.type);
      }
      outputPortsByTaskId.set(node.id, outputMap);
    }

    for (const b of bindings) {
      existingBindingTargets.add(`${b.targetNode}:${b.targetPort}`);
    }

    return { existingTaskIds, existingTaskTitles, existingTaskAgents, inputPortsByTaskId, outputPortsByTaskId, existingBindingTargets };
  }

  private buildWorkflowSummary(flow: any, selectedNodeId: string | null) {
    const nodes: Array<{ id: string; label?: string; description?: string; metadata?: Record<string, unknown>; input?: { ports?: Array<{ id: string; label?: string; type?: string; required?: boolean }> }; output?: { ports?: Array<{ id: string; label?: string; type?: string }> } }> = flow.nodes || [];
    const edges: Array<{ source: string; target: string; sourceOutputPortId?: string; targetInputPortId?: string }> = flow.controlEdges || [];
    const bindings: Array<{ id: string; sourceKind: string; targetNode: string; targetPort: string; sourceNode?: string; sourcePort?: string; iteration?: string }> = flow.dataBindings || [];

    return {
      taskCount: nodes.length,
      edgeCount: edges.length,
      dataBindingCount: bindings.length,
      tasks: nodes.map((node) => ({
        id: node.id,
        title: node.label || node.id,
        description: node.description || (node.metadata?.description as string) || '',
        inputPorts: (node.input?.ports || []).map((p) => ({ id: p.id, name: p.label || p.id, artifactKind: p.type, required: p.required === true })),
        outputPorts: (node.output?.ports || []).map((p) => ({ id: p.id, name: p.label || p.id, artifactKind: p.type })),
      })),
      edges: edges.map((edge) => ({
        sourceId: edge.source,
        targetId: edge.target,
        sourceOutputPortId: edge.sourceOutputPortId || null,
        targetInputPortId: edge.targetInputPortId || null,
      })),
      dataBindings: bindings.map((b) => ({
        id: b.id,
        sourceKind: b.sourceKind,
        targetNode: b.targetNode,
        targetPort: b.targetPort,
        sourceNode: b.sourceNode || null,
        sourcePort: b.sourcePort || null,
        iteration: b.iteration || null,
      })),
    };
  }

  private buildSelectedNodeContext(flow: any, selectedNodeId: string | null) {
    if (!selectedNodeId) {
      return { upstream: [], downstream: [], incomingBindings: [], outgoingBindings: [] };
    }

    const edges: Array<{ source: string; target: string }> = flow.controlEdges || [];
    const nodes: Array<{ id: string; label?: string; description?: string; metadata?: Record<string, unknown>; input?: { ports?: Array<{ id: string; label?: string; type?: string; required?: boolean }> }; output?: { ports?: Array<{ id: string; label?: string; type?: string }> } }> = flow.nodes || [];
    const bindings: Array<{ id: string; sourceKind: string; targetNode: string; targetPort: string; sourceNode?: string; sourcePort?: string }> = flow.dataBindings || [];

    const upstreamIds = edges.filter((e) => e.target === selectedNodeId).map((e) => e.source);
    const downstreamIds = edges.filter((e) => e.source === selectedNodeId).map((e) => e.target);

    return {
      upstream: nodes.filter((n) => upstreamIds.includes(n.id)).map((n) => ({ id: n.id, title: n.label || n.id, description: n.description || (n.metadata?.description as string) || '', outputPorts: (n.output?.ports || []).map((p) => ({ id: p.id, name: p.label || p.id, artifactKind: p.type })) })),
      downstream: nodes.filter((n) => downstreamIds.includes(n.id)).map((n) => ({ id: n.id, title: n.label || n.id, description: n.description || (n.metadata?.description as string) || '', inputPorts: (n.input?.ports || []).map((p) => ({ id: p.id, name: p.label || p.id, artifactKind: p.type, required: p.required === true })) })),
      incomingBindings: bindings.filter((b) => b.targetNode === selectedNodeId).map((b) => ({ id: b.id, sourceKind: b.sourceKind, sourceNode: b.sourceNode || null, sourcePort: b.sourcePort || null, targetPort: b.targetPort })),
      outgoingBindings: bindings.filter((b) => b.sourceNode === selectedNodeId).map((b) => ({ id: b.id, sourceKind: b.sourceKind, targetNode: b.targetNode, targetPort: b.targetPort, sourcePort: b.sourcePort || null })),
    };
  }

  private extractChatCompletionText(responseData: unknown): string {
    const content = (responseData as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content;
    if (typeof content === 'string') {
      return content.trim();
    }
    if (Array.isArray(content)) {
      return content
        .map((item) => (typeof (item as { text?: unknown })?.text === 'string' ? String((item as { text?: unknown }).text) : ''))
        .join('\n')
        .trim();
    }
    return '';
  }

  private normalizeSuggestions(
    raw: string,
    dto: RequestPlaybookFlowIntentDto,
    selectedNodeId: string | null,
    limits: IntentNormalizationLimits,
    validationContext: IntentWorkflowValidationContext,
  ): PlaybookIntentSuggestion[] {
    try {
      const parsed = JSON.parse(raw || '{}') as { suggestions?: Array<Record<string, unknown>> };
      const suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
      const normalized = suggestions
        .slice(0, 6)
        .map((item, index) => this.normalizeSuggestion(item, index, selectedNodeId, limits, validationContext))
        .filter((item): item is PlaybookIntentSuggestion => item !== null);

      return [this.createFallbackSuggestion(dto, selectedNodeId), ...normalized];
    } catch {
      return [this.createFallbackSuggestion(dto, selectedNodeId)];
    }
  }

  private normalizeSuggestion(
    item: Record<string, unknown>,
    index: number,
    selectedNodeId: string | null,
    limits: IntentNormalizationLimits,
    validationContext: IntentWorkflowValidationContext,
  ): PlaybookIntentSuggestion | null {
    if (item.kind === 'workflow_plan' || Array.isArray(item.changes) || this.looksLikeWorkflowPlanImpact(item.impact)) {
      return this.normalizeWorkflowPlanSuggestion(item, index, limits, validationContext);
    }

    const label = this.normalizeText(item.label) || this.normalizeText(item.title);
    const nestedTask = item.task && typeof item.task === 'object' ? item.task as Record<string, unknown> : null;
    const operationType = this.normalizeOperationType(item.operationType, selectedNodeId);
    const derivedLabel = label
      || (nestedTask ? this.normalizeText(nestedTask.title) || this.normalizeText(nestedTask.description)?.slice(0, 100) : '')
      || this.normalizeText(item.summary)?.slice(0, 100);
    if (!derivedLabel) {
      return null;
    }

    const explicitTitle = this.normalizeText(item.taskTitle) || this.normalizeText(nestedTask?.title);
    const taskTitle = operationType === 'update_node' ? explicitTitle : (explicitTitle || derivedLabel);
    const taskDescription = this.normalizeText(item.taskDescription) || this.normalizeText(nestedTask?.description) || this.normalizeText(item.summary);
    const agentSlug = this.normalizeText(item.agentSlug) || this.normalizeText(nestedTask?.agentSlug);
    const templateType = this.normalizeText(item.templateType) || this.normalizeText(nestedTask?.templateType);
    const inputPorts = nestedTask ? this.normalizeInputPorts(nestedTask.inputPorts, limits) : [];
    const outputPorts = nestedTask ? this.normalizeOutputPorts(nestedTask.outputPorts, limits) : [];

    const task = operationType === 'delete_node'
      ? null
      : operationType === 'update_node'
        ? {
          ...(taskTitle ? { title: taskTitle } : {}),
          description: taskDescription,
          ...(agentSlug ? { agentSlug } : {}),
          ...(templateType ? { templateType } : {}),
          ...(inputPorts.length ? { inputPorts } : {}),
          ...(outputPorts.length ? { outputPorts } : {}),
        }
        : {
          title: taskTitle || label,
          description: taskDescription,
          agentSlug: agentSlug || null,
          templateType: templateType || null,
          ...(inputPorts.length ? { inputPorts } : {}),
          ...(outputPorts.length ? { outputPorts } : {}),
        };

    return {
      id: `intent-${index}`,
      kind: 'single_change',
      label: derivedLabel,
      summary: this.normalizeText(item.summary) || '',
      reason: this.normalizeText(item.reason) || '',
      confidence: this.normalizeConfidence(item.confidence),
      operationType,
      task,
      targetTaskId: this.normalizeText(item.targetTaskId) || this.normalizeText(item.nodeRef) || selectedNodeId,
      isDirectIntentFallback: false,
    };
  }

  private normalizeWorkflowPlanSuggestion(
    item: Record<string, unknown>,
    index: number,
    limits: IntentNormalizationLimits,
    ctx: IntentWorkflowValidationContext,
  ): PlaybookIntentWorkflowPlanSuggestion | null {
    const label = this.normalizeText(item.label) || this.normalizeText(item.title);
    if (!label || !Array.isArray(item.changes)) {
      return null;
    }

    const rawChanges = item.changes
      .slice(0, limits.maxWorkflowPlanChanges)
      .map((change) => this.normalizeWorkflowChange(change, limits))
      .filter((change): change is PlaybookIntentWorkflowChange => change !== null);

    const createdNodeRefs = new Set<string>();
    const deletedTaskIds = new Set<string>();
    const acceptedChanges: PlaybookIntentWorkflowChange[] = [];

    for (const change of rawChanges) {
      const validated = this.validateWorkflowChange(change, ctx, createdNodeRefs, deletedTaskIds);
      if (validated) {
        acceptedChanges.push(validated);
        if (validated.type === 'create_node') {
          createdNodeRefs.add(validated.nodeRef);
        }
        if (validated.type === 'delete_node') {
          deletedTaskIds.add(validated.targetTaskId);
        }
      }
    }

    if (acceptedChanges.length === 0) {
      return null;
    }

    return {
      id: `intent-${index}`,
      kind: 'workflow_plan',
      label,
      summary: this.normalizeText(item.summary) || '',
      reason: this.normalizeText(item.reason) || '',
      confidence: this.normalizeConfidence(item.confidence),
      impact: this.normalizeWorkflowImpact(item.impact, acceptedChanges),
      changes: acceptedChanges,
      isDirectIntentFallback: false,
    };
  }

  private normalizeComparableTitle(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  private validateWorkflowChange(
    change: PlaybookIntentWorkflowChange,
    ctx: IntentWorkflowValidationContext,
    createdNodeRefs: Set<string>,
    deletedTaskIds: Set<string>,
  ): PlaybookIntentWorkflowChange | null {
    if (change.type === 'create_node') {
      if (createdNodeRefs.has(change.nodeRef)) {
        return null;
      }

      const newTitle = this.normalizeComparableTitle(change.task.title);
      const newAgent = change.task.agentSlug || null;
      for (const [taskId, existingTitle] of ctx.existingTaskTitles) {
        if (existingTitle === newTitle) {
          const existingAgent = ctx.existingTaskAgents.get(taskId);
          if (existingAgent === newAgent) {
            return null;
          }
        }
      }

      return change;
    }

    if (change.type === 'update_node') {
      if (!ctx.existingTaskIds.has(change.targetTaskId)) {
        return null;
      }
      return change;
    }

    if (change.type === 'delete_node') {
      if (!ctx.existingTaskIds.has(change.targetTaskId)) {
        return null;
      }
      return change;
    }

    if (change.type === 'create_edge' || change.type === 'delete_edge') {
      const sourceValid = this.resolveTaskRef(change.sourceTaskId, change.sourceNodeRef, ctx.existingTaskIds, createdNodeRefs);
      const targetValid = this.resolveTaskRef(change.targetTaskId, change.targetNodeRef, ctx.existingTaskIds, createdNodeRefs);
      if (!sourceValid || !targetValid) {
        return null;
      }

      if (change.type === 'create_edge') {
        if (change.sourceTaskId && deletedTaskIds.has(change.sourceTaskId)) {
          return null;
        }
        if (change.targetTaskId && deletedTaskIds.has(change.targetTaskId)) {
          return null;
        }
      }

      return change;
    }

    if (change.type === 'create_data_binding') {
      const sourceValid = this.resolveTaskRef(change.sourceTaskId, change.sourceNodeRef, ctx.existingTaskIds, createdNodeRefs);
      const targetValid = this.resolveTaskRef(change.targetTaskId, change.targetNodeRef, ctx.existingTaskIds, createdNodeRefs);
      if (!sourceValid || !targetValid) {
        return null;
      }

      if (change.sourceTaskId && ctx.existingTaskIds.has(change.sourceTaskId)) {
        const outputPorts = ctx.outputPortsByTaskId.get(change.sourceTaskId);
        if (outputPorts && change.sourcePort && !outputPorts.has(change.sourcePort)) {
          return null;
        }
      }

      if (change.targetTaskId && ctx.existingTaskIds.has(change.targetTaskId)) {
        const inputPorts = ctx.inputPortsByTaskId.get(change.targetTaskId);
        if (inputPorts && change.targetPort && !inputPorts.has(change.targetPort)) {
          return null;
        }
      }

      if (
        change.sourceTaskId && ctx.existingTaskIds.has(change.sourceTaskId)
        && change.targetTaskId && ctx.existingTaskIds.has(change.targetTaskId)
        && change.sourcePort && change.targetPort
      ) {
        const sourceKind = ctx.outputPortsByTaskId.get(change.sourceTaskId)?.get(change.sourcePort);
        const targetKind = ctx.inputPortsByTaskId.get(change.targetTaskId)?.get(change.targetPort);
        if (sourceKind && targetKind && sourceKind !== targetKind) {
          return null;
        }
      }

      return change;
    }

    if (change.type === 'delete_data_binding') {
      if (change.targetTaskId && !ctx.existingTaskIds.has(change.targetTaskId)) {
        return null;
      }
      if (change.targetTaskId && ctx.existingTaskIds.has(change.targetTaskId)) {
        const inputPorts = ctx.inputPortsByTaskId.get(change.targetTaskId);
        if (inputPorts && !inputPorts.has(change.targetPort)) {
          return null;
        }
      }
      return change;
    }

    return null;
  }

  private resolveTaskRef(
    taskId: string | null,
    nodeRef: string | null,
    existingTaskIds: Set<string>,
    createdNodeRefs: Set<string>,
  ): boolean {
    if (taskId) return existingTaskIds.has(taskId);
    if (nodeRef) return createdNodeRefs.has(nodeRef);
    return false;
  }

  private normalizeWorkflowChange(value: unknown, limits: IntentNormalizationLimits): PlaybookIntentWorkflowChange | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const item = value as Record<string, unknown>;
    if (item.type === 'create_node') {
      const nodeRef = this.normalizeText(item.nodeRef);
      const task = this.normalizeTaskDraft(
        item.task,
        this.normalizeText(item.taskTitle),
        this.normalizeText(item.taskDescription),
        limits,
      );
      if (!nodeRef || !task) {
        return null;
      }

      return {
        type: 'create_node',
        nodeRef,
        anchor: this.normalizeWorkflowAnchor(item.anchor),
        task,
      };
    }

    if (item.type === 'update_node') {
      const targetTaskId = this.normalizeText(item.targetTaskId);
      const task = this.normalizePartialTaskDraft(
        item.task,
        this.normalizeText(item.taskTitle),
        this.normalizeText(item.taskDescription),
        limits,
      );
      if (!targetTaskId || Object.keys(task).length === 0) {
        return null;
      }
      return { type: 'update_node', targetTaskId, task };
    }

    if (item.type === 'delete_node') {
      const targetTaskId = this.normalizeText(item.targetTaskId);
      return targetTaskId ? { type: 'delete_node', targetTaskId } : null;
    }

    if (item.type === 'create_edge' || item.type === 'delete_edge') {
      const sourceTaskId = this.normalizeText(item.sourceTaskId);
      const sourceNodeRef = this.normalizeText(item.sourceNodeRef) || this.normalizeText(item.sourceRef) || this.normalizeText(item.fromNodeRef);
      const targetTaskId = this.normalizeText(item.targetTaskId);
      const targetNodeRef = this.normalizeText(item.targetNodeRef) || this.normalizeText(item.targetRef) || this.normalizeText(item.toNodeRef);

      if (!(sourceTaskId || sourceNodeRef) || !(targetTaskId || targetNodeRef)) {
        return null;
      }

      return {
        type: item.type,
        sourceTaskId: sourceTaskId || null,
        sourceNodeRef: sourceNodeRef || null,
        targetTaskId: targetTaskId || null,
        targetNodeRef: targetNodeRef || null,
        ...(this.normalizeText(item.sourceOutputPortId) ? { sourceOutputPortId: this.normalizeText(item.sourceOutputPortId) } : {}),
        ...(this.normalizeText(item.targetInputPortId) ? { targetInputPortId: this.normalizeText(item.targetInputPortId) } : {}),
      };
    }

    if (item.type === 'create_data_binding') {
      const targetTaskId = this.normalizeText(item.targetTaskId);
      const targetNodeRef = this.normalizeText(item.targetNodeRef);
      const targetPort = this.normalizeText(item.targetPort);
      if (!targetPort || !(targetTaskId || targetNodeRef)) {
        return null;
      }
      const sourceTaskId = this.normalizeText(item.sourceTaskId);
      const sourceNodeRef = this.normalizeText(item.sourceNodeRef);
      const sourcePort = this.normalizeText(item.sourcePort);
      if (item.sourceKind !== 'node-output' || !(sourceTaskId || sourceNodeRef) || !sourcePort) {
        return null;
      }
      return {
        type: 'create_data_binding',
        targetTaskId: targetTaskId || null,
        targetNodeRef: targetNodeRef || null,
        targetPort,
        sourceKind: 'node-output',
        sourceTaskId: sourceTaskId || null,
        sourceNodeRef: sourceNodeRef || null,
        sourcePort: sourcePort || null,
        iteration: item.iteration === 'previous' ? 'previous' : 'current',
      };
    }

    if (item.type === 'delete_data_binding') {
      const targetTaskId = this.normalizeText(item.targetTaskId);
      const targetNodeRef = this.normalizeText(item.targetNodeRef);
      const targetPort = this.normalizeText(item.targetPort);
      if (!targetPort || !(targetTaskId || targetNodeRef)) {
        return null;
      }
      const sourceTaskId = this.normalizeText(item.sourceTaskId);
      const sourceNodeRef = this.normalizeText(item.sourceNodeRef);
      const sourcePort = this.normalizeText(item.sourcePort);
      return {
        type: 'delete_data_binding',
        targetTaskId: targetTaskId || null,
        targetNodeRef: targetNodeRef || null,
        targetPort,
        ...(sourceTaskId ? { sourceTaskId: sourceTaskId || null } : {}),
        ...(sourceNodeRef ? { sourceNodeRef: sourceNodeRef || null } : {}),
        ...(sourcePort ? { sourcePort: sourcePort || null } : {}),
      };
    }

    return null;
  }

  private normalizeWorkflowAnchor(value: unknown): { mode: 'append' | 'before' | 'after' | 'as_input'; targetTaskId: string | null; nodeRef: string | null; targetTaskIds?: string[]; nodeRefs?: string[]; sourceOutputPortId?: string | null; targetInputPortId?: string | null } {
    const item = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const mode = item.mode === 'before' || item.mode === 'after' || item.mode === 'append' || item.mode === 'as_input' ? item.mode : 'append';
    return {
      mode,
      targetTaskId: this.normalizeText(item.targetTaskId) || null,
      nodeRef: this.normalizeText(item.nodeRef) || null,
      targetTaskIds: this.normalizeTextArray(item.targetTaskIds),
      nodeRefs: this.normalizeTextArray(item.nodeRefs),
      sourceOutputPortId: this.normalizeText(item.sourceOutputPortId) || null,
      targetInputPortId: this.normalizeText(item.targetInputPortId) || null,
    };
  }

  private normalizeTaskDraft(
    value: unknown,
    fallbackTitle = '',
    fallbackDescription = '',
    limits: IntentNormalizationLimits,
  ): PlaybookIntentTaskDraft | null {
    const item = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const title = this.normalizeText(item.title) || fallbackTitle;
    const description = this.normalizeText(item.description) || fallbackDescription;
    const agentSlug = this.normalizeText(item.agentSlug);
    const templateType = this.normalizeText(item.templateType);
    const inputPorts = this.normalizeInputPorts(item.inputPorts, limits);
    const outputPorts = this.normalizeOutputPorts(item.outputPorts, limits);
    const iteratorBody = this.normalizeIteratorBody(item.iteratorBody, limits);
    return title
      ? {
        title,
        description,
        ...(agentSlug ? { agentSlug } : {}),
        ...(templateType ? { templateType } : {}),
        ...(inputPorts.length ? { inputPorts } : {}),
        ...(outputPorts.length ? { outputPorts } : {}),
        ...(iteratorBody ? { iteratorBody } : {}),
      }
      : null;
  }

  private normalizePartialTaskDraft(
    value: unknown,
    fallbackTitle = '',
    fallbackDescription = '',
    limits: IntentNormalizationLimits,
  ): Partial<PlaybookIntentTaskDraft> {
    const item = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const title = this.normalizeText(item.title) || fallbackTitle;
    const description = this.normalizeText(item.description) || fallbackDescription;
    const agentSlug = this.normalizeText(item.agentSlug);
    const templateType = this.normalizeText(item.templateType);
    const inputPorts = this.normalizeInputPorts(item.inputPorts, limits);
    const outputPorts = this.normalizeOutputPorts(item.outputPorts, limits);
    const iteratorBody = this.normalizeIteratorBody(item.iteratorBody, limits);
    return {
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
      ...(agentSlug ? { agentSlug } : {}),
      ...(templateType ? { templateType } : {}),
      ...(inputPorts.length ? { inputPorts } : {}),
      ...(outputPorts.length ? { outputPorts } : {}),
      ...(iteratorBody ? { iteratorBody } : {}),
    };
  }

  private normalizeIteratorBody(value: unknown, limits: IntentNormalizationLimits): PlaybookIntentTaskDraft['iteratorBody'] | undefined {
    if (!value || typeof value !== 'object') {
      return undefined;
    }

    const item = value as Record<string, unknown>;
    const steps = Array.isArray(item.steps)
      ? item.steps
        .map((step) => {
          if (!step || typeof step !== 'object') {
            return null;
          }

          const draft = step as Record<string, unknown>;
          const nodeRef = this.normalizeText(draft.nodeRef);
          const title = this.normalizeText(draft.title);
          if (!nodeRef || !title) {
            return null;
          }

          const description = this.normalizeText(draft.description);
          const agentSlug = this.normalizeText(draft.agentSlug);
          const templateType = this.normalizeText(draft.templateType);
          const inputPorts = this.normalizeInputPorts(draft.inputPorts, limits);
          const outputPorts = this.normalizeOutputPorts(draft.outputPorts, limits);
          return {
            nodeRef,
            title,
            description,
            ...(agentSlug ? { agentSlug } : {}),
            ...(templateType ? { templateType } : {}),
            ...(inputPorts.length ? { inputPorts } : {}),
            ...(outputPorts.length ? { outputPorts } : {}),
          };
        })
        .filter((step): step is NonNullable<typeof step> => step !== null)
        .slice(0, limits.maxIteratorBodySteps)
      : [];

    const validStepRefs = new Set(steps.map((s) => s.nodeRef));

    const edges = Array.isArray(item.edges)
      ? item.edges
        .map((edge) => {
          if (!edge || typeof edge !== 'object') {
            return null;
          }

          const normalizedEdge = edge as Record<string, unknown>;
          const sourceNodeRef = this.normalizeText(normalizedEdge.sourceNodeRef);
          const targetNodeRef = this.normalizeText(normalizedEdge.targetNodeRef);
          const sourceOutputPortId = this.normalizeText(normalizedEdge.sourceOutputPortId);
          const targetInputPortId = this.normalizeText(normalizedEdge.targetInputPortId);
          if (!sourceNodeRef || !targetNodeRef) {
            return null;
          }
          if (!validStepRefs.has(sourceNodeRef) || !validStepRefs.has(targetNodeRef)) {
            return null;
          }
          return {
            sourceNodeRef,
            targetNodeRef,
            ...(sourceOutputPortId ? { sourceOutputPortId } : {}),
            ...(targetInputPortId ? { targetInputPortId } : {}),
          };
        })
        .filter((edge): edge is NonNullable<typeof edge> => edge !== null)
        .slice(0, limits.maxIteratorBodyEdges)
      : [];

    return steps.length > 0 ? { steps, edges } : undefined;
  }

  private normalizeWorkflowImpact(value: unknown, changes: PlaybookIntentWorkflowChange[]): PlaybookIntentWorkflowPlanSuggestion['impact'] {
    const item = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const affectedTaskIds = Array.isArray(item.affectedTaskIds)
      ? item.affectedTaskIds.map((id: unknown) => this.normalizeText(id)).filter(Boolean).slice(0, 20)
      : changes.flatMap((change) => [
        ...('targetTaskId' in change && change.targetTaskId ? [change.targetTaskId] : []),
        ...('sourceTaskId' in change && change.sourceTaskId ? [change.sourceTaskId] : []),
      ]);

    return {
      nodesToCreate: this.normalizeCount(item.nodesToCreate, changes.filter((change) => change.type === 'create_node').length),
      nodesToUpdate: this.normalizeCount(item.nodesToUpdate, changes.filter((change) => change.type === 'update_node').length),
      nodesToDelete: this.normalizeCount(item.nodesToDelete, changes.filter((change) => change.type === 'delete_node').length),
      edgesToCreate: this.normalizeCount(item.edgesToCreate, changes.filter((change) => change.type === 'create_edge').length),
      edgesToDelete: this.normalizeCount(item.edgesToDelete, changes.filter((change) => change.type === 'delete_edge').length),
      dataBindingsToCreate: this.normalizeCount((item as Record<string, unknown>).dataBindingsToCreate, changes.filter((change) => change.type === 'create_data_binding').length),
      dataBindingsToDelete: this.normalizeCount((item as Record<string, unknown>).dataBindingsToDelete, changes.filter((change) => change.type === 'delete_data_binding').length),
      affectedTaskIds: [...new Set(affectedTaskIds)],
      businessOutcome: this.normalizeText(item.businessOutcome),
    };
  }

  private looksLikeWorkflowPlanImpact(value: unknown): boolean {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const item = value as Record<string, unknown>;
    return [
      item.nodesToCreate,
      item.nodesToUpdate,
      item.nodesToDelete,
      item.edgesToCreate,
      item.edgesToDelete,
    ].some((count) => typeof count === 'number');
  }

  private createFallbackSuggestion(dto: RequestPlaybookFlowIntentDto, selectedNodeId: string | null): PlaybookIntentSuggestion {
    const normalizedIntent = dto.intent.trim();

    return {
      id: 'intent-fallback',
      kind: 'single_change',
      label: '',
      summary: normalizedIntent,
      reason: '',
      confidence: 1,
      operationType: selectedNodeId ? 'update_node' : 'create_node',
      task: {
        title: normalizedIntent.slice(0, 120),
        description: normalizedIntent,
      },
      targetTaskId: selectedNodeId,
      isDirectIntentFallback: true,
    };
  }

  private normalizeText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private normalizeConfidence(value: unknown): number {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return 0.65;
    }
    return Math.max(0, Math.min(1, value));
  }

  private normalizeCount(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : fallback;
  }

  private normalizeTextArray(value: unknown): string[] {
    return Array.isArray(value)
      ? value.map((item) => this.normalizeText(item)).filter(Boolean).slice(0, 12)
      : [];
  }

  private normalizeArtifactKind(value: unknown): 'text' | 'document' | 'code' | 'image' | 'data' | 'dashboard' | '' {
    return value === 'text'
      || value === 'document'
      || value === 'code'
      || value === 'image'
      || value === 'data'
      || value === 'dashboard'
      ? value
      : '';
  }

  private normalizeInputPorts(value: unknown, limits: IntentNormalizationLimits): NonNullable<PlaybookIntentTaskDraft['inputPorts']> {
    if (!Array.isArray(value)) {
      return [];
    }

    const seen = new Set<string>();
    return value
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }

        const port = item as Record<string, unknown>;
        const id = this.normalizeText(port.id);
        const artifactKind = this.normalizeArtifactKind(port.artifactKind);
        if (!id || !artifactKind || seen.has(id)) {
          return null;
        }

        seen.add(id);
        const name = this.normalizeText(port.name);
        return {
          id,
          artifactKind,
          required: port.required === true,
          ...(name ? { name } : {}),
        };
      })
      .filter((port): port is NonNullable<typeof port> => port !== null)
      .slice(0, limits.maxInputPorts);
  }

  private normalizeOutputPorts(value: unknown, limits: IntentNormalizationLimits): NonNullable<PlaybookIntentTaskDraft['outputPorts']> {
    if (!Array.isArray(value)) {
      return [];
    }

    const seen = new Set<string>();
    return value
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }

        const port = item as Record<string, unknown>;
        const id = this.normalizeText(port.id);
        const artifactKind = this.normalizeArtifactKind(port.artifactKind);
        if (!id || !artifactKind || seen.has(id)) {
          return null;
        }

        seen.add(id);
        const name = this.normalizeText(port.name);
        return {
          id,
          artifactKind,
          ...(name ? { name } : {}),
        };
      })
      .filter((port): port is NonNullable<typeof port> => port !== null)
      .slice(0, limits.maxOutputPorts);
  }

  private normalizeOperationType(value: unknown, selectedNodeId: string | null): PlaybookIntentOperationType {
    return value === 'create_node'
      || value === 'insert_before'
      || value === 'insert_after'
      || value === 'update_node'
      || value === 'delete_node'
      || value === 'update_hitl_policy'
      || value === 'create_blocker_rule'
      || value === 'update_blocker_rule'
      || value === 'delete_blocker_rule'
      || value === 'create_hitl_memory'
      ? value
      : selectedNodeId
        ? 'insert_after'
        : 'create_node';
  }
}
