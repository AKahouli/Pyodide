import { identityKeyOf, type ResolvedEntity, type SourceAssetKind } from './semantic-source-mapping.types';

export type RelationMatchStrategy = 'exact' | 'case_insensitive' | 'normalized';
export type AmbiguityPolicy = 'review' | 'unresolved';
export type RelationCardinality = 'one_to_one' | 'one_to_many' | 'many_to_one' | 'many_to_many';

export interface RelationResolutionRule {
  id: string;
  relationId: string;
  sourceConceptId: string;
  targetConceptId: string;
  sourceAttribute: string;
  targetAttribute: string;
  cardinality: RelationCardinality;
  strategy: RelationMatchStrategy;
  ambiguityPolicy: AmbiguityPolicy;
}

export interface SourceResolutionPolicy {
  conceptId: string;
  priorities: { mappingId: string; rank: number }[];
  defaultStrategy: 'primary_then_fallback';
}

export interface ResolvedMappingEntity {
  conceptId: string;
  mappingId: string;
  identityFields: string[];
  source: {
    kind: SourceAssetKind | 'manual';
    workspaceId?: string;
    documentId?: string;
    documentName: string;
    documentPath?: string;
    mimeType?: string;
    sheetName?: string;
  };
  entity: ResolvedEntity;
}

export type SourcePreviewIssueCode = 'source_disabled' | 'source_not_ready' | 'source_failed' | 'preview_limited';

/** One unusable source in a preview: which file, which concept, and why it failed. */
export interface SourcePreviewIssue {
  mappingId: string;
  conceptId?: string;
  documentName?: string;
  code: SourcePreviewIssueCode;
  /** Cause without the source name, so identical causes can be grouped. */
  reason?: string;
  /** Sentence shown to the user, naming the source. */
  message: string;
  /** Technical cause, shown on demand. */
  detail?: string;
}

export interface ReconciledEntity {
  id: string;
  conceptId: string;
  entityKey: string;
  label: string;
  values: Record<string, unknown>;
  provenance: Record<string, {
    mappingId: string;
    source: ResolvedMappingEntity['source'];
    rowNumber?: number;
    field?: NonNullable<ResolvedEntity['provenance']['fields']>[string];
  }>;
  sources: { mappingId: string; source: ResolvedMappingEntity['source'] }[];
  conflicts: {
    attribute: string;
    preferred: unknown;
    conflicting: unknown;
    preferredMappingId: string;
    conflictingMappingId: string;
    preferredProvenance: ReconciledEntity['provenance'][string];
    conflictingProvenance: ReconciledEntity['provenance'][string];
  }[];
}

export interface RelationMatch {
  sourceEntityId: string;
  targetEntityIds: string[];
  status: 'resolved' | 'ambiguous' | 'unresolved';
  sourceValue: unknown;
  strategy: RelationMatchStrategy;
  partial: boolean;
}

