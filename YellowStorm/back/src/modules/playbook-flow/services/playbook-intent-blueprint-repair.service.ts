import { Injectable } from '@nestjs/common';
import type {
  PlaybookIntentBlueprint,
  PlaybookIntentBlueprintIteratorStep,
  PlaybookIntentBlueprintLink,
  PlaybookIntentBlueprintNode,
  PlaybookIntentBlueprintPort,
  PlaybookIntentBlueprintRouterConfig,
} from '../interfaces/playbook-flow-intent-blueprint.interface';
import type { PlaybookIntentDiagnostic } from '../interfaces/playbook-flow-intent-diagnostic.interface';
import type { IntentWorkflowValidationContext } from './playbook-flow-intent.service';
import type { BuilderDesignCatalog, BuilderNodeTemplate } from './playbook-intent-graph-builder.service';

export interface BlueprintRepairResult {
  blueprint: PlaybookIntentBlueprint;
  diagnostics: PlaybookIntentDiagnostic[];
  repairSummary: string[];
}

interface RepairArgs {
  blueprint: PlaybookIntentBlueprint;
  templates: BuilderNodeTemplate[];
  // Part of the repair contract; future safe checks can validate resources and existing graph state without changing callers.
  designCatalog: BuilderDesignCatalog;
  existingContext: IntentWorkflowValidationContext;
}

type RepairableNode = PlaybookIntentBlueprintNode | PlaybookIntentBlueprintIteratorStep;
type PortListName = 'inputPorts' | 'outputPorts';

@Injectable()
export class PlaybookIntentBlueprintRepairService {
  repair(args: RepairArgs): BlueprintRepairResult {
    const blueprint = JSON.parse(JSON.stringify(args.blueprint)) as PlaybookIntentBlueprint;
    // JSON round-trip splits the parser's shared reference between node.routerConfig and
    // node.primitive.router; the builder reads primitive.router first, so re-alias to keep
    // router repairs visible downstream.
    for (const node of blueprint.nodes) {
      if (node.routerConfig && node.primitive) node.primitive.router = node.routerConfig;
    }
    const templates = new Map(args.templates.filter((template) => template.enabled).map((template) => [template.key, template]));
    const diagnostics: PlaybookIntentDiagnostic[] = [];
    const repairSummary: string[] = [];

    this.adoptRouterLabelsFromLinks(blueprint, templates, diagnostics, repairSummary);

    blueprint.nodes.forEach((node, index) => {
      this.repairNode(node, templates.get(node.nodeTemplateKey), `nodes.${index}`, diagnostics, repairSummary);
      node.iteratorBody?.steps.forEach((step, stepIndex) => {
        this.repairNode(step, templates.get(step.nodeTemplateKey), `nodes.${index}.iteratorBody.steps.${stepIndex}`, diagnostics, repairSummary);
      });
      node.iteratorBody?.edges.forEach((edge, edgeIndex) => {
        this.repairLink(edge, `nodes.${index}.iteratorBody.edges.${edgeIndex}`, diagnostics, repairSummary);
      });
    });

    blueprint.links.forEach((link, index) => {
      this.repairLink(link, `links.${index}`, diagnostics, repairSummary);
    });

    this.repairIteratorCurrentItemBindings(blueprint, templates, diagnostics, repairSummary);
    this.repairUnboundRequiredInputBindings(blueprint, diagnostics, repairSummary);

    return { blueprint, diagnostics, repairSummary };
  }

