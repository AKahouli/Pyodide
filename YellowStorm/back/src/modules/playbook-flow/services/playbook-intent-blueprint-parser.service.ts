import { Injectable, Logger } from '@nestjs/common';
import {
  PlaybookIntentBlueprint,
  PlaybookIntentBlueprintBinding,
  PlaybookIntentBlueprintConnectorRef,
  PlaybookIntentBlueprintIteratorBody,
  PlaybookIntentBlueprintIteratorStep,
  PlaybookIntentBlueprintLink,
  PlaybookIntentBlueprintNode,
  PlaybookIntentBlueprintParseResult,
  PlaybookIntentBlueprintPort,
  PlaybookIntentBlueprintPrimitiveConfig,
  PlaybookIntentBlueprintRouterCondition,
  PlaybookIntentBlueprintRouterConfig,
  PlaybookIntentBlueprintSkillRef,
} from '../interfaces/playbook-flow-intent-blueprint.interface';
import type { PlaybookIntentDiagnostic } from '../interfaces/playbook-flow-intent-diagnostic.interface';

const SUPPORTED_ARTIFACT_KINDS: PlaybookIntentBlueprintPort['artifactKind'][] = [
  'text', 'document', 'code', 'image', 'data', 'dashboard',
];

const ANCHOR_MODES = ['append', 'before', 'after', 'as_input'] as const;
type AnchorMode = typeof ANCHOR_MODES[number];
const EDGE_KINDS = ['sequential', 'conditional'] as const;
const ROUTER_OPERATORS = ['equals', 'not_equals', 'contains', 'exists', 'gt', 'gte', 'lt', 'lte'] as const;

@Injectable()
export class PlaybookIntentBlueprintParserService {
  private readonly logger = new Logger(PlaybookIntentBlueprintParserService.name);

  parse(raw: string | null | undefined): PlaybookIntentBlueprintParseResult | null {
    const parsed = this.parseJsonObject(raw);
    if (!parsed || typeof parsed !== 'object') return null;

    const root = parsed as Record<string, unknown>;
    const blueprintNode = root.blueprint && typeof root.blueprint === 'object'
      ? root.blueprint as Record<string, unknown>
      : null;
    if (!blueprintNode) return null;

    const diagnostics: PlaybookIntentDiagnostic[] = [];
    const nodes = this.parseNodes(blueprintNode.nodes, diagnostics);
    const links = this.parseLinks(blueprintNode.links, nodes, diagnostics);
    const bindings = this.parseBindings(blueprintNode.bindings, nodes, diagnostics);
    const summary = this.asString(blueprintNode.summary) || this.asString(root.summary);
    const title = this.asString(blueprintNode.title) || this.asString(root.title) || summary || nodes[0]?.label;
    if (!title) {
      this.warnDiagnostic({ severity: 'warning', stage: 'parser', code: 'blueprint_missing_title', itemId: 'blueprint.title', message: 'blueprint_missing_title' });
      return null;
    }

    return {
      blueprint: {
        version: blueprintNode.version === 2 ? 2 : 1,
        title,
        summary,
        nodes,
        links,
        bindings,
        assumptions: [
          ...this.asStringArray(root.assumptions),
          ...this.asStringArray(blueprintNode.assumptions),
        ],
        riskFlags: [
          ...this.asStringArray(root.riskFlags),
          ...this.asStringArray(blueprintNode.riskFlags),
        ],
      },
      diagnostics,
    };
  }

  hasBlueprintShape(raw: string | null | undefined): boolean {
    const parsed = this.parseJsonObject(raw);
    return !!parsed && typeof parsed === 'object' && !!parsed.blueprint;
  }

  private parseJsonObject(raw: string | null | undefined): Record<string, unknown> | null {
    const trimmed = typeof raw === 'string' ? raw.trim() : '';
    if (!trimmed) return null;

    for (const candidate of this.jsonCandidates(trimmed)) {
      try {
        const parsed = JSON.parse(candidate) as unknown;
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? parsed as Record<string, unknown>
          : null;
      } catch {
        continue;
      }
    }
    return null;
  }

  private jsonCandidates(raw: string): string[] {
    const candidates = [raw];
    const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch?.[1]) candidates.push(fenceMatch[1].trim());

