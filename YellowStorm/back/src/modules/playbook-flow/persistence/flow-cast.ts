// Relative (not @common/*): pulled in by ts-node migration scripts without path aliases.
import { stripNul } from '../../../common/postgres/json';
import { DEFAULT_HITL_POLICY } from '../models/playbook-flow-hitl.model';

/**
 * What Mongoose did to a flow's document-shaped fields on every write, now done before the jsonb
 * write: keys outside the schema are dropped, subdocument defaults are filled (a port's
 * `required: false`, an edge's `priority: 0`, a binding's `iteration: 'current'`, a retry policy's
 * delays, the HITL policy and blocker defaults), and empty objects are removed ("minimize"). The
 * result is the JSON the flow's `toJSON()` returned, so API responses and runtime snapshots keep
 * their shape. Values are returned JSON-normalised (Dates as ISO strings, no undefined, no U+0000),
 * i.e. exactly what a jsonb read gives back.
 */

interface Field {
  default?: () => unknown;
  /** Single embedded subdocument. */
  sub?: Shape;
  /** Array of subdocuments, or of scalars when `true`; an absent array defaults to []. */
  array?: Shape | true;
  /** Cast to a Date. */
  date?: true;
}
type Shape = Record<string, Field>;

const scalar: Field = {};

const PORT: Shape = { id: scalar, label: scalar, type: scalar, required: { default: () => false } };
const IO: Shape = { raw: scalar, ports: { array: PORT } };
const ROUTER_CONDITION: Shape = { label: scalar, sourceNode: scalar, sourcePort: scalar, path: scalar, operator: scalar, value: scalar };
const ROUTER: Shape = {
  outputLabels: { array: true },
  maxIterations: scalar,
  conditions: { array: ROUTER_CONDITION },
  defaultLabel: scalar,
  mode: scalar,
  prompt: scalar,
};
const HITL_POLICY: Shape = {
  mode: { default: () => DEFAULT_HITL_POLICY.mode },
  sensitivity: { default: () => DEFAULT_HITL_POLICY.sensitivity },
  clarificationEnabled: { default: () => DEFAULT_HITL_POLICY.clarificationEnabled },
  approvalEnabled: { default: () => DEFAULT_HITL_POLICY.approvalEnabled },
  reviewEnabled: { default: () => DEFAULT_HITL_POLICY.reviewEnabled },
  propagateFeedbackDefault: { default: () => DEFAULT_HITL_POLICY.propagateFeedbackDefault },
  defaultFeedbackScope: { default: () => DEFAULT_HITL_POLICY.defaultFeedbackScope },
  inheritedFromWorkflow: scalar,
  disabledReason: { default: () => null },
};
const NODE: Shape = {
  id: scalar,
  kind: scalar,
  label: scalar,
  description: scalar,
  taskTemplateId: scalar,
  promptTemplateId: scalar,
  outputFormatId: scalar,
  input: { sub: IO },
  output: { sub: IO },
  routerConfig: { sub: ROUTER },
  iteratorConfig: { sub: { collectionPath: scalar, maxItems: scalar } },
  humanApprovalConfig: { sub: { promptTemplate: scalar, timeoutSeconds: scalar } },
  retryPolicy: { sub: { maxRetries: { default: () => 1 }, delayMs: { default: () => 1000 } } },
  hitlPolicy: { sub: HITL_POLICY },
  modelId: scalar,
  metadata: scalar,
  dynamicReasoning: { sub: { enabled: { default: () => false } } },
};
const CONTROL_EDGE: Shape = {
  id: scalar,
  kind: scalar,
  source: scalar,
  target: scalar,
  routerLabel: scalar,
  sourceOutputPortId: scalar,
  targetInputPortId: scalar,
  priority: { default: () => 0 },
};
const DATA_BINDING: Shape = {
  id: scalar,
  targetNode: scalar,
  targetPort: scalar,
  sourceKind: scalar,
  sourceNode: scalar,
  sourcePort: scalar,
  iteration: { default: () => 'current' },
  triggerPath: scalar,
  statePath: scalar,
  constantValue: scalar,
  expression: scalar,
};
const HITL_BLOCKER: Shape = {
  id: scalar,
  scope: { default: () => 'workflow' },
  nodeId: { default: () => null },
  enabled: { default: () => true },
  kind: scalar,
  label: scalar,
  description: scalar,
  action: scalar,
  riskLevel: { default: () => 'medium' },
  sensitivity: { default: () => 'balanced' },
  matcherType: scalar,
  matcherConfig: { default: () => ({}) },
  promptTemplate: { default: () => null },
  appliesToToolNames: { array: true },
  appliesToConnectorActions: { array: true },
  createdBy: { default: () => 'system' },
  createdAt: { date: true, default: () => new Date() },
  updatedAt: { date: true, default: () => new Date() },
};
const SETTINGS: Shape = { recursionLimit: { default: () => 25 }, maxParallelism: { default: () => 5 } };
const TRIGGER_CONFIG: Shape = { kind: scalar, params: scalar };

