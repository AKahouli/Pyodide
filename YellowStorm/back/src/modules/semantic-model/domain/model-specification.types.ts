// P1.1-P1.5: executable specification contracts (additive, no table rewrite).
// Reuses existing AttributeDefinition / SemanticNodeType / SemanticRelationType shapes;
// adds only what population needs: stable identity, population mode, typed filters.

export type PopulationMode = 'materialized' | 'filtered_materialized' | 'query_backed';

export type FilterOp = 'eq' | 'neq' | 'in' | 'not_in' | 'is_null' | 'is_not_null';

export interface FieldFilter {
  field: string;
  op: FilterOp;
  value?: unknown;
}

export interface FilterGroup {
  all?: FilterNode[];
  any?: FilterNode[];
  not?: FilterNode;
}

export type FilterNode = FieldFilter | FilterGroup;

export interface IdentityRule {
  namespace: string;
  keyComponents: string[];
}

export interface ConceptSpec {
  conceptId: string; // stable immutable id (existing node id)
  key: string; // stable machine key, unique per model
  label: string; // editable display label, never used as executable id
  identity: IdentityRule;
  populationMode: PopulationMode;
  eligibility?: FilterNode | null; // forbidden rows outside this filter
  materialization?: FilterNode | null; // subset prepared into graph; null = all eligible
  allowedFields: string[];
}

export interface RelationSpec {
  relationId: string; // stable immutable id (existing relation id)
  key: string;
  label: string;
  sourceConceptId: string;
  targetConceptId: string;
  cardinality: 'one_to_one' | 'one_to_many' | 'many_to_one' | 'many_to_many';
  matchingStrategy: 'exact' | 'case_insensitive' | 'normalized';
}

export type ReadinessState =
  | 'definition_valid'
  | 'data_prepared'
  | 'reviews_pending'
  | 'published_active';

export interface ModelSpecification {
  modelId: string;
  modelVersionId: string;
  homeWorkspaceId: string;
  concepts: ConceptSpec[];
  relations: RelationSpec[];
  sourceScope: Array<{ workspaceId: string; assetId: string }>;
  specHash?: string;
}

export interface SpecIssue {
  code:
    | 'duplicate_concept_id'
    | 'duplicate_concept_key'
    | 'duplicate_relation_id'
    | 'unknown_relation_endpoint'
    | 'empty_identity_key'
    | 'empty_source_scope'
    | 'empty_allowed_fields'
    | 'unknown_filter_field'
    | 'materialization_without_eligibility';
  targetId?: string;
  message: string;
}
