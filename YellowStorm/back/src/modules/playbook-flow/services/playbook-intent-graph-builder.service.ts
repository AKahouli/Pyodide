import { Injectable, Logger } from '@nestjs/common';
import {
  PlaybookIntentBlueprint,
  PlaybookIntentBlueprintBinding,
  PlaybookIntentBlueprintIteratorStep,
  PlaybookIntentBlueprintLink,
  PlaybookIntentBlueprintNode,
  PlaybookIntentBlueprintNodeKind,
  PlaybookIntentBlueprintPort,
} from '../interfaces/playbook-flow-intent-blueprint.interface';
import type {
  IntentNormalizationLimits,
  IntentWorkflowValidationContext,
  PlaybookIntentSuggestion,
  PlaybookIntentTaskDraft,
  PlaybookIntentWorkflowChange,
} from './playbook-flow-intent.service';

type WorkflowPlanSuggestion = Extract<PlaybookIntentSuggestion, { kind: 'workflow_plan' }>;
import { PlaybookIntentGraphBindingResolverService } from './playbook-intent-graph-binding-resolver.service';
import { PlaybookIntentNodeBuildRegistryService } from './playbook-intent-node-build-registry.service';

interface BuilderNodeTemplatePort {
  id: string;
  name: string;
  artifactKind: string;
  required?: boolean;
}

interface BuilderNodeTemplate {
  type: string;
  key: string;
  nodeType: string;
  enabled: boolean;
  recommendedAgentTypeSlug: string | null;
  inputPorts?: BuilderNodeTemplatePort[];
  outputPorts?: BuilderNodeTemplatePort[];
}

interface BuildOptions {
  blueprint: PlaybookIntentBlueprint;
  context: IntentWorkflowValidationContext;
  limits: IntentNormalizationLimits;
  templates: BuilderNodeTemplate[];
  selectedNodeId: string | null;
}

interface BuildResult {
  suggestion: WorkflowPlanSuggestion;
  dropped: Array<{ rule: string; itemId: string }>;
}

type BuilderPort = NonNullable<PlaybookIntentTaskDraft['inputPorts']>[number];

@Injectable()
export class PlaybookIntentGraphBuilderService {
  private readonly logger = new Logger(PlaybookIntentGraphBuilderService.name);

  constructor(
    private readonly registry: PlaybookIntentNodeBuildRegistryService,
    private readonly resolver: PlaybookIntentGraphBindingResolverService,
  ) {}

  build(options: BuildOptions): BuildResult {
    const dropped: Array<{ rule: string; itemId: string }> = [];
    const nodesByRef = new Map<string, PlaybookIntentBlueprintNode>();
    for (const node of options.blueprint.nodes) {
      nodesByRef.set(node.ref, node);
    }

    const acceptedChanges: PlaybookIntentWorkflowChange[] = [];
    const createdRefs = new Set<string>();

    for (const blueprintNode of options.blueprint.nodes.slice(0, options.limits.maxWorkflowPlanChanges)) {
      const change = this.buildCreateNodeChange(blueprintNode, options, dropped);
      if (!change) continue;
      acceptedChanges.push(change);
      createdRefs.add(blueprintNode.ref);
    }

    for (const link of options.blueprint.links) {
      const change = this.buildCreateEdgeChange(link, options, dropped);
      if (change) acceptedChanges.push(change);
    }

    for (const binding of options.blueprint.bindings || []) {
      const change = this.buildCreateBindingChange(binding, options, dropped);
      if (change) acceptedChanges.push(change);
    }

    const resolvedChanges = this.resolver.resolveWorkflowChanges({
      changes: acceptedChanges,
      context: options.context,
      deletedTaskIds: new Set(),
    });

    const label = options.blueprint.title;
    const summary = options.blueprint.summary;
    const suggestion: WorkflowPlanSuggestion = {
      id: 'intent-blueprint',
      kind: 'workflow_plan',
      label,
      summary,
      reason: summary || label,
      confidence: 0.85,
      impact: this.computeImpact(resolvedChanges, options.selectedNodeId),
      changes: resolvedChanges,
      isDirectIntentFallback: false,
    };

    return { suggestion, dropped };
  }

