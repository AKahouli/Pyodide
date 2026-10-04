import type { ConceptRecordsPage, DerivedFieldMapping, SourceFieldMapping } from '../../types';
import { computedPayload, recipeColumns } from './FieldRecipeEditor';

/**
 * A derived source's fields as the shared field list's rows (one per concept field, a source field being the
 * "column" a field reads), and back to what is saved. A field copied as it is saves as
 * `{ sourceAttribute, targetAttribute }` exactly, so a derived source saved before the field modes saves as it was.
 */

type Attribute = { key: string; label?: string };
type SourceRecord = ConceptRecordsPage['records'][number];

/** Rows of a saved derived source. A field reading a source field the source concept no longer has is left out. */
export function derivedRows(saved: readonly DerivedFieldMapping[], attributes: readonly Attribute[], sourceFields: readonly string[]): SourceFieldMapping[] {
  const byKey = new Map(saved.map((field) => [field.targetAttribute, field]));
  return attributes.map((attribute): SourceFieldMapping => {
    const field = byKey.get(attribute.key);
    const targetAttribute = attribute.key;
    if (!field) return { sourceField: null, targetAttribute, mode: 'ignore' };
    if (field.mode === 'computed') return { sourceField: null, targetAttribute, mode: 'computed', ...(field.computed ? { computed: field.computed } : {}) };
    if (field.mode === 'constant') return { sourceField: null, targetAttribute, mode: 'constant', constantValue: field.constantValue ?? '' };
    if (!field.sourceAttribute || !sourceFields.includes(field.sourceAttribute)) return { sourceField: null, targetAttribute, mode: 'ignore' };
    if (field.mode !== 'extract') return { sourceField: field.sourceAttribute, targetAttribute, mode: 'direct' };
    return {
      sourceField: field.sourceAttribute, targetAttribute, mode: 'extract', extractionStrategy: field.extractionStrategy ?? 'deterministic',
      ...(field.rules ? { rules: field.rules } : {}),
      ...(field.semanticDefinition ? { semanticDefinition: field.semanticDefinition } : {}),
      ...(field.agentId ? { agentId: field.agentId } : {}),
    };
  });
}

/** Rows of a new derived source: each field copies the source field `suggest` picks, the others are left out. */
export function newDerivedRows(attributes: readonly Attribute[], suggest: (attribute: Attribute) => string | undefined): SourceFieldMapping[] {
  return attributes.map((attribute) => {
    const sourceField = suggest(attribute);
    return sourceField ? { sourceField, targetAttribute: attribute.key, mode: 'direct' } : { sourceField: null, targetAttribute: attribute.key, mode: 'ignore' };
  });
}

/** What is saved: the fields that are filled, each with only what its mode uses, saved ones first in their saved order. */
export function derivedPayload(rows: readonly SourceFieldMapping[], savedOrder: readonly string[] = []): DerivedFieldMapping[] {
  const rank = (key: string) => { const at = savedOrder.indexOf(key); return at < 0 ? Number.MAX_SAFE_INTEGER : at; };
  return rows.filter((row) => row.mode !== 'ignore')
    .map((row, index) => ({ row, index }))
    .sort((left, right) => rank(left.row.targetAttribute) - rank(right.row.targetAttribute) || left.index - right.index)
    .map(({ row }): DerivedFieldMapping => {
      const { targetAttribute } = row;
      if (row.mode === 'computed') return { targetAttribute, mode: 'computed', ...(row.computed ? { computed: computedPayload(row.computed) } : {}) };
      if (row.mode === 'constant') return { targetAttribute, mode: 'constant', constantValue: (row.constantValue ?? '') as string | number | boolean };
      if (row.mode !== 'extract') return { sourceAttribute: row.sourceField ?? '', targetAttribute };
      const strategy = row.extractionStrategy ?? 'deterministic';
      return {
        sourceAttribute: row.sourceField ?? '', targetAttribute, mode: 'extract', extractionStrategy: strategy,
        ...(row.rules ? { rules: row.rules } : {}),
        ...(strategy !== 'deterministic' && row.semanticDefinition?.trim() ? { semanticDefinition: row.semanticDefinition } : {}),
        ...(strategy !== 'deterministic' && row.agentId ? { agentId: row.agentId } : {}),
      };
    });
}

/** The source fields the fields read: copied, read out of, or taken by a recipe. */
export function usedSourceFields(payload: readonly DerivedFieldMapping[]): string[] {
  return [...new Set(payload.flatMap((field) => [
    field.mode !== 'computed' && field.mode !== 'constant' ? field.sourceAttribute ?? '' : '',
    ...(field.mode === 'computed' ? recipeColumns(field.computed) : []),
  ]).filter(Boolean))];
}

/** A source record's value for a field; a key field is only kept in its (normalized) identity. */
export function recordValue(record: SourceRecord, key: string): unknown {
  return record.values?.[key] ?? record.identity?.[key] ?? null;
}
