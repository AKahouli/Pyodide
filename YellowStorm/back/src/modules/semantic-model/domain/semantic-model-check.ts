import { BadRequestException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import type { AttributeDefinition } from './semantic-model.types';
import type { SourceFieldMapping } from './semantic-source-mapping.types';

/**
 * The model check: every reason a preview or build of the model would be refused or would skip a source,
 * listed together instead of one at a time when a run is prepared. The rules here are the ones the back end
 * enforces while it prepares a run (`planRefresh`), which throws the first issue of each rule; the runtime's
 * own rules come back from `POST /v1/semantic-model-population/check` in the same shape.
 */
export type ModelCheckSeverity = 'error' | 'warning';

export interface ModelCheckIssue {
  severity: ModelCheckSeverity;
  /** Stable code the front end translates. A runtime code (`unmapped_identity`, `invalid_column_mapping`...) or a back end one. */
  code: string;
  /** Refines the code (which part of a mapping is wrong). */
  reason?: string;
  /** English text, for a code the front end has no words for. */
  message: string;
  conceptId?: string;
  /** The concept's field (its attribute key). */
  fieldId?: string;
  relationId?: string;
  mappingId?: string;
  /** A derived source. */
  sourceId?: string;
  params?: Record<string, string | number>;
}

export interface ModelCheck {
  modelId: string;
  /** Identifies what was checked (draft version, mappings, rules, limits): equal keys, equal answers. */
  versionKey: string;
  checkedAt: string;
  errorCount: number;
  warningCount: number;
  issues: ModelCheckIssue[];
}

/** A refusal that carries its issues; to a caller that only reads the message it is a validation failure. */
/** How many issues an answer carries in its details. */
const MAX_ISSUE_DETAILS = 10;

export class ModelIssueException extends BadRequestException {
  constructor(readonly issues: ModelCheckIssue[]) {
    // The issues travel with the answer, so a caller can say which part of the model is refused and why.
    super(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, issues[0]?.message ?? 'The model cannot be checked',
      issues.slice(0, MAX_ISSUE_DETAILS).map((issue) => ({ field: issue.mappingId ?? issue.conceptId ?? issue.code, message: issue.message })));
  }
}

export interface CheckNode {
  id: string;
  key: string;
  label: string;
  attributes?: AttributeDefinition[];
}

export interface CheckMapping {
  id: string;
  conceptId: string;
  assetKind: string;
  fieldMappings: SourceFieldMapping[] | null;
  identityFields: string[] | null;
}

const DOCUMENT_MODES = new Set(['extract', 'metadata', 'constant', 'computed']);
const SHEET_MODES = new Set(['direct', 'extract', 'constant', 'computed']);

/**
 * What a run asks of a mapping before it reads the source. A mapping that breaks one of these is skipped by a
 * whole-model run (the others still run), so each issue is a warning; refreshing that mapping alone refuses it.
 */
export function mappingIssues(mapping: CheckMapping, node: CheckNode): ModelCheckIssue[] {
  const issues: ModelCheckIssue[] = [];
  const at = { conceptId: mapping.conceptId, mappingId: mapping.id };
  const warn = (code: string, message: string, reason?: string, fieldId?: string): void => {
    issues.push({ severity: 'warning', code, message, ...(reason ? { reason } : {}), ...at, ...(fieldId ? { fieldId } : {}),
      ...(fieldId ? { params: { field: attributeLabel(node, fieldId) } } : {}) });
  };
  const knownAttributes = new Set((node.attributes ?? []).map((attribute) => attribute.key));
  const active = (mapping.fieldMappings ?? []).filter((field) => field.mode !== 'ignore');
  for (const field of active.filter((candidate) => !knownAttributes.has(candidate.targetAttribute))) {
    warn('mapping_attribute_missing', 'The mapping targets an attribute that is not present in the current draft', undefined, field.targetAttribute);
  }
  const allowedModes = mapping.assetKind === 'document' ? DOCUMENT_MODES : SHEET_MODES;
  for (const field of active.filter((candidate) => !allowedModes.has(candidate.mode))) {
    warn('mapping_mode_unsupported', 'The mapping contains a field mode unsupported by its source kind', undefined, field.targetAttribute);
  }
  const targets = active.map((field) => field.targetAttribute);
  for (const target of new Set(targets.filter((name, index) => targets.indexOf(name) !== index))) {
    warn('mapping_duplicate_target', 'A concept attribute can only be mapped once per source', undefined, target);
  }
  const mapped = new Set(targets);
  for (const field of mapping.identityFields ?? []) {
    if (!mapped.has(field)) warn('unmapped_identity', 'The mapping must populate every identity field', undefined, field);
  }
  if (mapping.assetKind !== 'document' && !active.some(readsSomething)) {
    warn('invalid_column_mapping', 'The mapping must directly map every identity field', 'no_fields');
  }
  return issues;
}

/** A sheet field gives the run something to read: a column, a cell reading, a recipe or a fixed value. */
function readsSomething(field: SourceFieldMapping): boolean {
  return field.mode === 'constant' || Boolean(field.mode === 'computed' && field.computed) || Boolean(field.sourceField && (field.mode === 'direct' || field.mode === 'extract'));
}

function attributeLabel(node: CheckNode | undefined, key: string): string {
  return node?.attributes?.find((attribute) => attribute.key === key)?.label || key;
}

/** Every concept a run fills needs the field that names its records, chosen by a person. */
export function labelFieldIssue(node: CheckNode, field: string | undefined): ModelCheckIssue | null {
  if (field && (node.attributes ?? []).some((attribute) => attribute.key === field)) return null;
  return {
    severity: 'error', code: 'missing_label_field', conceptId: node.id, params: { concept: node.label },
    message: `Choose the field that names each ${node.label} record (its label). Open Review to choose it.`,
  };
}

/** A concept a run fills is recognised by one of its fields. */
export function identityIssue(node: CheckNode): ModelCheckIssue {
  return {
    severity: 'error', code: 'no_identity', conceptId: node.id, params: { concept: node.label },
    message: `Concept "${node.label}" has no usable identity fields`,
  };
}

export interface RelationRuleCheck {
  relation: { id: string; key: string; sourceNodeTypeId: string; targetNodeTypeId: string };
  rule: { sourceAttribute: string; targetAttribute: string };
  sourceFieldMapped: boolean;
  targetFieldMapped: boolean;
}

/** A link matches records on a field of each side: both must exist, be filled by a source, and have the same type. */
export function relationRuleIssue(check: RelationRuleCheck, nodes: CheckNode[]): ModelCheckIssue | null {
  const { relation, rule } = check;
  const node = (id: string) => nodes.find((candidate) => candidate.id === id);
  const sourceType = node(relation.sourceNodeTypeId)?.attributes?.find((attribute) => attribute.key === rule.sourceAttribute)?.type;
  const targetType = node(relation.targetNodeTypeId)?.attributes?.find((attribute) => attribute.key === rule.targetAttribute)?.type;
  if (check.sourceFieldMapped && check.targetFieldMapped && sourceType && sourceType === targetType) return null;
  // Say which side is wrong, in the words of the model; Review lists it with a way to fix it.
  const side = !sourceType ? { conceptId: relation.sourceNodeTypeId, field: rule.sourceAttribute, code: 'relation_rule_field_missing', text: 'is no longer a field of' }
    : !targetType ? { conceptId: relation.targetNodeTypeId, field: rule.targetAttribute, code: 'relation_rule_field_missing', text: 'is no longer a field of' }
      : !check.sourceFieldMapped ? { conceptId: relation.sourceNodeTypeId, field: rule.sourceAttribute, code: 'relation_rule_unmapped', text: 'is not filled by any source of' }
        : !check.targetFieldMapped ? { conceptId: relation.targetNodeTypeId, field: rule.targetAttribute, code: 'relation_rule_unmapped', text: 'is not filled by any source of' }
          : null;
  const base = { severity: 'error' as const, relationId: relation.id, params: { relation: relation.key } };
  if (!side) {
    return { ...base, code: 'relation_rule_type_mismatch', params: { ...base.params, sourceType: String(sourceType), targetType: String(targetType) },
      message: `Link "${relation.key}" matches a ${sourceType} field with a ${targetType} field. Open Review to fix it.` };
  }
  const label = attributeLabel(node(side.conceptId), side.field);
  return { ...base, code: side.code, conceptId: side.conceptId, fieldId: side.field,
    params: { ...base.params, field: label, concept: node(side.conceptId)?.label ?? '' },
    message: `Link "${relation.key}" matches records on "${label}", which ${side.text} ${node(side.conceptId)?.label ?? ''}. Open Review to fix it.` };
}