  private buildCreateNodeChange(
    node: PlaybookIntentBlueprintNode,
    options: BuildOptions,
    dropped: Array<{ rule: string; itemId: string }>,
  ): PlaybookIntentWorkflowChange | null {
    const descriptor = this.registry.describe(node.nodeType || null);
    const template = this.resolveTemplate(node, options.templates, dropped);
    const inputPorts: BuilderPort[] = this.mergePorts(template?.inputPorts, node.inputPorts, `${node.ref}.inputs`, dropped);
    const outputPorts: BuilderPort[] = this.mergePorts(template?.outputPorts, node.outputPorts, `${node.ref}.outputs`, dropped);
    const agentSlug = this.resolveAgentSlug(node, template);

    const task: PlaybookIntentTaskDraft = {
      title: node.label,
      description: node.purpose || node.label,
      ...(agentSlug ? { agentSlug } : {}),
      ...(node.templateType || template?.type ? { templateType: node.templateType || template?.type || null } : {}),
      ...(inputPorts.length ? { inputPorts } : {}),
      ...(outputPorts.length ? { outputPorts } : {}),
      ...(descriptor.runtimeKind === 'iterator' && node.iteratorBody ? { iteratorBody: this.buildIteratorBody(node.iteratorBody, options, dropped) } : {}),
    };

    return {
      type: 'create_node',
      nodeRef: node.ref,
      anchor: {
        mode: node.anchor?.mode || 'append',
        targetTaskId: node.anchor?.targetTaskId || null,
        nodeRef: node.anchor?.targetRef || null,
        ...(node.anchor?.targetTaskId ? { targetTaskIds: [node.anchor.targetTaskId] } : {}),
        ...(node.anchor?.targetRef ? { nodeRefs: [node.anchor.targetRef] } : {}),
      },
      task,
    };
  }

  private buildIteratorBody(
    body: NonNullable<PlaybookIntentBlueprintNode['iteratorBody']>,
    options: BuildOptions,
    dropped: Array<{ rule: string; itemId: string }>,
  ): PlaybookIntentTaskDraft['iteratorBody'] {
    const steps = body.steps
      .slice(0, options.limits.maxIteratorBodySteps)
      .map((step) => this.buildIteratorStep(step, options, dropped))
      .filter((step): step is NonNullable<PlaybookIntentTaskDraft['iteratorBody']>['steps'][number] => step !== null);
    const validStepRefs = new Set(steps.map((s) => s.nodeRef));
    const edges = body.edges
      .filter((edge) => validStepRefs.has(edge.sourceRef) && validStepRefs.has(edge.targetRef))
      .slice(0, options.limits.maxIteratorBodyEdges)
      .map((edge) => ({
        sourceNodeRef: edge.sourceRef,
        targetNodeRef: edge.targetRef,
        ...(edge.sourceOutputPortId ? { sourceOutputPortId: edge.sourceOutputPortId } : {}),
        ...(edge.targetInputPortId ? { targetInputPortId: edge.targetInputPortId } : {}),
      }));

    return { steps, edges };
  }

  private buildIteratorStep(
    step: PlaybookIntentBlueprintIteratorStep,
    options: BuildOptions,
    dropped: Array<{ rule: string; itemId: string }>,
  ): NonNullable<PlaybookIntentTaskDraft['iteratorBody']>['steps'][number] {
    const template = this.resolveTemplate(step as unknown as PlaybookIntentBlueprintNode, options.templates, dropped);
    const inputPorts: BuilderPort[] = this.mergePorts(template?.inputPorts, step.inputPorts, `${step.ref}.inputs`, dropped);
    const outputPorts: BuilderPort[] = this.mergePorts(template?.outputPorts, step.outputPorts, `${step.ref}.outputs`, dropped);
    return {
      nodeRef: step.ref,
      title: step.title,
      description: step.description || step.title,
      ...(step.templateType || template?.type ? { templateType: step.templateType || template?.type || null } : {}),
      ...(template?.recommendedAgentTypeSlug ? { agentSlug: template.recommendedAgentTypeSlug } : {}),
      ...(inputPorts.length ? { inputPorts } : {}),
      ...(outputPorts.length ? { outputPorts } : {}),
    };
  }