  private repairIteratorCurrentItemBindings(
    blueprint: PlaybookIntentBlueprint,
    templates: Map<string, BuilderNodeTemplate>,
    diagnostics: PlaybookIntentDiagnostic[],
    repairSummary: string[],
  ): void {
    const occupiedTargets = new Set<string>();
    for (const binding of blueprint.bindings || []) {
      occupiedTargets.add(this.scopedTargetKey(binding.targetIteratorRef, binding.targetRef, binding.targetPort));
    }
    for (const link of blueprint.links) {
      if (!link.targetInputPortId) continue;
      occupiedTargets.add(this.scopedTargetKey(link.targetIteratorRef, link.targetRef, link.targetInputPortId));
    }

    for (const [nodeIndex, iterator] of blueprint.nodes.entries()) {
      const iteratorTemplate = templates.get(iterator.nodeTemplateKey);
      if (!iterator.iteratorBody || !iteratorTemplate?.iteratorConfig) continue;

      const itemsPort = iterator.inputPorts?.find((port) => port.id === 'items');
      if (!itemsPort) continue;

      const nonEntryRefs = new Set(iterator.iteratorBody.edges.map((edge) => edge.targetRef));
      for (const [stepIndex, step] of iterator.iteratorBody.steps.entries()) {
        if (nonEntryRefs.has(step.ref)) continue;

        const stepTemplatePortIds = new Set(
          (templates.get(step.nodeTemplateKey)?.inputPorts || []).map((port) => port.id),
        );
        const unboundRequiredPorts = (step.inputPorts || []).filter((port) =>
          port.required === true
          && !stepTemplatePortIds.has(port.id)
          && !occupiedTargets.has(this.scopedTargetKey(iterator.ref, step.ref, port.id)),
        );
        if (unboundRequiredPorts.length === 0) continue;

        const candidates = unboundRequiredPorts.filter(
          (port) => port.artifactKind === itemsPort.artifactKind,
        );
        const path = `nodes.${nodeIndex}.iteratorBody.steps.${stepIndex}.inputPorts`;
        if (candidates.length > 1) {
          this.recordWarning(
            diagnostics,
            'repair_iterator_current_item_target_ambiguous',
            path,
            step.ref,
            `Could not infer the current-item input for ${step.ref}: multiple compatible required ports are unbound.`,
            { iteratorRef: iterator.ref, candidatePortIds: candidates.map((port) => port.id) },
          );
          continue;
        }
        if (candidates.length === 0) {
          this.recordWarning(
            diagnostics,
            'repair_iterator_current_item_target_incompatible',
            path,
            step.ref,
            `Could not infer the current-item input for ${step.ref}: no unbound required port matches the iterator items artifact kind.`,
            {
              iteratorRef: iterator.ref,
              iteratorArtifactKind: itemsPort.artifactKind,
              candidatePortIds: unboundRequiredPorts.map((port) => port.id),
            },
          );
          continue;
        }

        const targetPort = candidates[0].id;
        blueprint.bindings = [
          ...(blueprint.bindings || []),
          {
            targetRef: step.ref,
            targetIteratorRef: iterator.ref,
            targetPort,
            sourceKind: 'state',
            statePath: 'inputs._item',
          },
        ];
        occupiedTargets.add(this.scopedTargetKey(iterator.ref, step.ref, targetPort));
        this.recordRepair(
          diagnostics,
          repairSummary,
          'repair_iterator_current_item_binding_added',
          `${path}.${targetPort}`,
          step.ref,
          `Bound iterator current item to ${step.ref}.${targetPort}.`,
        );
      }
    }
  }

  private scopedTargetKey(iteratorRef: string | null | undefined, targetRef: string, targetPort: string): string {
    return `${iteratorRef || ''}::${targetRef}::${targetPort}`;
  }

