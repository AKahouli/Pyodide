import { Injectable, Logger } from '@nestjs/common';
import {
  PlaybookIntentBlueprint,
  PlaybookIntentBlueprintBinding,
  PlaybookIntentBlueprintIteratorStep,
  PlaybookIntentBlueprintLink,
  PlaybookIntentBlueprintNode,
  PlaybookIntentBlueprintPort,
} from '../interfaces/playbook-flow-intent-blueprint.interface';
import type { PlaybookIntentDiagnostic } from '../interfaces/playbook-flow-intent-diagnostic.interface';
import type {
  IntentNormalizationLimits,
  IntentWorkflowValidationContext,
  PlaybookIntentSuggestion,
  PlaybookIntentTaskDraft,
  PlaybookIntentWorkflowChange,
} from './playbook-flow-intent.service';
import type { FlowNodeTemplateHumanApprovalConfig } from '../interfaces/playbook-flow-node-template.interface';
import { PlaybookFlowPrimitiveRegistryService, type PlaybookPrimitiveRuntimeSpec } from './playbook-flow-primitive-registry.service';

type WorkflowPlanSuggestion = Extract<PlaybookIntentSuggestion, { kind: 'workflow_plan' }>;
import { PlaybookIntentGraphBindingResolverService } from './playbook-intent-graph-binding-resolver.service';

export interface BuilderNodeTemplatePort {
  id: string;
  name: string;
  artifactKind: string;
  required?: boolean;
}

export interface BuilderNodeTemplate {
  key: string;
  nodeType: string;
  enabled: boolean;
  recommendedAgentTypeSlug: string | null;
  selectedAction?: string | null;
  requiredToolNames?: string[];
  iteratorConfig?: unknown;
  routerConfig?: PlaybookIntentTaskDraft['routerConfig'];
  humanApprovalConfig?: FlowNodeTemplateHumanApprovalConfig | PlaybookIntentTaskDraft['humanApprovalConfig'];
  retryPolicy?: PlaybookIntentTaskDraft['retryPolicy'];
  modelId?: string | null;
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
  diagnostics: PlaybookIntentDiagnostic[];
}

type BuilderPort = NonNullable<PlaybookIntentTaskDraft['inputPorts']>[number];
type RouterConditionLike = {
  label: string;
  sourceRef?: string | null;
  sourceIteratorRef?: string | null;
  sourceNode?: string | null;
  sourcePort?: string | null;
};
type BlueprintEndpointNode = Pick<PlaybookIntentBlueprintNode, 'ref' | 'nodeTemplateKey' | 'primitive' | 'routerConfig'>;

interface ReferencedPorts {
  inputsByRef: Map<string, Set<string>>;
  outputsByRef: Map<string, Set<string>>;
  inputKindsByRef: Map<string, Map<string, string>>;
  outputKindsByRef: Map<string, Map<string, string>>;
}

interface ResolvedEndpointRef {
  taskId: string | null;
  nodeRef: string | null;
  iteratorNodeRef?: string | null;
}

@Injectable()
export class PlaybookIntentGraphBuilderService {
  private readonly logger = new Logger(PlaybookIntentGraphBuilderService.name);

  constructor(
    private readonly resolver: PlaybookIntentGraphBindingResolverService,
    private readonly primitiveRegistry: PlaybookFlowPrimitiveRegistryService = new PlaybookFlowPrimitiveRegistryService(),
  ) {}

  build(options: BuildOptions): BuildResult {
    const diagnostics: PlaybookIntentDiagnostic[] = [];
    const nodesByRef = new Map<string, PlaybookIntentBlueprintNode>();
    for (const node of options.blueprint.nodes) {
      nodesByRef.set(node.ref, node);
    }

    const acceptedChanges: PlaybookIntentWorkflowChange[] = [];
    const createdRefs = new Set<string>();
    const referencedPorts = this.collectReferencedPorts(options.blueprint);

    for (const blueprintNode of options.blueprint.nodes.slice(0, options.limits.maxWorkflowPlanChanges)) {
      const change = this.buildCreateNodeChange(blueprintNode, options, diagnostics, referencedPorts);
      if (!change) continue;
      acceptedChanges.push(change);
      createdRefs.add(blueprintNode.ref);
    }

    for (const link of options.blueprint.links) {
      const change = this.buildCreateEdgeChange(link, options, diagnostics);
      if (change) acceptedChanges.push(change);
    }

    const explicitEdgeKeys = new Set(options.blueprint.links.map((link) => this.blueprintEdgeKey(link)));
    for (const binding of options.blueprint.bindings || []) {
      const change = this.buildCreateEdgeChangeFromBinding(binding, options, explicitEdgeKeys, diagnostics);
      if (change) acceptedChanges.push(change);
    }

    for (const binding of options.blueprint.bindings || []) {
      const change = this.buildCreateBindingChange(binding, options, diagnostics);
      if (change) acceptedChanges.push(change);
    }

    const resolved = this.resolver.resolveWorkflowChanges({
      changes: acceptedChanges,
      context: options.context,
      deletedTaskIds: new Set(),
    });
    diagnostics.push(...resolved.diagnostics);
    const resolvedChanges = resolved.changes;

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

    return { suggestion, diagnostics };
  }

