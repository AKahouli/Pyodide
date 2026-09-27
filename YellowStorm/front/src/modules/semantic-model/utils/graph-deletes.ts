import type { SemanticGraph, SemanticGraphOperation } from '../types';

export interface GraphDeletion {
  operations: SemanticGraphOperation[];
  update: (graph: SemanticGraph) => SemanticGraph;
}

/** Delete a concept with everything that hangs off it: its relationships, typed records and their links. */
export function conceptDeletion(graph: SemanticGraph, conceptId: string): GraphDeletion {
  const relationIds = new Set(graph.relations.filter((relation) => relation.sourceNodeTypeId === conceptId || relation.targetNodeTypeId === conceptId).map((relation) => relation.id));
  const recordIds = new Set(graph.records.filter((record) => record.nodeTypeId === conceptId).map((record) => record.id));
  const recordRelationIds = new Set(graph.recordRelations.filter((link) => relationIds.has(link.relationTypeId) || recordIds.has(link.sourceRecordId) || recordIds.has(link.targetRecordId)).map((link) => link.id));
  return {
    operations: [
      ...[...recordRelationIds].map((id) => ({ type: 'record_relation.delete' as const, id })),
      ...[...recordIds].map((id) => ({ type: 'record.delete' as const, id })),
      ...[...relationIds].map((id) => ({ type: 'relation_type.delete' as const, id })),
      { type: 'node_type.delete' as const, id: conceptId },
    ],
    update: (current) => ({
      ...current,
      nodes: current.nodes.filter((node) => node.id !== conceptId),
      relations: current.relations.filter((relation) => !relationIds.has(relation.id)),
      records: current.records.filter((record) => !recordIds.has(record.id)),
      recordRelations: current.recordRelations.filter((link) => !recordRelationIds.has(link.id)),
    }),
  };
}

/** Delete a relationship and the record links made with it. */
export function relationDeletion(graph: SemanticGraph, relationId: string): GraphDeletion {
  const recordRelationIds = new Set(graph.recordRelations.filter((link) => link.relationTypeId === relationId).map((link) => link.id));
  return {
    operations: [
      ...[...recordRelationIds].map((id) => ({ type: 'record_relation.delete' as const, id })),
      { type: 'relation_type.delete' as const, id: relationId },
    ],
    update: (current) => ({
      ...current,
      relations: current.relations.filter((relation) => relation.id !== relationId),
      recordRelations: current.recordRelations.filter((link) => !recordRelationIds.has(link.id)),
    }),
  };
}

/** Delete the records typed by hand for a concept, and the links made with them. */
export function typedRecordsDeletion(graph: SemanticGraph, conceptId: string): GraphDeletion & { count: number } {
  const recordIds = new Set(graph.records.filter((record) => record.nodeTypeId === conceptId).map((record) => record.id));
  const recordRelationIds = new Set(graph.recordRelations.filter((link) => recordIds.has(link.sourceRecordId) || recordIds.has(link.targetRecordId)).map((link) => link.id));
  return {
    count: recordIds.size,
    operations: [
      ...[...recordRelationIds].map((id) => ({ type: 'record_relation.delete' as const, id })),
      ...[...recordIds].map((id) => ({ type: 'record.delete' as const, id })),
    ],
    update: (current) => ({
      ...current,
      records: current.records.filter((record) => !recordIds.has(record.id)),
      recordRelations: current.recordRelations.filter((link) => !recordRelationIds.has(link.id)),
    }),
  };
}