  private resolveTemplate(
    node: PlaybookIntentBlueprintNode | PlaybookIntentBlueprintIteratorStep,
    templates: BuilderNodeTemplate[],
    dropped: Array<{ rule: string; itemId: string }>,
  ): BuilderNodeTemplate | undefined {
    const desiredType = node.templateType;
    const candidates = templates.filter((template) => template.enabled);
    if (desiredType) {
      const exact = candidates.find((template) => template.type === desiredType || template.key === desiredType);
      if (exact) return exact;
      dropped.push({ rule: 'builder_template_unknown', itemId: `${(node as PlaybookIntentBlueprintNode).ref || (node as PlaybookIntentBlueprintIteratorStep).ref}:${desiredType}` });
      this.logger.warn(`playbook_intent_builder_template_unknown ref=${(node as PlaybookIntentBlueprintNode).ref || (node as PlaybookIntentBlueprintIteratorStep).ref} type=${desiredType}`);
    }
    const kind = (node as PlaybookIntentBlueprintNode).nodeType as PlaybookIntentBlueprintNodeKind | undefined;
    if (!kind) return undefined;
    return candidates.find((template) => template.nodeType === kind);
  }

  private resolveAgentSlug(node: PlaybookIntentBlueprintNode, template: BuilderNodeTemplate | undefined): string | null {
    if (node.agentHint) return node.agentHint;
    if (template?.recommendedAgentTypeSlug) return template.recommendedAgentTypeSlug;
    return null;
  }

  private mergePorts(
    templatePorts: BuilderNodeTemplatePort[] | undefined,
    blueprintPorts: PlaybookIntentBlueprintPort[] | undefined,
    ownerRef: string,
    dropped: Array<{ rule: string; itemId: string }>,
  ): BuilderPort[] {
    const ports: BuilderPort[] = [];
    const seen = new Set<string>();
    for (const port of templatePorts || []) {
      if (!port.id || !port.artifactKind) continue;
      if (seen.has(port.id)) continue;
      seen.add(port.id);
      ports.push({
        id: port.id,
        artifactKind: port.artifactKind as BuilderPort['artifactKind'],
        required: false,
        ...(port.name ? { name: port.name } : {}),
      });
    }
    for (const port of blueprintPorts || []) {
      if (!port.id || !port.artifactKind) {
        dropped.push({ rule: 'builder_port_missing_fields', itemId: `${ownerRef}.${port.id || '?'}` });
        continue;
      }
      const existingIndex = ports.findIndex((p) => p.id === port.id);
      const merged: BuilderPort = {
        id: port.id,
        artifactKind: port.artifactKind as BuilderPort['artifactKind'],
        required: port.required === true,
        ...(port.name ? { name: port.name } : {}),
      };
      if (existingIndex >= 0) {
        ports[existingIndex] = merged;
      } else {
        ports.push(merged);
        seen.add(port.id);
      }
    }
    return ports;
  }

  private buildCreateEdgeChange(
    link: PlaybookIntentBlueprintLink,
    options: BuildOptions,
    dropped: Array<{ rule: string; itemId: string }>,
  ): PlaybookIntentWorkflowChange | null {
    const sourceId = this.resolveReference(link.sourceRef, options);
    const targetId = this.resolveReference(link.targetRef, options);
    if (!sourceId || !targetId) {
      dropped.push({ rule: 'builder_edge_unknown_ref', itemId: `${link.sourceRef}->${link.targetRef}` });
      return null;
    }
    return {
      type: 'create_edge',
      sourceTaskId: options.context.existingTaskIds.has(sourceId) ? sourceId : null,
      sourceNodeRef: options.context.existingTaskIds.has(sourceId) ? null : sourceId,
      targetTaskId: options.context.existingTaskIds.has(targetId) ? targetId : null,
      targetNodeRef: options.context.existingTaskIds.has(targetId) ? null : targetId,
      ...(link.sourceOutputPortId ? { sourceOutputPortId: link.sourceOutputPortId } : {}),
      ...(link.targetInputPortId ? { targetInputPortId: link.targetInputPortId } : {}),
    };
  }

