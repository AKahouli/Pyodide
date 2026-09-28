import { Injectable, Logger } from '@nestjs/common';
import type { RequestPlaybookFlowIntentDto } from '../dto/request-playbook-flow-intent.dto';
import { PlaybookIntentGraphBindingResolverService } from './playbook-intent-graph-binding-resolver.service';
import { parseDesignResourceLine } from '../utils/playbook-flow-safe-text.util';
const ROUTER_CONDITION_OPERATORS = ['equals', 'not_equals', 'contains', 'exists', 'gt', 'gte', 'lt', 'lte', 'in', 'not_in'] as const;

import type {
  IntentNormalizationLimits,
  IntentWorkflowValidationContext,
  PlaybookIntentOperationType,
  PlaybookIntentSuggestion,
  PlaybookIntentTaskDraft,
  PlaybookIntentWorkflowChange,
  PlaybookIntentWorkflowPlanSuggestion,
  ResolvedDesignResourceBindingValue,
} from './playbook-flow-intent.service';

/**
 * Normalizes raw intent LLM output (legacy single-shot path) into typed,
 * validated suggestions. Uses PlaybookIntentGraphBindingResolverService to
 * anchor workflow-plan changes onto the existing graph.
 */
@Injectable()
export class PlaybookIntentSuggestionNormalizerService {
  private readonly logger = new Logger(PlaybookIntentSuggestionNormalizerService.name);

  constructor(
    private readonly graphBindingResolver: PlaybookIntentGraphBindingResolverService = new PlaybookIntentGraphBindingResolverService(),
  ) {}