    const firstBrace = raw.indexOf('{');
    const lastBrace = raw.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      candidates.push(raw.slice(firstBrace, lastBrace + 1));
    }
    return [...new Set(candidates.filter(Boolean))];
  }

  private parseNodes(
    value: unknown,
    diagnostics: PlaybookIntentDiagnostic[],
  ): PlaybookIntentBlueprintNode[] {
    if (!Array.isArray(value)) return [];

    const seenRefs = new Set<string>();
    const accepted: PlaybookIntentBlueprintNode[] = [];

    for (const item of value) {
      if (!item || typeof item !== 'object') {
        this.recordDiagnostic(diagnostics, 'blueprint_node_invalid', 'unknown');
        continue;
      }
      const raw = item as Record<string, unknown>;
      const ref = this.asString(raw.ref);
      const label = this.asString(raw.label) || this.asString(raw.title);
      const purpose = this.asString(raw.purpose) || this.asString(raw.description);
      const nodeTemplateKey = this.parseNodeTemplateKey(raw, ref || label || 'unknown');

      if (!ref || !label || !nodeTemplateKey) {
        this.recordDiagnostic(diagnostics, 'blueprint_node_missing_fields', ref || label || 'unknown');
        continue;
      }
      if (seenRefs.has(ref)) {
        this.recordDiagnostic(diagnostics, 'blueprint_node_duplicate_ref', ref);
        continue;
      }
      const inputPorts = this.parsePorts(raw.inputPorts, diagnostics, `${ref}.inputs`);
      const outputPorts = this.parsePorts(raw.outputPorts, diagnostics, `${ref}.outputs`);
      const anchor = this.parseAnchor(raw.anchor);
      const primitive = this.parsePrimitive(raw.primitive, diagnostics, ref);
      const routerConfig = primitive?.router || this.parseRouterConfig(raw.routerConfig ?? raw.router_config, diagnostics, ref);

      accepted.push({
        ref,
        label,
        purpose,
        nodeTemplateKey,
        agentHint: this.asString(raw.agentHint) || null,
        ...(primitive ? { primitive: routerConfig ? { ...primitive, router: routerConfig } : primitive } : routerConfig ? { primitive: { kind: 'router', router: routerConfig } } : {}),
        ...(routerConfig ? { routerConfig } : {}),
        ...(this.asRecord(raw.humanApprovalConfig ?? raw.human_approval_config) ? { humanApprovalConfig: this.asRecord(raw.humanApprovalConfig ?? raw.human_approval_config) as Record<string, unknown> } : {}),
        inputPorts,
        outputPorts,
        connectorRefs: this.parseConnectorRefs(raw.connector_refs ?? raw.connectorRefs, diagnostics, ref),
        skillRefs: this.parseSkillRefs(raw.skill_refs ?? raw.skillRefs, diagnostics, ref),
        anchor,
        ...(raw.iteratorBody ? { iteratorBody: this.parseIteratorBody(raw.iteratorBody, diagnostics, ref) } : {}),
      });
      seenRefs.add(ref);
    }

    return accepted;
  }

  private parseConnectorRefs(
    value: unknown,
    diagnostics: PlaybookIntentDiagnostic[],
    ownerRef: string,
  ): PlaybookIntentBlueprintConnectorRef[] {
    if (!Array.isArray(value)) return [];
    const accepted: PlaybookIntentBlueprintConnectorRef[] = [];
    const seen = new Set<string>();
    for (const item of value) {
      if (!item || typeof item !== 'object') {
        this.recordDiagnostic(diagnostics, 'blueprint_connector_ref_invalid', ownerRef);
        continue;
      }
      const raw = item as Record<string, unknown>;
      const connectorSlug = this.asString(raw.connector_slug ?? raw.connectorSlug);
      const actionKey = this.asString(raw.action_key ?? raw.actionKey);
      if (!connectorSlug || !actionKey) {
        this.recordDiagnostic(diagnostics, 'blueprint_connector_ref_missing_fields', `${ownerRef}:${connectorSlug || '?'}.${actionKey || '?'}`);
        continue;
      }
      const key = `${connectorSlug}:${actionKey}`;
      if (seen.has(key)) {
        this.recordDiagnostic(diagnostics, 'blueprint_connector_ref_duplicate', `${ownerRef}:${key}`);
        continue;
      }
      seen.add(key);
      accepted.push({ connectorSlug, actionKey, reason: this.asString(raw.reason) || null });
    }
    return accepted;
  }

  private parseSkillRefs(
    value: unknown,
    diagnostics: PlaybookIntentDiagnostic[],
    ownerRef: string,
  ): PlaybookIntentBlueprintSkillRef[] {
    if (!Array.isArray(value)) return [];
    const accepted: PlaybookIntentBlueprintSkillRef[] = [];
    const seen = new Set<string>();
    for (const item of value) {
      if (!item || typeof item !== 'object') {
        this.recordDiagnostic(diagnostics, 'blueprint_skill_ref_invalid', ownerRef);
        continue;
      }
      const raw = item as Record<string, unknown>;
      const skillSlug = this.asString(raw.skill_slug ?? raw.skillSlug);
      if (!skillSlug) {
        this.recordDiagnostic(diagnostics, 'blueprint_skill_ref_missing_fields', `${ownerRef}:?`);
        continue;
      }
      if (seen.has(skillSlug)) {
        this.recordDiagnostic(diagnostics, 'blueprint_skill_ref_duplicate', `${ownerRef}:${skillSlug}`);
        continue;
      }
      seen.add(skillSlug);
      accepted.push({ skillSlug, reason: this.asString(raw.reason) || null });
    }
    return accepted;
  }

  private parseNodeTemplateKey(raw: Record<string, unknown>, _ownerRef: string): string {
    return this.asString(raw.nodeTemplateKey ?? raw.node_template_key);
  }

  private parsePorts(
    value: unknown,
    diagnostics: PlaybookIntentDiagnostic[],
    ownerRef: string,
  ): PlaybookIntentBlueprintPort[] {
    if (!Array.isArray(value)) return [];
    const accepted: PlaybookIntentBlueprintPort[] = [];
    const seenIds = new Set<string>();
    for (const item of value) {
      if (!item || typeof item !== 'object') {
        this.recordDiagnostic(diagnostics, 'blueprint_port_invalid', ownerRef);
        continue;
      }
      const raw = item as Record<string, unknown>;
      const id = this.asString(raw.id);
      const artifactKind = this.asString(raw.artifactKind) as PlaybookIntentBlueprintPort['artifactKind'] | '';
      if (!id || !artifactKind || seenIds.has(id)) {
        this.recordDiagnostic(diagnostics, 'blueprint_port_missing_or_duplicate', `${ownerRef}.${id || '?'}`);
        continue;
      }
      if (!SUPPORTED_ARTIFACT_KINDS.includes(artifactKind)) {
        this.recordDiagnostic(diagnostics, 'blueprint_port_unsupported_kind', `${ownerRef}.${id}:${artifactKind}`);
        continue;
      }
      seenIds.add(id);
      accepted.push({
        id,
        artifactKind,
        required: raw.required === true,
        ...(this.asString(raw.name) ? { name: this.asString(raw.name) } : {}),
      });
    }
    return accepted;
  }

  private parseAnchor(value: unknown): PlaybookIntentBlueprintNode['anchor'] {
    if (!value || typeof value !== 'object') return undefined;
    const raw = value as Record<string, unknown>;
    const mode = this.asString(raw.mode);
    const safeMode: AnchorMode = (ANCHOR_MODES as readonly string[]).includes(mode) ? mode as AnchorMode : 'append';
    return {
      mode: safeMode,
      targetTaskId: this.asString(raw.targetTaskId) || null,
      targetRef: this.asString(raw.targetRef) || null,
    };
  }

  private parseIteratorBody(
    value: unknown,
    diagnostics: PlaybookIntentDiagnostic[],
    ownerRef: string,
  ): PlaybookIntentBlueprintIteratorBody {
    if (!value || typeof value !== 'object') return { steps: [], edges: [] };
    const raw = value as Record<string, unknown>;
    const steps = Array.isArray(raw.steps)
      ? raw.steps
        .map((step) => this.parseIteratorStep(step, diagnostics, ownerRef))
        .filter((step): step is PlaybookIntentBlueprintIteratorStep => step !== null)
      : [];
    const validStepRefs = new Set(steps.map((s) => s.ref));
    const edges = Array.isArray(raw.edges)
      ? raw.edges
        .map((edge) => this.parseIteratorEdge(edge, validStepRefs, diagnostics, ownerRef))
        .filter((edge): edge is NonNullable<typeof edge> => edge !== null)
      : [];

    return { steps, edges };
  }

  private parseIteratorStep(
    value: unknown,
    diagnostics: PlaybookIntentDiagnostic[],
    ownerRef: string,
  ): PlaybookIntentBlueprintIteratorStep | null {
    if (!value || typeof value !== 'object') return null;
    const raw = value as Record<string, unknown>;
    const ref = this.asString(raw.ref);
    const title = this.asString(raw.title) || this.asString(raw.label);
    const nodeTemplateKey = this.parseNodeTemplateKey(raw, `${ownerRef}.step.${ref || '?'}`);
    if (!ref || !title || !nodeTemplateKey) {
      this.recordDiagnostic(diagnostics, 'blueprint_iterator_step_missing_fields', `${ownerRef}.step.${ref || '?'}`);
      return null;
    }
    const primitive = this.parsePrimitive(raw.primitive, diagnostics, `${ownerRef}.${ref}`);
    return {
      ref,
      title,
      description: this.asString(raw.description),
      nodeTemplateKey,
      agentHint: this.asString(raw.agentHint) || null,
      connectorRefs: this.parseConnectorRefs(raw.connector_refs ?? raw.connectorRefs, diagnostics, `${ownerRef}.${ref}`),
      skillRefs: this.parseSkillRefs(raw.skill_refs ?? raw.skillRefs, diagnostics, `${ownerRef}.${ref}`),
      ...(primitive ? { primitive } : {}),
      inputPorts: this.parsePorts(raw.inputPorts, diagnostics, `${ownerRef}.${ref}.inputs`),
      outputPorts: this.parsePorts(raw.outputPorts, diagnostics, `${ownerRef}.${ref}.outputs`),
    };
  }

  private parseIteratorEdge(
    value: unknown,
    validRefs: Set<string>,
    diagnostics: PlaybookIntentDiagnostic[],
    ownerRef: string,
  ): PlaybookIntentBlueprintIteratorBody['edges'][number] | null {
    if (!value || typeof value !== 'object') return null;
    const raw = value as Record<string, unknown>;
    const sourceRef = this.asString(raw.sourceRef);
    const targetRef = this.asString(raw.targetRef);
    if (!sourceRef || !targetRef) {
      this.recordDiagnostic(diagnostics, 'blueprint_iterator_edge_missing_refs', ownerRef);
      return null;
    }
    if (!validRefs.has(sourceRef) || !validRefs.has(targetRef)) {
      this.recordDiagnostic(diagnostics, 'blueprint_iterator_edge_unknown_ref', `${sourceRef}->${targetRef}`);
      return null;
    }
    return {
      sourceRef,
      targetRef,
      ...this.parseEdgeMetadata(raw, diagnostics, `${ownerRef}.${sourceRef}->${targetRef}`),
      ...(this.asString(raw.sourceOutputPortId ?? raw.source_output_port_id) ? { sourceOutputPortId: this.asString(raw.sourceOutputPortId ?? raw.source_output_port_id) } : {}),
      ...(this.asString(raw.targetInputPortId ?? raw.target_input_port_id) ? { targetInputPortId: this.asString(raw.targetInputPortId ?? raw.target_input_port_id) } : {}),
    };
  }

  private parseLinks(
    value: unknown,
    nodes: PlaybookIntentBlueprintNode[],
    diagnostics: PlaybookIntentDiagnostic[],
  ): PlaybookIntentBlueprintLink[] {
    if (!Array.isArray(value)) return [];
    const refSet = new Set(nodes.map((n) => n.ref));
    const iteratorStepsByRef = this.buildIteratorStepRefSet(nodes);
    const accepted: PlaybookIntentBlueprintLink[] = [];
    const seenKeys = new Set<string>();
    for (const item of value) {
      if (!item || typeof item !== 'object') {
        this.recordDiagnostic(diagnostics, 'blueprint_link_invalid', 'unknown');
        continue;
      }
      const raw = item as Record<string, unknown>;
      const sourceRef = this.asString(raw.sourceRef ?? raw.source_ref);
      const targetRef = this.asString(raw.targetRef ?? raw.target_ref);
      const sourceIteratorRef = this.asString(raw.sourceIteratorRef ?? raw.source_iterator_ref);
      const targetIteratorRef = this.asString(raw.targetIteratorRef ?? raw.target_iterator_ref);
      const edgeMetadata = this.parseEdgeMetadata(raw, diagnostics, `${sourceRef || '?'}->${targetRef || '?'}`);
      if (edgeMetadata.kind === 'conditional' && !edgeMetadata.routerLabel) {
        this.recordDiagnostic(diagnostics, 'blueprint_link_conditional_missing_label', `${sourceRef || '?'}->${targetRef || '?'}`);
        continue;
      }
      if (!sourceRef || !targetRef) {
        this.recordDiagnostic(diagnostics, 'blueprint_link_missing_refs', `${sourceRef || '?'}->${targetRef || '?'}`);
        continue;
      }
      if (!this.hasEndpointRef(refSet, iteratorStepsByRef, sourceRef, sourceIteratorRef)) {
        this.recordDiagnostic(diagnostics, 'blueprint_link_unknown_ref', `${sourceRef}->${targetRef}`);
        continue;
      }
      if (!this.hasEndpointRef(refSet, iteratorStepsByRef, targetRef, targetIteratorRef)) {
        this.recordDiagnostic(diagnostics, 'blueprint_link_unknown_ref', `${sourceRef}->${targetRef}`);
        continue;
      }
      const sourceOutputPortId = this.asString(raw.sourceOutputPortId ?? raw.source_output_port_id);
      const targetInputPortId = this.asString(raw.targetInputPortId ?? raw.target_input_port_id);
      const key = `${sourceIteratorRef}.${sourceRef}::${targetIteratorRef}.${targetRef}::${sourceOutputPortId}::${targetInputPortId}::${edgeMetadata.routerLabel || ''}`;
      if (seenKeys.has(key)) {
        this.recordDiagnostic(diagnostics, 'blueprint_link_duplicate', key);
        continue;
      }
      seenKeys.add(key);
      accepted.push({
        sourceRef,
        targetRef,
        ...(sourceIteratorRef ? { sourceIteratorRef } : {}),
        ...(targetIteratorRef ? { targetIteratorRef } : {}),
        ...edgeMetadata,
        ...(sourceOutputPortId ? { sourceOutputPortId } : {}),
        ...(targetInputPortId ? { targetInputPortId } : {}),
        ...(typeof raw.priority === 'number' ? { priority: raw.priority } : {}),
      });
    }
    return accepted;
  }

  private parseBindings(
    value: unknown,
    nodes: PlaybookIntentBlueprintNode[],
    diagnostics: PlaybookIntentDiagnostic[],
  ): PlaybookIntentBlueprintBinding[] {
    if (!Array.isArray(value)) return [];
    const refSet = new Set(nodes.map((n) => n.ref));
    const inputsByRef = new Map<string, Map<string, PlaybookIntentBlueprintPort>>();
    const outputsByRef = new Map<string, Map<string, PlaybookIntentBlueprintPort>>();
    const iteratorStepsByRef = this.buildIteratorStepRefSet(nodes);
    for (const node of nodes) {
      inputsByRef.set(node.ref, new Map((node.inputPorts || []).map((p) => [p.id, p])));
      outputsByRef.set(node.ref, new Map((node.outputPorts || []).map((p) => [p.id, p])));
      for (const step of node.iteratorBody?.steps || []) {
        const scopedRef = this.scopedRef(node.ref, step.ref);
        inputsByRef.set(scopedRef, new Map((step.inputPorts || []).map((p) => [p.id, p])));
        outputsByRef.set(scopedRef, new Map((step.outputPorts || []).map((p) => [p.id, p])));
      }
    }

    const accepted: PlaybookIntentBlueprintBinding[] = [];
    const seenKeys = new Set<string>();
    for (const item of value) {
      if (!item || typeof item !== 'object') {
        this.recordDiagnostic(diagnostics, 'blueprint_binding_invalid', 'unknown');
        continue;
      }
      const raw = item as Record<string, unknown>;
      const targetRef = this.asString(raw.targetRef ?? raw.target_ref);
      const targetIteratorRef = this.asString(raw.targetIteratorRef ?? raw.target_iterator_ref);
      const targetPort = this.asString(raw.targetPort ?? raw.target_port);
      if (!targetRef || !targetPort) {
        this.recordDiagnostic(diagnostics, 'blueprint_binding_missing_target', `${targetRef || '?'}.${targetPort || '?'}`);
        continue;
      }
      if (!this.hasEndpointRef(refSet, iteratorStepsByRef, targetRef, targetIteratorRef)) {
        this.recordDiagnostic(diagnostics, 'blueprint_binding_unknown_target_ref', targetRef);
        continue;
      }
      const sourceKind = this.asString(raw.sourceKind) as 'node-output' | 'constant' | '';
      if (sourceKind !== 'node-output' && sourceKind !== 'constant') {
        this.recordDiagnostic(diagnostics, 'blueprint_binding_invalid_source_kind', `${targetRef}.${targetPort}`);
        continue;
      }

      const targetCatalogRef = targetIteratorRef ? this.scopedRef(targetIteratorRef, targetRef) : targetRef;
      const key = `${targetCatalogRef}.${targetPort}`;
      if (seenKeys.has(key)) {
        this.recordDiagnostic(diagnostics, 'blueprint_binding_duplicate_target', key);
        continue;
      }

      const targetPorts = inputsByRef.get(targetCatalogRef);
      if (!targetPorts?.has(targetPort)) {
        this.recordDiagnostic(diagnostics, 'blueprint_binding_unknown_target_port', key);
        continue;
      }
      seenKeys.add(key);

      if (sourceKind === 'constant') {
        const constantValue = this.parseConstantValue(raw.constantValue, diagnostics, key);
        if (!constantValue) continue;
        accepted.push({
          targetRef,
          ...(targetIteratorRef ? { targetIteratorRef } : {}),
          targetPort,
          sourceKind: 'constant',
          constantValue,
        });
        continue;
      }

      const sourceRef = this.asString(raw.sourceRef ?? raw.source_ref);
      const sourceIteratorRef = this.asString(raw.sourceIteratorRef ?? raw.source_iterator_ref);
      const sourcePort = this.asString(raw.sourcePort ?? raw.source_port);
      if (!sourceRef || !sourcePort) {
        this.recordDiagnostic(diagnostics, 'blueprint_binding_missing_source', key);
        continue;
      }
      if (!this.hasEndpointRef(refSet, iteratorStepsByRef, sourceRef, sourceIteratorRef)) {
        this.recordDiagnostic(diagnostics, 'blueprint_binding_unknown_source_ref', `${sourceRef}->${key}`);
        continue;
      }
      const sourceCatalogRef = sourceIteratorRef ? this.scopedRef(sourceIteratorRef, sourceRef) : sourceRef;
      const sourcePorts = outputsByRef.get(sourceCatalogRef);
      if (!sourcePorts?.has(sourcePort)) {
        this.recordDiagnostic(diagnostics, 'blueprint_binding_unknown_source_port', `${sourceRef}.${sourcePort}->${key}`);
        continue;
      }
      const targetKind = targetPorts.get(targetPort)?.artifactKind;
      const sourceKindPort = sourcePorts.get(sourcePort)?.artifactKind;
      if (targetKind && sourceKindPort && targetKind !== sourceKindPort) {
        this.recordDiagnostic(diagnostics, 'blueprint_binding_artifact_mismatch', `${sourceRef}.${sourcePort}->${key}`);
        continue;
      }
      accepted.push({
        targetRef,
        ...(targetIteratorRef ? { targetIteratorRef } : {}),
        targetPort,
        sourceKind: 'node-output',
        sourceRef,
        ...(sourceIteratorRef ? { sourceIteratorRef } : {}),
        sourcePort,
        ...(raw.iteration === 'previous' ? { iteration: 'previous' as const } : {}),
      });
    }
    return accepted;
  }

  private buildIteratorStepRefSet(nodes: PlaybookIntentBlueprintNode[]): Map<string, Set<string>> {
    return new Map(nodes.map((node) => [
      node.ref,
      new Set((node.iteratorBody?.steps || []).map((step) => step.ref)),
    ]));
  }

  private hasEndpointRef(
    topLevelRefs: Set<string>,
    iteratorStepsByRef: Map<string, Set<string>>,
    ref: string,
    iteratorRef: string,
  ): boolean {
    if (!iteratorRef || ref === iteratorRef) return topLevelRefs.has(ref);
    return iteratorStepsByRef.get(iteratorRef)?.has(ref) === true;
  }

  private scopedRef(iteratorRef: string, stepRef: string): string {
    return `${iteratorRef}.${stepRef}`;
  }

  private parseConstantValue(
    value: unknown,
    diagnostics: PlaybookIntentDiagnostic[],
    key: string,
  ): PlaybookIntentBlueprintBinding['constantValue'] | null {
    if (!value || typeof value !== 'object') {
      this.recordDiagnostic(diagnostics, 'blueprint_binding_invalid_constant', key);
      return null;
    }
    const raw = value as Record<string, unknown>;
    const kind = this.asString(raw.kind);
    const id = this.asString(raw.id);
    const workspaceId = this.asString(raw.workspaceId) || (kind === 'workspace' ? id : '');
    if ((kind !== 'workspace' && kind !== 'document') || !id || !workspaceId) {
      this.recordDiagnostic(diagnostics, 'blueprint_binding_invalid_constant', key);
      return null;
    }
    return {
      kind,
      id,
      workspaceId,
      ...(kind === 'document' ? { documentId: this.asString(raw.documentId) || id } : {}),
      ...(this.asString(raw.workspaceName) ? { workspaceName: this.asString(raw.workspaceName) } : {}),
      ...(this.asString(raw.path) ? { path: this.asString(raw.path) } : {}),
      ...(this.asString(raw.mimeType) ? { mimeType: this.asString(raw.mimeType) } : {}),
      ...(this.asString(raw.label) ? { label: this.asString(raw.label) } : {}),
    };
  }

  private parsePrimitive(
    value: unknown,
    diagnostics: PlaybookIntentDiagnostic[],
    ownerRef: string,
  ): PlaybookIntentBlueprintPrimitiveConfig | null {
    const raw = this.asRecord(value);
    if (!raw) return null;
    const kind = this.asString(raw.kind);
    if (!kind) {
      this.recordDiagnostic(diagnostics, 'blueprint_primitive_invalid', ownerRef);
      return null;
    }
    const router = this.parseRouterConfig(raw.router ?? raw.routerConfig ?? raw.router_config, diagnostics, ownerRef);
    return {
      kind,
      ...(router ? { router } : {}),
      ...(this.asRecord(raw.iterator) ? { iterator: this.asRecord(raw.iterator) as Record<string, unknown> } : {}),
      ...(this.asRecord(raw.humanApproval ?? raw.human_approval) ? { humanApproval: this.asRecord(raw.humanApproval ?? raw.human_approval) as Record<string, unknown> } : {}),
      ...(this.asRecord(raw.evaluation) ? { evaluation: this.asRecord(raw.evaluation) as Record<string, unknown> } : {}),
      ...(this.asRecord(raw.action) ? { action: this.asRecord(raw.action) as Record<string, unknown> } : {}),
      ...(this.asRecord(raw.metadata) ? { metadata: this.asRecord(raw.metadata) as Record<string, unknown> } : {}),
    };
  }

  private parseRouterConfig(
    value: unknown,
    diagnostics: PlaybookIntentDiagnostic[],
    ownerRef: string,
  ): PlaybookIntentBlueprintRouterConfig | null {
    const raw = this.asRecord(value);
    if (!raw) return null;
    const outputLabels = this.asStringArray(raw.outputLabels ?? raw.output_labels);
    if (outputLabels.length === 0) {
      this.recordDiagnostic(diagnostics, 'blueprint_router_config_invalid', ownerRef);
      return null;
    }
    const uniqueLabels = [...new Set(outputLabels)];
    const conditions = Array.isArray(raw.conditions)
      ? raw.conditions
        .map((condition) => this.parseRouterCondition(condition, diagnostics, ownerRef, uniqueLabels))
        .filter((condition): condition is NonNullable<typeof condition> => condition !== null)
      : [];
    const defaultLabel = this.asString(raw.defaultLabel ?? raw.default_label) || null;
    if (defaultLabel && !uniqueLabels.includes(defaultLabel)) {
      this.recordDiagnostic(diagnostics, 'blueprint_router_config_invalid', `${ownerRef}.defaultLabel`);
    }
    return {
      outputLabels: uniqueLabels,
      ...(typeof raw.maxIterations === 'number' ? { maxIterations: raw.maxIterations } : typeof raw.max_iterations === 'number' ? { maxIterations: raw.max_iterations } : {}),
      ...(conditions.length ? { conditions } : {}),
      ...(defaultLabel ? { defaultLabel } : {}),
    };
  }

  private parseRouterCondition(
    value: unknown,
    diagnostics: PlaybookIntentDiagnostic[],
    ownerRef: string,
    outputLabels: string[],
  ): PlaybookIntentBlueprintRouterCondition | null {
    const raw = this.asRecord(value);
    if (!raw) return null;
    const label = this.asString(raw.label);
    const sourceRef = this.asString(raw.sourceRef ?? raw.source_ref ?? raw.sourceNode ?? raw.source_node);
    const sourcePort = this.asString(raw.sourcePort ?? raw.source_port);
    const operator = this.asString(raw.operator) as PlaybookIntentBlueprintRouterCondition['operator'];
    if (!label || !sourceRef || !sourcePort || !(ROUTER_OPERATORS as readonly string[]).includes(operator) || !outputLabels.includes(label)) {
      this.recordDiagnostic(diagnostics, 'blueprint_router_condition_invalid', ownerRef);
      return null;
    }
    return {
      label,
      sourceRef,
      sourcePort,
      ...(this.asString(raw.sourceIteratorRef ?? raw.source_iterator_ref) ? { sourceIteratorRef: this.asString(raw.sourceIteratorRef ?? raw.source_iterator_ref) } : {}),
      ...(this.asString(raw.path) ? { path: this.asString(raw.path) } : {}),
      operator,
      ...(Object.prototype.hasOwnProperty.call(raw, 'value') ? { value: raw.value } : {}),
    };
  }

  private parseEdgeMetadata(
    raw: Record<string, unknown>,
    diagnostics: PlaybookIntentDiagnostic[],
    ownerRef: string,
  ): Pick<PlaybookIntentBlueprintLink, 'kind' | 'routerLabel'> {
    const kind = this.asString(raw.kind) || this.asString(raw.edgeKind ?? raw.edge_kind);
    const routerLabel = this.asString(raw.routerLabel ?? raw.router_label) || null;
    if (kind && !(EDGE_KINDS as readonly string[]).includes(kind)) {
      this.recordDiagnostic(diagnostics, 'blueprint_link_invalid_kind', ownerRef);
      return routerLabel ? { routerLabel } : {};
    }
    return {
      ...(kind ? { kind: kind as PlaybookIntentBlueprintLink['kind'] } : {}),
      ...(routerLabel ? { routerLabel } : {}),
    };
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  }

  private asString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private asStringArray(value: unknown): string[] {
    return Array.isArray(value)
      ? value.map((item) => this.asString(item)).filter((entry) => entry.length > 0).slice(0, 8)
      : [];
  }

  private recordDiagnostic(diagnostics: PlaybookIntentDiagnostic[], code: string, itemId: string): void {
    const diagnostic: PlaybookIntentDiagnostic = {
      severity: 'warning',
      stage: 'parser',
      code,
      itemId,
      message: code,
    };
    diagnostics.push(diagnostic);
    this.warnDiagnostic(diagnostic);
  }

  private warnDiagnostic(diagnostic: PlaybookIntentDiagnostic): void {
    this.logger.warn(`playbook_intent_blueprint_drop rule=${diagnostic.code} item=${diagnostic.itemId || ''}`);
  }
}