  private buildCreateBindingChange(
    binding: PlaybookIntentBlueprintBinding,
    options: BuildOptions,
    dropped: Array<{ rule: string; itemId: string }>,
  ): PlaybookIntentWorkflowChange | null {
    const targetId = this.resolveReference(binding.targetRef, options);
    if (!targetId) {
      dropped.push({ rule: 'builder_binding_unknown_target', itemId: `${binding.targetRef}.${binding.targetPort}` });
      return null;
    }
    const isExisting = options.context.existingTaskIds.has(targetId);
    if (binding.sourceKind === 'constant' && binding.constantValue) {
      return {
        type: 'create_data_binding',
        targetTaskId: isExisting ? targetId : null,
        targetNodeRef: isExisting ? null : targetId,
        targetPort: binding.targetPort,
        sourceKind: 'constant',
        constantValue: {
          ...binding.constantValue,
          question: '',
          label: binding.constantValue.label || '',
        },
      };
    }
    if (!binding.sourceRef || !binding.sourcePort) {
      dropped.push({ rule: 'builder_binding_missing_source', itemId: `${binding.targetRef}.${binding.targetPort}` });
      return null;
    }
    const sourceId = this.resolveReference(binding.sourceRef, options);
    if (!sourceId) {
      dropped.push({ rule: 'builder_binding_unknown_source', itemId: `${binding.sourceRef}->${binding.targetRef}.${binding.targetPort}` });
      return null;
    }
    return {
      type: 'create_data_binding',
      targetTaskId: isExisting ? targetId : null,
      targetNodeRef: isExisting ? null : targetId,
      targetPort: binding.targetPort,
      sourceKind: 'node-output',
      sourceTaskId: options.context.existingTaskIds.has(sourceId) ? sourceId : null,
      sourceNodeRef: options.context.existingTaskIds.has(sourceId) ? null : sourceId,
      sourcePort: binding.sourcePort,
      iteration: binding.iteration || 'current',
    };
  }

  private resolveReference(ref: string, options: BuildOptions): string | null {
    if (options.context.existingTaskIds.has(ref)) return ref;
    if (options.blueprint.nodes.some((node) => node.ref === ref)) return ref;
    return null;
  }

  private computeImpact(changes: PlaybookIntentWorkflowChange[], selectedNodeId: string | null) {
    const affected = new Set<string>();
    if (selectedNodeId) affected.add(selectedNodeId);
    for (const change of changes) {
      if (change.type === 'create_node') {
        affected.add(change.nodeRef);
      } else if ('targetTaskId' in change && change.targetTaskId) {
        affected.add(change.targetTaskId);
      } else if ('sourceTaskId' in change && change.sourceTaskId) {
        affected.add(change.sourceTaskId);
      }
    }
    return {
      nodesToCreate: changes.filter((change) => change.type === 'create_node').length,
      nodesToUpdate: changes.filter((change) => change.type === 'update_node').length,
      nodesToDelete: changes.filter((change) => change.type === 'delete_node').length,
      edgesToCreate: changes.filter((change) => change.type === 'create_edge').length,
      edgesToDelete: changes.filter((change) => change.type === 'delete_edge').length,
      dataBindingsToCreate: changes.filter((change) => change.type === 'create_data_binding').length,
      dataBindingsToDelete: changes.filter((change) => change.type === 'delete_data_binding').length,
      affectedTaskIds: [...affected],
      businessOutcome: '',
    };
  }
}