  private adoptRouterLabelsFromLinks(
    blueprint: PlaybookIntentBlueprint,
    templates: Map<string, BuilderNodeTemplate>,
    diagnostics: PlaybookIntentDiagnostic[],
    repairSummary: string[],
  ): void {
    const resolveOwner = (iteratorRef: string | null | undefined, ref: string): RepairableNode | null => (iteratorRef
      ? blueprint.nodes.find((node) => node.ref === iteratorRef)?.iteratorBody?.steps?.find((step) => step.ref === ref) || null
      : blueprint.nodes.find((node) => node.ref === ref) || null);

    for (const link of blueprint.links) {
      const owner = resolveOwner(link.sourceIteratorRef, link.sourceRef);
      if (!owner) continue;
      const routerConfig = this.ensureRouterConfig(owner, templates.get(owner.nodeTemplateKey), diagnostics, repairSummary);
      if (!routerConfig) continue;
      const itemId = `${link.sourceRef}->${link.targetRef}`;
      if (!link.routerLabel && link.kind !== 'sequential') {
        const inferred = this.inferRouterLabel(link.sourceOutputPortId, routerConfig);
        if (!inferred) continue;
        link.routerLabel = inferred;
        this.recordRepair(diagnostics, repairSummary, 'repair_router_link_label_inferred', `links.${itemId}.routerLabel`, itemId, `Inferred router label ${inferred} for link ${itemId}.`);
      }
      if (link.routerLabel) this.adoptRouterLabel(routerConfig, owner.ref, link.routerLabel, itemId, diagnostics, repairSummary);
    }
    for (const node of blueprint.nodes) {
      for (const edge of node.iteratorBody?.edges || []) {
        const owner = node.iteratorBody?.steps?.find((step) => step.ref === edge.sourceRef) || null;
        if (!owner) continue;
        const routerConfig = this.ensureRouterConfig(owner, templates.get(owner.nodeTemplateKey), diagnostics, repairSummary);
        if (!routerConfig) continue;
        const itemId = `${node.ref}.${edge.sourceRef}->${edge.targetRef}`;
        if (!edge.routerLabel && edge.kind !== 'sequential') {
          const inferred = this.inferRouterLabel(edge.sourceOutputPortId, routerConfig);
          if (!inferred) continue;
          edge.routerLabel = inferred;
          this.recordRepair(diagnostics, repairSummary, 'repair_router_link_label_inferred', `nodes.${node.ref}.iteratorBody.edges.${itemId}.routerLabel`, itemId, `Inferred router label ${inferred} for link ${itemId}.`);
        }
        if (edge.routerLabel) this.adoptRouterLabel(routerConfig, owner.ref, edge.routerLabel, itemId, diagnostics, repairSummary);
      }
    }
  }

  private ensureRouterConfig(
    owner: RepairableNode,
    template: BuilderNodeTemplate | undefined,
    diagnostics: PlaybookIntentDiagnostic[],
    repairSummary: string[],
  ): PlaybookIntentBlueprintRouterConfig | null {
    const existing = this.getRouterConfig(owner);
    if (existing) return existing;
    if (!template?.routerConfig?.outputLabels?.length) return null;
    // The LLM wired labeled branches on a router-template step without declaring its own
    // config; materialize one from the template so the labels can be adopted.
    const routerConfig: PlaybookIntentBlueprintRouterConfig = {
      outputLabels: [...template.routerConfig.outputLabels],
      ...(template.routerConfig.defaultLabel ? { defaultLabel: template.routerConfig.defaultLabel } : {}),
      ...(template.routerConfig.maxIterations != null ? { maxIterations: template.routerConfig.maxIterations } : {}),
    };
    if ('routerConfig' in owner) {
      owner.routerConfig = routerConfig;
      if (owner.primitive) owner.primitive.router = routerConfig;
    } else {
      owner.primitive = { ...(owner.primitive || { kind: 'router' }), router: routerConfig };
    }
    this.recordRepair(
      diagnostics,
      repairSummary,
      'repair_router_config_materialized',
      `${owner.ref}.routerConfig`,
      owner.ref,
      `Materialized router config for ${owner.ref} from template ${template.key}.`,
    );
    return routerConfig;
  }

  private inferRouterLabel(sourceOutputPortId: string | null | undefined, routerConfig: PlaybookIntentBlueprintRouterConfig): string | null {
    if (sourceOutputPortId && routerConfig.outputLabels.includes(sourceOutputPortId)) return sourceOutputPortId;
    if (routerConfig.outputLabels.length === 1) return routerConfig.outputLabels[0];
    return null;
  }

