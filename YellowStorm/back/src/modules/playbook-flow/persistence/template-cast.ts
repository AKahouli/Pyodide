// Relative (not @common/*): pulled in by ts-node migration scripts without path aliases.
import { stripNul } from '../../../common/postgres/json';

/**
 * What the Mongoose node-template schema did to the document-shaped fields on every write, now done
 * before the jsonb write: keys outside the schema are dropped (a router's `mode` and `prompt` too, the
 * template schema never had them), subdocument defaults are filled and the strings the schema trimmed
 * are trimmed. Mongoose also gave every config subdocument an `_id`; nothing read it, so none is added.
 * Values come back JSON-normalised, i.e. exactly what a jsonb read returns.
 */

interface Field {
  default?: () => unknown;
  trim?: true;
  /** Array of subdocuments; an absent array takes `default`. */
  array?: Shape;
}
type Shape = Record<string, Field>;

const plain: Field = {};
const trimmed: Field = { trim: true };
const nullDefault = (trim?: true): Field => ({ default: () => null, ...(trim ? { trim } : {}) });

const INPUT_PORT: Shape = { id: trimmed, name: trimmed, artifactKind: trimmed, required: plain, description: trimmed };
const OUTPUT_PORT: Shape = { id: trimmed, name: trimmed, artifactKind: trimmed, description: trimmed };
const ITERATOR: Shape = {
  source: trimmed,
  mode: trimmed,
  batchSize: nullDefault(),
  itemVariable: nullDefault(true),
  outputVariable: nullDefault(true),
  errorStrategy: { trim: true, default: () => 'stop' },
};
const ROUTER_CONDITION: Shape = {
  label: trimmed,
  sourceNode: nullDefault(),
  sourcePort: nullDefault(),
  path: nullDefault(),
  operator: plain,
  value: nullDefault(),
};
const ROUTER: Shape = {
  outputLabels: { default: () => [] },
  maxIterations: { default: () => 1 },
  conditions: { array: ROUTER_CONDITION, default: () => [] },
  defaultLabel: nullDefault(),
};
const HUMAN_APPROVAL: Shape = { promptTemplate: { trim: true, default: () => '' }, timeoutSeconds: nullDefault() };
const RETRY_POLICY: Shape = { maxRetries: { default: () => 1 }, delayMs: { default: () => 1000 } };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function castShape(value: Record<string, unknown>, shape: Shape): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(shape)) {
    const raw = value[key];
    if (raw === undefined) {
      if (field.default) out[key] = field.default();
      continue;
    }
    if (field.array) out[key] = Array.isArray(raw) ? castItems(raw, field.array) : raw;
    else out[key] = field.trim && typeof raw === 'string' ? raw.trim() : raw;
  }
  return out;
}

function castItems(items: readonly unknown[], shape: Shape): Record<string, unknown>[] {
  return items.filter(isPlainObject).map((item) => castShape(item, shape));
}

/** JSON round trip (what jsonb stores and returns) with U+0000 removed. */
function toJson<T>(value: T): T {
  return stripNul(JSON.parse(JSON.stringify(value)) as T);
}

function castArray<T>(items: unknown, shape: Shape): T[] {
  return Array.isArray(items) ? toJson(castItems(items, shape)) as T[] : [];
}

function castObject<T>(value: unknown, shape: Shape): T | null {
  return isPlainObject(value) ? toJson(castShape(value, shape)) as T : null;
}

export const castInputPorts = <T>(ports: unknown): T[] => castArray<T>(ports, INPUT_PORT);
export const castOutputPorts = <T>(ports: unknown): T[] => castArray<T>(ports, OUTPUT_PORT);
export const castIteratorConfig = <T>(config: unknown): T | null => castObject<T>(config, ITERATOR);
export const castRouterConfig = <T>(config: unknown): T | null => castObject<T>(config, ROUTER);
export const castHumanApprovalConfig = <T>(config: unknown): T | null => castObject<T>(config, HUMAN_APPROVAL);
export const castRetryPolicy = <T>(config: unknown): T | null => castObject<T>(config, RETRY_POLICY);

/** The column length limits of node and prompt templates (the Mongoose `maxlength`s). */
export const TEMPLATE_MAX_LENGTHS = {
  key: 120,
  title: 160,
  description: 600,
  icon: 80,
  color: 40,
  category: 80,
} as const;
