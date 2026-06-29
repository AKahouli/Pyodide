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
    const templates = new Map(args.templates.filter((template) => template.enabled).map((template) => [template.key, template]));
    const diagnostics: PlaybookIntentDiagnostic[] = [];
    const repairSummary: string[] = [];

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

    return { blueprint, diagnostics, repairSummary };
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
}