  private adoptRouterLabel(
    routerConfig: PlaybookIntentBlueprintRouterConfig,
    ownerRef: string,
    label: string,
    itemId: string,
    diagnostics: PlaybookIntentDiagnostic[],
    repairSummary: string[],
  ): void {
    if (!label.trim()) return;
    routerConfig.outputLabels = routerConfig.outputLabels || [];
    if (routerConfig.outputLabels.includes(label)) return;
    routerConfig.outputLabels.push(label);
    this.recordRepair(
      diagnostics,
      repairSummary,
      'repair_router_label_adopted',
      `routerConfig.outputLabels.${label}`,
      itemId,
      `Adopted router branch label ${label} used by link ${itemId}.`,
    );
  }

  private repairUnboundRequiredInputBindings(
    blueprint: PlaybookIntentBlueprint,
    diagnostics: PlaybookIntentDiagnostic[],
    repairSummary: string[],
  ): void {
    const occupiedTargets = new Set<string>();
    for (const binding of blueprint.bindings || []) {
      occupiedTargets.add(this.scopedTargetKey(binding.targetIteratorRef ?? null, binding.targetRef, binding.targetPort));
    }
    for (const link of blueprint.links) {
      if (!link.targetInputPortId) continue;
      occupiedTargets.add(this.scopedTargetKey(link.targetIteratorRef ?? null, link.targetRef, link.targetInputPortId));
    }

    const nodesByRef = new Map(blueprint.nodes.map((node) => [node.ref, node]));
    const outputKindByRef = (ref: string, portId: string | null | undefined): string | null => {
      if (!portId) return null;
      return nodesByRef.get(ref)?.outputPorts?.find((port) => port.id === portId)?.artifactKind ?? null;
    };

    for (const node of blueprint.nodes) {
      for (const port of node.inputPorts || []) {
        if (port.required !== true) continue;
        if (occupiedTargets.has(this.scopedTargetKey(null, node.ref, port.id))) continue;

        const sequentialSources = new Map<string, { ref: string; portId: string }>();
        for (const link of blueprint.links) {
          if (link.targetRef !== node.ref || link.targetIteratorRef || link.sourceIteratorRef || link.routerLabel) continue;
          if (outputKindByRef(link.sourceRef, link.sourceOutputPortId) !== port.artifactKind) continue;
          if (!link.sourceOutputPortId) continue;
          sequentialSources.set(`${link.sourceRef} ${link.sourceOutputPortId}`, { ref: link.sourceRef, portId: link.sourceOutputPortId });
        }

        let source: { ref: string; portId: string } | null = null;
        if (sequentialSources.size === 1) {
          source = [...sequentialSources.values()][0];
        } else if (sequentialSources.size === 0) {
          // Fall back to a unique same-named output port with the same artifact kind (common multi-fan-out pattern).
          const namedMatches = blueprint.nodes
            .filter((candidate) => candidate.ref !== node.ref)
            .filter((candidate) => candidate.outputPorts?.some((output) => output.id === port.id && output.artifactKind === port.artifactKind));
          if (namedMatches.length === 1 && namedMatches[0].outputPorts?.some((output) => output.id === port.id)) {
            source = { ref: namedMatches[0].ref, portId: port.id };
          }
        }

        if (!source) {
          this.recordWarning(
            diagnostics,
            'repair_required_port_binding_unresolved',
            `${node.ref}.${port.id}`,
            node.ref,
            `Could not infer a data binding for the required input ${node.ref}.${port.id}.`,
            { requiredArtifactKind: port.artifactKind },
          );
          continue;
        }

        blueprint.bindings = [
          ...(blueprint.bindings || []),
          { targetRef: node.ref, targetPort: port.id, sourceKind: 'node-output' as const, sourceRef: source.ref, sourcePort: source.portId },
        ];
        occupiedTargets.add(this.scopedTargetKey(null, node.ref, port.id));
        this.recordRepair(
          diagnostics,
          repairSummary,
          'repair_required_port_binding_added',
          `bindings.${node.ref}.${port.id}`,
          node.ref,
          `Bound required input ${node.ref}.${port.id} to ${source.ref}.${source.portId}.`,
        );
      }
    }
  }

