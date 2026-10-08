import { graphExport, graphOutline, graphRecordValues, searchGraphValues, type OutlineSourceGraph } from './graph-outline';

const graph: OutlineSourceGraph = {
  dataRevisionId: 'rev-1',
  specification: { concepts: [{ conceptId: 'c-mail', allowedFields: ['sujet', 'corps', 'envoyé le', 'cle'] }, { conceptId: 'c-person', allowedFields: ['nom'] }] },
  nodes: [
    { id: 'm1', label: 'mail', properties: { concept_id: 'c-mail', record_label: 'Hello', sujet: 'Facture février', corps: 'x'.repeat(500), envoy__le: '2026-03-02T10:00:00Z', cle: '__missing__', source_file_name: 'a.eml' } },
    { id: 'p1', label: 'person', properties: { concept_id: 'c-person', record_label: 'Ana', nom: 'Ana' } },
  ],
  edges: [
    { id: 'e1', label: 'r-sent', sourceId: 'm1', targetId: 'p1', properties: {} },
    { id: 'e2', label: 'r-sent', sourceId: 'm1', targetId: 'gone', properties: {} },
  ],
};

describe('graph outline', () => {
  it('keeps names, missing fields and dates, not values, and drops links to records not in the graph', () => {
    const outline = graphOutline(graph);
    expect(outline.records[0]).toEqual({ id: 'm1', c: 'c-mail', l: 'Hello', m: ['cle'], d: { 'envoyé le': '2026-03-02T10:00:00Z' } });
    expect(outline.records[1]).toEqual({ id: 'p1', c: 'c-person', l: 'Ana' });
    expect(outline.links).toEqual([{ id: 'e1', r: 'r-sent', s: 'm1', t: 'p1' }]);
    expect(JSON.stringify(outline)).not.toContain('xxxx');
  });

  it('reads one record with its values and file', () => {
    expect(graphRecordValues(graph, 'm1')).toMatchObject({ values: { sujet: 'Facture février', cle: '__missing__' }, sourceFileName: 'a.eml' });
    expect(graphRecordValues(graph, 'nope')).toBeNull();
  });

  it('finds records by a value, ignoring accents and case', () => {
    expect(searchGraphValues(graph, 'FEVRIER')).toEqual([{ id: 'm1', field: 'sujet', value: 'Facture février' }]);
    expect(searchGraphValues(graph, 'nothing')).toEqual([]);
  });

  it('exports each field whole, shortened or left out; unchosen fields are shortened', () => {
    const content = graphExport(graph, { 'c-mail': { sujet: 'full', cle: 'exclude' } }, 200);
    const mail = content.records[0].v;
    expect(mail.sujet).toBe('Facture février');
    expect(mail).not.toHaveProperty('cle');
    expect(String(mail.corps)).toHaveLength(201);
    expect(content.records[1].v).toEqual({ nom: 'Ana' });
  });
});
