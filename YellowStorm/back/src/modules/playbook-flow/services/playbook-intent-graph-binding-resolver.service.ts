import { Injectable, Logger } from '@nestjs/common';
import type {
  IntentWorkflowValidationContext,
  PlaybookIntentTaskDraft,
  PlaybookIntentWorkflowChange,
} from './playbook-flow-intent.service';

type ArtifactKind = 'text' | 'document' | 'code' | 'image' | 'data' | 'dashboard';
type CreateEdgeChange = Extract<PlaybookIntentWorkflowChange, { type: 'create_edge' | 'delete_edge' }> & { type: 'create_edge' };
type CreateBindingChange = Extract<PlaybookIntentWorkflowChange, { type: 'create_data_binding' }>;

interface PortCatalog {
  inputPorts: Map<string, Map<string, ArtifactKind>>;
  outputPorts: Map<string, Map<string, ArtifactKind>>;
  nodeRefToTaskId: Map<string, string>;
}

interface ResolveParams {
  changes: PlaybookIntentWorkflowChange[];
  context: IntentWorkflowValidationContext;
  deletedTaskIds: Set<string>;
}

@Injectable()
export class PlaybookIntentGraphBindingResolverService {
  private readonly logger = new Logger(PlaybookIntentGraphBindingResolverService.name);

  resolveWorkflowChanges(params: ResolveParams): PlaybookIntentWorkflowChange[] {
    const catalog = this.buildCatalog(params.changes, params.context);
    const accepted: PlaybookIntentWorkflowChange[] = [];
    const edges = new Map<string, PlaybookIntentWorkflowChange>();
    const bindings = new Map<string, PlaybookIntentWorkflowChange>();

    for (const change of params.changes) {
      if (change.type === 'create_edge') {
        const edge = this.resolveEdge(change as CreateEdgeChange, catalog, params.deletedTaskIds);
        if (edge) this.setUnique(edges, this.edgeKey(edge), edge, 'duplicate_edge');
        continue;
      }
      if (change.type === 'create_data_binding') {
        const binding = this.resolveBinding(change, catalog, params.context, params.deletedTaskIds);
        if (binding) this.setUnique(bindings, this.bindingKey(binding), binding, 'duplicate_binding_target');
        continue;
      }
      accepted.push(change);
    }

    for (const edge of edges.values()) {
      accepted.push(edge);
      const binding = this.bindingFromEdge(edge as CreateEdgeChange, catalog, params.context);
      if (binding && !bindings.has(this.bindingKey(binding))) {
        bindings.set(this.bindingKey(binding), binding);
      }
    }

    accepted.push(...bindings.values());
    return accepted;
  }

  private buildCatalog(changes: PlaybookIntentWorkflowChange[], context: IntentWorkflowValidationContext): PortCatalog {
    const inputPorts = new Map(context.inputPortsByTaskId) as Map<string, Map<string, ArtifactKind>>;
    const outputPorts = new Map(context.outputPortsByTaskId) as Map<string, Map<string, ArtifactKind>>;
    const nodeRefToTaskId = new Map<string, string>();

    for (const change of changes) {
      if (change.type !== 'create_node') continue;
      nodeRefToTaskId.set(change.nodeRef, change.nodeRef);
      inputPorts.set(change.nodeRef, this.portMap(change.task.inputPorts));
      outputPorts.set(change.nodeRef, this.portMap(change.task.outputPorts));
      for (const step of change.task.iteratorBody?.steps || []) {
        const scopedRef = this.scopedRef(change.nodeRef, step.nodeRef);
        nodeRefToTaskId.set(scopedRef, scopedRef);
        inputPorts.set(scopedRef, this.portMap(step.inputPorts));
        outputPorts.set(scopedRef, this.portMap(step.outputPorts));
      }
    }

    return { inputPorts, outputPorts, nodeRefToTaskId };
  }

  private portMap(ports: PlaybookIntentTaskDraft['inputPorts'] | PlaybookIntentTaskDraft['outputPorts']): Map<string, ArtifactKind> {
    return new Map((ports || []).map((port) => [port.id, port.artifactKind]));
  }

