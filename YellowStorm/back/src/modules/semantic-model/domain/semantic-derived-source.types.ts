/** How a derived record picks one value when the records it comes from disagree. */
export const DERIVED_CONFLICT_RULES = ['most_frequent', 'latest', 'longest', 'leave_empty'] as const;
export type DerivedConflictRule = (typeof DERIVED_CONFLICT_RULES)[number];

/** A field of the source concept copied into a field of the derived concept. */
export interface DerivedFieldMapping {
  sourceAttribute: string;
  targetAttribute: string;
}

/**
 * A concept filled from another concept's records: one record per distinct key value they carry,
 * e.g. the organizations named by the customer id and name of every contract.
 */
export interface DerivedSource {
  id: string;
  conceptId: string;
  sourceConceptId: string;
  fieldMappings: DerivedFieldMapping[];
  conflictRule: DerivedConflictRule;
  /** The source field that orders records for the most recent rule; null for every other rule. */
  orderBy: string | null;
  updatedAt: string;
}

/** What a run receives for one derived source; both sides hash exactly these keys. */
export interface RuntimeDerivation {
  derivationId: string;
  conceptId: string;
  sourceConceptId: string;
  fieldMappings: DerivedFieldMapping[];
  conflictRule: DerivedConflictRule;
  orderBy: string | null;
  labelField: string | null;
  mappingVersion: string;
}

/**
 * A derived source checked against the concepts as they are now. A copied field either concept no
 * longer has is left out; `missing` names the removed fields without which no record can be made:
 * the one a key field was copied from, or the one the most recent rule orders by.
 */
export function checkDerivedSource(source: Pick<DerivedSource, 'fieldMappings' | 'conflictRule' | 'orderBy'>,
  sourceFields: ReadonlySet<string>, targetFields: ReadonlySet<string>, identity: readonly string[]) {
  const fieldMappings = source.fieldMappings.filter((field) => sourceFields.has(field.sourceAttribute) && targetFields.has(field.targetAttribute));
  const missing = identity.filter((key) => !fieldMappings.some((field) => field.targetAttribute === key))
    .map((key) => source.fieldMappings.find((field) => field.targetAttribute === key && !sourceFields.has(field.sourceAttribute))?.sourceAttribute ?? key);
  if (source.conflictRule === 'latest' && (!source.orderBy || !sourceFields.has(source.orderBy))) missing.push(source.orderBy ?? '');
  return { fieldMappings, missing: [...new Set(missing.filter(Boolean))] };
}
