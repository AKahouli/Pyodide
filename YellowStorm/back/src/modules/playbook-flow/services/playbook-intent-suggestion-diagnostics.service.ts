import { Injectable } from '@nestjs/common';
import type { PlaybookIntentDiagnostic, PlaybookIntentDiagnosticResolutionCode } from '../interfaces/playbook-flow-intent-diagnostic.interface';
import type { ControlEdge, DataBinding, FlowNode } from '../models/playbook-flow.model';
import { PlaybookFlowValidatorService } from './playbook-flow-validator.service';
import type { PlaybookIntentSuggestion, PlaybookIntentTaskDraft, PlaybookIntentWorkflowChange } from './playbook-flow-intent.service';

type WorkflowPlanSuggestion = Extract<PlaybookIntentSuggestion, { kind: 'workflow_plan' }>;
type IntentSuggestionValidationStatus = NonNullable<WorkflowPlanSuggestion['validationStatus']>;

interface FlowDraft {
  nodes: FlowNode[];
  controlEdges: ControlEdge[];
  dataBindings: DataBinding[];
}

@Injectable()
export class PlaybookIntentSuggestionDiagnosticsService {
  constructor(
    private readonly validator: PlaybookFlowValidatorService = new PlaybookFlowValidatorService(),
  ) {}

  enrichWorkflowPlan(
    suggestion: WorkflowPlanSuggestion,
    flow: { nodes?: FlowNode[]; controlEdges?: ControlEdge[]; dataBindings?: DataBinding[] },
    diagnostics: PlaybookIntentDiagnostic[],
    repairSummary?: string[],
  ): WorkflowPlanSuggestion {
    const validationDiagnostics = this.collectValidationDiagnostics(suggestion, flow)
      .map((diagnostic) => this.addReviewGuidance(diagnostic, suggestion));
    const allDiagnostics = [...diagnostics.map((diagnostic) => this.addReviewGuidance(diagnostic, suggestion)), ...validationDiagnostics];
    const validationStatus = this.classifyValidation(allDiagnostics);
    return {
      ...suggestion,
      confidence: this.scoreConfidence(suggestion.confidence, allDiagnostics),
      ...(allDiagnostics.length ? { diagnostics: allDiagnostics } : {}),
      ...(validationDiagnostics.length ? { validationDiagnostics } : {}),
      validationStatus,
      repairSummary: repairSummary && repairSummary.length > 0 ? repairSummary.join(' ') : null,
    };
  }

  private addReviewGuidance(
    diagnostic: PlaybookIntentDiagnostic,
    suggestion: WorkflowPlanSuggestion,
  ): PlaybookIntentDiagnostic {
    if (diagnostic.reviewTarget && diagnostic.resolutionCode) return diagnostic;
    const searchable = [diagnostic.itemId, diagnostic.path, diagnostic.message].filter(Boolean).join(' ');
    const nodes = suggestion.changes
      .filter((change): change is Extract<PlaybookIntentWorkflowChange, { type: 'create_node' }> => change.type === 'create_node')
      .flatMap((change) => [{
        ref: change.nodeRef,
        label: change.task.title,
        ports: [...(change.task.inputPorts || []), ...(change.task.outputPorts || [])].map((port) => port.id),
      }, ...(change.task.iteratorBody?.steps || []).map((step) => ({
        ref: `${change.nodeRef}.${step.nodeRef}`,
        label: step.title,
        ports: [...(step.inputPorts || []), ...(step.outputPorts || [])].map((port) => port.id),
      }))])
      .sort((a, b) => b.ref.length - a.ref.length);
    const node = nodes.find((candidate) => this.containsIdentifier(searchable, candidate.ref))
      || nodes.find((candidate) => this.containsIdentifier(searchable, candidate.ref.split('.').at(-1) || ''));
    const portId = node?.ports.find((port) => this.containsIdentifier(searchable, port));
    return {
      ...diagnostic,
      reviewTarget: node
        ? { kind: portId ? 'port' : 'node', nodeRef: node.ref, nodeLabel: node.label, ...(portId ? { portId } : {}) }
        : { kind: 'workflow' },
      resolutionCode: this.resolveResolutionCode(diagnostic),
    };
  }

