import { describe, expect, it } from 'vitest';
import type { GraphOutline, SemanticGraph } from '../../types';
import {
  buildGraphIndex, countPer, mergeOutlines, shownRecords, dateFields, fieldCompleteness, linkGroups, monthlyCounts, mostLinked, neighbourhood, searchRecords, shortestPath, unlinkedRecords, unreadLinks,
} from './graph-analytics';

const FIELDS: Record<string, string[]> = { 'c-mail': ['sujet', 'envoye_le'], 'c-person': ['nom'], 'c-file': ['nom_fichier'] };
const DATE = /^\d{4}-\d{2}/;
const node = (id: string, concept: string, label: string, values: Record<string, unknown>): GraphOutline['records'][number] => {
  const m = FIELDS[`c-${concept}`].filter((key) => values[key] === null || values[key] === '' || values[key] === '__missing__');
  const d = Object.fromEntries(Object.entries(values).filter(([, value]) => typeof value === 'string' && DATE.test(value)));
  return { id, c: `c-${concept}`, l: label, ...(m.length ? { m } : {}), ...(Object.keys(d).length ? { d: d as Record<string, string> } : {}) };
};
const edge = (id: string, s: string, t: string, r: string) => ({ id, r, s, t });

const model = {
  nodes: [
    { id: 'c-mail', key: 'mail', label: 'Message', attributes: [{ key: 'sujet', label: 'Subject', type: 'text' }, { key: 'envoye_le', label: 'Sent on', type: 'date' }] },
    { id: 'c-person', key: 'person', label: 'Correspondent', attributes: [{ key: 'nom', label: 'Name', type: 'text' }] },
    { id: 'c-file', key: 'file', label: 'Attachment', attributes: [{ key: 'nom_fichier', label: 'File name', type: 'text' }] },
  ],
  relations: [{ id: 'r-sent', key: 'sent', label: 'sent by' }, { id: 'r-has', key: 'has', label: 'contains' }],
} as unknown as SemanticGraph;

const nodes = [
  node('m1', 'mail', 'Hello', { sujet: 'Hello', envoye_le: '2026-01-15' }),
  node('m2', 'mail', 'Invoice', { sujet: 'Invoice février', envoye_le: '2026-03-02T10:00:00Z' }),
  node('m3', 'mail', 'Draft', { sujet: '', envoye_le: '__missing__' }),
  node('p1', 'person', 'Ana', { nom: 'Ana' }),
  node('p2', 'person', 'Bo', { nom: 'Bo' }),
  node('f1', 'file', 'a.pdf', { nom_fichier: 'a.pdf' }),
  node('f9', 'file', 'lost.pdf', { nom_fichier: null }),
];
const edges = [
  edge('e1', 'm1', 'p1', 'r-sent'), edge('e2', 'm2', 'p1', 'r-sent'), edge('e3', 'm3', 'p2', 'r-sent'),
  edge('e4', 'm2', 'f1', 'r-has'),
];
const index = buildGraphIndex({ concepts: Object.entries(FIELDS).map(([id, fields]) => ({ id, fields })), records: nodes, links: edges }, model);

