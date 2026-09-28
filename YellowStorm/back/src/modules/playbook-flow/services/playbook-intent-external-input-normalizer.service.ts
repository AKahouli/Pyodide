import { Injectable } from '@nestjs/common';
import type { PlaybookIntentDiagnostic } from '../interfaces/playbook-flow-intent-diagnostic.interface';
import type { DataBinding } from '../models/playbook-flow.model';
import {
  createManagedPlaybookInputPath,
  isCompleteDataBinding,
  isManagedPlaybookInputPath,
} from '../utils/playbook-managed-input.util';
import type {
  PlaybookIntentAnalysisContext,
  PlaybookIntentSuggestion,
  PlaybookIntentWorkflowChange,
  ResolvedDesignResource,
} from './playbook-flow-intent.service';

type WorkflowPlan = Extract<PlaybookIntentSuggestion, { kind: 'workflow_plan' }>;
type CreateBinding = Extract<PlaybookIntentWorkflowChange, { type: 'create_data_binding' }>;

const CONFIGURATION_TERMS = [
  'destination workspace', 'output workspace', 'destination folder', 'output folder',
  'save location', 'archive location', 'recipient configuration',
];

@Injectable()
export class PlaybookIntentExternalInputNormalizerService {
  normalize(
    suggestion: WorkflowPlan,
    context: PlaybookIntentAnalysisContext,
  ): { suggestion: WorkflowPlan; diagnostics: PlaybookIntentDiagnostic[] } {
    const diagnostics: PlaybookIntentDiagnostic[] = [];
    let changes = [...suggestion.changes];
    const usedPaths = new Set<string>();
    for (const binding of context.flow.dataBindings ?? []) {
      if (binding.sourceKind === 'trigger' && isManagedPlaybookInputPath(binding.triggerPath)) usedPaths.add(binding.triggerPath);
    }
    for (const change of changes) {
      if (change.type === 'create_data_binding' && change.sourceKind === 'trigger' && isManagedPlaybookInputPath(change.triggerPath)) {
        usedPaths.add(change.triggerPath);
      }
    }

    for (const target of this.requiredTargets(changes)) {
      const generatedBindings = changes.filter((change): change is CreateBinding => change.type === 'create_data_binding'
        && this.sameTarget(change, target.taskId, target.nodeRef, target.portId));
      const existingBindings = target.taskId
        ? (context.flow.dataBindings ?? []).filter((binding: DataBinding) => binding.targetNode === target.taskId && binding.targetPort === target.portId)
        : [];
      const validInternal = generatedBindings.find((binding) => binding.sourceKind === 'node-output' || binding.sourceKind === 'state');
      if (validInternal || this.hasGeneratedRouterControl(changes, target.taskId, target.nodeRef, target.portId)) continue;

      const existing = existingBindings.length === 1 ? existingBindings[0] : undefined;
      if (existing && isCompleteDataBinding(existing)) {
        if (existing.sourceKind !== 'trigger' || isManagedPlaybookInputPath(existing.triggerPath)) continue;
      }

      const trustedConstant = this.resolveTrustedConstant(generatedBindings, target.semanticText, context.resolvedDesignResources);
      changes = changes.filter((change) => change.type !== 'create_data_binding'
        || !this.sameTarget(change, target.taskId, target.nodeRef, target.portId));
      if (trustedConstant.kind === 'ambiguous') {
        diagnostics.push({
          severity: 'warning',
          stage: 'repair',
          code: 'ambiguous_external_resource',
          itemId: `${target.nodeRef || target.taskId}.${target.portId}`,
          message: `Multiple trusted resources could configure ${target.portId}; a run-time binding was retained.`,
          repairable: true,
        });
      }
      if (trustedConstant.kind === 'resolved') {
        changes.push(this.constantBinding(target, trustedConstant.resource));
        continue;
      }
      const generatedTrigger = generatedBindings.find((binding): binding is Extract<CreateBinding, { sourceKind: 'trigger' }> =>
        binding.sourceKind === 'trigger' && isManagedPlaybookInputPath(binding.triggerPath));
      const preservedPath = existing?.sourceKind === 'trigger' && isManagedPlaybookInputPath(existing.triggerPath)
        ? existing.triggerPath
        : generatedTrigger?.triggerPath;
      changes.push({
        type: 'create_data_binding',
        targetTaskId: target.taskId,
        targetNodeRef: target.nodeRef,
        targetPort: target.portId,
        sourceKind: 'trigger',
        triggerPath: preservedPath || createManagedPlaybookInputPath(target.taskId || target.nodeRef || 'node', target.portId, usedPaths),
      });
    }

    return { suggestion: { ...suggestion, changes }, diagnostics };
  }

