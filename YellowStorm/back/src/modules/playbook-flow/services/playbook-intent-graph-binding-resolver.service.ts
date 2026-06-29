import { Injectable, Logger } from '@nestjs/common';
import type {
  IntentWorkflowValidationContext,
  PlaybookIntentTaskDraft,
  PlaybookIntentWorkflowChange,
} from './playbook-flow-intent.service';
import type { PlaybookIntentDiagnostic } from '../interfaces/playbook-flow-intent-diagnostic.interface';

type ArtifactKind = 'text' | 'document' | 'code' | 'image' | 'data' | 'dashboard';
const TEXT_SERIALIZABLE_ARTIFACT_KINDS = new Set<ArtifactKind>(['text', 'data', 'code', 'document']);
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

export interface ResolveWorkflowChangesResult {
  changes: PlaybookIntentWorkflowChange[];
  diagnostics: PlaybookIntentDiagnostic[];
}

@Injectable()
export class PlaybookIntentGraphBindingResolverService {
  private readonly logger = new Logger(PlaybookIntentGraphBindingResolverService.name);

  resolveWorkflowChanges(params: ResolveParams): ResolveWorkflowChangesResult {
    const catalog = this.buildCatalog(params.changes, params.context);
    const accepted: PlaybookIntentWorkflowChange[] = [];
    const edges = new Map<string, PlaybookIntentWorkflowChange>();
    const bindings = new Map<string, PlaybookIntentWorkflowChange>();
    const diagnostics: PlaybookIntentDiagnostic[] = [];

    for (const change of params.changes) {
      if (change.type === 'create_edge') {
        const edge = this.resolveEdge(change as CreateEdgeChange, catalog, params.deletedTaskIds, diagnostics);
        if (edge) this.setUnique(edges, this.edgeKey(edge), edge, 'duplicate_edge', diagnostics);
        continue;
      }
      if (change.type === 'create_data_binding') {
        const binding = this.resolveBinding(change, catalog, params.context, params.deletedTaskIds, diagnostics);
        if (binding) this.setUnique(bindings, this.bindingKey(binding), binding, 'duplicate_binding_target', diagnostics);
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
    return { changes: accepted, diagnostics };
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
    diagnostics: PlaybookIntentDiagnostic[],
  ): PlaybookIntentWorkflowChange | null {
    const sourceId = this.resolveTaskId(edge.sourceTaskId, edge.sourceNodeRef, edge.sourceIteratorNodeRef || null, catalog);
    const targetId = this.resolveTaskId(edge.targetTaskId, edge.targetNodeRef, edge.targetIteratorNodeRef || null, catalog);
    if (!sourceId || !targetId || deletedTaskIds.has(sourceId) || deletedTaskIds.has(targetId)) {
      this.recordDiagnostic(diagnostics, 'edge_unresolved_task', `${edge.sourceTaskId || edge.sourceNodeRef || '?'}->${edge.targetTaskId || edge.targetNodeRef || '?'}`);
      return null;
    }

    const sourcePorts = catalog.outputPorts.get(sourceId);
    const targetPorts = catalog.inputPorts.get(targetId);
    if (edge.edgeKind === 'conditional' || edge.routerLabel) {
      return {
        ...edge,
        edgeKind: 'conditional',
        ...(edge.routerLabel ? { routerLabel: edge.routerLabel } : {}),
      };
    }
    let sourcePort = this.resolvePort(sourcePorts, edge.sourceOutputPortId || null, null);
    let targetPort = this.resolvePort(targetPorts, edge.targetInputPortId || null, sourcePort.kind);

    if (edge.sourceOutputPortId && !sourcePort.id) {
      const requestedTargetPort = this.resolvePort(targetPorts, edge.targetInputPortId || null, null);
      sourcePort = this.resolvePort(sourcePorts, edge.sourceOutputPortId, requestedTargetPort.kind, true);
      if (sourcePort.id) {
        targetPort = this.resolvePort(targetPorts, edge.targetInputPortId || null, sourcePort.kind, true);
        this.recordDiagnostic(diagnostics, 'edge_port_fallback', `${sourceId}.${edge.sourceOutputPortId}->${sourceId}.${sourcePort.id}`);
      }
    }

    if (edge.targetInputPortId && !targetPort.id) {
      targetPort = this.resolvePort(targetPorts, edge.targetInputPortId, sourcePort.kind, true);
      if (targetPort.id) {
        this.recordDiagnostic(diagnostics, 'edge_port_fallback', `${targetId}.${edge.targetInputPortId}->${targetId}.${targetPort.id}`);
      }
    }

    if ((edge.sourceOutputPortId && !sourcePort.id) || (edge.targetInputPortId && !targetPort.id)) {
      this.recordDiagnostic(diagnostics, 'edge_unknown_port', `${sourceId}.${edge.sourceOutputPortId || '?'}->${targetId}.${edge.targetInputPortId || '?'}`);
      return null;
    }
    if (sourcePort.kind && targetPort.kind && !this.areArtifactKindsCompatible(sourcePort.kind, targetPort.kind)) {
      this.recordDiagnostic(diagnostics, 'edge_artifact_mismatch', `${sourceId}.${sourcePort.id || '?'}->${targetId}.${targetPort.id || '?'}`, {
        severity: 'error',
        message: `Cannot connect ${sourcePort.kind} output to ${targetPort.kind} input.`,
        repairable: true,
      });
      return null;
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
    diagnostics: PlaybookIntentDiagnostic[],
  ): PlaybookIntentWorkflowChange | null {
    const targetId = this.resolveTaskId(binding.targetTaskId, binding.targetNodeRef, binding.targetIteratorNodeRef || null, catalog);
    if (!targetId || deletedTaskIds.has(targetId)) {
      this.recordDiagnostic(diagnostics, 'binding_unresolved_target', `${binding.targetTaskId || binding.targetNodeRef || '?'}.${binding.targetPort}`);
      return null;
    }

    const targetPort = this.resolvePort(catalog.inputPorts.get(targetId), binding.targetPort, null);
    if (!targetPort.id) {
      this.recordDiagnostic(diagnostics, 'binding_unknown_target_port', `${targetId}.${binding.targetPort}`);
      return null;
    }
    if (context.existingBindingTargets.has(`${targetId}:${targetPort.id}`)) {
      this.recordDiagnostic(diagnostics, 'existing_binding_target', `${targetId}.${targetPort.id}`);
      return null;
    }

    if (binding.sourceKind === 'constant') {
      return { ...binding, targetPort: targetPort.id };
    }

    const sourceId = this.resolveTaskId(binding.sourceTaskId, binding.sourceNodeRef, binding.sourceIteratorNodeRef || null, catalog);
    if (!sourceId || deletedTaskIds.has(sourceId)) {
      this.recordDiagnostic(diagnostics, 'binding_unresolved_source', `${binding.sourceTaskId || binding.sourceNodeRef || '?'}->${targetId}.${targetPort.id}`);
      return null;
    }
    const sourcePort = this.resolvePort(catalog.outputPorts.get(sourceId), binding.sourcePort || null, targetPort.kind);
    if (!sourcePort.id || !this.areArtifactKindsCompatible(sourcePort.kind, targetPort.kind)) {
      this.recordDiagnostic(diagnostics, 'binding_artifact_mismatch', `${sourceId}.${binding.sourcePort || '?'}->${targetId}.${targetPort.id}`, {
        severity: 'error',
        message: `Cannot bind ${sourcePort.kind || 'unknown'} output to ${targetPort.kind} input.`,
        repairable: true,
      });
      return null;
    }

    return { ...binding, sourcePort: sourcePort.id, targetPort: targetPort.id };
  }

  private bindingFromEdge(
    edge: CreateEdgeChange,
    catalog: PortCatalog,
    context: IntentWorkflowValidationContext,
  ): PlaybookIntentWorkflowChange | null {
    if (edge.edgeKind === 'conditional' || edge.routerLabel) return null;
    const sourceId = this.resolveTaskId(edge.sourceTaskId, edge.sourceNodeRef, edge.sourceIteratorNodeRef || null, catalog);
    const targetId = this.resolveTaskId(edge.targetTaskId, edge.targetNodeRef, edge.targetIteratorNodeRef || null, catalog);
    if (!sourceId || !targetId || !edge.sourceOutputPortId || !edge.targetInputPortId) return null;
    if (context.existingBindingTargets.has(`${targetId}:${edge.targetInputPortId}`)) return null;

    const sourceKind = catalog.outputPorts.get(sourceId)?.get(edge.sourceOutputPortId);
    const targetKind = catalog.inputPorts.get(targetId)?.get(edge.targetInputPortId);
    if (!sourceKind || !targetKind || !this.areArtifactKindsCompatible(sourceKind, targetKind)) return null;

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

    // Prefer exact kind match; only fall back to compatible kinds when no exact match exists.
    const exactCandidates = [...ports.entries()].filter(([, kind]) => kind === requiredKind);
    if (exactCandidates.length === 1) return { id: exactCandidates[0][0], kind: exactCandidates[0][1] };
    if (exactCandidates.length > 1) return { id: null, kind: null };

    const compatibleCandidates = [...ports.entries()].filter(([, kind]) => kind !== requiredKind && this.areArtifactKindsCompatible(kind, requiredKind));
    // Ambiguous inference is intentionally rejected because wrong ports corrupt runtime data flow.
    return compatibleCandidates.length === 1 ? { id: compatibleCandidates[0][0], kind: compatibleCandidates[0][1] } : { id: null, kind: null };
  }

  private resolveTaskId(taskId: string | null, nodeRef: string | null, iteratorNodeRef: string | null, catalog: PortCatalog): string | null {
    if (taskId) return taskId;
    if (iteratorNodeRef && nodeRef) return catalog.nodeRefToTaskId.get(this.scopedRef(iteratorNodeRef, nodeRef)) || null;
    if (nodeRef) return catalog.nodeRefToTaskId.get(nodeRef) || nodeRef;
    return null;
  }

  private areArtifactKindsCompatible(sourceKind: ArtifactKind | null, targetKind: ArtifactKind | null): boolean {
    if (!sourceKind || !targetKind) return true;
    if (sourceKind === targetKind) return true;
    return TEXT_SERIALIZABLE_ARTIFACT_KINDS.has(sourceKind) && TEXT_SERIALIZABLE_ARTIFACT_KINDS.has(targetKind);
  }

  private edgeKey(edge: PlaybookIntentWorkflowChange): string {
    if (edge.type !== 'create_edge') return '';
    return [edge.sourceTaskId || this.scopedRef(edge.sourceIteratorNodeRef || null, edge.sourceNodeRef), edge.targetTaskId || this.scopedRef(edge.targetIteratorNodeRef || null, edge.targetNodeRef), edge.edgeKind || '', edge.routerLabel || '', edge.sourceOutputPortId || '', edge.targetInputPortId || ''].join(':');
  }

  private bindingKey(binding: PlaybookIntentWorkflowChange): string {
    if (binding.type !== 'create_data_binding') return '';
    return [binding.targetTaskId || this.scopedRef(binding.targetIteratorNodeRef || null, binding.targetNodeRef), binding.targetPort].join(':');
  }

  private scopedRef(iteratorRef: string | null, nodeRef: string | null): string {
    return iteratorRef && nodeRef ? `${iteratorRef}.${nodeRef}` : nodeRef || '';
  }

  private setUnique<T>(items: Map<string, T>, key: string, value: T, code: string, diagnostics: PlaybookIntentDiagnostic[]): void {
    if (items.has(key)) {
      this.recordDiagnostic(diagnostics, code, key);
      return;
    }
    items.set(key, value);
  }

  private recordDiagnostic(
    diagnostics: PlaybookIntentDiagnostic[],
    code: string,
    itemId: string,
    overrides?: { severity?: 'info' | 'warning' | 'error'; message?: string; repairable?: boolean },
  ): void {
    const severity = overrides?.severity ?? 'warning';
    const diagnostic: PlaybookIntentDiagnostic = {
      severity,
      stage: 'binding_resolver',
      code,
      itemId,
      message: overrides?.message ?? code,
      ...(overrides?.repairable != null ? { repairable: overrides.repairable } : {}),
    };
    diagnostics.push(diagnostic);
    const logLevel = severity === 'error' ? 'error' : 'warn';
    this.logger[logLevel](`playbook_intent_connection_drop rule=${diagnostic.code} item=${diagnostic.itemId || ''}`);
  }
}