  private containsIdentifier(value: string, identifier: string): boolean {
    if (!identifier) return false;
    const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^A-Za-z0-9_-])${escaped}($|[^A-Za-z0-9_-])`).test(value);
  }

  private resolveResolutionCode(diagnostic: PlaybookIntentDiagnostic): PlaybookIntentDiagnosticResolutionCode {
    const value = `${diagnostic.code} ${diagnostic.message}`.toLowerCase();
    if (value.includes('constant')) return 'review_constant';
    if (value.includes('binding') || value.includes('required input')) return 'review_data_binding';
    if (value.includes('router')) return 'review_router';
    if (value.includes('edge') || value.includes('link')) return 'review_connection';
    if (value.includes('port')) return 'review_port';
    if (diagnostic.stage === 'repair') return 'review_repair';
    return diagnostic.itemId ? 'review_node' : 'review_workflow';
  }

  private classifyValidation(diagnostics: PlaybookIntentDiagnostic[]): IntentSuggestionValidationStatus {
    if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) return 'blocked';
    if (diagnostics.length > 0) return 'valid_with_warnings';
    return 'valid';
  }

  private scoreConfidence(baseConfidence: number, diagnostics: PlaybookIntentDiagnostic[]): number {
    const penalty = diagnostics.reduce((total, diagnostic) => {
      if (diagnostic.severity === 'error') return total + 0.15;
      if (diagnostic.severity === 'warning') return total + 0.05;
      return total;
    }, 0);
    return Math.max(0.1, Math.min(0.85, baseConfidence - Math.min(penalty, 0.45)));
  }

  private collectValidationDiagnostics(
    suggestion: WorkflowPlanSuggestion,
    flow: { nodes?: FlowNode[]; controlEdges?: ControlEdge[]; dataBindings?: DataBinding[] },
  ): PlaybookIntentDiagnostic[] {
    const draft = this.buildDraftGraph(flow, suggestion.changes);
    return this.validator.collectValidationErrors(draft.nodes, draft.controlEdges, draft.dataBindings, {
      allowDraftRouters: false,
      allowUnboundRequiredPorts: false,
      allowIncompleteNodeOutputBindings: false,
    }).map((error) => ({
      severity: 'error' as const,
      stage: 'invariant_validator' as const,
      code: `validator_rule_${error.rule}`,
      itemId: `rule:${error.rule}`,
      message: error.message,
      repairable: true,
    }));
  }

  private buildDraftGraph(
    flow: { nodes?: FlowNode[]; controlEdges?: ControlEdge[]; dataBindings?: DataBinding[] },
    changes: PlaybookIntentWorkflowChange[],
  ): FlowDraft {
    const nodes = new Map((flow.nodes || []).map((node) => [node.id, { ...node }]));
    const controlEdges = new Map((flow.controlEdges || []).map((edge) => [edge.id, { ...edge }]));
    const dataBindings = new Map((flow.dataBindings || []).map((binding) => [binding.id, { ...binding }]));
    const nodeRefToId = new Map<string, string>();

    for (const change of changes) {
      if (change.type === 'create_node') {
        const node = this.toFlowNode(change.nodeRef, change.task);
        nodes.set(node.id, node);
        nodeRefToId.set(change.nodeRef, node.id);
      } else if (change.type === 'delete_node') {
        nodes.delete(change.targetTaskId);
        this.pruneDeletedNodeReferences(change.targetTaskId, controlEdges, dataBindings);
      }
    }

    for (const change of changes) {
      if (change.type === 'create_edge') {
        // Iterator-scoped edges connect steps inside iterator bodies; the draft graph has no
        // step nodes, so validating them here produces false rule-2 failures. They are
        // structurally validated by the blueprint builder and applied into iterator bodies.
        const scopedEdge = change as { sourceIteratorNodeRef?: string | null; targetIteratorNodeRef?: string | null };
        if (!scopedEdge.sourceIteratorNodeRef && !scopedEdge.targetIteratorNodeRef) {
          const edge = this.toControlEdge(change, nodeRefToId);
          if (edge) controlEdges.set(edge.id, edge);
        }
      } else if (change.type === 'delete_edge') {
        const edge = this.toControlEdge(change, nodeRefToId);
        if (edge) controlEdges.delete(edge.id);
      } else if (change.type === 'create_data_binding') {
        // Iterator-scoped bindings target steps inside iterator bodies; the draft graph has no
        // concept of steps, so validating them here produces false rule-7/rule-8 failures.
        // They are structurally validated by the blueprint builder and resolver.
        if (!(change as { targetIteratorNodeRef?: string | null }).targetIteratorNodeRef) {
          const binding = this.toDataBinding(change, nodeRefToId);
          if (binding) dataBindings.set(binding.id, binding);
        }
      } else if (change.type === 'delete_data_binding') {
        const targetNode = this.resolveNodeId(change.targetTaskId, change.targetNodeRef, nodeRefToId);
        if (targetNode) dataBindings.delete(this.bindingId(targetNode, change.targetPort));
      }
    }

    return { nodes: [...nodes.values()], controlEdges: [...controlEdges.values()], dataBindings: [...dataBindings.values()] };
  }

  private pruneDeletedNodeReferences(
    nodeId: string,
    controlEdges: Map<string, ControlEdge>,
    dataBindings: Map<string, DataBinding>,
  ): void {
    for (const [edgeId, edge] of controlEdges) {
      if (edge.source === nodeId || edge.target === nodeId) controlEdges.delete(edgeId);
    }
    for (const [bindingId, binding] of dataBindings) {
      if (binding.targetNode === nodeId || binding.sourceNode === nodeId) dataBindings.delete(bindingId);
    }
  }

  private toFlowNode(nodeRef: string, task: PlaybookIntentTaskDraft): FlowNode {
    return {
      id: nodeRef,
      kind: this.resolveNodeKind(task),
      label: task.title,
      description: task.description,
      routerConfig: task.routerConfig ? {
        outputLabels: task.routerConfig.outputLabels,
        maxIterations: task.routerConfig.maxIterations ?? 1,
        conditions: task.routerConfig.conditions,
        ...(task.routerConfig.defaultLabel ? { defaultLabel: task.routerConfig.defaultLabel } : {}),
      } : undefined,
      humanApprovalConfig: task.humanApprovalConfig as FlowNode['humanApprovalConfig'],
      retryPolicy: task.retryPolicy || undefined,
      modelId: task.modelId || undefined,
      input: { ports: (task.inputPorts || []).map((port) => ({ id: port.id, label: port.name || port.id, type: port.artifactKind, required: port.required === true })) },
      output: { ports: (task.outputPorts || []).map((port) => ({ id: port.id, label: port.name || port.id, type: port.artifactKind })) },
    } as FlowNode;
  }

  private resolveNodeKind(task: PlaybookIntentTaskDraft): string {
    if (task.routerConfig) return 'router';
    if (task.humanApprovalConfig) return 'human_approval';
    if (task.iteratorBody) return 'iterator';
    return 'step';
  }

  private toControlEdge(
    change: Extract<PlaybookIntentWorkflowChange, { type: 'create_edge' | 'delete_edge' }>,
    nodeRefToId: Map<string, string>,
  ): ControlEdge | null {
    const source = this.resolveNodeId(change.sourceTaskId, change.sourceNodeRef, nodeRefToId);
    const target = this.resolveNodeId(change.targetTaskId, change.targetNodeRef, nodeRefToId);
    if (!source || !target) return null;
    return {
      id: this.edgeId(source, target, change.routerLabel || change.sourceOutputPortId || null, change.targetInputPortId || null),
      kind: change.edgeKind || (change.routerLabel ? 'conditional' : 'sequential'),
      source,
      target,
      ...(change.routerLabel ? { routerLabel: change.routerLabel } : {}),
      ...(change.sourceOutputPortId ? { sourceOutputPortId: change.sourceOutputPortId } : {}),
      ...(change.targetInputPortId ? { targetInputPortId: change.targetInputPortId } : {}),
      ...(change.priority != null ? { priority: change.priority } : {}),
    } as ControlEdge;
  }

  private toDataBinding(
    change: Extract<PlaybookIntentWorkflowChange, { type: 'create_data_binding' }>,
    nodeRefToId: Map<string, string>,
  ): DataBinding | null {
    const targetNode = this.resolveNodeId(change.targetTaskId, change.targetNodeRef, nodeRefToId);
    if (!targetNode) return null;
    if (change.sourceKind === 'constant') {
      return { id: this.bindingId(targetNode, change.targetPort), targetNode, targetPort: change.targetPort, sourceKind: 'constant', constantValue: change.constantValue } as DataBinding;
    }
    if (change.sourceKind === 'state') {
      return { id: this.bindingId(targetNode, change.targetPort), targetNode, targetPort: change.targetPort, sourceKind: 'state', statePath: change.statePath } as DataBinding;
    }
    if (change.sourceKind === 'trigger') {
      return { id: this.bindingId(targetNode, change.targetPort), targetNode, targetPort: change.targetPort, sourceKind: 'trigger', triggerPath: change.triggerPath } as DataBinding;
    }
    const sourceNode = this.resolveNodeId(change.sourceTaskId, change.sourceNodeRef, nodeRefToId);
    if (!sourceNode || !change.sourcePort) return null;
    return {
      id: this.bindingId(targetNode, change.targetPort),
      targetNode,
      targetPort: change.targetPort,
      sourceKind: 'node-output',
      sourceNode,
      sourcePort: change.sourcePort,
      iteration: change.iteration || 'current',
    } as DataBinding;
  }

  private resolveNodeId(taskId: string | null | undefined, nodeRef: string | null | undefined, nodeRefToId: Map<string, string>): string | null {
    return taskId || (nodeRef ? nodeRefToId.get(nodeRef) || nodeRef : null);
  }

  private edgeId(source: string, target: string, sourcePort: string | null, targetPort: string | null): string {
    return ['intent-edge', source, sourcePort || 'default', target, targetPort || 'default'].join('-');
  }

  private bindingId(targetNode: string, targetPort: string): string {
    return `intent-binding-${targetNode}-${targetPort}`;
  }
}
