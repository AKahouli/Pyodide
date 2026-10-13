import type { AttributeDefinition, FieldGraphSettings } from './semantic-model.types';

/**
 * Which fields of a concept the graph shows. It shapes the graph only: records, search indexes and the
 * records tables read the runtime database, so it is no part of the specification or its hash.
 */
export type GraphExposure = Record<string, { hidden?: string[]; maxChars?: Record<string, number> }>;

/** A cut text keeps at least this many characters and at most what the runtime allows. */
export const GRAPH_MAX_CHARS_RANGE = [50, 100_000] as const;
const GRAPH_KEYS = ['expose', 'maxChars'] as const;

/** Why a field's graph settings cannot be kept; empty when they can. */
export function fieldGraphProblems(input: unknown, where = 'graph: '): string[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return [`${where}must be an object`];
  const source = input as Record<string, unknown>;
  const problems = Object.keys(source).filter((key) => !(GRAPH_KEYS as readonly string[]).includes(key)).map((key) => `${where}${key} is not a setting`);
  if (source.expose !== undefined && typeof source.expose !== 'boolean') problems.push(`${where}expose must be true or false`);
  const [min, max] = GRAPH_MAX_CHARS_RANGE;
  if (source.maxChars !== undefined && source.maxChars !== null
    && (typeof source.maxChars !== 'number' || !Number.isInteger(source.maxChars) || source.maxChars < min || source.maxChars > max)) {
    problems.push(`${where}maxChars must be a whole number from ${String(min)} to ${String(max)}`);
  }
  return problems;
}

/** What a field stores: nothing when it is the default (shown, whole). */
export function pickFieldGraph(input: unknown): FieldGraphSettings | undefined {
  if (!input || typeof input !== 'object' || fieldGraphProblems(input).length) return undefined;
  const { expose, maxChars } = input as FieldGraphSettings;
  const settings: FieldGraphSettings = {
    ...(expose === false ? { expose: false } : {}),
    ...(typeof maxChars === 'number' ? { maxChars } : {}),
  };
  return Object.keys(settings).length ? settings : undefined;
}

/** The exposure the runtime applies, for the concepts that hide or cut a field; `{}` when every field shows. */
export function graphExposureOf(nodes: readonly { id: string; attributes?: AttributeDefinition[] | null }[]): GraphExposure {
  const exposure: GraphExposure = {};
  for (const node of nodes) {
    const hidden: string[] = [];
    const maxChars: Record<string, number> = {};
    for (const attribute of node.attributes ?? []) {
      const settings = pickFieldGraph(attribute.graph);
      if (settings?.expose === false) hidden.push(attribute.key);
      else if (settings?.maxChars !== undefined && attribute.type === 'text') maxChars[attribute.key] = settings.maxChars;
    }
    if (hidden.length || Object.keys(maxChars).length) {
      exposure[node.id] = {
        ...(hidden.length ? { hidden } : {}),
        ...(Object.keys(maxChars).length ? { maxChars } : {}),
      };
    }
  }
  return exposure;
}