describe('graph analytics', () => {
  it('counts the links of a record not read yet from the server count and the links read', () => {
    const counted = buildGraphIndex({
      concepts: [{ id: 'c-mail', fields: [] }, { id: 'c-person', fields: [] }],
      records: [{ id: 'm1', c: 'c-mail', l: 'Hello', n: 4 }, { id: 'p1', c: 'c-person', l: 'Ana', n: 1 }, { id: 'p2', c: 'c-person', l: 'Bo' }],
      links: [edge('e1', 'm1', 'p1', 'r-sent')],
    }, null);
    expect(counted.byId.get('m1')!.linkTotal).toBe(4);
    expect(unreadLinks(counted, counted.byId.get('m1')!)).toBe(3);
    // Every link read, or no count from the server: nothing unread.
    expect(unreadLinks(counted, counted.byId.get('p1')!)).toBe(0);
    expect(counted.byId.get('p2')!.linkTotal).toBeNull();
    expect(unreadLinks(counted, counted.byId.get('p2')!)).toBe(0);
    // Against the records shown, a link to one left out is still to be shown.
    expect(unreadLinks(counted, counted.byId.get('m1')!, new Set(['m1']))).toBe(4);
    expect(unreadLinks(counted, counted.byId.get('m1')!, new Set(['m1', 'p1']))).toBe(3);
    expect(unreadLinks(counted, counted.byId.get('p1')!, new Set(['p1']))).toBe(1);
  });

  it('names fields, concepts and links as people read them', () => {
    const mail = index.byId.get('m1')!;
    expect(mail.conceptLabel).toBe('Message');
    expect(mail.fields.map((field) => field.label)).toEqual(['Subject', 'Sent on']);
    expect(index.byId.get('m3')!.missing).toBe(2);
    expect(index.links[0].label).toBe('sent by');
    expect(index.concepts).toEqual([{ key: 'mail', conceptId: 'c-mail', label: 'Message', count: 3 }, { key: 'person', conceptId: 'c-person', label: 'Correspondent', count: 2 }, { key: 'file', conceptId: 'c-file', label: 'Attachment', count: 2 }]);
  });

  it('groups linked records by relationship and direction', () => {
    expect(linkGroups(index, 'p1')).toEqual([expect.objectContaining({ label: 'sent by', outgoing: false, conceptLabel: 'Message', records: [index.byId.get('m1'), index.byId.get('m2')] })]);
  });

  it('walks neighbourhoods and finds the shortest path either way', () => {
    expect([...neighbourhood(index, 'p1', 1).keys()].sort()).toEqual(['m1', 'm2', 'p1']);
    expect(neighbourhood(index, 'p1', 2).get('f1')).toBe(2);
    expect(shortestPath(index, 'm1', 'f1')!.records).toEqual(['m1', 'p1', 'm2', 'f1']);
    expect(shortestPath(index, 'm1', 'p2')).toBeNull();
  });

  it('measures completeness, unlinked and most linked records', () => {
    const files = fieldCompleteness(index, 'file');
    expect(files.total).toBe(2);
    expect(files.fields[0]).toMatchObject({ label: 'File name', filled: 1, missing: ['f9'] });
    expect(unlinkedRecords(index).map((record) => record.id)).toEqual(['f9']);
    expect(mostLinked(index, 2).map((record) => record.id)).toEqual(['p1', 'm2']);
  });

  it('counts linked records of one concept per record of another', () => {
    expect(countPer(index, 'person', 'mail').map((row) => [row.record.id, row.count])).toEqual([['p1', 2], ['p2', 1]]);
  });

  it('finds date fields and counts records per month, empty months included', () => {
    expect(dateFields(index)).toEqual([expect.objectContaining({ concept: 'mail', key: 'envoye_le', dated: 2 })]);
    expect(monthlyCounts(index, 'mail', 'envoye_le')).toEqual([
      { month: '2026-01', records: ['m1'] }, { month: '2026-02', records: [] }, { month: '2026-03', records: ['m2'] },
    ]);
  });

  it('searches names, those starting with the words first, ignoring accents and case', () => {
    expect(searchRecords(index, 'ana').map((hit) => hit.record.id)).toEqual(['p1']);
    expect(searchRecords(index, 'PDF').map((hit) => hit.record.id)).toEqual(['f1', 'f9']);
    expect(searchRecords(index, 'fevrier')).toEqual([]);
  });

  it('draws the concepts shown, near the focus, inside the period with what is linked only to it', () => {
    const ids = (set: Set<string>) => [...set].sort();
    expect(ids(shownRecords(index, { hidden: new Set(['file']) }))).toEqual(['m1', 'm2', 'm3', 'p1', 'p2']);
    expect(ids(shownRecords(index, { hidden: new Set(), near: neighbourhood(index, 'p2', 1) }))).toEqual(['m3', 'p2']);
    // Only February–March: m1 (January) and undated m3 leave, and p2, linked only to m3, with them.
    expect(ids(shownRecords(index, { hidden: new Set(), period: { concept: 'mail', field: 'envoye_le', from: '2026-02', to: '2026-03' } })))
      .toEqual(['f1', 'f9', 'm2', 'p1']);
    expect(shownRecords(index, { hidden: new Set(['mail']), keep: 'm1' }).has('m1')).toBe(true);
  });
});

describe('mergeOutlines', () => {
  it('adds the records and links read around a record, keeping the first part and its totals', () => {
    const totals = { records: 9, links: 4, concepts: { 'c-mail': 5, 'c-person': 4 }, relations: { 'r-sent': 4 } };
    const first: GraphOutline = {
      dataRevisionId: 'rev', truncated: true, totals,
      concepts: [{ id: 'c-mail', fields: ['sujet'] }],
      records: [node('m1', 'mail', 'Hello', { sujet: 'Hello' })],
      links: [],
    };
    const more: GraphOutline = {
      dataRevisionId: 'rev', truncated: false, totals: null,
      concepts: [{ id: 'c-mail', fields: ['sujet'] }, { id: 'c-person', fields: ['nom'] }],
      records: [node('m1', 'mail', 'Hello', { sujet: 'Hello' }), node('p1', 'person', 'Ana', { nom: 'Ana' })],
      links: [edge('e1', 'm1', 'p1', 'r-sent')],
    };
    const merged = mergeOutlines(first, more);
    expect(merged.records.map((record) => record.id)).toEqual(['m1', 'p1']);
    expect(merged.links).toHaveLength(1);
    expect(merged.concepts.map((concept) => concept.id)).toEqual(['c-mail', 'c-person']);
    expect(merged).toMatchObject({ truncated: true, totals });
    expect(mergeOutlines(merged, more).records).toHaveLength(2);
  });
});