  private repairNode(
    node: RepairableNode,
    template: BuilderNodeTemplate | undefined,
    path: string,
    diagnostics: PlaybookIntentDiagnostic[],
    repairSummary: string[],
  ): void {
    if (template) {
      this.addMissingRequiredPorts(node, 'inputPorts', template.inputPorts || [], path, diagnostics, repairSummary);
      this.addMissingRequiredPorts(node, 'outputPorts', template.outputPorts || [], path, diagnostics, repairSummary);
      this.applyTemplateDefaultLabel(node, template, path, diagnostics, repairSummary);
    }

    this.deduplicatePorts(node, 'inputPorts', path, diagnostics, repairSummary);
    this.repairRouterConfig(node, path, diagnostics, repairSummary);
    this.deduplicatePorts(node, 'outputPorts', path, diagnostics, repairSummary);
  }

  private addMissingRequiredPorts(
    node: RepairableNode,
    listName: PortListName,
    templatePorts: NonNullable<BuilderNodeTemplate['inputPorts']>,
    path: string,
    diagnostics: PlaybookIntentDiagnostic[],
    repairSummary: string[],
  ): void {
    const requiredTemplatePorts = templatePorts.filter((port) => port.required);
    if (requiredTemplatePorts.length === 0) return;

    const ports = node[listName] || [];
    const portIds = new Set(ports.map((port) => port.id));
    for (const templatePort of requiredTemplatePorts) {
      if (portIds.has(templatePort.id)) continue;
      ports.push({
        id: templatePort.id,
        name: templatePort.name,
        artifactKind: templatePort.artifactKind as PlaybookIntentBlueprintPort['artifactKind'],
        required: templatePort.required,
      });
      portIds.add(templatePort.id);
      this.recordRepair(diagnostics, repairSummary, 'repair_template_required_port_added', `${path}.${listName}.${templatePort.id}`, node.ref, `Added missing required template port ${templatePort.id}.`);
    }
    node[listName] = ports;
  }

  private repairRouterConfig(
    node: RepairableNode,
    path: string,
    diagnostics: PlaybookIntentDiagnostic[],
    repairSummary: string[],
  ): void {
    const routerConfig = this.getRouterConfig(node);
    if (!routerConfig) return;

    const originalLabels = routerConfig.outputLabels || [];
    const outputLabels = [...new Set(originalLabels.filter((label) => label.trim().length > 0))];
    if (outputLabels.length !== originalLabels.length) {
      routerConfig.outputLabels = outputLabels;
      this.recordRepair(diagnostics, repairSummary, 'repair_router_labels_deduplicated', `${path}.routerConfig.outputLabels`, node.ref, `Deduplicated router output labels for ${node.ref}.`);
    }

    if (!routerConfig.defaultLabel && (routerConfig.conditions || []).length > 0) {
      const conditionedLabels = new Set((routerConfig.conditions || []).map((condition) => condition.label));
      const unconditionedLabels = (routerConfig.outputLabels || []).filter((label) => !conditionedLabels.has(label));
      if (unconditionedLabels.length === 1) {
        routerConfig.defaultLabel = unconditionedLabels[0];
        this.recordRepair(
          diagnostics,
          repairSummary,
          'repair_router_default_label_inferred',
          `${path}.routerConfig.defaultLabel`,
          node.ref,
          `Inferred router default label ${unconditionedLabels[0]} as the only branch without a deterministic condition.`,
        );
      }
    }

    const outputPorts = node.outputPorts || [];
    const outputPortIds = new Set(outputPorts.map((port) => port.id));
    const fallbackArtifactKind = outputPorts[0]?.artifactKind || 'data';
    for (const label of routerConfig.outputLabels || []) {
      if (outputPortIds.has(label)) continue;
      outputPorts.push({ id: label, name: label, artifactKind: fallbackArtifactKind });
      outputPortIds.add(label);
      this.recordRepair(diagnostics, repairSummary, 'repair_router_output_port_added', `${path}.outputPorts.${label}`, node.ref, `Added router output port ${label}.`);
    }
    node.outputPorts = outputPorts;
  }

