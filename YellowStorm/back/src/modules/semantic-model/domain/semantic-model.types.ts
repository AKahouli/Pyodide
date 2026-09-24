export const semanticModelKinds = ['workspace_default', 'designed'] as const;
export const semanticModelStatuses = ['draft', 'published', 'archived'] as const;
export const nodeCategories = ['business_object', 'classification', 'system_collection'] as const;
export const recordPolicies = ['none', 'optional', 'expected'] as const;
export const attributeTypes = ['text', 'number', 'boolean', 'date', 'enum'] as const;

export type SemanticModelKind = (typeof semanticModelKinds)[number];
export type SemanticModelStatus = (typeof semanticModelStatuses)[number];
export type NodeCategory = (typeof nodeCategories)[number];
export type RecordPolicy = (typeof recordPolicies)[number];
export type AttributeType = (typeof attributeTypes)[number];

export interface CanvasPosition {
  x: number;
  y: number;
}

export interface AttributeDefinition {
  key: string;
  label: string;
  type: AttributeType;
  required: boolean;
  description?: string;
  options?: string[];
}

export interface SemanticNodeType {
  id: string;
  key: string;
  label: string;
  description: string;
  category: NodeCategory;
  recordPolicy: RecordPolicy;
  systemKey: string | null;
  aliases: string[];
  attributes: AttributeDefinition[];
  position: CanvasPosition;
}

export interface SemanticRelationType {
  id: string;
  key: string;
  label: string;
  inverseLabel: string;
  description: string;
  sourceNodeTypeId: string;
  targetNodeTypeId: string;
  cardinality: 'one_to_one' | 'one_to_many' | 'many_to_one' | 'many_to_many';
  traversable: boolean;
  filterable: boolean;
  attributes: AttributeDefinition[];
}

export interface SemanticRecord {
  id: string;
  nodeTypeId: string;
  label: string;
  values: Record<string, unknown>;
  status: 'active' | 'inactive';
  position: CanvasPosition;
}

export interface SemanticRecordRelation {
  id: string;
  relationTypeId: string;
  sourceRecordId: string;
  targetRecordId: string;
  values: Record<string, unknown>;
}

export type SemanticGraphOperation =
  | { type: 'node_type.create'; entity: SemanticNodeType }
  | { type: 'node_type.update'; id: string; changes: Partial<Omit<SemanticNodeType, 'id' | 'systemKey'>> }
  | { type: 'node_type.delete'; id: string }
  | { type: 'relation_type.create'; entity: SemanticRelationType }
  | { type: 'relation_type.update'; id: string; changes: Partial<Omit<SemanticRelationType, 'id'>> }
  | { type: 'relation_type.delete'; id: string }
  | { type: 'record.create'; entity: SemanticRecord }
  | { type: 'record.update'; id: string; changes: Partial<Omit<SemanticRecord, 'id' | 'nodeTypeId'>> }
  | { type: 'record.delete'; id: string }
  | { type: 'record_relation.create'; entity: SemanticRecordRelation }
  | { type: 'record_relation.update'; id: string; changes: Pick<SemanticRecordRelation, 'values'> }
  | { type: 'record_relation.delete'; id: string }
  | { type: 'layout.update'; positions: Array<{ id: string; position: CanvasPosition }> };

export interface SemanticGraph {
  modelId: string;
  versionId: string;
  revision: number;
  nodes: SemanticNodeType[];
  relations: SemanticRelationType[];
  records: SemanticRecord[];
  recordRelations: SemanticRecordRelation[];
}

export interface ValidationIssue {
  code: string;
  severity: 'error' | 'warning';
  targetKind: 'model' | 'node_type' | 'relation_type' | 'record' | 'binding' | 'workspace';
  targetId?: string;
  /** Business name of the target, so a finding never reads as anonymous. */
  targetLabel?: string;
  message: string;
}