function hasValue(value: unknown): boolean {
  return value !== null && value !== undefined && (typeof value !== 'string' || value.trim().length > 0);
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function normalizeRelationValue(value: unknown, strategy: RelationMatchStrategy): string {
  const text = hasValue(value) ? String(value).trim() : '';
  if (strategy === 'exact') return text;
  // toLowerCase, never toLocaleLowerCase: the hash/match contract must be
  // host-locale independent, and the Python runtime port uses str.lower().
  const lower = text.toLowerCase();
  if (strategy === 'case_insensitive') return lower;
  return lower
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function reconcileConceptEntities(
  entries: ResolvedMappingEntity[],
  policy?: SourceResolutionPolicy,
): ReconciledEntity[] {
  const ranks = new Map(policy?.priorities.map((item) => [item.mappingId, item.rank]) ?? []);
  const sorted = [...entries].sort((left, right) =>
    (ranks.get(left.mappingId) ?? Number.MAX_SAFE_INTEGER) - (ranks.get(right.mappingId) ?? Number.MAX_SAFE_INTEGER));
  const groups = new Map<string, ResolvedMappingEntity[]>();
  for (const entry of sorted) {
    const identity = entry.identityFields.length ? identityKeyOf(entry.entity.values, entry.identityFields) : '';
    const canReconcile = Boolean(identity.replace(/\u0000/g, ''));
    const key = canReconcile ? `identity:${identity}` : `source:${entry.mappingId}:${entry.entity.entityKey}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }

  return [...groups.entries()].map(([groupKey, group]) => {
    const first = group[0];
    const values: Record<string, unknown> = {};
    const provenance: ReconciledEntity['provenance'] = {};
    const conflicts: ReconciledEntity['conflicts'] = [];
    for (const entry of group) {
      for (const [attribute, value] of Object.entries(entry.entity.values)) {
        if (!hasValue(value)) continue;
        if (!hasValue(values[attribute])) {
          values[attribute] = value;
          provenance[attribute] = {
            mappingId: entry.mappingId,
            source: entry.source,
            rowNumber: entry.entity.provenance.rowNumber,
            field: entry.entity.provenance.fields?.[attribute],
          };
        } else if (!valuesEqual(values[attribute], value)) {
          conflicts.push({
            attribute,
            preferred: values[attribute],
            conflicting: value,
            preferredMappingId: provenance[attribute].mappingId,
            conflictingMappingId: entry.mappingId,
            preferredProvenance: provenance[attribute],
            conflictingProvenance: {
              mappingId: entry.mappingId,
              source: entry.source,
              rowNumber: entry.entity.provenance.rowNumber,
              field: entry.entity.provenance.fields?.[attribute],
            },
          });
        }
      }
    }
    return {
      id: `${first.conceptId}:${groupKey}`,
      conceptId: first.conceptId,
      entityKey: groupKey,
      label: group.find((entry) => hasValue(entry.entity.label))?.entity.label ?? '',
      values,
      provenance,
      sources: group.map((entry) => ({ mappingId: entry.mappingId, source: entry.source })),
      conflicts,
    };
  });
}

export function reconcilePreviewEntities(
  entries: ResolvedMappingEntity[],
  policies: SourceResolutionPolicy[],
  limit: number,
): { entities: ReconciledEntity[]; incompleteConceptIds: string[] } {
  const policyByConcept = new Map(policies.map((policy) => [policy.conceptId, policy]));
  const byConcept = new Map<string, ResolvedMappingEntity[]>();
  for (const entry of entries) byConcept.set(entry.conceptId, [...(byConcept.get(entry.conceptId) ?? []), entry]);
  const entities: ReconciledEntity[] = [];
  const incompleteConceptIds: string[] = [];
  for (const [conceptId, conceptEntries] of byConcept) {
    const reconciled = reconcileConceptEntities(conceptEntries, policyByConcept.get(conceptId));
    entities.push(...reconciled.slice(0, limit));
    if (reconciled.length > limit) incompleteConceptIds.push(conceptId);
  }
  return { entities, incompleteConceptIds };
}

export function resolveRelationMatches(
  entities: ReconciledEntity[],
  rule: RelationResolutionRule,
  incompleteConceptIds: ReadonlySet<string> = new Set(),
): RelationMatch[] {
  const targets = entities.filter((entity) => entity.conceptId === rule.targetConceptId);
  const targetIndex = new Map<string, ReconciledEntity[]>();
  for (const target of targets) {
    const key = normalizeRelationValue(target.values[rule.targetAttribute], rule.strategy);
    if (key) targetIndex.set(key, [...(targetIndex.get(key) ?? []), target]);
  }
  return entities
    .filter((entity) => entity.conceptId === rule.sourceConceptId)
    .map((source) => {
      const sourceValue = source.values[rule.sourceAttribute];
      const key = normalizeRelationValue(sourceValue, rule.strategy);
      const candidates = key ? targetIndex.get(key) ?? [] : [];
      const partial = incompleteConceptIds.has(rule.targetConceptId);
      return {
        sourceEntityId: source.id,
        targetEntityIds: candidates.map((candidate) => candidate.id),
        status: partial ? 'unresolved' : candidates.length === 0 ? 'unresolved' :
          (rule.cardinality === 'one_to_one' || rule.cardinality === 'many_to_one') && candidates.length > 1
            ? 'ambiguous'
            : 'resolved',
        sourceValue,
        strategy: rule.strategy,
        partial,
      };
    });
}
