import { Injectable } from '@nestjs/common';
import { NotFoundException, ServiceUnavailableException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { LiteLLMConnectionService } from '../../models/litellm-connection.service';
import { RequestPlaybookIntentDto } from '../dto/request-playbook-intent.dto';
import { PlaybookService } from './playbook.service';
import { PlaybookSettingsService } from './playbook-settings.service';
import { PlaybookPromptService } from './playbook-prompt.service';
import { PlaybookPromptTemplateRendererService } from './playbook-prompt-template-renderer.service';
import { AgentService } from '../../agent/agent.service';
import { PlaybookNodeTemplateService } from './playbook-node-template.service';

type PlaybookIntentOperationType = 'create_node' | 'insert_before' | 'insert_after' | 'update_node' | 'delete_node';

interface PlaybookIntentTaskDraft {
  title: string;
  description: string;
  agentSlug?: string | null;
  templateType?: string | null;
  iteratorBody?: {
    steps: Array<{
      nodeRef: string;
      title: string;
      description: string;
      agentSlug?: string | null;
      templateType?: string | null;
    }>;
    edges: Array<{
      sourceNodeRef: string;
      targetNodeRef: string;
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
  task: PlaybookIntentTaskDraft | null;
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
    affectedTaskIds: string[];
    businessOutcome: string;
  };
  changes: PlaybookIntentWorkflowChange[];
  isDirectIntentFallback: false;
}

type PlaybookIntentSuggestion = PlaybookIntentSingleChangeSuggestion | PlaybookIntentWorkflowPlanSuggestion;

export interface PlaybookIntentResponse {
  suggestions: PlaybookIntentSuggestion[];
  model: string;
  settings: Awaited<ReturnType<PlaybookSettingsService['resolveEffectiveSettings']>>;
}

@Injectable()
export class PlaybookIntentService {
  constructor(
    private readonly playbookService: PlaybookService,
    private readonly liteLLMConnectionService: LiteLLMConnectionService,
    private readonly playbookSettingsService: PlaybookSettingsService,
    private readonly playbookPromptService: PlaybookPromptService,
    private readonly promptRenderer: PlaybookPromptTemplateRendererService,
    private readonly agentService: AgentService,
    private readonly playbookNodeTemplateService: PlaybookNodeTemplateService,
  ) { }

  async analyze(playbookId: string, dto: RequestPlaybookIntentDto): Promise<PlaybookIntentResponse> {
    const httpClient = this.liteLLMConnectionService.getHttpClient();
    if (!httpClient) {
      throw new ServiceUnavailableException(ErrorCode.AI_SERVICE_ERROR);
    }

    const playbook = await this.playbookService.findById(playbookId);
    const selectedTask = dto.selectedTaskId
      ? playbook.tasks.find((item) => item.id === dto.selectedTaskId) || null
      : null;

    if (dto.selectedTaskId && !selectedTask) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_TASK_NOT_FOUND);
    }

    const effectiveSettings = await this.playbookSettingsService.resolveEffectiveSettings(playbook.designSettings);
    const model = await this.playbookSettingsService.resolveInferenceModel(playbook.designSettings);
    const prompt = await this.playbookPromptService.findByKey('intent.analyze');
    const defaultAgents = await this.agentService.findDefaultAgents({ page: 1, limit: 100, isActive: true });
    const nodeTemplates = await this.playbookNodeTemplateService.findEnabled();
    const systemPrompt = prompt?.systemTemplate?.trim() || 'Return JSON only with a top-level suggestions array.';
    const userPrompt = this.promptRenderer.render(prompt?.userTemplate || '', {
      playbook_name: playbook.name,
      playbook_description: playbook.description || '',
      workflow_summary: JSON.stringify({
        taskCount: playbook.tasks.length,
        edgeCount: playbook.edges.length,
        tasks: playbook.tasks.map((task) => ({ id: task.id, title: task.title, description: task.description, assignedAgentId: task.assignedAgentId })),
        edges: playbook.edges.map((edge) => ({ sourceId: edge.sourceId, targetId: edge.targetId })),
      }, null, 2),
      default_agents: JSON.stringify(defaultAgents.data.map((agent) => ({
        agentSlug: agent.slug,
        name: agent.name,
        role: agent.role
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
      selected_task_title: selectedTask?.title || '',
      selected_task_description: selectedTask?.description || '',
      selected_task_id: selectedTask?.id || '',
      selected_task_context: JSON.stringify(this.buildSelectedTaskContext(playbook, selectedTask?.id || null), null, 2),
    });

    const response = await httpClient.post('/v1/chat/completions', {
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }, { timeout: 45000 });

    return {
      suggestions: this.normalizeSuggestions(this.extractChatCompletionText(response.data), dto, selectedTask?.id || null),
      model,
      settings: effectiveSettings,
    };
  }

  private buildSelectedTaskContext(playbook: Awaited<ReturnType<PlaybookService['findById']>>, selectedTaskId: string | null) {
    if (!selectedTaskId) {
      return { upstream: [], downstream: [] };
    }

    const upstreamTaskIds = playbook.edges.filter((edge) => edge.targetId === selectedTaskId).map((edge) => edge.sourceId);
    const downstreamTaskIds = playbook.edges.filter((edge) => edge.sourceId === selectedTaskId).map((edge) => edge.targetId);

    return {
      upstream: playbook.tasks.filter((task) => upstreamTaskIds.includes(task.id)).map((task) => ({ id: task.id, title: task.title, description: task.description })),
      downstream: playbook.tasks.filter((task) => downstreamTaskIds.includes(task.id)).map((task) => ({ id: task.id, title: task.title, description: task.description })),
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

  private normalizeSuggestions(raw: string, dto: RequestPlaybookIntentDto, selectedTaskId: string | null): PlaybookIntentSuggestion[] {
    try {
      const parsed = JSON.parse(raw || '{}') as { suggestions?: Array<Record<string, unknown>> };
      const suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
      const normalized = suggestions
        .slice(0, 6)
        .map((item, index) => this.normalizeSuggestion(item, index, selectedTaskId))
        .filter((item): item is PlaybookIntentSuggestion => item !== null);

      return [this.createFallbackSuggestion(dto, selectedTaskId), ...normalized];
    } catch {
      return [this.createFallbackSuggestion(dto, selectedTaskId)];
    }
  }

  private normalizeSuggestion(item: Record<string, unknown>, index: number, selectedTaskId: string | null): PlaybookIntentSuggestion | null {
    if (item.kind === 'workflow_plan' || Array.isArray(item.changes) || this.looksLikeWorkflowPlanImpact(item.impact)) {
      return this.normalizeWorkflowPlanSuggestion(item, index);
    }

    const label = this.normalizeText(item.label) || this.normalizeText(item.title);
    if (!label) {
      return null;
    }

    const operationType = this.normalizeOperationType(item.operationType, selectedTaskId);
    const taskTitle = this.normalizeText(item.taskTitle) || label;
    const taskDescription = this.normalizeText(item.taskDescription) || this.normalizeText(item.summary);
    const agentSlug = this.normalizeText(item.agentSlug);
    const templateType = this.normalizeText(item.templateType);

    return {
      id: `intent-${index}`,
      kind: 'single_change',
      label,
      summary: this.normalizeText(item.summary) || '',
      reason: this.normalizeText(item.reason) || '',
      confidence: this.normalizeConfidence(item.confidence),
      operationType,
      task: operationType === 'delete_node'
        ? null
        : {
          title: taskTitle,
          description: taskDescription,
          agentSlug: agentSlug || null,
          templateType: templateType || null,
        },
      targetTaskId: this.normalizeText(item.targetTaskId) || selectedTaskId,
      isDirectIntentFallback: false,
    };
  }

  private normalizeWorkflowPlanSuggestion(item: Record<string, unknown>, index: number): PlaybookIntentWorkflowPlanSuggestion | null {
    const label = this.normalizeText(item.label) || this.normalizeText(item.title);
    if (!label || !Array.isArray(item.changes)) {
      return null;
    }

    const changes = item.changes
      .slice(0, 8)
      .map((change) => this.normalizeWorkflowChange(change))
      .filter((change): change is PlaybookIntentWorkflowChange => change !== null);

    if (changes.length === 0) {
      return null;
    }

    return {
      id: `intent-${index}`,
      kind: 'workflow_plan',
      label,
      summary: this.normalizeText(item.summary) || '',
      reason: this.normalizeText(item.reason) || '',
      confidence: this.normalizeConfidence(item.confidence),
      impact: this.normalizeWorkflowImpact(item.impact, changes),
      changes,
      isDirectIntentFallback: false,
    };
  }

  private normalizeWorkflowChange(value: unknown): PlaybookIntentWorkflowChange | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const item = value as Record<string, unknown>;
    if (item.type === 'create_node') {
      const nodeRef = this.normalizeText(item.nodeRef);
      const task = this.normalizeTaskDraft(item.task, this.normalizeText(item.taskTitle), this.normalizeText(item.taskDescription));
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
      const targetTaskId = this.normalizeText(item.targetTaskId) || this.normalizeText(item.nodeRef);
      const task = this.normalizePartialTaskDraft(item.task, this.normalizeText(item.taskTitle), this.normalizeText(item.taskDescription));
      if (!targetTaskId || Object.keys(task).length === 0) {
        return null;
      }
      return { type: 'update_node', targetTaskId, task };
    }

    if (item.type === 'delete_node') {
      const targetTaskId = this.normalizeText(item.targetTaskId) || this.normalizeText(item.nodeRef);
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
      };
    }

    return null;
  }

  private normalizeWorkflowAnchor(value: unknown): PlaybookIntentWorkflowChange & { type: 'create_node' } extends { anchor: infer Anchor } ? Anchor : never {
    const item = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const mode = item.mode === 'before' || item.mode === 'after' || item.mode === 'append' || item.mode === 'as_input' ? item.mode : 'append';
    return {
      mode,
      targetTaskId: this.normalizeText(item.targetTaskId) || null,
      nodeRef: this.normalizeText(item.nodeRef) || null,
      targetTaskIds: this.normalizeTextArray(item.targetTaskIds),
      nodeRefs: this.normalizeTextArray(item.nodeRefs),
    };
  }

  private normalizeTaskDraft(value: unknown, fallbackTitle = '', fallbackDescription = ''): PlaybookIntentTaskDraft | null {
    const item = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const title = this.normalizeText(item.title) || fallbackTitle;
    const description = this.normalizeText(item.description) || fallbackDescription;
    const agentSlug = this.normalizeText(item.agentSlug);
    const templateType = this.normalizeText(item.templateType);
    const iteratorBody = this.normalizeIteratorBody(item.iteratorBody);
    return title
      ? {
        title,
        description,
        ...(agentSlug ? { agentSlug } : {}),
        ...(templateType ? { templateType } : {}),
        ...(iteratorBody ? { iteratorBody } : {}),
      }
      : null;
  }

  private normalizePartialTaskDraft(value: unknown, fallbackTitle = '', fallbackDescription = ''): Partial<PlaybookIntentTaskDraft> {
    const item = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const title = this.normalizeText(item.title) || fallbackTitle;
    const description = this.normalizeText(item.description) || fallbackDescription;
    const agentSlug = this.normalizeText(item.agentSlug);
    const templateType = this.normalizeText(item.templateType);
    const iteratorBody = this.normalizeIteratorBody(item.iteratorBody);
    return {
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
      ...(agentSlug ? { agentSlug } : {}),
      ...(templateType ? { templateType } : {}),
      ...(iteratorBody ? { iteratorBody } : {}),
    };
  }

  private normalizeIteratorBody(value: unknown): PlaybookIntentTaskDraft['iteratorBody'] | undefined {
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
          return {
            nodeRef,
            title,
            description,
            ...(agentSlug ? { agentSlug } : {}),
            ...(templateType ? { templateType } : {}),
          };
        })
        .filter((step): step is NonNullable<typeof step> => step !== null)
        .slice(0, 12)
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
          if (!sourceNodeRef || !targetNodeRef) {
            return null;
          }
          if (!validStepRefs.has(sourceNodeRef) || !validStepRefs.has(targetNodeRef)) {
            return null;
          }
          return { sourceNodeRef, targetNodeRef };
        })
        .filter((edge): edge is NonNullable<typeof edge> => edge !== null)
        .slice(0, 24)
      : [];

    return steps.length > 0 ? { steps, edges } : undefined;
  }

  private normalizeWorkflowImpact(value: unknown, changes: PlaybookIntentWorkflowChange[]): PlaybookIntentWorkflowPlanSuggestion['impact'] {
    const item = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const affectedTaskIds = Array.isArray(item.affectedTaskIds)
      ? item.affectedTaskIds.map((id) => this.normalizeText(id)).filter(Boolean).slice(0, 20)
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

  private createFallbackSuggestion(dto: RequestPlaybookIntentDto, selectedTaskId: string | null): PlaybookIntentSuggestion {
    const normalizedIntent = dto.intent.trim();

    return {
      id: 'intent-fallback',
      kind: 'single_change',
      label: '',
      summary: normalizedIntent,
      reason: '',
      confidence: 1,
      operationType: selectedTaskId ? 'update_node' : 'create_node',
      task: {
        title: normalizedIntent.slice(0, 120),
        description: normalizedIntent,
      },
      targetTaskId: selectedTaskId,
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

  private normalizeOperationType(value: unknown, selectedTaskId: string | null): PlaybookIntentOperationType {
    return value === 'create_node'
      || value === 'insert_before'
      || value === 'insert_after'
      || value === 'update_node'
      || value === 'delete_node'
      ? value
      : selectedTaskId
        ? 'insert_after'
        : 'create_node';
  }
}
