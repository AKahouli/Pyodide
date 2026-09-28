import type {
  CanvasPosition,
  SemanticGraph,
  SemanticGraphOperation,
  SemanticNodeType,
  SemanticRecord,
  SemanticRecordRelation,
  SemanticRelationType,
} from './semantic-model.types';

/**
 * The graph operations that turn one draft graph into another. Used to undo and redo a change made
 * by the assistant: what the server keeps is changed with ordinary, validated graph operations.
 */

const NODE_FIELDS = ['key', 'label', 'description', 'category', 'recordPolicy', 'aliases', 'attributes'] as const;
const RELATION_FIELDS = ['key', 'label', 'inverseLabel', 'description', 'sourceNodeTypeId', 'targetNodeTypeId', 'cardinality', 'traversable', 'filterable', 'attributes'] as const;
const RECORD_FIELDS = ['label', 'values', 'status'] as const;
const origin: CanvasPosition = { x: 0, y: 0 };

const same = (left: unknown, right: unknown) => left === right || JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

function changedFields<T extends object, K extends keyof T>(from: T, to: T, fields: readonly K[]): Partial<Pick<T, K>> {
  const changes: Partial<Pick<T, K>> = {};
  for (const field of fields) if (!same(from[field], to[field])) changes[field] = to[field];
  return changes;
}

const nodeEntity = (node: SemanticNodeType): SemanticNodeType => ({
  id: node.id, key: node.key, label: node.label, description: node.description, category: node.category, recordPolicy: node.recordPolicy,
  systemKey: null, aliases: node.aliases ?? [], attributes: node.attributes ?? [], position: node.position ?? origin,
});
const relationEntity = (relation: SemanticRelationType): SemanticRelationType => ({
  id: relation.id, key: relation.key, label: relation.label, inverseLabel: relation.inverseLabel, description: relation.description,
  sourceNodeTypeId: relation.sourceNodeTypeId, targetNodeTypeId: relation.targetNodeTypeId, cardinality: relation.cardinality,
  traversable: relation.traversable, filterable: relation.filterable, attributes: relation.attributes ?? [],
});
const recordEntity = (record: SemanticRecord): SemanticRecord => ({
  id: record.id, nodeTypeId: record.nodeTypeId, label: record.label, values: record.values ?? {}, status: record.status, position: record.position ?? origin,
});
const recordRelationEntity = (link: SemanticRecordRelation): SemanticRecordRelation => ({
  id: link.id, relationTypeId: link.relationTypeId, sourceRecordId: link.sourceRecordId, targetRecordId: link.targetRecordId, values: link.values ?? {},
});

/** Removals first (links before what they join), then additions (parents first), then changes and moves. */
export function graphDiff(from: SemanticGraph, to: SemanticGraph): SemanticGraphOperation[] {
  const byId = <T extends { id: string }>(items: T[]) => new Map(items.map((item) => [item.id, item]));
  const fromNodes = byId(from.nodes), toNodes = byId(to.nodes);
  const fromRelations = byId(from.relations), toRelations = byId(to.relations);
  const fromRecords = byId(from.records), toRecords = byId(to.records);
  const fromLinks = byId(from.recordRelations), toLinks = byId(to.recordRelations);
  const removals: SemanticGraphOperation[] = [];
  const additions: SemanticGraphOperation[] = [];
  const changes: SemanticGraphOperation[] = [];
  const positions: Array<{ id: string; position: CanvasPosition }> = [];
  const linkReplaced = (link: SemanticRecordRelation) => {
    const next = toLinks.get(link.id);
    return Boolean(next && (next.relationTypeId !== link.relationTypeId || next.sourceRecordId !== link.sourceRecordId || next.targetRecordId !== link.targetRecordId));
  };

  for (const link of from.recordRelations) if (!toLinks.has(link.id) || linkReplaced(link)) removals.push({ type: 'record_relation.delete', id: link.id });
  for (const record of from.records) if (!toRecords.has(record.id) || toRecords.get(record.id)!.nodeTypeId !== record.nodeTypeId) removals.push({ type: 'record.delete', id: record.id });
  for (const relation of from.relations) if (!toRelations.has(relation.id)) removals.push({ type: 'relation_type.delete', id: relation.id });
  for (const node of from.nodes) if (!toNodes.has(node.id)) removals.push({ type: 'node_type.delete', id: node.id });

  for (const node of to.nodes) {
    const before = fromNodes.get(node.id);
    if (!before) { additions.push({ type: 'node_type.create', entity: nodeEntity(node) }); continue; }
    const changed = changedFields(before, node, NODE_FIELDS);
    if (Object.keys(changed).length) changes.push({ type: 'node_type.update', id: node.id, changes: changed });
    if (!same(before.position, node.position) && node.position) positions.push({ id: node.id, position: node.position });
  }
  for (const relation of to.relations) {
    const before = fromRelations.get(relation.id);
    if (!before) { additions.push({ type: 'relation_type.create', entity: relationEntity(relation) }); continue; }
    const changed = changedFields(before, relation, RELATION_FIELDS);
    if (Object.keys(changed).length) changes.push({ type: 'relation_type.update', id: relation.id, changes: changed });
  }
  for (const record of to.records) {
    const before = fromRecords.get(record.id);
    if (!before || before.nodeTypeId !== record.nodeTypeId) { additions.push({ type: 'record.create', entity: recordEntity(record) }); continue; }
    const changed = changedFields(before, record, RECORD_FIELDS);
    if (Object.keys(changed).length) changes.push({ type: 'record.update', id: record.id, changes: changed });
    if (!same(before.position, record.position) && record.position) positions.push({ id: record.id, position: record.position });
  }
  for (const link of to.recordRelations) {
    const before = fromLinks.get(link.id);
    if (!before || linkReplaced(before)) { additions.push({ type: 'record_relation.create', entity: recordRelationEntity(link) }); continue; }
    if (!same(before.values, link.values)) changes.push({ type: 'record_relation.update', id: link.id, changes: { values: link.values ?? {} } });
  }
  return [...removals, ...additions, ...changes, ...(positions.length ? [{ type: 'layout.update' as const, positions }] : [])];
}