export const DEFAULT_FLOW_SETTINGS = { recursionLimit: 25, maxParallelism: 5 };
export const DEFAULT_DESIGN_SETTINGS = { inferenceModelId: null, nodeSuggestionsMode: 'inherit', approvalSuggestionMode: 'inherit' };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** An object to cast field by field: plain, or a DTO class instance. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);
}

function castValue(value: unknown, field: Field): unknown {
  if (value === null) return null;
  if (field.date) {
    const date = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(date.getTime()) ? value : date;
  }
  if (field.sub) return isRecord(value) ? castShape(value, field.sub) : value;
  if (field.array && Array.isArray(value)) {
    const shape = field.array;
    return shape === true ? value : value.map((item) => (isRecord(item) ? castShape(item, shape) : item));
  }
  return value;
}

function castShape(value: Record<string, unknown>, shape: Shape): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(shape)) {
    const raw = value[key];
    if (raw === undefined) {
      if (field.default) out[key] = field.default();
      else if (field.array) out[key] = [];
      continue;
    }
    out[key] = castValue(raw, field);
  }
  return out;
}

/**
 * Mongoose's minimize: empty plain objects are removed, recursively, but never inside arrays.
 * Mutates `value`, which is always a fresh JSON copy here.
 */
function minimize(value: Record<string, unknown>): Record<string, unknown> | undefined {
  let hasKeys = false;
  for (const key of Object.keys(value)) {
    const item = value[key];
    if (isPlainObject(item) && minimize(item) === undefined) {
      delete value[key];
      continue;
    }
    hasKeys = true;
  }
  return hasKeys ? value : undefined;
}

/** JSON round trip (what jsonb stores and returns, and a deep copy) with U+0000 removed. */
function toJson<T>(value: T): T {
  return stripNul(JSON.parse(JSON.stringify(value)) as T);
}

function castArray<T>(items: readonly unknown[] | null | undefined, shape: Shape): T[] {
  if (!Array.isArray(items)) return [];
  const cast = toJson(items.map((item) => (isRecord(item) ? castShape(item, shape) : item)));
  return cast.map((item) => (isPlainObject(item) ? (minimize(item) ?? {}) : item)) as T[];
}

function castObject<T>(value: unknown, shape: Shape): T | null {
  if (!isRecord(value)) return null;
  const reduced = minimize(toJson(castShape(value, shape)));
  return reduced === undefined ? null : (reduced as T);
}

export const castFlowNodes = <T>(nodes: readonly unknown[] | null | undefined): T[] => castArray<T>(nodes, NODE);
export const castControlEdges = <T>(edges: readonly unknown[] | null | undefined): T[] => castArray<T>(edges, CONTROL_EDGE);
export const castDataBindings = <T>(bindings: readonly unknown[] | null | undefined): T[] => castArray<T>(bindings, DATA_BINDING);
export const castHitlBlockers = <T>(blockers: readonly unknown[] | null | undefined): T[] => castArray<T>(blockers, HITL_BLOCKER);

/** A flow HITL policy; an absent one becomes the defaults. */
export const castHitlPolicy = <T>(policy: unknown): T => castObject<T>(isRecord(policy) ? policy : {}, HITL_POLICY) as T;
export const castFlowSettings = <T>(settings: unknown): T => castObject<T>(isRecord(settings) ? settings : {}, SETTINGS) as T;
/** Null when nothing is left once empty objects are removed. */
export const castTriggerConfig = <T>(trigger: unknown): T | null => castObject<T>(trigger, TRIGGER_CONFIG);

/** A free-form object column (`designSettings`, `generationProvenance`): minimized, null when empty. */
export function castMixedObject<T>(value: unknown): T | null {
  if (!isRecord(value)) return null;
  const reduced = minimize(toJson(value));
  return reduced === undefined ? null : (reduced as T);
}