  private buildCreateNodeChange(
    node: PlaybookIntentBlueprintNode,
    options: BuildOptions,
    diagnostics: PlaybookIntentDiagnostic[],
    referencedPorts: ReferencedPorts,
  ): PlaybookIntentWorkflowChange | null {
    const template = this.resolveNodeTemplate(node.nodeTemplateKey, options.templates, diagnostics);
    if (!template) return null;
    const runtimeSpec = this.resolvePrimitiveRuntimeSpec(node, diagnostics);
    this.appendPrimitiveDiagnostics(runtimeSpec, node, this.supportsIteratorBody(template), diagnostics);
    const inputPorts: BuilderPort[] = this.mergePorts(template.inputPorts, node.inputPorts, `${node.ref}.inputs`, referencedPorts.inputsByRef.get(node.ref), referencedPorts.inputKindsByRef.get(node.ref), diagnostics);
    const routerConfig = this.buildRouterConfig(node, template, diagnostics);
    const nodeType = this.resolveNodeType(node, template, routerConfig);
    const normalizedOutputPorts = this.normalizeOutputPorts(node.outputPorts, node, runtimeSpec, routerConfig);
    const outputPorts: BuilderPort[] = this.mergePorts(template.outputPorts, normalizedOutputPorts, `${node.ref}.outputs`, referencedPorts.outputsByRef.get(node.ref), referencedPorts.outputKindsByRef.get(node.ref), diagnostics);
    const agentSlug = this.resolveAgentSlug(node, template);

    let task: PlaybookIntentTaskDraft = {
      title: node.label,
      description: node.purpose || node.label,
      ...(agentSlug ? { agentSlug } : {}),
      nodeTemplateKey: template.key,
      nodeType,
      taskType: this.resolveTaskType(nodeType),
      ...(routerConfig ? { routerConfig } : {}),
      ...(node.humanApprovalConfig ? { humanApprovalConfig: node.humanApprovalConfig } : template.humanApprovalConfig ? { humanApprovalConfig: { ...template.humanApprovalConfig } } : {}),
      ...(template.retryPolicy ? { retryPolicy: template.retryPolicy } : {}),
      ...(template.modelId ? { modelId: template.modelId } : {}),
      ...(inputPorts.length ? { inputPorts } : {}),
      ...(outputPorts.length ? { outputPorts } : {}),
      ...(node.connectorRefs?.length ? { toolBindings: this.buildToolBindings(node, options, diagnostics) } : {}),
      ...(node.skillRefs?.length ? { skillBindings: this.buildSkillBindings(node, options, diagnostics) } : {}),
      ...(node.iteratorBody && this.supportsIteratorBody(template) ? { iteratorBody: this.buildIteratorBody(node.ref, node.iteratorBody, options, diagnostics, referencedPorts) } : {}),
    };
    if (node.iteratorBody && !this.supportsIteratorBody(template)) {
      this.recordDiagnostic(diagnostics, 'builder_iterator_body_not_supported_by_template', node.ref);
    }
    task = this.applyPrimitiveTaskPatch(task, node, runtimeSpec);

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
    diagnostics: PlaybookIntentDiagnostic[],
  ): NonNullable<PlaybookIntentTaskDraft['toolBindings']> {
    const connectors = new Map((options.designCatalog?.connectors || []).map((connector) => [connector.slug, connector]));
    const actionKeys = new Set((options.designCatalog?.connectorActions || []).map((action) => `${action.connectorSlug}:${action.actionKey}`));
    const bindings = [] as NonNullable<PlaybookIntentTaskDraft['toolBindings']>;
    const bindingsBySlug = new Map<string, NonNullable<PlaybookIntentTaskDraft['toolBindings']>[number]>();
    for (const ref of node.connectorRefs || []) {
      const connector = connectors.get(ref.connectorSlug);
      if (!connector) {
        this.recordDiagnostic(diagnostics, 'builder_connector_ref_unknown_slug', `${node.ref}:${ref.connectorSlug}`);
        continue;
      }
      if (!actionKeys.has(`${ref.connectorSlug}:${ref.actionKey}`)) {
        this.recordDiagnostic(diagnostics, 'builder_connector_ref_unknown_action', `${node.ref}:${ref.connectorSlug}.${ref.actionKey}`);
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
    diagnostics: PlaybookIntentDiagnostic[],
  ): NonNullable<PlaybookIntentTaskDraft['skillBindings']> {
    const skills = new Map((options.designCatalog?.skills || []).map((skill) => [skill.slug, skill]));
    const bindings = [] as NonNullable<PlaybookIntentTaskDraft['skillBindings']>;
    for (const ref of node.skillRefs || []) {
      const skill = skills.get(ref.skillSlug);
      if (!skill) {
        this.recordDiagnostic(diagnostics, 'builder_skill_ref_unknown_slug', `${node.ref}:${ref.skillSlug}`);
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
    ownerRef: string,
    body: NonNullable<PlaybookIntentBlueprintNode['iteratorBody']>,
    options: BuildOptions,
    diagnostics: PlaybookIntentDiagnostic[],
    externalReferencedPorts: ReferencedPorts,
  ): PlaybookIntentTaskDraft['iteratorBody'] {
    const referencedPorts = this.collectIteratorReferencedPorts(body);
    this.mergeExternalIteratorReferences(ownerRef, body, referencedPorts, externalReferencedPorts);
    const steps = body.steps
      .slice(0, options.limits.maxIteratorBodySteps)
      .map((step) => this.buildIteratorStep(step, options, diagnostics, referencedPorts))
      .filter((step): step is NonNullable<PlaybookIntentTaskDraft['iteratorBody']>['steps'][number] => step !== null);
    const validStepRefs = new Set(steps.map((s) => s.nodeRef));
    const routerLabelsByStepRef = new Map(steps
      .filter((step) => step.routerConfig)
      .map((step) => [step.nodeRef, new Set(step.routerConfig!.outputLabels)]));
    const edges = body.edges
      .filter((edge) => validStepRefs.has(edge.sourceRef) && validStepRefs.has(edge.targetRef))
      .slice(0, options.limits.maxIteratorBodyEdges)
      .filter((edge) => this.isValidIteratorBodyEdge(ownerRef, edge, routerLabelsByStepRef, diagnostics))
      .map((edge) => ({
        sourceNodeRef: edge.sourceRef,
        targetNodeRef: edge.targetRef,
        ...(edge.kind ? { edgeKind: edge.kind } : {}),
        ...(edge.routerLabel ? { routerLabel: edge.routerLabel } : {}),
        ...(edge.sourceOutputPortId ? { sourceOutputPortId: edge.sourceOutputPortId } : {}),
        ...(edge.targetInputPortId ? { targetInputPortId: edge.targetInputPortId } : {}),
      }));

    return { steps, edges };
  }

  private isValidIteratorBodyEdge(
    ownerRef: string,
    edge: NonNullable<PlaybookIntentBlueprintNode['iteratorBody']>['edges'][number],
    routerLabelsByStepRef: Map<string, Set<string>>,
    diagnostics: PlaybookIntentDiagnostic[],
  ): boolean {
    const routerLabels = routerLabelsByStepRef.get(edge.sourceRef) || null;
    const edgeKind = edge.kind || (routerLabels ? 'conditional' : undefined);
    if (edgeKind !== 'conditional') return true;
    if (routerLabels?.has(edge.routerLabel || '')) return true;
    this.recordDiagnostic(diagnostics, 'builder_conditional_edge_invalid_router_label', `${ownerRef}.${edge.sourceRef}->${edge.targetRef}`);
    return false;
  }

  private buildIteratorStep(
    step: PlaybookIntentBlueprintIteratorStep,
    options: BuildOptions,
    diagnostics: PlaybookIntentDiagnostic[],
    referencedPorts: ReferencedPorts,
  ): NonNullable<PlaybookIntentTaskDraft['iteratorBody']>['steps'][number] | null {
    const template = this.resolveNodeTemplate(step.nodeTemplateKey, options.templates, diagnostics);
    if (!template) return null;
    const nodeLike = { ...step, label: step.title, purpose: step.description || step.title } as PlaybookIntentBlueprintNode;
    const runtimeSpec = this.resolvePrimitiveRuntimeSpec(nodeLike, diagnostics);
    this.appendPrimitiveDiagnostics(runtimeSpec, nodeLike, this.supportsIteratorBody(template), diagnostics);
    const routerConfig = this.buildRouterConfig(nodeLike, template, diagnostics);
    const nodeType = this.resolveNodeType(nodeLike, template, routerConfig);
    const inputPorts: BuilderPort[] = this.mergePorts(template.inputPorts, step.inputPorts, `${step.ref}.inputs`, referencedPorts.inputsByRef.get(step.ref), referencedPorts.inputKindsByRef.get(step.ref), diagnostics);
    const normalizedOutputPorts = this.normalizeOutputPorts(step.outputPorts, nodeLike, runtimeSpec, routerConfig);
    const outputPorts: BuilderPort[] = this.mergePorts(template.outputPorts, normalizedOutputPorts, `${step.ref}.outputs`, referencedPorts.outputsByRef.get(step.ref), referencedPorts.outputKindsByRef.get(step.ref), diagnostics);
    const task = this.applyPrimitiveTaskPatch({
      nodeRef: step.ref,
      title: step.title,
      description: step.description || step.title,
      nodeTemplateKey: template.key,
      nodeType,
      taskType: this.resolveTaskType(nodeType),
      ...(template.recommendedAgentTypeSlug ? { agentSlug: template.recommendedAgentTypeSlug } : {}),
      ...(step.agentHint ? { agentSlug: step.agentHint } : {}),
      ...(routerConfig ? { routerConfig } : {}),
      ...(template.humanApprovalConfig ? { humanApprovalConfig: { ...template.humanApprovalConfig } } : {}),
      ...(template.retryPolicy ? { retryPolicy: template.retryPolicy } : {}),
      ...(template.modelId ? { modelId: template.modelId } : {}),
      ...(step.connectorRefs?.length ? { toolBindings: this.buildToolBindings(nodeLike, options, diagnostics) } : {}),
      ...(step.skillRefs?.length ? { skillBindings: this.buildSkillBindings(nodeLike, options, diagnostics) } : {}),
      ...(inputPorts.length ? { inputPorts } : {}),
      ...(outputPorts.length ? { outputPorts } : {}),
    }, nodeLike, runtimeSpec);
    return task as NonNullable<PlaybookIntentTaskDraft['iteratorBody']>['steps'][number];
  }

  private resolvePrimitiveRuntimeSpec(
    node: PlaybookIntentBlueprintNode,
    diagnostics: PlaybookIntentDiagnostic[],
  ): PlaybookPrimitiveRuntimeSpec | null {
    const kind = node.primitive?.kind;
    if (!kind) return null;
    const runtimeSpec = this.primitiveRegistry.getRuntimeSpec(kind);
    if (!runtimeSpec && !this.primitiveRegistry.isKnownPrimitive(kind)) {
      this.recordDiagnostic(diagnostics, 'builder_primitive_kind_unknown', `${node.ref}:${kind}`);
    }
    return runtimeSpec;
  }

  private appendPrimitiveDiagnostics(
    runtimeSpec: PlaybookPrimitiveRuntimeSpec | null,
    node: PlaybookIntentBlueprintNode,
    supportsIteratorBody: boolean,
    diagnostics: PlaybookIntentDiagnostic[],
  ): void {
    for (const diagnostic of runtimeSpec?.validateNode?.({ node, supportsIteratorBody }) || []) {
      diagnostics.push(diagnostic);
      this.logger.warn(`playbook_intent_builder_drop rule=${diagnostic.code} item=${diagnostic.itemId || ''}`);
    }
  }

  private normalizeOutputPorts(
    ports: PlaybookIntentBlueprintPort[] | undefined,
    node: PlaybookIntentBlueprintNode,
    runtimeSpec: PlaybookPrimitiveRuntimeSpec | null,
    routerConfig: PlaybookIntentTaskDraft['routerConfig'] | null,
  ): PlaybookIntentBlueprintPort[] | undefined {
    if (node.primitive && runtimeSpec?.normalizeOutputPorts) {
      return runtimeSpec.normalizeOutputPorts(ports, node.primitive);
    }
    return routerConfig ? this.withRouterOutputPorts(ports, routerConfig.outputLabels) : ports;
  }

  private applyPrimitiveTaskPatch<T extends PlaybookIntentTaskDraft>(
    task: T,
    node: PlaybookIntentBlueprintNode,
    runtimeSpec: PlaybookPrimitiveRuntimeSpec | null,
  ): T {
    if (!node.primitive || !runtimeSpec?.compileTaskPatch) return task;
    return { ...task, ...runtimeSpec.compileTaskPatch(node.primitive) };
  }

  private resolveNodeTemplate(
    nodeTemplateKey: string,
    templates: BuilderNodeTemplate[],
    diagnostics: PlaybookIntentDiagnostic[],
  ): BuilderNodeTemplate | undefined {
    const template = templates.find((candidate) => candidate.enabled && candidate.key === nodeTemplateKey);
    if (!template) this.recordDiagnostic(diagnostics, 'builder_node_template_key_unknown', nodeTemplateKey);
    return template;
  }

  private supportsIteratorBody(template: BuilderNodeTemplate): boolean {
    return Boolean(template.iteratorConfig);
  }

  private buildRouterConfig(
    node: PlaybookIntentBlueprintNode,
    template: BuilderNodeTemplate,
    diagnostics: PlaybookIntentDiagnostic[],
  ): PlaybookIntentTaskDraft['routerConfig'] | null {
    const source = node.primitive?.router || node.routerConfig || template.routerConfig || null;
    const isRouter = (node.primitive?.kind || template.nodeType) === 'router' || Boolean(source);
    if (!isRouter) return null;
    if (!source) {
      this.recordDiagnostic(diagnostics, 'builder_router_primitive_missing_config', node.ref);
      return null;
    }
    const outputLabels = [...new Set((source.outputLabels || []).map((label) => label.trim()).filter(Boolean))];
    if (outputLabels.length === 0) {
      this.recordDiagnostic(diagnostics, 'builder_router_missing_output_labels', node.ref);
      return null;
    }
    const defaultLabel = source.defaultLabel && outputLabels.includes(source.defaultLabel) ? source.defaultLabel : null;
    return {
      outputLabels,
      maxIterations: source.maxIterations ?? template.routerConfig?.maxIterations ?? 1,
      defaultLabel,
      conditions: (source.conditions || [])
        .filter((condition) => {
          const isKnownLabel = outputLabels.includes(condition.label);
          if (!isKnownLabel) this.recordDiagnostic(diagnostics, 'builder_router_condition_unknown_label', `${node.ref}:${condition.label}`);
          return isKnownLabel;
        })
        .map((condition) => ({
          label: condition.label,
          sourceNode: this.resolveRouterConditionSourceNode(condition),
          sourcePort: condition.sourcePort,
          ...(condition.path ? { path: condition.path } : {}),
          operator: condition.operator,
          ...(Object.prototype.hasOwnProperty.call(condition, 'value') ? { value: condition.value } : {}),
        })),
    };
  }

  private resolveNodeType(
    node: PlaybookIntentBlueprintNode,
    template: BuilderNodeTemplate,
    routerConfig: PlaybookIntentTaskDraft['routerConfig'] | null,
  ): NonNullable<PlaybookIntentTaskDraft['nodeType']> {
    const primitiveKind = node.primitive?.kind;
    if (primitiveKind === 'router' || routerConfig) return 'router';
    if (primitiveKind === 'iterator') return 'iterator';
    if (primitiveKind === 'human_approval') return 'human_approval';
    if (primitiveKind === 'action') return 'action';
    if (primitiveKind === 'evaluation') return 'evaluation';
    if (template.nodeType === 'router' || template.nodeType === 'iterator' || template.nodeType === 'human_approval' || template.nodeType === 'action' || template.nodeType === 'evaluation') {
      return template.nodeType;
    }
    return 'agent';
  }

  private resolveTaskType(nodeType: NonNullable<PlaybookIntentTaskDraft['nodeType']>): string {
    if (nodeType === 'router') return 'router';
    if (nodeType === 'iterator') return 'iterator';
    if (nodeType === 'evaluation') return 'evaluation';
    return 'generic';
  }

  private resolveRouterConditionSourceNode(
    condition: RouterConditionLike,
  ): string | null {
    if ('sourceRef' in condition) return this.scopedRef(condition.sourceIteratorRef, condition.sourceRef || null);
    return condition.sourceNode || null;
  }

  private withRouterOutputPorts(
    ports: PlaybookIntentBlueprintPort[] | undefined,
    outputLabels: string[],
  ): PlaybookIntentBlueprintPort[] {
    const byId = new Map((ports || []).map((port) => [port.id, port]));
    for (const label of outputLabels) {
      if (!byId.has(label)) {
        byId.set(label, { id: label, name: label, artifactKind: 'text' });
      }
    }
    return [...byId.values()];
  }

  private recordDiagnostic(diagnostics: PlaybookIntentDiagnostic[], code: string, itemId: string): void {
    const diagnostic: PlaybookIntentDiagnostic = {
      severity: 'warning',
      stage: 'graph_builder',
      code,
      itemId,
      message: code,
    };
    diagnostics.push(diagnostic);
    this.logger.warn(`playbook_intent_builder_drop rule=${diagnostic.code} item=${diagnostic.itemId || ''}`);
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
    referencedTemplatePortKinds: Map<string, string> | undefined,
    diagnostics: PlaybookIntentDiagnostic[],
  ): BuilderPort[] {
    const ports: BuilderPort[] = [];
    const seen = new Set<string>();
    for (const port of templatePorts || []) {
      if (!port.id || !port.artifactKind) continue;
      if (!port.required && !referencedTemplatePorts?.has(port.id)) continue;
      if (seen.has(port.id)) continue;
      seen.add(port.id);
      ports.push({
        id: port.id,
        artifactKind: (referencedTemplatePortKinds?.get(port.id) || port.artifactKind) as BuilderPort['artifactKind'],
        required: port.required === true,
        ...(port.name ? { name: port.name } : {}),
      });
    }

    if (blueprintPorts?.length) {
      const byId = new Map(ports.map((port) => [port.id, port]));
      for (const port of blueprintPorts) {
        if (!port.id || !port.artifactKind) {
          this.recordDiagnostic(diagnostics, 'builder_port_missing_fields', `${ownerRef}.${port.id || '?'}`);
          continue;
        }
        const existing = byId.get(port.id);
        if (existing) {
          existing.name = port.name || existing.name;
          existing.artifactKind = port.artifactKind as BuilderPort['artifactKind'];
          existing.required = existing.required === true || port.required === true;
          continue;
        }
        seen.add(port.id);
        const nextPort = {
          id: port.id,
          artifactKind: port.artifactKind as BuilderPort['artifactKind'],
          required: port.required === true,
          ...(port.name ? { name: port.name } : {}),
        };
        byId.set(port.id, nextPort);
        ports.push(nextPort);
      }
      return ports;
    }
    return ports;
  }

  private collectReferencedPorts(blueprint: PlaybookIntentBlueprint): ReferencedPorts {
    const referenced = this.emptyReferencedPorts();
    const catalog = this.buildBlueprintPortCatalog(blueprint.nodes);
    for (const link of blueprint.links) {
      const sourceRef = this.scopedRef(link.sourceIteratorRef, link.sourceRef);
      const targetRef = this.scopedRef(link.targetIteratorRef, link.targetRef);
      this.addReferencedPort(referenced.outputsByRef, sourceRef, link.sourceOutputPortId || null);
      this.addReferencedPort(referenced.inputsByRef, targetRef, link.targetInputPortId || null);
      const sourceKind = this.lookupPortKind(catalog.outputsByRef, sourceRef, link.sourceOutputPortId || null);
      const targetKind = this.lookupPortKind(catalog.inputsByRef, targetRef, link.targetInputPortId || null);
      this.addReferencedPortKind(referenced.inputKindsByRef, targetRef, link.targetInputPortId || null, sourceKind);
      this.addReferencedPortKind(referenced.outputKindsByRef, sourceRef, link.sourceOutputPortId || null, targetKind);
    }
    for (const binding of blueprint.bindings || []) {
      const targetRef = this.scopedRef(binding.targetIteratorRef, binding.targetRef);
      this.addReferencedPort(referenced.inputsByRef, targetRef, binding.targetPort);
      if (binding.sourceKind === 'node-output') {
        const sourceRef = this.scopedRef(binding.sourceIteratorRef, binding.sourceRef || null);
        this.addReferencedPort(referenced.outputsByRef, sourceRef, binding.sourcePort || null);
        const sourceKind = this.lookupPortKind(catalog.outputsByRef, sourceRef, binding.sourcePort || null);
        const targetKind = this.lookupPortKind(catalog.inputsByRef, targetRef, binding.targetPort);
        this.addReferencedPortKind(referenced.inputKindsByRef, targetRef, binding.targetPort, sourceKind);
        this.addReferencedPortKind(referenced.outputKindsByRef, sourceRef, binding.sourcePort || null, targetKind);
      }
    }
    return referenced;
  }

  private collectIteratorReferencedPorts(body: NonNullable<PlaybookIntentBlueprintNode['iteratorBody']>): ReferencedPorts {
    const referenced = this.emptyReferencedPorts();
    for (const edge of body.edges) {
      this.addReferencedPort(referenced.outputsByRef, edge.sourceRef, edge.sourceOutputPortId || null);
      this.addReferencedPort(referenced.inputsByRef, edge.targetRef, edge.targetInputPortId || null);
    }
    return referenced;
  }

  private mergeExternalIteratorReferences(
    ownerRef: string,
    body: NonNullable<PlaybookIntentBlueprintNode['iteratorBody']>,
    referenced: ReferencedPorts,
    externalReferenced: ReferencedPorts,
  ): void {
    for (const step of body.steps) {
      const scoped = `${ownerRef}.${step.ref}`;
      this.copyReferencedPorts(externalReferenced.inputsByRef.get(scoped), referenced.inputsByRef, step.ref);
      this.copyReferencedPorts(externalReferenced.outputsByRef.get(scoped), referenced.outputsByRef, step.ref);
      this.copyReferencedPortKinds(externalReferenced.inputKindsByRef.get(scoped), referenced.inputKindsByRef, step.ref);
      this.copyReferencedPortKinds(externalReferenced.outputKindsByRef.get(scoped), referenced.outputKindsByRef, step.ref);
    }
  }

  private copyReferencedPorts(source: Set<string> | undefined, target: Map<string, Set<string>>, ref: string): void {
    if (!source?.size) return;
    const ports = target.get(ref) || new Set<string>();
    for (const port of source) ports.add(port);
    target.set(ref, ports);
  }

  private copyReferencedPortKinds(source: Map<string, string> | undefined, target: Map<string, Map<string, string>>, ref: string): void {
    if (!source?.size) return;
    const ports = target.get(ref) || new Map<string, string>();
    for (const [port, kind] of source) ports.set(port, kind);
    target.set(ref, ports);
  }

  private emptyReferencedPorts(): ReferencedPorts {
    return { inputsByRef: new Map(), outputsByRef: new Map(), inputKindsByRef: new Map(), outputKindsByRef: new Map() };
  }

  private addReferencedPort(portsByRef: Map<string, Set<string>>, ref: string | null, portId: string | null): void {
    if (!ref || !portId) return;
    const ports = portsByRef.get(ref) || new Set<string>();
    ports.add(portId);
    portsByRef.set(ref, ports);
  }

  private addReferencedPortKind(portsByRef: Map<string, Map<string, string>>, ref: string | null, portId: string | null, artifactKind: string | null): void {
    if (!ref || !portId || !artifactKind) return;
    const ports = portsByRef.get(ref) || new Map<string, string>();
    const existing = ports.get(portId);
    if (existing && existing !== artifactKind) return;
    ports.set(portId, artifactKind);
    portsByRef.set(ref, ports);
  }

  private buildBlueprintPortCatalog(nodes: PlaybookIntentBlueprintNode[]): { inputsByRef: Map<string, Map<string, string>>; outputsByRef: Map<string, Map<string, string>> } {
    const inputsByRef = new Map<string, Map<string, string>>();
    const outputsByRef = new Map<string, Map<string, string>>();
    for (const node of nodes) {
      inputsByRef.set(node.ref, this.blueprintPortMap(node.inputPorts));
      outputsByRef.set(node.ref, this.blueprintPortMap(node.outputPorts));
      for (const step of node.iteratorBody?.steps || []) {
        const ref = `${node.ref}.${step.ref}`;
        inputsByRef.set(ref, this.blueprintPortMap(step.inputPorts));
        outputsByRef.set(ref, this.blueprintPortMap(step.outputPorts));
      }
    }
    return { inputsByRef, outputsByRef };
  }

  private blueprintPortMap(ports: PlaybookIntentBlueprintPort[] | undefined): Map<string, string> {
    return new Map((ports || []).map((port) => [port.id, port.artifactKind]));
  }

  private lookupPortKind(portsByRef: Map<string, Map<string, string>>, ref: string | null, portId: string | null): string | null {
    return ref && portId ? portsByRef.get(ref)?.get(portId) || null : null;
  }

  private buildCreateEdgeChange(
    link: PlaybookIntentBlueprintLink,
    options: BuildOptions,
    diagnostics: PlaybookIntentDiagnostic[],
  ): PlaybookIntentWorkflowChange | null {
    const source = this.resolveEndpointReference(link.sourceRef, link.sourceIteratorRef || null, options);
    const target = this.resolveEndpointReference(link.targetRef, link.targetIteratorRef || null, options);
    if (!source || !target) {
      this.recordDiagnostic(diagnostics, 'builder_edge_unknown_ref', `${link.sourceRef}->${link.targetRef}`);
      return null;
    }
    const sourceNode = this.findBlueprintEndpointNode(link.sourceRef, link.sourceIteratorRef || null, options);
    const sourceTemplate = sourceNode ? options.templates.find((template) => template.enabled && template.key === sourceNode.nodeTemplateKey) : null;
    const routerConfig = sourceNode ? (sourceNode.primitive?.router || sourceNode.routerConfig || sourceTemplate?.routerConfig) : null;
    const edgeKind = link.kind || (routerConfig ? 'conditional' : undefined);
    if (edgeKind === 'conditional') {
      if (!routerConfig || !link.routerLabel || !routerConfig.outputLabels.includes(link.routerLabel)) {
        this.recordDiagnostic(diagnostics, 'builder_conditional_edge_invalid_router_label', `${link.sourceRef}->${link.targetRef}`);
        return null;
      }
    }
    return {
      type: 'create_edge',
      sourceTaskId: source.taskId,
      sourceNodeRef: source.nodeRef,
      ...(source.iteratorNodeRef ? { sourceIteratorNodeRef: source.iteratorNodeRef } : {}),
      targetTaskId: target.taskId,
      targetNodeRef: target.nodeRef,
      ...(target.iteratorNodeRef ? { targetIteratorNodeRef: target.iteratorNodeRef } : {}),
      ...(link.sourceOutputPortId || (edgeKind === 'conditional' && link.routerLabel) ? { sourceOutputPortId: link.sourceOutputPortId || link.routerLabel } : {}),
      ...(link.targetInputPortId ? { targetInputPortId: link.targetInputPortId } : {}),
      ...(edgeKind ? { edgeKind } : {}),
      ...(link.routerLabel ? { routerLabel: link.routerLabel } : {}),
      ...(link.priority != null ? { priority: link.priority } : {}),
    };
  }

  private buildCreateBindingChange(
    binding: PlaybookIntentBlueprintBinding,
    options: BuildOptions,
    diagnostics: PlaybookIntentDiagnostic[],
  ): PlaybookIntentWorkflowChange | null {
    const target = this.resolveEndpointReference(binding.targetRef, binding.targetIteratorRef || null, options);
    if (!target) {
      this.recordDiagnostic(diagnostics, 'builder_binding_unknown_target', `${binding.targetRef}.${binding.targetPort}`);
      return null;
    }
    if (binding.sourceKind === 'constant' && binding.constantValue) {
      return {
        type: 'create_data_binding',
        targetTaskId: target.taskId,
        targetNodeRef: target.nodeRef,
        ...(target.iteratorNodeRef ? { targetIteratorNodeRef: target.iteratorNodeRef } : {}),
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
      this.recordDiagnostic(diagnostics, 'builder_binding_missing_source', `${binding.targetRef}.${binding.targetPort}`);
      return null;
    }
    const source = this.resolveEndpointReference(binding.sourceRef, binding.sourceIteratorRef || null, options);
    if (!source) {
      this.recordDiagnostic(diagnostics, 'builder_binding_unknown_source', `${binding.sourceRef}->${binding.targetRef}.${binding.targetPort}`);
      return null;
    }
    return {
      type: 'create_data_binding',
      targetTaskId: target.taskId,
      targetNodeRef: target.nodeRef,
      ...(target.iteratorNodeRef ? { targetIteratorNodeRef: target.iteratorNodeRef } : {}),
      targetPort: binding.targetPort,
      sourceKind: 'node-output',
      sourceTaskId: source.taskId,
      sourceNodeRef: source.nodeRef,
      ...(source.iteratorNodeRef ? { sourceIteratorNodeRef: source.iteratorNodeRef } : {}),
      sourcePort: binding.sourcePort,
      iteration: binding.iteration || 'current',
    };
  }

  private buildCreateEdgeChangeFromBinding(
    binding: PlaybookIntentBlueprintBinding,
    options: BuildOptions,
    explicitEdgeKeys: Set<string>,
    diagnostics: PlaybookIntentDiagnostic[],
  ): PlaybookIntentWorkflowChange | null {
    if (binding.sourceKind !== 'node-output') return null;
    if (!binding.sourceRef || !binding.sourcePort) return null;
    const link = {
      sourceRef: binding.sourceRef,
      targetRef: binding.targetRef,
      sourceIteratorRef: binding.sourceIteratorRef,
      targetIteratorRef: binding.targetIteratorRef,
      sourceOutputPortId: binding.sourcePort,
      targetInputPortId: binding.targetPort,
    };
    if (explicitEdgeKeys.has(this.blueprintEdgeKey(link))) return null;
    return this.buildCreateEdgeChange(link, options, diagnostics);
  }

  private findBlueprintEndpointNode(ref: string, iteratorRef: string | null, options: BuildOptions): BlueprintEndpointNode | null {
    if (!iteratorRef || ref === iteratorRef) {
      return options.blueprint.nodes.find((node) => node.ref === ref) || null;
    }
    return options.blueprint.nodes
      .find((node) => node.ref === iteratorRef)
      ?.iteratorBody?.steps.find((step) => step.ref === ref) || null;
  }

  private blueprintEdgeKey(link: PlaybookIntentBlueprintLink): string {
    return [link.sourceIteratorRef || '', link.sourceRef, link.targetIteratorRef || '', link.targetRef, link.sourceOutputPortId || '', link.targetInputPortId || ''].join(':');
  }

  private resolveReference(ref: string, options: BuildOptions): string | null {
    if (options.context.existingTaskIds.has(ref)) return ref;
    if (options.blueprint.nodes.some((node) => node.ref === ref)) return ref;
    return null;
  }

  private resolveEndpointReference(ref: string | null | undefined, iteratorRef: string | null, options: BuildOptions): ResolvedEndpointRef | null {
    if (!ref) return null;
    if (!iteratorRef || ref === iteratorRef) {
      const resolved = this.resolveReference(ref, options);
      if (!resolved) return null;
      return options.context.existingTaskIds.has(resolved)
        ? { taskId: resolved, nodeRef: null }
        : { taskId: null, nodeRef: resolved };
    }
    const iteratorNode = options.blueprint.nodes.find((node) => node.ref === iteratorRef);
    if (!iteratorNode?.iteratorBody?.steps.some((step) => step.ref === ref)) return null;
    return { taskId: null, nodeRef: ref, iteratorNodeRef: iteratorRef };
  }

  private scopedRef(iteratorRef: string | null | undefined, ref: string | null): string | null {
    if (!ref) return null;
    return iteratorRef ? `${iteratorRef}.${ref}` : ref;
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