  private requiredTargets(changes: PlaybookIntentWorkflowChange[]): Array<{
    taskId: string | null; nodeRef: string | null; portId: string; semanticText: string;
  }> {
    return changes.flatMap((change) => {
      if (change.type !== 'create_node' && change.type !== 'update_node') return [];
      const taskId = change.type === 'update_node' ? change.targetTaskId : null;
      const nodeRef = change.type === 'create_node' ? change.nodeRef : null;
      const task = change.task;
      return (task.inputPorts ?? []).filter((port) => port.required === true).map((port) => ({
        taskId,
        nodeRef,
        portId: port.id,
        semanticText: [task.title, task.description, port.id, port.name].filter(Boolean).join(' ').toLowerCase(),
      }));
    });
  }

  private sameTarget(change: CreateBinding, taskId: string | null, nodeRef: string | null, portId: string): boolean {
    return change.targetPort === portId
      && (taskId ? change.targetTaskId === taskId : change.targetNodeRef === nodeRef);
  }

  private hasGeneratedRouterControl(
    changes: PlaybookIntentWorkflowChange[],
    taskId: string | null,
    nodeRef: string | null,
    portId: string,
  ): boolean {
    const routerRefs = new Set(changes.flatMap((change) => change.type === 'create_node' && change.task.routerConfig ? [change.nodeRef] : []));
    return changes.some((change) => change.type === 'create_edge'
      && change.edgeKind === 'conditional'
      && Boolean(change.sourceNodeRef && routerRefs.has(change.sourceNodeRef))
      && (taskId ? change.targetTaskId === taskId : change.targetNodeRef === nodeRef)
      && (change.targetInputPortId || 'default') === portId);
  }

  private resolveTrustedConstant(
    generated: CreateBinding[],
    semanticText: string,
    resources: ResolvedDesignResource[],
  ): { kind: 'none' } | { kind: 'ambiguous' } | { kind: 'resolved'; resource: ResolvedDesignResource } {
    if (!CONFIGURATION_TERMS.some((term) => semanticText.includes(term))) return { kind: 'none' };
    const workspaces = resources.filter((resource) => resource.kind === 'workspace');
    const proposed = generated.find((binding) => binding.sourceKind === 'constant');
    if (proposed?.sourceKind === 'constant' && proposed.constantValue && typeof proposed.constantValue === 'object') {
      const value = proposed.constantValue as Record<string, unknown>;
      const exact = workspaces.filter((resource) => resource.id === value.id
        && (resource.workspaceId || resource.id) === value.workspaceId);
      if (exact.length === 1) return { kind: 'resolved', resource: exact[0] };
    }
    if (workspaces.length === 1) return { kind: 'resolved', resource: workspaces[0] };
    return workspaces.length > 1 ? { kind: 'ambiguous' } : { kind: 'none' };
  }

  private constantBinding(
    target: { taskId: string | null; nodeRef: string | null; portId: string },
    resource: ResolvedDesignResource,
  ): CreateBinding {
    return {
      type: 'create_data_binding',
      targetTaskId: target.taskId,
      targetNodeRef: target.nodeRef,
      targetPort: target.portId,
      sourceKind: 'constant',
      constantValue: {
        kind: resource.kind,
        id: resource.id,
        workspaceId: resource.workspaceId || resource.id,
        workspaceName: resource.workspaceName,
        label: resource.label,
      },
    };
  }
}
