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
  designCatalog?: BuilderDesignCatalog;
  selectedNodeId: string | null;
}

export interface BuilderDesignCatalog {
  connectors?: BuilderCatalogConnector[];
  connectorActions?: BuilderCatalogConnectorAction[];
  skills?: BuilderCatalogSkill[];
}

export interface BuilderCatalogConnector {
  id: string;
  slug: string;
  name: string;
}

export interface BuilderCatalogConnectorAction {
  connectorSlug: string;
  actionKey: string;
}

export interface BuilderCatalogSkill {
  id: string;
  slug: string;
  name: string;
}

interface BuildResult {
  suggestion: WorkflowPlanSuggestion;
  dropped: Array<{ rule: string; itemId: string }>;
}

type BuilderPort = NonNullable<PlaybookIntentTaskDraft['inputPorts']>[number];

interface ReferencedPorts {
  inputsByRef: Map<string, Set<string>>;
  outputsByRef: Map<string, Set<string>>;
}

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
    const referencedPorts = this.collectReferencedPorts(options.blueprint);

    for (const blueprintNode of options.blueprint.nodes.slice(0, options.limits.maxWorkflowPlanChanges)) {
      const change = this.buildCreateNodeChange(blueprintNode, options, dropped, referencedPorts);
      if (!change) continue;
      acceptedChanges.push(change);
      createdRefs.add(blueprintNode.ref);
    }

    for (const link of options.blueprint.links) {
      const change = this.buildCreateEdgeChange(link, options, dropped);
      if (change) acceptedChanges.push(change);
    }

    const explicitEdgeKeys = new Set(options.blueprint.links.map((link) => this.blueprintEdgeKey(link)));
    for (const binding of options.blueprint.bindings || []) {
      const change = this.buildCreateEdgeChangeFromBinding(binding, options, explicitEdgeKeys, dropped);
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
    referencedPorts: ReferencedPorts,
  ): PlaybookIntentWorkflowChange | null {
    const descriptor = this.registry.describe(node.nodeType || null);
    const template = this.resolveTemplate(node, options.templates, dropped);
    const inputPorts: BuilderPort[] = this.mergePorts(template?.inputPorts, node.inputPorts, `${node.ref}.inputs`, referencedPorts.inputsByRef.get(node.ref), dropped);
    const outputPorts: BuilderPort[] = this.mergePorts(template?.outputPorts, node.outputPorts, `${node.ref}.outputs`, referencedPorts.outputsByRef.get(node.ref), dropped);
    const agentSlug = this.resolveAgentSlug(node, template);

    const task: PlaybookIntentTaskDraft = {
      title: node.label,
      description: node.purpose || node.label,
      ...(agentSlug ? { agentSlug } : {}),
      ...(node.templateType || template?.type ? { templateType: node.templateType || template?.type || null } : {}),
      ...(inputPorts.length ? { inputPorts } : {}),
      ...(outputPorts.length ? { outputPorts } : {}),
      ...(node.connectorRefs?.length ? { toolBindings: this.buildToolBindings(node, options, dropped) } : {}),
      ...(node.skillRefs?.length ? { skillBindings: this.buildSkillBindings(node, options, dropped) } : {}),
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

  private buildToolBindings(
    node: PlaybookIntentBlueprintNode,
    options: BuildOptions,
    dropped: Array<{ rule: string; itemId: string }>,
  ): NonNullable<PlaybookIntentTaskDraft['toolBindings']> {
    const connectors = new Map((options.designCatalog?.connectors || []).map((connector) => [connector.slug, connector]));
    const actionKeys = new Set((options.designCatalog?.connectorActions || []).map((action) => `${action.connectorSlug}:${action.actionKey}`));
    const bindings = [] as NonNullable<PlaybookIntentTaskDraft['toolBindings']>;
    const bindingsBySlug = new Map<string, NonNullable<PlaybookIntentTaskDraft['toolBindings']>[number]>();
    for (const ref of node.connectorRefs || []) {
      const connector = connectors.get(ref.connectorSlug);
      if (!connector) {
        this.recordDrop(dropped, 'builder_connector_ref_unknown_slug', `${node.ref}:${ref.connectorSlug}`);
        continue;
      }
      if (!actionKeys.has(`${ref.connectorSlug}:${ref.actionKey}`)) {
        this.recordDrop(dropped, 'builder_connector_ref_unknown_action', `${node.ref}:${ref.connectorSlug}.${ref.actionKey}`);
        continue;
      }
      const existing = bindingsBySlug.get(ref.connectorSlug);
      if (existing) {
        existing.actions.push({ actionKey: ref.actionKey, isEnabled: true });
        continue;
      }
      const binding = {
        id: this.safeBindingId('tool', node.ref, ref.connectorSlug),
        connectorId: connector.id,
        connectorSlug: connector.slug,
        connectorName: connector.name,
        actions: [{ actionKey: ref.actionKey, isEnabled: true }],
        isEnabled: true,
      };
      bindingsBySlug.set(ref.connectorSlug, binding);
      bindings.push(binding);
    }
    return bindings;
  }

  private buildSkillBindings(
    node: PlaybookIntentBlueprintNode,
    options: BuildOptions,
    dropped: Array<{ rule: string; itemId: string }>,
  ): NonNullable<PlaybookIntentTaskDraft['skillBindings']> {
    const skills = new Map((options.designCatalog?.skills || []).map((skill) => [skill.slug, skill]));
    const bindings = [] as NonNullable<PlaybookIntentTaskDraft['skillBindings']>;
    for (const ref of node.skillRefs || []) {
      const skill = skills.get(ref.skillSlug);
      if (!skill) {
        this.recordDrop(dropped, 'builder_skill_ref_unknown_slug', `${node.ref}:${ref.skillSlug}`);
        continue;
      }
      bindings.push({
        id: this.safeBindingId('skill', node.ref, ref.skillSlug),
        skillId: skill.id,
        skillSlug: skill.slug,
        skillName: skill.name,
        isEnabled: true,
      });
    }
    return bindings;
  }

  private safeBindingId(...parts: string[]): string {
    return parts.join('-').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'binding';
  }

  private buildIteratorBody(
    body: NonNullable<PlaybookIntentBlueprintNode['iteratorBody']>,
    options: BuildOptions,
    dropped: Array<{ rule: string; itemId: string }>,
  ): PlaybookIntentTaskDraft['iteratorBody'] {
    const referencedPorts = this.collectIteratorReferencedPorts(body);
    const steps = body.steps
      .slice(0, options.limits.maxIteratorBodySteps)
      .map((step) => this.buildIteratorStep(step, options, dropped, referencedPorts))
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
    referencedPorts: ReferencedPorts,
  ): NonNullable<PlaybookIntentTaskDraft['iteratorBody']>['steps'][number] {
    const template = this.resolveTemplate(step as unknown as PlaybookIntentBlueprintNode, options.templates, dropped);
    const inputPorts: BuilderPort[] = this.mergePorts(template?.inputPorts, step.inputPorts, `${step.ref}.inputs`, referencedPorts.inputsByRef.get(step.ref), dropped);
    const outputPorts: BuilderPort[] = this.mergePorts(template?.outputPorts, step.outputPorts, `${step.ref}.outputs`, referencedPorts.outputsByRef.get(step.ref), dropped);
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

  private recordDrop(dropped: Array<{ rule: string; itemId: string }>, rule: string, itemId: string): void {
    dropped.push({ rule, itemId });
    this.logger.warn(`playbook_intent_builder_drop rule=${rule} item=${itemId}`);
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
    referencedTemplatePorts: Set<string> | undefined,
    dropped: Array<{ rule: string; itemId: string }>,
  ): BuilderPort[] {
    const ports: BuilderPort[] = [];
    const seen = new Set<string>();
    if (blueprintPorts?.length) {
      for (const port of blueprintPorts) {
        if (!port.id || !port.artifactKind) {
          dropped.push({ rule: 'builder_port_missing_fields', itemId: `${ownerRef}.${port.id || '?'}` });
          continue;
        }
        if (seen.has(port.id)) continue;
        seen.add(port.id);
        ports.push({
          id: port.id,
          artifactKind: port.artifactKind as BuilderPort['artifactKind'],
          required: port.required === true,
          ...(port.name ? { name: port.name } : {}),
        });
      }
      return ports;
    }

    for (const port of templatePorts || []) {
      if (!port.id || !port.artifactKind) continue;
      if (!referencedTemplatePorts?.has(port.id)) continue;
      if (seen.has(port.id)) continue;
      seen.add(port.id);
      ports.push({
        id: port.id,
        artifactKind: port.artifactKind as BuilderPort['artifactKind'],
        required: false,
        ...(port.name ? { name: port.name } : {}),
      });
    }
    return ports;
  }

  private collectReferencedPorts(blueprint: PlaybookIntentBlueprint): ReferencedPorts {
    const referenced: ReferencedPorts = { inputsByRef: new Map(), outputsByRef: new Map() };
    for (const link of blueprint.links) {
      this.addReferencedPort(referenced.outputsByRef, link.sourceRef, link.sourceOutputPortId || null);
      this.addReferencedPort(referenced.inputsByRef, link.targetRef, link.targetInputPortId || null);
    }
    for (const binding of blueprint.bindings || []) {
      this.addReferencedPort(referenced.inputsByRef, binding.targetRef, binding.targetPort);
      if (binding.sourceKind === 'node-output') this.addReferencedPort(referenced.outputsByRef, binding.sourceRef || null, binding.sourcePort || null);
    }
    return referenced;
  }

  private collectIteratorReferencedPorts(body: NonNullable<PlaybookIntentBlueprintNode['iteratorBody']>): ReferencedPorts {
    const referenced: ReferencedPorts = { inputsByRef: new Map(), outputsByRef: new Map() };
    for (const edge of body.edges) {
      this.addReferencedPort(referenced.outputsByRef, edge.sourceRef, edge.sourceOutputPortId || null);
      this.addReferencedPort(referenced.inputsByRef, edge.targetRef, edge.targetInputPortId || null);
    }
    return referenced;
  }

  private addReferencedPort(portsByRef: Map<string, Set<string>>, ref: string | null, portId: string | null): void {
    if (!ref || !portId) return;
    const ports = portsByRef.get(ref) || new Set<string>();
    ports.add(portId);
    portsByRef.set(ref, ports);
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

  private buildCreateEdgeChangeFromBinding(
    binding: PlaybookIntentBlueprintBinding,
    options: BuildOptions,
    explicitEdgeKeys: Set<string>,
    dropped: Array<{ rule: string; itemId: string }>,
  ): PlaybookIntentWorkflowChange | null {
    if (binding.sourceKind !== 'node-output') return null;
    if (!binding.sourceRef || !binding.sourcePort) return null;
    const link = {
      sourceRef: binding.sourceRef,
      targetRef: binding.targetRef,
      sourceOutputPortId: binding.sourcePort,
      targetInputPortId: binding.targetPort,
    };
    if (explicitEdgeKeys.has(this.blueprintEdgeKey(link))) return null;
    return this.buildCreateEdgeChange(link, options, dropped);
  }

  private blueprintEdgeKey(link: PlaybookIntentBlueprintLink): string {
    return [link.sourceRef, link.targetRef, link.sourceOutputPortId || '', link.targetInputPortId || ''].join(':');
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
