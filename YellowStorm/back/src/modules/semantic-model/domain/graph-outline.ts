/**
 * What the data graph view reads: a light outline of every record and link, one record's values on demand,
 * a search through values, and the content of a standalone export. Pure functions over the runtime graph.
 */

export interface OutlineSourceGraph {
  dataRevisionId: string;
  nodes: Array<{ id: string; label: string; properties: Record<string, unknown> }>;
  edges: Array<{ id: string; label: string; sourceId: string; targetId: string; properties: Record<string, unknown> }>;
  specification: { concepts: Array<{ conceptId: string; allowedFields: string[] }> };
}

/** How one field travels in an export: whole, cut to a length, or left out. */
export type ExportFieldChoice = 'full' | 'short' | 'exclude';

const ISO_DATE = /^\d{4}-\d{2}(-\d{2})?([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;
const SNIPPET = 120;

export const isMissingValue = (value: unknown) => value === null || value === undefined || value === '' || value === '__missing__';

/** The name the graph stores a field under: the runtime replaces characters it cannot use in a property name. */
export function graphFieldKey(field: string): string {
  const safe = field.replace(/[^a-zA-Z0-9_]/g, '_');
  return /^[0-9]/.test(safe) ? `_${safe}` : safe;
}

const conceptOf = (node: OutlineSourceGraph['nodes'][number]) => String(node.properties.concept_id ?? node.label);

function fieldsByConcept(graph: OutlineSourceGraph) {
  return new Map(graph.specification.concepts.map((concept) => [concept.conceptId, concept.allowedFields]));
}

function valueOf(node: OutlineSourceGraph['nodes'][number], field: string): unknown {
  return node.properties[field] ?? node.properties[graphFieldKey(field)] ?? null;
}

const labelOf = (node: OutlineSourceGraph['nodes'][number]) => String(node.properties.record_label ?? node.id);

/**
 * Every record with its concept, name, missing fields and dates, and every link — enough to draw, count,
 * filter by period and find paths, without the values themselves (a mail body can weigh more than the rest).
 */
export function graphOutline(graph: OutlineSourceGraph) {
  const fields = fieldsByConcept(graph);
  const ids = new Set(graph.nodes.map((node) => node.id));
  return {
    dataRevisionId: graph.dataRevisionId,
    concepts: graph.specification.concepts.map((concept) => ({ id: concept.conceptId, fields: concept.allowedFields })),
    records: graph.nodes.map((node) => {
      const concept = conceptOf(node);
      const missing: string[] = [];
      const dates: Record<string, string> = {};
      for (const field of fields.get(concept) ?? []) {
        const value = valueOf(node, field);
        if (isMissingValue(value)) missing.push(field);
        else if (typeof value === 'string' && value.length <= 32 && ISO_DATE.test(value.trim())) dates[field] = value.trim();
      }
      return { id: node.id, c: concept, l: labelOf(node), ...(missing.length ? { m: missing } : {}), ...(Object.keys(dates).length ? { d: dates } : {}) };
    }),
    links: graph.edges.filter((edge) => ids.has(edge.sourceId) && ids.has(edge.targetId))
      .map((edge) => ({ id: edge.id, r: edge.label, s: edge.sourceId, t: edge.targetId })),
  };
}

/** One record's values by field, and the file it was read from; null when the record is not in the graph. */
export function graphRecordValues(graph: OutlineSourceGraph, recordId: string) {
  const node = graph.nodes.find((item) => item.id === recordId);
  if (!node) return null;
  const fields = fieldsByConcept(graph).get(conceptOf(node)) ?? [];
  const source = node.properties.source_file_name;
  return {
    id: node.id,
    values: Object.fromEntries(fields.map((field) => [field, valueOf(node, field)])),
    sourceFileName: isMissingValue(source) ? null : String(source),
  };
}

/** Folds accents and case, so "fevrier" finds "Février". */
export const foldText = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Records one of whose values holds every word typed, with the value that matched, cut around the match. */
export function searchGraphValues(graph: OutlineSourceGraph, query: string, limit = 8) {
  const words = foldText(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const fields = fieldsByConcept(graph);
  const hits: Array<{ id: string; field: string; value: string }> = [];
  for (const node of graph.nodes) {
    for (const field of fields.get(conceptOf(node)) ?? []) {
      const value = valueOf(node, field);
      if (isMissingValue(value)) continue;
      const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
      const folded = foldText(text);
      if (!words.every((word) => folded.includes(word))) continue;
      const at = Math.max(0, folded.indexOf(words[0]) - 30);
      const cut = text.slice(at, at + SNIPPET);
      hits.push({ id: node.id, field, value: `${at > 0 ? '…' : ''}${cut}${at + SNIPPET < text.length ? '…' : ''}` });
      break;
    }
    if (hits.length >= limit) break;
  }
  return hits;
}

/**
 * The records and links of a standalone export, each field kept whole, cut to `shortenTo` characters or left out
 * as chosen per concept. Fields without a choice are cut, so nothing leaves whole unless someone asked for it.
 */
export function graphExport(graph: OutlineSourceGraph, choices: Record<string, Record<string, ExportFieldChoice>>, shortenTo: number) {
  const fields = fieldsByConcept(graph);
  const ids = new Set(graph.nodes.map((node) => node.id));
  const cut = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(cut);
    if (typeof value === 'string' && value.length > shortenTo) return `${value.slice(0, shortenTo)}…`;
    return value;
  };
  return {
    dataRevisionId: graph.dataRevisionId,
    records: graph.nodes.map((node) => {
      const concept = conceptOf(node);
      const values: Record<string, unknown> = {};
      for (const field of fields.get(concept) ?? []) {
        const choice = choices[concept]?.[field] ?? 'short';
        if (choice === 'exclude') continue;
        const value = valueOf(node, field);
        values[field] = isMissingValue(value) ? null : choice === 'full' ? value : cut(value);
      }
      return { id: node.id, c: concept, l: labelOf(node), v: values };
    }),
    links: graph.edges.filter((edge) => ids.has(edge.sourceId) && ids.has(edge.targetId))
      .map((edge) => ({ id: edge.id, r: edge.label, s: edge.sourceId, t: edge.targetId })),
  };
}
