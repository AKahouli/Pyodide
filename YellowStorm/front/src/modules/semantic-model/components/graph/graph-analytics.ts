import type { AgeGraphEdge, AgeGraphNode, AttributeDefinition, SemanticGraph, SemanticNodeType } from '../../types';

/** One record of the data graph, with what people read about it. */
export interface GraphRecord {
  id: string;
  /** The concept's key: what records of one concept share. */
  concept: string;
  conceptLabel: string;
  label: string;
  fields: GraphField[];
  missing: number;
  raw: AgeGraphNode;
}

export interface GraphField {
  key: string;
  label: string;
  type: AttributeDefinition['type'];
  value: unknown;
  missing: boolean;
}

export interface GraphLink {
  id: string;
  source: string;
  target: string;
  relation: string;
  label: string;
}

export interface GraphConcept {
  key: string;
  label: string;
  count: number;
}

export interface GraphIndex {
  records: GraphRecord[];
  byId: Map<string, GraphRecord>;
  links: GraphLink[];
  /** Every link touching a record, either way. */
  linksOf: Map<string, GraphLink[]>;
  concepts: GraphConcept[];
  degree: Map<string, number>;
}

export const isMissing = (value: unknown) => value === null || value === undefined || value === '' || value === '__missing__';

const definitionOf = (node: AgeGraphNode, model: SemanticGraph | null): SemanticNodeType | undefined => {
  const conceptId = node.properties.concept_id;
  return model?.nodes.find((concept) => concept.id === conceptId)
    ?? model?.nodes.find((concept) => concept.key === node.label || concept.label === node.label);
};

/** Reads the loaded graph once: records with their fields' names, links, concepts and how linked each record is. */
export function buildGraphIndex(nodes: AgeGraphNode[], edges: AgeGraphEdge[], model: SemanticGraph | null): GraphIndex {
  const records: GraphRecord[] = nodes.map((node) => {
    const definition = definitionOf(node, model);
    const meta = node.properties._meta as { nodeTypeLabel?: string; attributes?: Array<{ key: string; value: unknown }> } | undefined;
    const fields = (meta?.attributes ?? []).map((attribute) => {
      const known = definition?.attributes.find((item) => item.key === attribute.key);
      return { key: attribute.key, label: known?.label ?? attribute.key.replaceAll('_', ' '), type: known?.type ?? 'text', value: attribute.value, missing: isMissing(attribute.value) };
    });
    return {
      id: node.id,
      concept: definition?.key ?? node.label,
      conceptLabel: definition?.label ?? meta?.nodeTypeLabel ?? node.label.replaceAll('_', ' '),
      label: String(node.properties.record_label ?? node.id),
      fields,
      missing: fields.filter((field) => field.missing).length,
      raw: node,
    };
  });
  const byId = new Map(records.map((record) => [record.id, record]));
  const links: GraphLink[] = edges.filter((edge) => byId.has(edge.sourceId) && byId.has(edge.targetId)).map((edge) => ({
    id: edge.id, source: edge.sourceId, target: edge.targetId, relation: edge.label,
    label: model?.relations.find((relation) => relation.id === edge.label || relation.key === edge.label)?.label ?? edge.label.replaceAll('_', ' '),
  }));
  const linksOf = new Map<string, GraphLink[]>(records.map((record) => [record.id, []]));
  for (const link of links) {
    linksOf.get(link.source)!.push(link);
    if (link.target !== link.source) linksOf.get(link.target)!.push(link);
  }
  const degree = new Map(records.map((record) => [record.id, linksOf.get(record.id)!.length]));
  const concepts = new Map<string, GraphConcept>();
  for (const record of records) {
    const concept = concepts.get(record.concept) ?? { key: record.concept, label: record.conceptLabel, count: 0 };
    concept.count++;
    concepts.set(record.concept, concept);
  }
  return { records, byId, links, linksOf, concepts: [...concepts.values()], degree };
}

export const otherEnd = (link: GraphLink, id: string) => (link.source === id ? link.target : link.source);

/** The records within `depth` links of the start, either way. */
export function neighbourhood(index: GraphIndex, start: string, depth: number): Map<string, number> {
  const seen = new Map([[start, 0]]);
  let frontier = [start];
  for (let step = 1; step <= depth && frontier.length; step++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const link of index.linksOf.get(id) ?? []) {
        const other = otherEnd(link, id);
        if (!seen.has(other)) { seen.set(other, step); next.push(other); }
      }
    }
    frontier = next;
  }
  return seen;
}

