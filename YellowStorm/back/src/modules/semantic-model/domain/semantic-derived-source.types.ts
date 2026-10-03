import type { AttributeDefinition } from './semantic-model.types';
import { aiFieldHints, type ComputedFieldSpec, type ExtractionRules, type SourceExtractionStrategy, type SourceFieldMapping } from './semantic-source-mapping.types';

/** How a derived record picks one value when the records it comes from disagree. */
export const DERIVED_CONFLICT_RULES = ['most_frequent', 'latest', 'longest', 'leave_empty'] as const;
export type DerivedConflictRule = (typeof DERIVED_CONFLICT_RULES)[number];

/**
 * How a field of the derived concept gets its value from a source record, as a sheet field does from a
 * row: copied from a source field as it is (the default, no `mode`), read out of a source field's text
 * with the document rules and/or AI (`extract`), taken from a source field or another field by a recipe
 * (`computed`; a `column` input names a field of the source record), or fixed (`constant`).
 */
export const DERIVED_FIELD_MODES = ['direct', 'extract', 'computed', 'constant'] as const;
export type DerivedFieldMode = (typeof DERIVED_FIELD_MODES)[number];

/** A field of the derived concept and how it is filled; a copied field keeps the shape it always had. */
export interface DerivedFieldMapping {
  /** The source field it reads: required when copied or read out of a text. */
  sourceAttribute?: string;
  targetAttribute: string;
  /** Absent: copied as it is. */
  mode?: Exclude<DerivedFieldMode, 'direct'>;
  extractionStrategy?: SourceExtractionStrategy;
  rules?: ExtractionRules;
  semanticDefinition?: string;
  agentId?: string;
  computed?: ComputedFieldSpec;
  constantValue?: string | number | boolean;
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
  fieldMappings: Array<DerivedFieldMapping | Record<string, unknown>>;
  conflictRule: DerivedConflictRule;
  orderBy: string | null;
  labelField: string | null;
  mappingVersion: string;
  /** How much of a field's text the AI reads; only present when a field is read by AI. */
  aiSettings?: Record<string, unknown>;
}

export const derivedFieldMode = (field: Pick<DerivedFieldMapping, 'mode'>): DerivedFieldMode => field.mode ?? 'direct';

export function derivedFieldUsesAi(field: DerivedFieldMapping): boolean {
  return field.mode === 'extract' && (field.extractionStrategy === 'ai' || field.extractionStrategy === 'rules_then_ai');
}

/**
 * A field as it is stored: only what its mode uses. A copied field is stored as `{ sourceAttribute,
 * targetAttribute }` exactly, as before the field modes, so derived sources saved before keep their
 * run fingerprint.
 */
export function storedDerivedField(field: DerivedFieldMapping & { mode?: DerivedFieldMode }): DerivedFieldMapping {
  const { targetAttribute } = field;
  if (field.mode === 'extract') {
    const strategy = field.extractionStrategy ?? 'deterministic';
    return {
      sourceAttribute: field.sourceAttribute, targetAttribute, mode: 'extract', extractionStrategy: strategy,
      ...(field.rules ? { rules: field.rules } : {}),
      ...(strategy !== 'deterministic' && field.semanticDefinition?.trim() ? { semanticDefinition: field.semanticDefinition } : {}),
      ...(strategy !== 'deterministic' && field.agentId ? { agentId: field.agentId } : {}),
    };
  }
  if (field.mode === 'computed') return { targetAttribute, mode: 'computed', computed: field.computed };
  if (field.mode === 'constant') return { targetAttribute, mode: 'constant', constantValue: field.constantValue };
  return { sourceAttribute: field.sourceAttribute, targetAttribute };
}

/** The derived fields as sheet field mappings (a source field is the "column"), to check and preview them alike. */
export function asSheetFieldMappings(fields: DerivedFieldMapping[]): SourceFieldMapping[] {
  return fields.map((field) => ({
    ...field,
    sourceField: field.sourceAttribute ?? null,
    mode: derivedFieldMode(field),
  } as SourceFieldMapping));
}

/** The source fields a field reads: its own, or the one its recipe reads (through another field too). */
export function derivedFieldInputs(field: DerivedFieldMapping, fields: readonly DerivedFieldMapping[]): string[] {
  if (field.mode === 'constant') return [];
  if (field.mode !== 'computed') return field.sourceAttribute ? [field.sourceAttribute] : [];
  const input = field.computed?.input;
  if (input?.kind === 'column') return [input.name];
  const other = input?.kind === 'field' ? fields.find((item) => item.targetAttribute === input.name && item !== field) : undefined;
  return other && other.mode !== 'computed' ? derivedFieldInputs(other, fields) : [];
}

/**
 * What a run receives for a field: a copied one as stored; one read out of a text with its label (the
 * label its rules look for by default) and, for AI, what the agent is told, as a sheet cell's.
 */
export function runtimeDerivedField(field: DerivedFieldMapping, attribute?: AttributeDefinition): DerivedFieldMapping | Record<string, unknown> {
  if (field.mode !== 'extract') return storedDerivedField(field);
  const strategy = field.extractionStrategy ?? 'deterministic';
  return {
    sourceAttribute: field.sourceAttribute,
    targetAttribute: field.targetAttribute,
    mode: 'extract',
    label: attribute?.label || field.targetAttribute,
    extractionStrategy: strategy,
    ...(field.rules ? { rules: field.rules } : {}),
    ...(strategy !== 'deterministic' && field.agentId ? { agentId: field.agentId } : {}),
    ...(strategy !== 'deterministic' && attribute ? aiFieldHints(attribute, field) : {}),
  };
}

/**
 * A derived source checked against the concepts as they are now. A field reading a source field either
 * concept no longer has is left out (and so is a field taken from it); `missing` names the removed fields
 * without which no record can be made: the one a key field was read from, or the one the most recent rule
 * orders by.
 */
export function checkDerivedSource(source: Pick<DerivedSource, 'fieldMappings' | 'conflictRule' | 'orderBy'>,
  sourceFields: ReadonlySet<string>, targetFields: ReadonlySet<string>, identity: readonly string[]) {
  const readable = (field: DerivedFieldMapping): boolean => {
    if (!targetFields.has(field.targetAttribute)) return false;
    if (field.mode === 'constant') return true;
    if (field.mode === 'computed' && field.computed?.input.kind === 'field') {
      const other = source.fieldMappings.find((item) => item.targetAttribute === field.computed!.input.name && item !== field);
      return Boolean(other && other.mode !== 'computed' && readable(other));
    }
    const inputs = derivedFieldInputs(field, source.fieldMappings);
    return inputs.length > 0 && inputs.every((input) => sourceFields.has(input));
  };
  const fieldMappings = source.fieldMappings.filter(readable);
  const missing = identity.filter((key) => !fieldMappings.some((field) => field.targetAttribute === key))
    .map((key) => {
      const field = source.fieldMappings.find((item) => item.targetAttribute === key);
      return (field ? derivedFieldInputs(field, source.fieldMappings).find((input) => !sourceFields.has(input)) : undefined) ?? key;
    });
  if (source.conflictRule === 'latest' && (!source.orderBy || !sourceFields.has(source.orderBy))) missing.push(source.orderBy ?? '');
  return { fieldMappings, missing: [...new Set(missing.filter(Boolean))] };
}
