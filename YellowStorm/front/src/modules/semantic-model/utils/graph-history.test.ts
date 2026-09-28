import { describe, expect, it } from 'vitest';
import type { SemanticGraph } from '../types';
import { conceptDeletion } from './graph-deletes';
import { applyGraphOperations, graphDiff } from './graph-history';

const node = (id: string, label = id) => ({ id, key: id, label, description: '', category: 'business_object' as const, recordPolicy: 'optional' as const, systemKey: null, aliases: [], attributes: [], position: { x: 0, y: 0 } });
const graph: SemanticGraph = {
  modelId: 'm', versionId: 'v', revision: 1,
  nodes: [node('customer'), node('contract')],
  relations: [{ id: 'signs', key: 'signs', label: 'signs', inverseLabel: '', description: '', sourceNodeTypeId: 'customer', targetNodeTypeId: 'contract', cardinality: 'one_to_many', traversable: true, filterable: true, attributes: [] }],
  records: [{ id: 'r1', nodeTypeId: 'customer', label: 'Acme', values: {}, status: 'active', position: { x: 1, y: 1 } }, { id: 'r2', nodeTypeId: 'contract', label: 'C-1', values: {}, status: 'active', position: { x: 2, y: 2 } }],
  recordRelations: [{ id: 'l1', relationTypeId: 'signs', sourceRecordId: 'r1', targetRecordId: 'r2', values: {} }],
};

describe('graphDiff', () => {
  it('puts back a deleted concept with everything that hung off it, parents before children', () => {
    const deletion = conceptDeletion(graph, 'customer');
    const after = deletion.update(graph);
    const back = graphDiff(after, graph);
    expect(back.map((operation) => operation.type)).toEqual(['node_type.create', 'relation_type.create', 'record.create', 'record_relation.create']);
    expect(applyGraphOperations(after, back)).toEqual({ ...graph, nodes: [graph.nodes[1], graph.nodes[0]], records: [graph.records[1], graph.records[0]] });
  });

  it('removes links before what they join, and turns edits and moves into updates', () => {
    const edited: SemanticGraph = { ...graph, nodes: [{ ...node('customer', 'Client'), position: { x: 5, y: 6 } }, graph.nodes[1]], relations: [], recordRelations: [] };
    expect(graphDiff(graph, edited)).toEqual([
      { type: 'record_relation.delete', id: 'l1' },
      { type: 'relation_type.delete', id: 'signs' },
      { type: 'node_type.update', id: 'customer', changes: { label: 'Client' } },
      { type: 'layout.update', positions: [{ id: 'customer', position: { x: 5, y: 6 } }] },
    ]);
    expect(graphDiff(graph, graph)).toEqual([]);
  });
});