/** The fewest links from one record to another, whatever their direction; null when they are not connected. */
export function shortestPath(index: GraphIndex, from: string, to: string): { records: string[]; links: GraphLink[] } | null {
  if (!index.byId.has(from) || !index.byId.has(to)) return null;
  if (from === to) return { records: [from], links: [] };
  const came = new Map<string, GraphLink | null>([[from, null]]);
  const queue = [from];
  while (queue.length) {
    const id = queue.shift()!;
    for (const link of index.linksOf.get(id) ?? []) {
      const other = otherEnd(link, id);
      if (came.has(other)) continue;
      came.set(other, link);
      if (other === to) {
        const records = [to];
        const links: GraphLink[] = [];
        let at = to;
        while (at !== from) {
          const via = came.get(at)!;
          links.unshift(via);
          at = otherEnd(via, at);
          records.unshift(at);
        }
        return { records, links };
      }
      queue.push(other);
    }
  }
  return null;
}

/** Linked records grouped by relationship, direction and the other concept: "contient → 4 Pièce jointe". */
export function linkGroups(index: GraphIndex, id: string) {
  const groups = new Map<string, { relation: string; label: string; outgoing: boolean; conceptLabel: string; records: GraphRecord[] }>();
  for (const link of index.linksOf.get(id) ?? []) {
    const other = index.byId.get(otherEnd(link, id))!;
    const outgoing = link.source === id;
    const key = `${link.relation}|${outgoing}|${other.concept}`;
    const group = groups.get(key) ?? { relation: link.relation, label: link.label, outgoing, conceptLabel: other.conceptLabel, records: [] };
    if (!group.records.includes(other)) group.records.push(other);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.records.length - a.records.length);
}

/** How often each field of a concept holds a value. */
export function fieldCompleteness(index: GraphIndex, concept: string) {
  const records = index.records.filter((record) => record.concept === concept);
  const fields = new Map<string, { key: string; label: string; filled: number; missing: string[] }>();
  for (const record of records) {
    for (const field of record.fields) {
      const entry = fields.get(field.key) ?? { key: field.key, label: field.label, filled: 0, missing: [] };
      if (field.missing) entry.missing.push(record.id); else entry.filled++;
      fields.set(field.key, entry);
    }
  }
  return { total: records.length, fields: [...fields.values()].sort((a, b) => a.filled - b.filled) };
}

export const unlinkedRecords = (index: GraphIndex) => index.records.filter((record) => !index.degree.get(record.id));

export const mostLinked = (index: GraphIndex, limit = 10) =>
  [...index.records].filter((record) => index.degree.get(record.id)).sort((a, b) => index.degree.get(b.id)! - index.degree.get(a.id)! || a.label.localeCompare(b.label)).slice(0, limit);

/** Pairs of concepts linked by at least one link, for "count B per A". */
export function linkedConceptPairs(index: GraphIndex) {
  const pairs = new Set<string>();
  for (const link of index.links) {
    const a = index.byId.get(link.source)!.concept;
    const b = index.byId.get(link.target)!.concept;
    if (a !== b) { pairs.add(`${a}|${b}`); pairs.add(`${b}|${a}`); }
  }
  return [...pairs].map((pair) => { const [group, counted] = pair.split('|'); return { group, counted }; });
}

/** For each record of `group`, how many different records of `counted` are linked to it. */
export function countPer(index: GraphIndex, group: string, counted: string) {
  return index.records.filter((record) => record.concept === group).map((record) => {
    const others = new Set((index.linksOf.get(record.id) ?? []).map((link) => otherEnd(link, record.id)).filter((other) => index.byId.get(other)!.concept === counted));
    return { record, count: others.size };
  }).filter((row) => row.count > 0).sort((a, b) => b.count - a.count || a.record.label.localeCompare(b.record.label));
}

/** A value read as a date, when it is one. */
export function asDate(value: unknown): Date | null {
  if (isMissing(value)) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}(-\d{2})?([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(text)) return null;
  const date = new Date(text.length === 7 ? `${text}-01` : text);
  return Number.isNaN(date.getTime()) ? null : date;
}

