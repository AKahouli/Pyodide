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
  PlaybookIntentBlueprintSkillRef,
} from '../interfaces/playbook-flow-intent-blueprint.interface';

const SUPPORTED_ARTIFACT_KINDS: PlaybookIntentBlueprintPort['artifactKind'][] = [
  'text', 'document', 'code', 'image', 'data', 'dashboard',
];

const ANCHOR_MODES = ['append', 'before', 'after', 'as_input'] as const;
type AnchorMode = typeof ANCHOR_MODES[number];

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

    const dropped: Array<{ rule: string; itemId: string }> = [];
    const nodes = this.parseNodes(blueprintNode.nodes, dropped);
    const links = this.parseLinks(blueprintNode.links, nodes, dropped);
    const bindings = this.parseBindings(blueprintNode.bindings, nodes, dropped);
    const summary = this.asString(blueprintNode.summary) || this.asString(root.summary);
    const title = this.asString(blueprintNode.title) || this.asString(root.title) || summary || nodes[0]?.label;
    if (!title) {
      this.warnDrop('blueprint_missing_title', 'blueprint.title');
      return null;
    }

    return {
      blueprint: {
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
      dropped,
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
    dropped: Array<{ rule: string; itemId: string }>,
  ): PlaybookIntentBlueprintNode[] {
    if (!Array.isArray(value)) return [];

    const seenRefs = new Set<string>();
    const accepted: PlaybookIntentBlueprintNode[] = [];

    for (const item of value) {
      if (!item || typeof item !== 'object') {
        this.recordDrop(dropped, 'blueprint_node_invalid', 'unknown');
        continue;
      }
      const raw = item as Record<string, unknown>;
      const ref = this.asString(raw.ref);
      const label = this.asString(raw.label) || this.asString(raw.title);
      const purpose = this.asString(raw.purpose) || this.asString(raw.description);
      const nodeTemplateKey = this.parseNodeTemplateKey(raw, ref || label || 'unknown');

      if (!ref || !label || !nodeTemplateKey) {
        this.recordDrop(dropped, 'blueprint_node_missing_fields', ref || label || 'unknown');
        continue;
      }
      if (seenRefs.has(ref)) {
        this.recordDrop(dropped, 'blueprint_node_duplicate_ref', ref);
        continue;
      }
      const templateType = this.asString(raw.templateType) || null;
      const inputPorts = this.parsePorts(raw.inputPorts, dropped, `${ref}.inputs`);
      const outputPorts = this.parsePorts(raw.outputPorts, dropped, `${ref}.outputs`);
      const anchor = this.parseAnchor(raw.anchor);

      accepted.push({
        ref,
        label,
        purpose,
        nodeTemplateKey,
        templateType,
        nodeType: this.asString(raw.nodeType) || null,
        agentHint: this.asString(raw.agentHint) || null,
        inputPorts,
        outputPorts,
        connectorRefs: this.parseConnectorRefs(raw.connector_refs ?? raw.connectorRefs, dropped, ref),
        skillRefs: this.parseSkillRefs(raw.skill_refs ?? raw.skillRefs, dropped, ref),
        anchor,
        ...(raw.iteratorBody ? { iteratorBody: this.parseIteratorBody(raw.iteratorBody, dropped, ref) } : {}),
      });
      seenRefs.add(ref);
    }

    return accepted;
  }

  private parseConnectorRefs(
    value: unknown,
    dropped: Array<{ rule: string; itemId: string }>,
    ownerRef: string,
  ): PlaybookIntentBlueprintConnectorRef[] {
    if (!Array.isArray(value)) return [];
    const accepted: PlaybookIntentBlueprintConnectorRef[] = [];
    const seen = new Set<string>();
    for (const item of value) {
      if (!item || typeof item !== 'object') {
        this.recordDrop(dropped, 'blueprint_connector_ref_invalid', ownerRef);
        continue;
      }
      const raw = item as Record<string, unknown>;
      const connectorSlug = this.asString(raw.connector_slug ?? raw.connectorSlug);
      const actionKey = this.asString(raw.action_key ?? raw.actionKey);
      if (!connectorSlug || !actionKey) {
        this.recordDrop(dropped, 'blueprint_connector_ref_missing_fields', `${ownerRef}:${connectorSlug || '?'}.${actionKey || '?'}`);
        continue;
      }
      const key = `${connectorSlug}:${actionKey}`;
      if (seen.has(key)) {
        this.recordDrop(dropped, 'blueprint_connector_ref_duplicate', `${ownerRef}:${key}`);
        continue;
      }
      seen.add(key);
      accepted.push({ connectorSlug, actionKey, reason: this.asString(raw.reason) || null });
    }
    return accepted;
  }

  private parseSkillRefs(
    value: unknown,
    dropped: Array<{ rule: string; itemId: string }>,
    ownerRef: string,
  ): PlaybookIntentBlueprintSkillRef[] {
    if (!Array.isArray(value)) return [];
    const accepted: PlaybookIntentBlueprintSkillRef[] = [];
    const seen = new Set<string>();
    for (const item of value) {
      if (!item || typeof item !== 'object') {
        this.recordDrop(dropped, 'blueprint_skill_ref_invalid', ownerRef);
        continue;
      }
      const raw = item as Record<string, unknown>;
      const skillSlug = this.asString(raw.skill_slug ?? raw.skillSlug);
      if (!skillSlug) {
        this.recordDrop(dropped, 'blueprint_skill_ref_missing_fields', `${ownerRef}:?`);
        continue;
      }
      if (seen.has(skillSlug)) {
        this.recordDrop(dropped, 'blueprint_skill_ref_duplicate', `${ownerRef}:${skillSlug}`);
        continue;
      }
      seen.add(skillSlug);
      accepted.push({ skillSlug, reason: this.asString(raw.reason) || null });
    }
    return accepted;
  }

  private parseNodeTemplateKey(raw: Record<string, unknown>, ownerRef: string): string {
    const nodeTemplateKey = this.asString(raw.nodeTemplateKey ?? raw.node_template_key);
    if (nodeTemplateKey) return nodeTemplateKey;

    // Compatibility fallback lets existing saved prompt overrides drain while compilation moves to template keys.
    const legacyTemplateType = this.asString(raw.templateType);
    if (legacyTemplateType) {
      const safeOwnerRef = ownerRef.replace(/[\r\n]/g, ' ');
      const safeTemplateType = legacyTemplateType.replace(/[\r\n]/g, ' ');
      this.logger.warn(`playbook_intent_blueprint_legacy_template_type owner=${safeOwnerRef} templateType=${safeTemplateType}`);
    }
    return legacyTemplateType;
  }

  private parsePorts(
    value: unknown,
    dropped: Array<{ rule: string; itemId: string }>,
    ownerRef: string,
  ): PlaybookIntentBlueprintPort[] {
    if (!Array.isArray(value)) return [];
    const accepted: PlaybookIntentBlueprintPort[] = [];
    const seenIds = new Set<string>();
    for (const item of value) {
      if (!item || typeof item !== 'object') {
        this.recordDrop(dropped, 'blueprint_port_invalid', ownerRef);
        continue;
      }
      const raw = item as Record<string, unknown>;
      const id = this.asString(raw.id);
      const artifactKind = this.asString(raw.artifactKind) as PlaybookIntentBlueprintPort['artifactKind'] | '';
      if (!id || !artifactKind || seenIds.has(id)) {
        this.recordDrop(dropped, 'blueprint_port_missing_or_duplicate', `${ownerRef}.${id || '?'}`);
        continue;
      }
      if (!SUPPORTED_ARTIFACT_KINDS.includes(artifactKind)) {
        this.recordDrop(dropped, 'blueprint_port_unsupported_kind', `${ownerRef}.${id}:${artifactKind}`);
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
    dropped: Array<{ rule: string; itemId: string }>,
    ownerRef: string,
  ): PlaybookIntentBlueprintIteratorBody {
    if (!value || typeof value !== 'object') return { steps: [], edges: [] };
    const raw = value as Record<string, unknown>;
    const steps = Array.isArray(raw.steps)
      ? raw.steps
        .map((step) => this.parseIteratorStep(step, dropped, ownerRef))
        .filter((step): step is PlaybookIntentBlueprintIteratorStep => step !== null)
      : [];
    const validStepRefs = new Set(steps.map((s) => s.ref));
    const edges = Array.isArray(raw.edges)
      ? raw.edges
        .map((edge) => this.parseIteratorEdge(edge, validStepRefs, dropped, ownerRef))
        .filter((edge): edge is NonNullable<typeof edge> => edge !== null)
      : [];

    return { steps, edges };
  }

  private parseIteratorStep(
    value: unknown,
    dropped: Array<{ rule: string; itemId: string }>,
    ownerRef: string,
  ): PlaybookIntentBlueprintIteratorStep | null {
    if (!value || typeof value !== 'object') return null;
    const raw = value as Record<string, unknown>;
    const ref = this.asString(raw.ref);
    const title = this.asString(raw.title) || this.asString(raw.label);
    const nodeTemplateKey = this.parseNodeTemplateKey(raw, `${ownerRef}.step.${ref || '?'}`);
    if (!ref || !title || !nodeTemplateKey) {
      this.recordDrop(dropped, 'blueprint_iterator_step_missing_fields', `${ownerRef}.step.${ref || '?'}`);
      return null;
    }
    return {
      ref,
      title,
      description: this.asString(raw.description),
      nodeTemplateKey,
      templateType: this.asString(raw.templateType) || null,
      nodeType: this.asString(raw.nodeType) || null,
      inputPorts: this.parsePorts(raw.inputPorts, dropped, `${ownerRef}.${ref}.inputs`),
      outputPorts: this.parsePorts(raw.outputPorts, dropped, `${ownerRef}.${ref}.outputs`),
    };
  }

  private parseIteratorEdge(
    value: unknown,
    validRefs: Set<string>,
    dropped: Array<{ rule: string; itemId: string }>,
    ownerRef: string,
  ): PlaybookIntentBlueprintIteratorBody['edges'][number] | null {
    if (!value || typeof value !== 'object') return null;
    const raw = value as Record<string, unknown>;
    const sourceRef = this.asString(raw.sourceRef);
    const targetRef = this.asString(raw.targetRef);
    if (!sourceRef || !targetRef) {
      this.recordDrop(dropped, 'blueprint_iterator_edge_missing_refs', ownerRef);
      return null;
    }
    if (!validRefs.has(sourceRef) || !validRefs.has(targetRef)) {
      this.recordDrop(dropped, 'blueprint_iterator_edge_unknown_ref', `${sourceRef}->${targetRef}`);
      return null;
    }
    return {
      sourceRef,
      targetRef,
      ...(this.asString(raw.sourceOutputPortId) ? { sourceOutputPortId: this.asString(raw.sourceOutputPortId) } : {}),
      ...(this.asString(raw.targetInputPortId) ? { targetInputPortId: this.asString(raw.targetInputPortId) } : {}),
    };
  }

  private parseLinks(
    value: unknown,
    nodes: PlaybookIntentBlueprintNode[],
    dropped: Array<{ rule: string; itemId: string }>,
  ): PlaybookIntentBlueprintLink[] {
    if (!Array.isArray(value)) return [];
    const refSet = new Set(nodes.map((n) => n.ref));
    const iteratorStepsByRef = this.buildIteratorStepRefSet(nodes);
    const accepted: PlaybookIntentBlueprintLink[] = [];
    const seenKeys = new Set<string>();
    for (const item of value) {
      if (!item || typeof item !== 'object') {
        this.recordDrop(dropped, 'blueprint_link_invalid', 'unknown');
        continue;
      }
      const raw = item as Record<string, unknown>;
      const sourceRef = this.asString(raw.sourceRef);
      const targetRef = this.asString(raw.targetRef);
      const sourceIteratorRef = this.asString(raw.sourceIteratorRef);
      const targetIteratorRef = this.asString(raw.targetIteratorRef);
      if (!sourceRef || !targetRef) {
        this.recordDrop(dropped, 'blueprint_link_missing_refs', `${sourceRef || '?'}->${targetRef || '?'}`);
        continue;
      }
      if (!this.hasEndpointRef(refSet, iteratorStepsByRef, sourceRef, sourceIteratorRef)) {
        this.recordDrop(dropped, 'blueprint_link_unknown_ref', `${sourceRef}->${targetRef}`);
        continue;
      }
      if (!this.hasEndpointRef(refSet, iteratorStepsByRef, targetRef, targetIteratorRef)) {
        this.recordDrop(dropped, 'blueprint_link_unknown_ref', `${sourceRef}->${targetRef}`);
        continue;
      }
      const key = `${sourceIteratorRef}.${sourceRef}::${targetIteratorRef}.${targetRef}::${raw.sourceOutputPortId || ''}::${raw.targetInputPortId || ''}`;
      if (seenKeys.has(key)) {
        this.recordDrop(dropped, 'blueprint_link_duplicate', key);
        continue;
      }
      seenKeys.add(key);
      accepted.push({
        sourceRef,
        targetRef,
        ...(sourceIteratorRef ? { sourceIteratorRef } : {}),
        ...(targetIteratorRef ? { targetIteratorRef } : {}),
        ...(this.asString(raw.sourceOutputPortId) ? { sourceOutputPortId: this.asString(raw.sourceOutputPortId) } : {}),
        ...(this.asString(raw.targetInputPortId) ? { targetInputPortId: this.asString(raw.targetInputPortId) } : {}),
      });
    }
    return accepted;
  }

  private parseBindings(
    value: unknown,
    nodes: PlaybookIntentBlueprintNode[],
    dropped: Array<{ rule: string; itemId: string }>,
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
        this.recordDrop(dropped, 'blueprint_binding_invalid', 'unknown');
        continue;
      }
      const raw = item as Record<string, unknown>;
      const targetRef = this.asString(raw.targetRef);
      const targetIteratorRef = this.asString(raw.targetIteratorRef);
      const targetPort = this.asString(raw.targetPort);
      if (!targetRef || !targetPort) {
        this.recordDrop(dropped, 'blueprint_binding_missing_target', `${targetRef || '?'}.${targetPort || '?'}`);
        continue;
      }
      if (!this.hasEndpointRef(refSet, iteratorStepsByRef, targetRef, targetIteratorRef)) {
        this.recordDrop(dropped, 'blueprint_binding_unknown_target_ref', targetRef);
        continue;
      }
      const sourceKind = this.asString(raw.sourceKind) as 'node-output' | 'constant' | '';
      if (sourceKind !== 'node-output' && sourceKind !== 'constant') {
        this.recordDrop(dropped, 'blueprint_binding_invalid_source_kind', `${targetRef}.${targetPort}`);
        continue;
      }

      const targetCatalogRef = targetIteratorRef ? this.scopedRef(targetIteratorRef, targetRef) : targetRef;
      const key = `${targetCatalogRef}.${targetPort}`;
      if (seenKeys.has(key)) {
        this.recordDrop(dropped, 'blueprint_binding_duplicate_target', key);
        continue;
      }

      const targetPorts = inputsByRef.get(targetCatalogRef);
      if (!targetPorts?.has(targetPort)) {
        this.recordDrop(dropped, 'blueprint_binding_unknown_target_port', key);
        continue;
      }
      seenKeys.add(key);

      if (sourceKind === 'constant') {
        const constantValue = this.parseConstantValue(raw.constantValue, dropped, key);
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

      const sourceRef = this.asString(raw.sourceRef);
      const sourceIteratorRef = this.asString(raw.sourceIteratorRef);
      const sourcePort = this.asString(raw.sourcePort);
      if (!sourceRef || !sourcePort) {
        this.recordDrop(dropped, 'blueprint_binding_missing_source', key);
        continue;
      }
      if (!this.hasEndpointRef(refSet, iteratorStepsByRef, sourceRef, sourceIteratorRef)) {
        this.recordDrop(dropped, 'blueprint_binding_unknown_source_ref', `${sourceRef}->${key}`);
        continue;
      }
      const sourceCatalogRef = sourceIteratorRef ? this.scopedRef(sourceIteratorRef, sourceRef) : sourceRef;
      const sourcePorts = outputsByRef.get(sourceCatalogRef);
      if (!sourcePorts?.has(sourcePort)) {
        this.recordDrop(dropped, 'blueprint_binding_unknown_source_port', `${sourceRef}.${sourcePort}->${key}`);
        continue;
      }
      const targetKind = targetPorts.get(targetPort)?.artifactKind;
      const sourceKindPort = sourcePorts.get(sourcePort)?.artifactKind;
      if (targetKind && sourceKindPort && targetKind !== sourceKindPort) {
        this.recordDrop(dropped, 'blueprint_binding_artifact_mismatch', `${sourceRef}.${sourcePort}->${key}`);
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
    if (!iteratorRef) return topLevelRefs.has(ref);
    return iteratorStepsByRef.get(iteratorRef)?.has(ref) === true;
  }

  private scopedRef(iteratorRef: string, stepRef: string): string {
    return `${iteratorRef}.${stepRef}`;
  }

  private parseConstantValue(
    value: unknown,
    dropped: Array<{ rule: string; itemId: string }>,
    key: string,
  ): PlaybookIntentBlueprintBinding['constantValue'] | null {
    if (!value || typeof value !== 'object') {
      this.recordDrop(dropped, 'blueprint_binding_invalid_constant', key);
      return null;
    }
    const raw = value as Record<string, unknown>;
    const kind = this.asString(raw.kind);
    const id = this.asString(raw.id);
    const workspaceId = this.asString(raw.workspaceId) || (kind === 'workspace' ? id : '');
    if ((kind !== 'workspace' && kind !== 'document') || !id || !workspaceId) {
      this.recordDrop(dropped, 'blueprint_binding_invalid_constant', key);
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

  private asString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private asStringArray(value: unknown): string[] {
    return Array.isArray(value)
      ? value.map((item) => this.asString(item)).filter((entry) => entry.length > 0).slice(0, 8)
      : [];
  }

  private recordDrop(dropped: Array<{ rule: string; itemId: string }>, rule: string, itemId: string): void {
    dropped.push({ rule, itemId });
    this.warnDrop(rule, itemId);
  }

  private warnDrop(rule: string, itemId: string): void {
    this.logger.warn(`playbook_intent_blueprint_drop rule=${rule} item=${itemId}`);
  }
}