  private resolveEdge(
    edge: CreateEdgeChange,
    catalog: PortCatalog,
    deletedTaskIds: Set<string>,
  ): PlaybookIntentWorkflowChange | null {
    const sourceId = this.resolveTaskId(edge.sourceTaskId, edge.sourceNodeRef, edge.sourceIteratorNodeRef || null, catalog);
    const targetId = this.resolveTaskId(edge.targetTaskId, edge.targetNodeRef, edge.targetIteratorNodeRef || null, catalog);
    if (!sourceId || !targetId || deletedTaskIds.has(sourceId) || deletedTaskIds.has(targetId)) {
      this.warnDrop('edge_unresolved_task', `${edge.sourceTaskId || edge.sourceNodeRef || '?'}->${edge.targetTaskId || edge.targetNodeRef || '?'}`);
      return null;
    }

    const sourcePorts = catalog.outputPorts.get(sourceId);
    const targetPorts = catalog.inputPorts.get(targetId);
    let sourcePort = this.resolvePort(sourcePorts, edge.sourceOutputPortId || null, null);
    let targetPort = this.resolvePort(targetPorts, edge.targetInputPortId || null, sourcePort.kind);

    if (edge.sourceOutputPortId && !sourcePort.id) {
      const requestedTargetPort = this.resolvePort(targetPorts, edge.targetInputPortId || null, null);
      sourcePort = this.resolvePort(sourcePorts, edge.sourceOutputPortId, requestedTargetPort.kind, true);
      if (sourcePort.id) {
        targetPort = this.resolvePort(targetPorts, edge.targetInputPortId || null, sourcePort.kind, true);
        this.warnDrop('edge_port_fallback', `${sourceId}.${edge.sourceOutputPortId}->${sourceId}.${sourcePort.id}`);
      }
    }

    if (edge.targetInputPortId && !targetPort.id) {
      targetPort = this.resolvePort(targetPorts, edge.targetInputPortId, sourcePort.kind, true);
      if (targetPort.id) {
        this.warnDrop('edge_port_fallback', `${targetId}.${edge.targetInputPortId}->${targetId}.${targetPort.id}`);
      }
    }

    if ((edge.sourceOutputPortId && !sourcePort.id) || (edge.targetInputPortId && !targetPort.id)) {
      this.warnDrop('edge_unknown_port', `${sourceId}.${edge.sourceOutputPortId || '?'}->${targetId}.${edge.targetInputPortId || '?'}`);
      return null;
    }
    if (sourcePort.kind && targetPort.kind && sourcePort.kind !== targetPort.kind) {
      this.warnDrop('edge_artifact_mismatch', `${sourceId}.${sourcePort.id || '?'}->${targetId}.${targetPort.id || '?'}`);
      return {
        ...edge,
        ...(sourcePort.id ? { sourceOutputPortId: sourcePort.id } : {}),
        ...(targetPort.id ? { targetInputPortId: targetPort.id } : {}),
      };
    }
    return {
      ...edge,
      ...(sourcePort.id ? { sourceOutputPortId: sourcePort.id } : {}),
      ...(targetPort.id ? { targetInputPortId: targetPort.id } : {}),
    };
  }

  private resolveBinding(
    binding: CreateBindingChange,
    catalog: PortCatalog,
    context: IntentWorkflowValidationContext,
    deletedTaskIds: Set<string>,
  ): PlaybookIntentWorkflowChange | null {
    const targetId = this.resolveTaskId(binding.targetTaskId, binding.targetNodeRef, binding.targetIteratorNodeRef || null, catalog);
    if (!targetId || deletedTaskIds.has(targetId)) {
      this.warnDrop('binding_unresolved_target', `${binding.targetTaskId || binding.targetNodeRef || '?'}.${binding.targetPort}`);
      return null;
    }

    const targetPort = this.resolvePort(catalog.inputPorts.get(targetId), binding.targetPort, null);
    if (!targetPort.id) {
      this.warnDrop('binding_unknown_target_port', `${targetId}.${binding.targetPort}`);
      return null;
    }
    if (context.existingBindingTargets.has(`${targetId}:${targetPort.id}`)) {
      this.warnDrop('existing_binding_target', `${targetId}.${targetPort.id}`);
      return null;
    }

    if (binding.sourceKind === 'constant') {
      return { ...binding, targetPort: targetPort.id };
    }

    const sourceId = this.resolveTaskId(binding.sourceTaskId, binding.sourceNodeRef, binding.sourceIteratorNodeRef || null, catalog);
    if (!sourceId || deletedTaskIds.has(sourceId)) {
      this.warnDrop('binding_unresolved_source', `${binding.sourceTaskId || binding.sourceNodeRef || '?'}->${targetId}.${targetPort.id}`);
      return null;
    }
    const sourcePort = this.resolvePort(catalog.outputPorts.get(sourceId), binding.sourcePort || null, targetPort.kind);
    if (!sourcePort.id || sourcePort.kind !== targetPort.kind) {
      this.warnDrop('binding_artifact_mismatch', `${sourceId}.${binding.sourcePort || '?'}->${targetId}.${targetPort.id}`);
      return null;
    }

    return { ...binding, sourcePort: sourcePort.id, targetPort: targetPort.id };
  }

