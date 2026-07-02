import { Injectable } from '@nestjs/common';
import type {
  PlaybookIntentBlueprintNode,
  PlaybookIntentBlueprintPort,
  PlaybookIntentBlueprintPrimitiveConfig,
} from '../interfaces/playbook-flow-intent-blueprint.interface';
import type { PlaybookIntentDiagnostic } from '../interfaces/playbook-flow-intent-diagnostic.interface';
import type { PlaybookIntentTaskDraft } from './playbook-flow-intent.service';

export interface PlaybookPrimitivePromptSpec {
  kind: string;
  title: string;
  description: string;
  selectionRules: string[];
  topologyRules: string[];
  configSchemaHint: Record<string, unknown>;
  promptInstructions: string;
}

export interface PlaybookPrimitiveRuntimeContext {
  node: PlaybookIntentBlueprintNode;
  supportsIteratorBody: boolean;
}

export interface PlaybookPrimitiveRuntimeSpec {
  kind: string;
  normalizeOutputPorts?: (
    ports: PlaybookIntentBlueprintPort[] | undefined,
    primitive: PlaybookIntentBlueprintPrimitiveConfig,
  ) => PlaybookIntentBlueprintPort[] | undefined;
  compileTaskPatch?: (primitive: PlaybookIntentBlueprintPrimitiveConfig) => Partial<PlaybookIntentTaskDraft>;
  validateNode?: (context: PlaybookPrimitiveRuntimeContext) => PlaybookIntentDiagnostic[];
}

const PRIMITIVES: PlaybookPrimitivePromptSpec[] = [
  {
    kind: 'agent',
    title: 'Agent step',
    description: 'LLM or agent work that transforms inputs into semantic outputs.',
    selectionRules: ['Use for analysis, extraction, summarization, synthesis, and other non-deterministic knowledge work.'],
    topologyRules: ['Use explicit data bindings for every consumed upstream output.'],
    configSchemaHint: { kind: 'agent' },
    promptInstructions: 'Set primitive.kind="agent" for standard agent work.',
  },
  {
    kind: 'action',
    title: 'Connector action',
    description: 'External connector or tool action.',
    selectionRules: ['Use when a listed connector action is required.'],
    topologyRules: ['External side effects should be preceded by human approval unless explicitly approved by the user.'],
    configSchemaHint: { kind: 'action', action: { connectorSlug: 'string', actionKey: 'string' } },
    promptInstructions: 'Use only connector slugs and action keys from the available design catalog.',
  },
  {
    kind: 'evaluation',
    title: 'Evaluation',
    description: 'Quality, policy, or rubric evaluation node.',
    selectionRules: ['Use when the workflow must score, judge, or verify a prior result.'],
    topologyRules: ['Evaluation outputs should be structured data when routers consume them.'],
    configSchemaHint: { kind: 'evaluation' },
    promptInstructions: 'Prefer data outputs for downstream deterministic conditions.',
  },
  {
    kind: 'iterator',
    title: 'Iterator',
    description: 'Repeats child steps for each item in a collection.',
    selectionRules: ['Use when the request says each, every, per item, batch, list, records, invoices, claims, or documents.'],
    topologyRules: ['Iterator body edges stay inside iteratorBody. Child branch targets should stay in the same iterator.'],
    configSchemaHint: { kind: 'iterator' },
    promptInstructions: 'Place repeated steps in iteratorBody.steps and use iteratorBody.edges for child ordering.',
  },
  {
    kind: 'router',
    title: 'Router',
    description: 'Conditional control-flow branch based on prior structured outputs or business rules.',
    selectionRules: ['Use when execution must branch based on a score, status, boolean decision, threshold, or business rule.'],
    topologyRules: ['Define outputLabels and defaultLabel.', 'Every conditional link must include routerLabel declared in outputLabels.', 'Conditions must reference previous node outputs.'],
    configSchemaHint: {
      kind: 'router',
      router: {
        outputLabels: ['snake_case_label'],
        defaultLabel: 'snake_case_label',
        maxIterations: 1,
        conditions: [{ label: 'snake_case_label', sourceRef: 'prior_ref', sourcePort: 'data_port', path: '$.field', operator: 'equals', value: true }],
      },
    },
    promptInstructions: 'When choosing a router template, include primitive.kind="router" and primitive.router. Add one conditional link per branch with routerLabel.',
  },
  {
    kind: 'human_approval',
    title: 'Human approval',
    description: 'Human review, approval, rejection, or clarification gate.',
    selectionRules: ['Use before destructive or external-send side effects and for explicit approval requests.'],
    topologyRules: ['Approval nodes must receive enough context through data bindings.'],
    configSchemaHint: { kind: 'human_approval', humanApproval: { promptTemplate: 'string', approvalMode: 'approve_reject' } },
    promptInstructions: 'Set primitive.kind="human_approval" and provide a concise prompt template when the approval policy is known.',
  },
];

const RUNTIME_SPECS: PlaybookPrimitiveRuntimeSpec[] = [
  {
    kind: 'router',
    normalizeOutputPorts: (ports, primitive) => {
      const labels = [...new Set((primitive.router?.outputLabels || []).map((label) => label.trim()).filter(Boolean))];
      if (labels.length === 0) return ports;
      const byId = new Map((ports || []).map((port) => [port.id, port]));
      for (const label of labels) {
        if (!byId.has(label)) byId.set(label, { id: label, name: label, artifactKind: 'text' });
      }
      return [...byId.values()];
    },
  },
  {
    kind: 'human_approval',
    compileTaskPatch: (primitive) => primitive.humanApproval
      ? { humanApprovalConfig: { ...primitive.humanApproval } }
      : {},
  },
  {
    kind: 'iterator',
    validateNode: ({ node, supportsIteratorBody }) => {
      if (!supportsIteratorBody || node.iteratorBody) return [];
      return [{
        severity: 'warning',
        stage: 'graph_builder',
        code: 'builder_iterator_primitive_missing_body',
        itemId: node.ref,
        message: 'Iterator primitive requires iteratorBody steps.',
      }];
    },
  },
];

@Injectable()
export class PlaybookFlowPrimitiveRegistryService {
  getPromptCatalog(): PlaybookPrimitivePromptSpec[] {
    return PRIMITIVES.map((primitive) => ({
      ...primitive,
      selectionRules: [...primitive.selectionRules],
      topologyRules: [...primitive.topologyRules],
      configSchemaHint: this.cloneJsonRecord(primitive.configSchemaHint),
    }));
  }

  getRuntimeSpec(kind: string | null | undefined): PlaybookPrimitiveRuntimeSpec | null {
    if (!kind) return null;
    return RUNTIME_SPECS.find((spec) => spec.kind === kind) || null;
  }

  isKnownPrimitive(kind: string | null | undefined): boolean {
    if (!kind) return false;
    return PRIMITIVES.some((primitive) => primitive.kind === kind);
  }

  private cloneJsonRecord(value: Record<string, unknown>): Record<string, unknown> {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  }
}