export interface DateField { concept: string; conceptLabel: string; key: string; label: string; dated: number }

/** Fields holding dates: declared as dates, or text fields whose values mostly read as dates. */
export function dateFields(index: GraphIndex): DateField[] {
  const found = new Map<string, DateField & { values: number }>();
  for (const record of index.records) {
    for (const field of record.fields) {
      if (field.type !== 'date' && field.type !== 'text') continue;
      const id = `${record.concept}|${field.key}`;
      const entry = found.get(id) ?? { concept: record.concept, conceptLabel: record.conceptLabel, key: field.key, label: field.label, dated: 0, values: 0, declared: field.type === 'date' } as DateField & { values: number; declared?: boolean };
      if (!field.missing) entry.values++;
      if (asDate(field.value)) entry.dated++;
      found.set(id, entry);
    }
  }
  return [...found.values()]
    .filter((entry) => entry.dated > 0 && entry.dated >= entry.values * 0.8)
    .map(({ concept, conceptLabel, key, label, dated }) => ({ concept, conceptLabel, key, label, dated }));
}

export const monthKey = (date: Date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

/** Records of a concept per month of a date field, every month between the first and the last. */
export function monthlyCounts(index: GraphIndex, concept: string, field: string) {
  const counts = new Map<string, string[]>();
  for (const record of index.records) {
    if (record.concept !== concept) continue;
    const date = asDate(record.fields.find((item) => item.key === field)?.value);
    if (!date) continue;
    const month = monthKey(date);
    counts.set(month, [...(counts.get(month) ?? []), record.id]);
  }
  const months = [...counts.keys()].sort();
  if (!months.length) return [];
  const rows: Array<{ month: string; records: string[] }> = [];
  let [year, month] = months[0].split('-').map(Number);
  const last = months[months.length - 1];
  for (;;) {
    const key = `${year}-${String(month).padStart(2, '0')}`;
    rows.push({ month: key, records: counts.get(key) ?? [] });
    if (key === last || rows.length > 600) break;
    month++;
    if (month > 12) { month = 1; year++; }
  }
  return rows;
}

/** Folds accents and case, so "fevrier" finds "Février". */
export const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Records whose name, or else one of whose values, holds the words typed; names first. */
export function searchRecords(index: GraphIndex, query: string, limit = 8) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const scored: Array<{ record: GraphRecord; score: number; field?: GraphField }> = [];
  for (const record of index.records) {
    const name = fold(record.label);
    if (words.every((word) => name.includes(word))) { scored.push({ record, score: name.startsWith(words[0]) ? 0 : 1 }); continue; }
    const field = record.fields.find((item) => !item.missing && words.every((word) => fold(String(item.value)).includes(word)));
    if (field) scored.push({ record, score: 2, field });
  }
  return scored.sort((a, b) => a.score - b.score || a.record.label.localeCompare(b.record.label)).slice(0, limit);
}

/**
 * The records drawn: concepts not hidden, near the focused record when there is one, and inside the period kept —
 * dated records outside it are left out, with the records linked only to them. `keep` is drawn whatever the filters.
 */
export function shownRecords(index: GraphIndex, { hidden, near, period, keep }: Readonly<{
  hidden: Set<string>;
  near?: Map<string, number> | null;
  period?: { concept: string; field: string; from: string; to: string } | null;
  keep?: string | null;
}>): Set<string> {
  const outOfPeriod = new Set<string>();
  if (period) {
    for (const record of index.records) {
      if (record.concept !== period.concept) continue;
      const date = asDate(record.fields.find((field) => field.key === period.field)?.value);
      const month = date ? monthKey(date) : null;
      if (!month || month < period.from || month > period.to) outOfPeriod.add(record.id);
    }
    for (const record of index.records) {
      const links = index.linksOf.get(record.id) ?? [];
      if (record.concept !== period.concept && links.length && links.every((link) => outOfPeriod.has(otherEnd(link, record.id)))) outOfPeriod.add(record.id);
    }
  }
  return new Set(index.records.filter((record) => record.id === keep
    || (!hidden.has(record.concept) && (!near || near.has(record.id)) && !outOfPeriod.has(record.id))).map((record) => record.id));
}
