import { describe, expect, it } from 'vitest';
import type { AgeGraphEdge, AgeGraphNode, SemanticGraph } from '../../types';
import {
  buildGraphIndex, countPer, shownRecords, dateFields, fieldCompleteness, linkGroups, monthlyCounts, mostLinked, neighbourhood, searchRecords, shortestPath, unlinkedRecords,
} from './graph-analytics';

const node = (id: string, concept: string, label: string, values: Record<string, unknown>): AgeGraphNode => ({
  id, label: concept, properties: { record_label: label, ...values, _meta: { nodeTypeLabel: concept, attributes: Object.entries(values).map(([key, value]) => ({ key, label: key, value })) } },
});
const edge = (id: string, sourceId: string, targetId: string, label: string): AgeGraphEdge => ({ id, label, sourceId, targetId, properties: {} });

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
const index = buildGraphIndex(nodes, edges, model);

describe('graph analytics', () => {
  it('names fields, concepts and links as people read them', () => {
    const mail = index.byId.get('m1')!;
    expect(mail.conceptLabel).toBe('Message');
    expect(mail.fields.map((field) => field.label)).toEqual(['Subject', 'Sent on']);
    expect(index.byId.get('m3')!.missing).toBe(2);
    expect(index.links[0].label).toBe('sent by');
    expect(index.concepts).toEqual([{ key: 'mail', label: 'Message', count: 3 }, { key: 'person', label: 'Correspondent', count: 2 }, { key: 'file', label: 'Attachment', count: 2 }]);
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

  it('searches names first, then values, ignoring accents and case', () => {
    expect(searchRecords(index, 'ana').map((hit) => hit.record.id)).toEqual(['p1']);
    const hit = searchRecords(index, 'fevrier')[0];
    expect(hit.record.id).toBe('m2');
    expect(hit.field?.label).toBe('Subject');
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