  normalizeSuggestions(
    raw: string,
    dto: RequestPlaybookFlowIntentDto,
    selectedNodeId: string | null,
    limits: IntentNormalizationLimits,
    validationContext: IntentWorkflowValidationContext,
    includeFallback = true,
  ): PlaybookIntentSuggestion[] {
    try {
      const parsed = JSON.parse(raw || '{}') as { suggestions?: Array<Record<string, unknown>> };
      const suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
      const normalized = suggestions
        .slice(0, 6)
        .map((item, index) => this.normalizeSuggestion(item, index, selectedNodeId, limits, validationContext))
        .filter((item): item is PlaybookIntentSuggestion => item !== null);

      return includeFallback ? [this.createFallbackSuggestion(dto, selectedNodeId), ...normalized] : normalized;
    } catch {
      return includeFallback ? [this.createFallbackSuggestion(dto, selectedNodeId)] : [];
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
    const nodeTemplateKey = this.normalizeText(item.nodeTemplateKey) || this.normalizeText(nestedTask?.nodeTemplateKey);
    const inputPorts = nestedTask ? this.normalizeInputPorts(nestedTask.inputPorts, limits) : [];
    const outputPorts = nestedTask ? this.normalizeOutputPorts(nestedTask.outputPorts, limits) : [];

    const task = operationType === 'delete_node'
      ? null
      : operationType === 'update_node'
        ? {
          ...(taskTitle ? { title: taskTitle } : {}),
          description: taskDescription,
          ...(agentSlug ? { agentSlug } : {}),
          ...(nodeTemplateKey ? { nodeTemplateKey } : {}),
          ...(inputPorts.length ? { inputPorts } : {}),
          ...(outputPorts.length ? { outputPorts } : {}),
        }
        : {
          title: taskTitle || label,
          description: taskDescription,
          agentSlug: agentSlug || null,
          nodeTemplateKey: nodeTemplateKey || null,
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

    const resolved = this.graphBindingResolver.resolveWorkflowChanges({
      changes: acceptedChanges,
      context: ctx,
      deletedTaskIds,
    });
    const resolvedChanges = resolved.changes;

    if (resolvedChanges.length === 0) {
      return null;
    }

    return {
      id: `intent-${index}`,
      kind: 'workflow_plan',
      label,
      summary: this.normalizeText(item.summary) || '',
      reason: this.normalizeText(item.reason) || '',
      confidence: this.normalizeConfidence(item.confidence),
      impact: this.normalizeWorkflowImpact(item.impact, resolvedChanges),
      changes: resolvedChanges,
      isDirectIntentFallback: false,
    };
  }

  normalizeComparableTitle(value: string): string {
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
      const newDescription = this.normalizeComparableTitle(change.task.description || '');
      const newAgent = change.task.agentSlug || null;
      for (const [taskId, existingTitle] of ctx.existingTaskTitles) {
        if (existingTitle === newTitle) {
          const existingAgent = ctx.existingTaskAgents.get(taskId);
          if (existingAgent === newAgent) {
            return null;
          }
          const existingDescription = ctx.existingTaskDescriptions.get(taskId) ?? '';
          if (existingDescription === newDescription) {
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
      const targetValid = this.resolveTaskRef(change.targetTaskId, change.targetNodeRef, ctx.existingTaskIds, createdNodeRefs);
      if (!targetValid) {
        return null;
      }

      if (change.sourceKind === 'constant' || change.sourceKind === 'state' || change.sourceKind === 'trigger') {
        if (change.targetTaskId && ctx.existingTaskIds.has(change.targetTaskId)) {
          const inputPorts = ctx.inputPortsByTaskId.get(change.targetTaskId);
          if (inputPorts && change.targetPort && !inputPorts.has(change.targetPort)) {
            return null;
          }
        }
        if (change.sourceKind === 'state' && !change.statePath.trim()) return null;
        if (change.sourceKind === 'trigger' && !change.triggerPath.trim()) return null;
        return change;
      }

      const sourceValid = this.resolveTaskRef(change.sourceTaskId, change.sourceNodeRef, ctx.existingTaskIds, createdNodeRefs);
      if (!sourceValid) {
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
      const sourceIteratorNodeRef = this.normalizeText(item.sourceIteratorNodeRef) || this.normalizeText(item.sourceIteratorRef);
      const targetTaskId = this.normalizeText(item.targetTaskId);
      const targetNodeRef = this.normalizeText(item.targetNodeRef) || this.normalizeText(item.targetRef) || this.normalizeText(item.toNodeRef);
      const targetIteratorNodeRef = this.normalizeText(item.targetIteratorNodeRef) || this.normalizeText(item.targetIteratorRef);

      if (!(sourceTaskId || sourceNodeRef) || !(targetTaskId || targetNodeRef)) {
        return null;
      }

      return {
        type: item.type,
        sourceTaskId: sourceTaskId || null,
        sourceNodeRef: sourceNodeRef || null,
        ...(sourceIteratorNodeRef ? { sourceIteratorNodeRef } : {}),
        targetTaskId: targetTaskId || null,
        targetNodeRef: targetNodeRef || null,
        ...(targetIteratorNodeRef ? { targetIteratorNodeRef } : {}),
        ...(this.normalizeText(item.sourceOutputPortId) ? { sourceOutputPortId: this.normalizeText(item.sourceOutputPortId) } : {}),
        ...(this.normalizeText(item.targetInputPortId) ? { targetInputPortId: this.normalizeText(item.targetInputPortId) } : {}),
      };
    }

    if (item.type === 'create_data_binding') {
      const targetTaskId = this.normalizeText(item.targetTaskId);
      const targetNodeRef = this.normalizeText(item.targetNodeRef);
      const targetIteratorNodeRef = this.normalizeText(item.targetIteratorNodeRef) || this.normalizeText(item.targetIteratorRef);
      const targetPort = this.normalizeText(item.targetPort);
      if (!targetPort || !(targetTaskId || targetNodeRef)) {
        return null;
      }
      const sourceTaskId = this.normalizeText(item.sourceTaskId);
      const sourceNodeRef = this.normalizeText(item.sourceNodeRef);
      const sourceIteratorNodeRef = this.normalizeText(item.sourceIteratorNodeRef) || this.normalizeText(item.sourceIteratorRef);
      const sourcePort = this.normalizeText(item.sourcePort);
      if (item.sourceKind === 'constant') {
        const constantValue = this.normalizeResolvedDesignResourceBindingValue(item.constantValue);
        return constantValue ? {
          type: 'create_data_binding',
          targetTaskId: targetTaskId || null,
          targetNodeRef: targetNodeRef || null,
          ...(targetIteratorNodeRef ? { targetIteratorNodeRef } : {}),
          targetPort,
          sourceKind: 'constant',
          constantValue,
        } : null;
      }

      if (item.sourceKind === 'state') {
        const statePath = this.normalizeText(item.statePath);
        return statePath ? {
          type: 'create_data_binding',
          targetTaskId: targetTaskId || null,
          targetNodeRef: targetNodeRef || null,
          ...(targetIteratorNodeRef ? { targetIteratorNodeRef } : {}),
          targetPort,
          sourceKind: 'state',
          statePath,
        } : null;
      }

      if (item.sourceKind === 'trigger') {
        const triggerPath = this.normalizeText(item.triggerPath);
        return triggerPath ? {
          type: 'create_data_binding',
          targetTaskId: targetTaskId || null,
          targetNodeRef: targetNodeRef || null,
          ...(targetIteratorNodeRef ? { targetIteratorNodeRef } : {}),
          targetPort,
          sourceKind: 'trigger',
          triggerPath,
        } : null;
      }

      if (item.sourceKind !== 'node-output' || !(sourceTaskId || sourceNodeRef) || !sourcePort) {
        return null;
      }
      return {
        type: 'create_data_binding',
        targetTaskId: targetTaskId || null,
        targetNodeRef: targetNodeRef || null,
        ...(targetIteratorNodeRef ? { targetIteratorNodeRef } : {}),
        targetPort,
        sourceKind: 'node-output',
        sourceTaskId: sourceTaskId || null,
        sourceNodeRef: sourceNodeRef || null,
        ...(sourceIteratorNodeRef ? { sourceIteratorNodeRef } : {}),
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

  private normalizeResolvedDesignResourceBindingValue(value: unknown): ResolvedDesignResourceBindingValue | null {
    const item = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const kind = this.normalizeText(item.kind);
    const id = this.normalizeText(item.id);
    const workspaceId = this.normalizeText(item.workspaceId) || (kind === 'workspace' ? id : '');
    if ((kind !== 'document' && kind !== 'workspace') || !id || !workspaceId) {
      return null;
    }

    return {
      kind,
      id,
      workspaceId,
      ...(kind === 'document' ? { documentId: this.normalizeText(item.documentId) || id } : {}),
      ...(this.normalizeText(item.question) ? { question: this.normalizeText(item.question) } : { question: '' }),
      ...(this.normalizeText(item.label) ? { label: this.normalizeText(item.label) } : { label: '' }),
      ...(this.normalizeText(item.workspaceName) ? { workspaceName: this.normalizeText(item.workspaceName) } : {}),
      ...(this.normalizeText(item.path) ? { path: this.normalizeText(item.path) } : {}),
      ...(this.normalizeText(item.mimeType) ? { mimeType: this.normalizeText(item.mimeType) } : {}),
    };
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
    const nodeTemplateKey = this.normalizeText(item.nodeTemplateKey);
    const nodeType = this.normalizeNodeType(item.nodeType);
    const taskType = this.normalizeText(item.taskType);
    const routerConfig = this.normalizeRouterConfig(item.routerConfig, title || fallbackTitle || 'create_node');
    const humanApprovalConfig = this.normalizeRecord(item.humanApprovalConfig);
    const inputPorts = this.normalizeInputPorts(item.inputPorts, limits);
    const outputPorts = this.normalizeOutputPorts(item.outputPorts, limits);
    const iteratorBody = this.normalizeIteratorBody(item.iteratorBody, limits);
    return title
      ? {
        title,
        description,
        ...(agentSlug ? { agentSlug } : {}),
        ...(nodeTemplateKey ? { nodeTemplateKey } : {}),
        ...(nodeType ? { nodeType } : {}),
        ...(taskType ? { taskType } : {}),
        ...(routerConfig ? { routerConfig } : {}),
        ...(humanApprovalConfig ? { humanApprovalConfig } : {}),
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
    const nodeTemplateKey = this.normalizeText(item.nodeTemplateKey);
    const nodeType = this.normalizeNodeType(item.nodeType);
    const taskType = this.normalizeText(item.taskType);
    const routerConfig = this.normalizeRouterConfig(item.routerConfig, title || fallbackTitle || 'update_node');
    const humanApprovalConfig = this.normalizeRecord(item.humanApprovalConfig);
    const inputPorts = this.normalizeInputPorts(item.inputPorts, limits);
    const outputPorts = this.normalizeOutputPorts(item.outputPorts, limits);
    const iteratorBody = this.normalizeIteratorBody(item.iteratorBody, limits);
    return {
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
      ...(agentSlug ? { agentSlug } : {}),
      ...(nodeTemplateKey ? { nodeTemplateKey } : {}),
      ...(nodeType ? { nodeType } : {}),
      ...(taskType ? { taskType } : {}),
      ...(routerConfig ? { routerConfig } : {}),
      ...(humanApprovalConfig ? { humanApprovalConfig } : {}),
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
          const nodeTemplateKey = this.normalizeText(draft.nodeTemplateKey);
          const nodeType = this.normalizeNodeType(draft.nodeType);
          const taskType = this.normalizeText(draft.taskType);
          const routerConfig = this.normalizeRouterConfig(draft.routerConfig, nodeRef);
          const humanApprovalConfig = this.normalizeRecord(draft.humanApprovalConfig);
          const inputPorts = this.normalizeInputPorts(draft.inputPorts, limits);
          const outputPorts = this.normalizeOutputPorts(draft.outputPorts, limits);
          return {
            nodeRef,
            title,
            description,
            ...(agentSlug ? { agentSlug } : {}),
            ...(nodeTemplateKey ? { nodeTemplateKey } : {}),
            ...(nodeType ? { nodeType } : {}),
            ...(taskType ? { taskType } : {}),
            ...(routerConfig ? { routerConfig } : {}),
            ...(humanApprovalConfig ? { humanApprovalConfig } : {}),
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
      nodesToCreate: changes.filter((change) => change.type === 'create_node').length,
      nodesToUpdate: changes.filter((change) => change.type === 'update_node').length,
      nodesToDelete: changes.filter((change) => change.type === 'delete_node').length,
      edgesToCreate: changes.filter((change) => change.type === 'create_edge').length,
      edgesToDelete: changes.filter((change) => change.type === 'delete_edge').length,
      dataBindingsToCreate: changes.filter((change) => change.type === 'create_data_binding').length,
      dataBindingsToDelete: changes.filter((change) => change.type === 'delete_data_binding').length,
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

  private normalizeNodeType(value: unknown): PlaybookIntentTaskDraft['nodeType'] | undefined {
    const nodeType = this.normalizeText(value);
    if (nodeType === 'agent' || nodeType === 'action' || nodeType === 'evaluation' || nodeType === 'iterator' || nodeType === 'router' || nodeType === 'human_approval') {
      return nodeType;
    }
    return undefined;
  }

  private normalizeRouterConfig(value: unknown, itemId: string): PlaybookIntentTaskDraft['routerConfig'] | undefined {
    const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
    if (!raw) return undefined;
    const outputLabels = Array.isArray(raw.outputLabels)
      ? raw.outputLabels.map((label) => this.normalizeText(label)).filter(Boolean)
      : [];
    if (outputLabels.length === 0) {
      this.logger.warn(`playbook_intent_direct_plan_drop rule=router_config_missing_output_labels item=${itemId}`);
      return undefined;
    }
    const defaultLabel = this.normalizeText(raw.defaultLabel);
    const conditions = this.normalizeRouterConditions(raw.conditions, itemId, outputLabels);
    const mode = this.normalizeText(raw.mode);
    const prompt = this.normalizeText(raw.prompt);
    return {
      outputLabels: [...new Set(outputLabels)],
      ...(typeof raw.maxIterations === 'number' ? { maxIterations: raw.maxIterations } : {}),
      ...(defaultLabel ? { defaultLabel } : {}),
      ...(conditions.length ? { conditions } : {}),
      ...(mode === 'ai' || mode === 'deterministic' ? { mode } : {}),
      ...(prompt ? { prompt } : {}),
    };
  }

  private normalizeRouterConditions(
    value: unknown,
    itemId: string,
    outputLabels: string[],
  ): NonNullable<NonNullable<PlaybookIntentTaskDraft['routerConfig']>['conditions']> {
    if (!Array.isArray(value)) return [];
    return value
      .map((condition, index) => {
        const raw = condition && typeof condition === 'object' && !Array.isArray(condition) ? condition as Record<string, unknown> : null;
        if (!raw) return null;
        const label = this.normalizeText(raw.label);
        const sourceNode = this.normalizeText(raw.sourceNode);
        const sourcePort = this.normalizeText(raw.sourcePort);
        const operator = this.normalizeText(raw.operator) as NonNullable<NonNullable<PlaybookIntentTaskDraft['routerConfig']>['conditions']>[number]['operator'];
        if (!label || !outputLabels.includes(label) || !sourcePort || !(ROUTER_CONDITION_OPERATORS as readonly string[]).includes(operator)) {
          this.logger.warn(`playbook_intent_direct_plan_drop rule=router_condition_invalid item=${itemId}:${index}`);
          return null;
        }
        return {
          label,
          ...(sourceNode ? { sourceNode } : {}),
          sourcePort,
          ...(this.normalizeText(raw.path) ? { path: this.normalizeText(raw.path) } : {}),
          operator,
          ...(Object.prototype.hasOwnProperty.call(raw, 'value') ? { value: raw.value } : {}),
        };
      })
      .filter((condition): condition is NonNullable<typeof condition> => condition !== null);
  }

  private normalizeRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : undefined;
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
