import type { DerivedExpand, ConceptRecordsPage, DerivedFieldMapping, SourceFieldMapping } from '../../types';
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

/** A field of an expanded item: the item itself (`@item`), or a path inside an object item (`@item.email`). */
export const ITEM_FIELD = '@item';
export const isItemField = (name: string | null | undefined): boolean => name === ITEM_FIELD || (Boolean(name?.startsWith(`${ITEM_FIELD}.`)) && name!.length > ITEM_FIELD.length + 1);

/** The source record's fields a preview sends: those the fields read, and the one expanded (not the item's own). */
export function sentSourceFields(payload: readonly DerivedFieldMapping[], expand?: DerivedExpand | null): string[] {
  return [...new Set([...usedSourceFields(payload).filter((field) => !isItemField(field)), ...(expand?.field ? [expand.field] : [])])];
}

/**
 * The fields an item offers, from the item as the preview returns it: `@item`, and for a JSON object one
 * `@item.<path>` per value inside it (as the runtime reads it), so a recipe can be tried on them.
 */
export function itemColumns(itemText: string): Record<string, unknown> {
  const columns: Record<string, unknown> = { [ITEM_FIELD]: itemText };
  if (!itemText.trim().startsWith('{')) return columns;
  try {
    const walk = (value: Record<string, unknown>, prefix: string, depth: number) => {
      for (const [key, inner] of Object.entries(value)) {
        const name = `${prefix}${key}`;
        if (inner && typeof inner === 'object' && !Array.isArray(inner) && depth < 4) walk(inner as Record<string, unknown>, `${name}.`, depth + 1);
        else if (inner !== null && inner !== undefined) columns[name] = typeof inner === 'object' ? JSON.stringify(inner) : inner;
      }
    };
    walk(JSON.parse(itemText) as Record<string, unknown>, `${ITEM_FIELD}.`, 1);
  } catch {
    // Not JSON after all (a cut item): only the item itself.
  }
  return columns;
}

/** The expand setting as saved: only what its split uses; none when no field is picked. */
export function expandPayload(expand: DerivedExpand | null): DerivedExpand | undefined {
  if (!expand?.field) return undefined;
  const delimiters = (expand.delimiters ?? []).filter(Boolean);
  return {
    field: expand.field, split: expand.split,
    ...(expand.split === 'delimiters' && delimiters.length ? { delimiters } : {}),
    ...((expand.split === 'auto' || expand.split === 'list') && expand.path?.trim() ? { path: expand.path.trim() } : {}),
    ...(expand.maxItems ? { maxItems: expand.maxItems } : {}),
    ...(expand.relationId ? { relationId: expand.relationId } : {}),
  };
}

/** Why an expand setting cannot be saved, as a translation key, or null. */
export function expandProblem(expand: DerivedExpand | null): string | null {
  if (!expand) return null;
  if (!expand.field) return 'derived.expand.problem.field';
  if (expand.split === 'delimiters' && !(expand.delimiters ?? []).some(Boolean)) return 'derived.expand.problem.delimiters';
  return null;
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