  private bindingFromEdge(
    edge: CreateEdgeChange,
    catalog: PortCatalog,
    context: IntentWorkflowValidationContext,
  ): PlaybookIntentWorkflowChange | null {
    const sourceId = this.resolveTaskId(edge.sourceTaskId, edge.sourceNodeRef, edge.sourceIteratorNodeRef || null, catalog);
    const targetId = this.resolveTaskId(edge.targetTaskId, edge.targetNodeRef, edge.targetIteratorNodeRef || null, catalog);
    if (!sourceId || !targetId || !edge.sourceOutputPortId || !edge.targetInputPortId) return null;
    if (context.existingBindingTargets.has(`${targetId}:${edge.targetInputPortId}`)) return null;

    const sourceKind = catalog.outputPorts.get(sourceId)?.get(edge.sourceOutputPortId);
    const targetKind = catalog.inputPorts.get(targetId)?.get(edge.targetInputPortId);
    if (!sourceKind || !targetKind || sourceKind !== targetKind) return null;

    // Edges and bindings are separate canvas contracts; synthesize the binding so runtime data flow is not lost.
    return {
      type: 'create_data_binding',
      sourceKind: 'node-output',
      sourceTaskId: edge.sourceTaskId,
      sourceNodeRef: edge.sourceNodeRef,
      ...(edge.sourceIteratorNodeRef ? { sourceIteratorNodeRef: edge.sourceIteratorNodeRef } : {}),
      sourcePort: edge.sourceOutputPortId,
      targetTaskId: edge.targetTaskId,
      targetNodeRef: edge.targetNodeRef,
      ...(edge.targetIteratorNodeRef ? { targetIteratorNodeRef: edge.targetIteratorNodeRef } : {}),
      targetPort: edge.targetInputPortId,
      iteration: 'current',
    };
  }

  private resolvePort(
    ports: Map<string, ArtifactKind> | undefined,
    requested: string | null,
    requiredKind: ArtifactKind | null,
    allowRequestedFallback = false,
  ): { id: string | null; kind: ArtifactKind | null } {
    if (!ports || ports.size === 0) return { id: requested, kind: null };
    if (requested && ports.has(requested)) return { id: requested, kind: ports.get(requested) || null };
    if (requested && !allowRequestedFallback) return { id: null, kind: null };
    if (!requiredKind) return { id: null, kind: null };

    const candidates = [...ports.entries()].filter(([, kind]) => kind === requiredKind);
    // Ambiguous inference is intentionally rejected because wrong ports corrupt runtime data flow.
    return candidates.length === 1 ? { id: candidates[0][0], kind: candidates[0][1] } : { id: null, kind: null };
  }

  private resolveTaskId(taskId: string | null, nodeRef: string | null, iteratorNodeRef: string | null, catalog: PortCatalog): string | null {
    if (taskId) return taskId;
    if (iteratorNodeRef && nodeRef) return catalog.nodeRefToTaskId.get(this.scopedRef(iteratorNodeRef, nodeRef)) || null;
    if (nodeRef) return catalog.nodeRefToTaskId.get(nodeRef) || nodeRef;
    return null;
  }

  private edgeKey(edge: PlaybookIntentWorkflowChange): string {
    if (edge.type !== 'create_edge') return '';
    return [edge.sourceTaskId || this.scopedRef(edge.sourceIteratorNodeRef || null, edge.sourceNodeRef), edge.targetTaskId || this.scopedRef(edge.targetIteratorNodeRef || null, edge.targetNodeRef), edge.sourceOutputPortId || '', edge.targetInputPortId || ''].join(':');
  }

  private bindingKey(binding: PlaybookIntentWorkflowChange): string {
    if (binding.type !== 'create_data_binding') return '';
    return [binding.targetTaskId || this.scopedRef(binding.targetIteratorNodeRef || null, binding.targetNodeRef), binding.targetPort].join(':');
  }

  private scopedRef(iteratorRef: string | null, nodeRef: string | null): string {
    return iteratorRef && nodeRef ? `${iteratorRef}.${nodeRef}` : nodeRef || '';
  }

  private setUnique<T>(items: Map<string, T>, key: string, value: T, rule: string): void {
    if (items.has(key)) {
      this.warnDrop(rule, key);
      return;
    }
    items.set(key, value);
  }

  private warnDrop(rule: string, itemId: string): void {
    this.logger.warn(`playbook_intent_connection_drop rule=${rule} item=${itemId}`);
  }
}
