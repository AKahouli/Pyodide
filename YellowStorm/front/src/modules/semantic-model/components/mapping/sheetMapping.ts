import type { DocumentLabelSuggestion, SourceFieldMapping } from '../../types';
import { computedPayload, recipeRefs } from './FieldRecipeEditor';
import { fieldColumn, recipeChangesValue, sameNamedColumn } from './FieldMappingList';

/**
 * A sheet mapping as one row per concept field (as a document mapping is), and back to what is saved.
 * A field is read from a column as it is (`direct`), out of the column's cell text (`extract`, the document
 * rules and AI on the cell), taken from a column or another field (`computed`, a recipe), fixed, or left out.
 */

type Attribute = { key: string; label?: string };

/** Rows of a saved mapping. A field read from a column then transformed (saved before the field modes) is a recipe. */
export function sheetRows(saved: SourceFieldMapping[], attributes: readonly Attribute[]): SourceFieldMapping[] {
  const byKey = new Map(saved.filter((mapping) => mapping.mode !== 'ignore' && mapping.targetAttribute).map((mapping) => [mapping.targetAttribute, mapping]));
  return attributes.map((attribute) => {
    const mapping = byKey.get(attribute.key);
    if (!mapping) return { sourceField: null, targetAttribute: attribute.key, mode: 'ignore' };
    if (mapping.mode === 'direct' && mapping.computed) {
      if (recipeChangesValue(mapping)) return { sourceField: null, targetAttribute: attribute.key, mode: 'computed', computed: mapping.computed };
      const { computed: _unused, ...plain } = mapping;
      return plain;
    }
    return mapping;
  });
}

/** Rows of a new mapping: each field reads the column named like it, the others are left out. */
export function newSheetRows(attributes: readonly Attribute[], columns: readonly string[]): SourceFieldMapping[] {
  return attributes.map((attribute) => {
    const column = sameNamedColumn(attribute, columns);
    return column ? { sourceField: column, targetAttribute: attribute.key, mode: 'direct' } : { sourceField: null, targetAttribute: attribute.key, mode: 'ignore' };
  });
}

/**
 * What is saved: the fields that are read, each with only what its mode uses. Fields saved before keep their
 * saved order (a sheet's label is its first field read from a column), so an unchanged mapping saves as it was.
 */
export function sheetPayload(rows: SourceFieldMapping[], savedOrder: readonly string[] = []): SourceFieldMapping[] {
  const rank = (key: string) => { const at = savedOrder.indexOf(key); return at < 0 ? Number.MAX_SAFE_INTEGER : at; };
  return rows.filter((mapping) => mapping.mode !== 'ignore' && mapping.targetAttribute)
    .map((mapping, index) => ({ mapping, index }))
    .sort((left, right) => rank(left.mapping.targetAttribute) - rank(right.mapping.targetAttribute) || left.index - right.index)
    .map(({ mapping }): SourceFieldMapping => {
      const { sourceField, targetAttribute, mode } = mapping;
      if (mode === 'direct') return { sourceField, targetAttribute, mode };
      if (mode === 'constant') return { sourceField: null, targetAttribute, mode, constantValue: mapping.constantValue ?? '' };
      if (mode === 'computed') return { sourceField: null, targetAttribute, mode, ...(mapping.computed ? { computed: computedPayload(mapping.computed) } : {}) };
      return {
        sourceField, targetAttribute, mode,
        extractionStrategy: mapping.extractionStrategy ?? 'deterministic',
        ...(mapping.rules ? { rules: mapping.rules } : {}),
        ...(mapping.semanticDefinition ? { semanticDefinition: mapping.semanticDefinition } : {}),
        ...(mapping.agentId ? { agentId: mapping.agentId } : {}),
      };
    });
}

/**
 * A preset or the last mapping (often a document one) applied to a sheet: each field keeps how it is read,
 * with a column of this sheet (its own when the sheet has it, else the one the field reads now or the one
 * named like it). What a sheet has no use for (a document's name or file) leaves the field as it is.
 */
export function adaptToSheet(applied: SourceFieldMapping[], current: SourceFieldMapping[], attributes: readonly Attribute[], columns: readonly string[]): SourceFieldMapping[] {
  const byKey = new Map(applied.map((mapping) => [mapping.targetAttribute, mapping]));
  return current.map((row) => {
    const mapping = byKey.get(row.targetAttribute);
    if (!mapping) return row;
    const attribute = attributes.find((item) => item.key === row.targetAttribute) ?? { key: row.targetAttribute };
    const column = (mapping.sourceField && columns.includes(mapping.sourceField) ? mapping.sourceField : null)
      ?? fieldColumn(row) ?? sameNamedColumn(attribute, columns) ?? null;
    if (mapping.mode === 'metadata' || (mapping.mode === 'computed' && recipeRefs(mapping.computed?.input).some((ref) => ref.kind === 'file'))) return row;
    if (mapping.mode === 'ignore') return { sourceField: column, targetAttribute: row.targetAttribute, mode: 'ignore' };
    if (mapping.mode === 'direct' || mapping.mode === 'extract') return { ...mapping, sourceField: column };
    return { ...mapping, sourceField: null };
  });
}

/** A sample cell as text, as the runtime reads it. */
export function cellValue(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.slice(0, 20000);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return String(value).slice(0, 20000);
}

/** The row number of a sample row: its sheet row when known, else its position after the header. */
export function sampleRowNumber(row: Record<string, unknown>, index: number): number {
  return typeof row.__sheetRow === 'number' ? row.__sheetRow : index + 2;
}

// "Réf. commande : 123" — a short label at the start of a line, then a colon.
const CELL_LABEL = /^\s*([\p{L}][\p{L}\p{N} .'’/()-]{0,39}?)\s*[:：](?!\/\/)\s*(\S.{0,80})?$/u;

/**
 * Labels that start lines (`Label: value`) in the cells read, with how many cells hold each: what a cell's
 * rules can look for, as the labels found in documents are for a document.
 */
export function cellLabelSuggestions(texts: readonly string[], max = 40): DocumentLabelSuggestion[] {
  const found = new Map<string, { label: string; cells: number; example: string }>();
  for (const text of texts) {
    const inCell = new Set<string>();
    for (const line of text.split(/\r?\n/).slice(0, 400)) {
      const match = CELL_LABEL.exec(line);
      if (!match) continue;
      const label = match[1].trim();
      const key = label.toLocaleLowerCase();
      if (inCell.has(key) || /^(https?|mailto)$/i.test(label)) continue;
      inCell.add(key);
      const entry = found.get(key) ?? { label, cells: 0, example: (match[2] ?? '').trim() };
      entry.cells += 1;
      found.set(key, entry);
    }
  }
  return [...found.values()]
    .sort((left, right) => right.cells - left.cells || left.label.localeCompare(right.label))
    .slice(0, max)
    .map((item) => ({ label: item.label, kind: 'label', documents: item.cells, page: null, example: item.example }));
}
