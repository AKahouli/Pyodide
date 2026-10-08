import type { AttributeDefinition, GraphOutline, SemanticGraph, SemanticNodeType } from '../../types';

/** One record of the data graph, with what people read about it. Values arrive when the record is opened. */
export interface GraphRecord {
  id: string;
  /** The concept's key: what records of one concept share. */
  concept: string;
  /** The concept's id, as the server names it. */
  conceptId: string;
  conceptLabel: string;
  label: string;
  /** The name folded for search. */
  folded: string;
  fields: GraphField[];
  missing: number;
  /** Values that read as dates, by field key. */
  dates: Record<string, string>;
}

export interface GraphField {
  key: string;
  label: string;
  type: AttributeDefinition['type'];
  /** Undefined until the record's values are read. */
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

/** Folds accents and case, so "fevrier" finds "Février". */
export const fold = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const EMPTY_OUTLINE: GraphOutline = { concepts: [], records: [], links: [] };

/** Reads the outline once: records with their fields' names, links, concepts and how linked each record is. */
export function buildGraphIndex(outline: GraphOutline | null, model: SemanticGraph | null): GraphIndex {
  const { concepts: outlineConcepts, records: rows, links: rawLinks } = outline ?? EMPTY_OUTLINE;
  const fieldsOf = new Map(outlineConcepts.map((concept) => [concept.id, concept.fields]));
  const definitions = new Map<string, SemanticNodeType | undefined>();
  const definitionOf = (conceptId: string) => {
    if (!definitions.has(conceptId)) definitions.set(conceptId, model?.nodes.find((concept) => concept.id === conceptId) ?? model?.nodes.find((concept) => concept.key === conceptId || concept.label === conceptId));
    return definitions.get(conceptId);
  };
  const records: GraphRecord[] = rows.map((row) => {
    const definition = definitionOf(row.c);
    const missingKeys = new Set(row.m ?? []);
    const fields = (fieldsOf.get(row.c) ?? []).map((key) => {
      const known = definition?.attributes.find((item) => item.key === key);
      return { key, label: known?.label ?? key.replaceAll('_', ' '), type: known?.type ?? 'text', value: undefined, missing: missingKeys.has(key) };
    });
    return {
      id: row.id,
      concept: definition?.key ?? row.c,
      conceptId: row.c,
      conceptLabel: definition?.label ?? row.c.replaceAll('_', ' '),
      label: row.l,
      folded: fold(row.l),
      fields,
      missing: missingKeys.size,
      dates: row.d ?? {},
    };
  });
  const byId = new Map(records.map((record) => [record.id, record]));
  const relationLabels = new Map<string, string>();
  const labelOf = (relation: string) => {
    if (!relationLabels.has(relation)) relationLabels.set(relation, model?.relations.find((item) => item.id === relation || item.key === relation)?.label ?? relation.replaceAll('_', ' '));
    return relationLabels.get(relation)!;
  };
  const links: GraphLink[] = rawLinks.filter((link) => byId.has(link.s) && byId.has(link.t))
    .map((link) => ({ id: link.id, source: link.s, target: link.t, relation: link.r, label: labelOf(link.r) }));
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

/** The record with the values read for it. */
export const withValues = (record: GraphRecord, values: Record<string, unknown>): GraphRecord => ({
  ...record,
  fields: record.fields.map((field) => ({ ...field, value: values[field.key], missing: isMissing(values[field.key]) })),
});

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
  const seen = new Set<string>();
  for (const link of index.linksOf.get(id) ?? []) {
    const other = index.byId.get(otherEnd(link, id))!;
    const outgoing = link.source === id;
    const key = `${link.relation}|${outgoing}|${other.concept}`;
    const group = groups.get(key) ?? { relation: link.relation, label: link.label, outgoing, conceptLabel: other.conceptLabel, records: [] };
    if (!seen.has(`${key}|${other.id}`)) { seen.add(`${key}|${other.id}`); group.records.push(other); }
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

/** Fields holding dates: those whose values mostly read as dates. */
export function dateFields(index: GraphIndex): DateField[] {
  const found = new Map<string, DateField & { values: number }>();
  for (const record of index.records) {
    for (const field of record.fields) {
      const id = `${record.concept}|${field.key}`;
      let entry = found.get(id);
      if (!entry) { entry = { concept: record.concept, conceptLabel: record.conceptLabel, key: field.key, label: field.label, dated: 0, values: 0 }; found.set(id, entry); }
      if (!field.missing) entry.values++;
      if (asDate(record.dates[field.key])) entry.dated++;
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
    const date = asDate(record.dates[field]);
    if (!date) continue;
    const month = monthKey(date);
    const bucket = counts.get(month);
    if (bucket) bucket.push(record.id); else counts.set(month, [record.id]);
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

/** A record found by search; `field` and `value` say which value matched when it was not the name. */
export interface SearchHit { record: GraphRecord; score: number; field?: string; value?: string }

/** Records whose name holds the words typed, those starting with them first. Values are searched by the server. */
export function searchRecords(index: GraphIndex, query: string, limit = 8): SearchHit[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const scored: SearchHit[] = [];
  for (const record of index.records) {
    if (words.every((word) => record.folded.includes(word))) scored.push({ record, score: record.folded.startsWith(words[0]) ? 0 : 1 });
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
      const date = asDate(record.dates[period.field]);
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