  private repairLink(
    link: PlaybookIntentBlueprintLink | NonNullable<PlaybookIntentBlueprintNode['iteratorBody']>['edges'][number],
    path: string,
    diagnostics: PlaybookIntentDiagnostic[],
    repairSummary: string[],
  ): void {
    if (!link.routerLabel) return;
    if (!link.kind) {
      link.kind = 'conditional';
      this.recordRepair(diagnostics, repairSummary, 'repair_router_link_kind_set', `${path}.kind`, `${link.sourceRef}->${link.targetRef}`, `Marked router link ${link.sourceRef}->${link.targetRef} as conditional.`);
    }
    if (!link.sourceOutputPortId) {
      link.sourceOutputPortId = link.routerLabel;
      this.recordRepair(diagnostics, repairSummary, 'repair_router_link_source_port_set', `${path}.sourceOutputPortId`, `${link.sourceRef}->${link.targetRef}`, `Set router link source port to ${link.routerLabel}.`);
    }
  }

  private deduplicatePorts(
    node: RepairableNode,
    listName: PortListName,
    path: string,
    diagnostics: PlaybookIntentDiagnostic[],
    repairSummary: string[],
  ): void {
    const ports = node[listName] || [];
    if (ports.length < 2) return;

    const deduped = new Map<string, PlaybookIntentBlueprintPort>();
    for (const port of ports) {
      const existing = deduped.get(port.id);
      if (!existing) {
        deduped.set(port.id, { ...port });
      } else {
        deduped.set(port.id, { ...existing, required: Boolean(existing.required || port.required) });
      }
    }
    if (deduped.size === ports.length) return;

    node[listName] = [...deduped.values()];
    this.recordRepair(diagnostics, repairSummary, 'repair_ports_deduplicated', `${path}.${listName}`, node.ref, `Deduplicated ${listName} for ${node.ref}.`);
  }

  private applyTemplateDefaultLabel(
    node: RepairableNode,
    template: BuilderNodeTemplate,
    path: string,
    diagnostics: PlaybookIntentDiagnostic[],
    repairSummary: string[],
  ): void {
    const routerConfig = this.getRouterConfig(node);
    const defaultLabel = template.routerConfig?.defaultLabel;
    if (!routerConfig || routerConfig.defaultLabel || !defaultLabel) return;
    if (!(routerConfig.outputLabels || []).includes(defaultLabel)) return;

    routerConfig.defaultLabel = defaultLabel;
    this.recordRepair(diagnostics, repairSummary, 'repair_router_default_label_applied', `${path}.routerConfig.defaultLabel`, node.ref, `Applied router default label ${defaultLabel}.`);
  }

  private getRouterConfig(node: RepairableNode): PlaybookIntentBlueprintRouterConfig | null {
    if ('routerConfig' in node && node.routerConfig) return node.routerConfig;
    return node.primitive?.router || null;
  }

  private recordRepair(
    diagnostics: PlaybookIntentDiagnostic[],
    repairSummary: string[],
    code: string,
    path: string,
    itemId: string,
    message: string,
  ): void {
    repairSummary.push(message);
    diagnostics.push({ severity: 'info', stage: 'repair', code, path, itemId, message, repairable: false });
  }

  private recordWarning(
    diagnostics: PlaybookIntentDiagnostic[],
    code: string,
    path: string,
    itemId: string,
    message: string,
    metadata: Record<string, unknown>,
  ): void {
    diagnostics.push({ severity: 'warning', stage: 'repair', code, path, itemId, message, repairable: true, metadata });
  }
}
