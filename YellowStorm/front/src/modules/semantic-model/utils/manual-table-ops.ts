import type { CanvasPosition, SemanticGraphOperation, SemanticRecord } from '../types';
import type { ManualColumn, RowPatch } from './manual-table';

/** The server takes at most this many operations in one save, so a bigger edit is split into steps of this size. */
export const MAX_OPERATIONS_PER_STEP = 2000;

export function chunkOperations(operations: SemanticGraphOperation[], size = MAX_OPERATIONS_PER_STEP): SemanticGraphOperation[][] {
  const chunks: SemanticGraphOperation[][] = [];
  for (let index = 0; index < operations.length; index += size) chunks.push(operations.slice(index, index + size));
  return chunks;
}

const text = (value: unknown) => (value === undefined || value === null ? '' : String(value));

/** A record needs a name: the Name cell, else the first value filled in. */
export function deriveLabel(name: string, values: Record<string, unknown>, columns: ManualColumn[]): string {
  if (name.trim()) return name.trim();
  for (const column of columns) {
    const value = column.attribute === null ? '' : text(values[column.attribute]).trim();
    if (value) return value;
  }
  return '';
}

/** Where the n-th record of a model sits on the records canvas. */
export const recordPosition = (index: number): CanvasPosition => ({ x: 120 + (index % 3) * 304, y: 120 + Math.floor(index / 3) * 164 });

const sameValues = (left: Record<string, unknown>, right: Record<string, unknown>) => {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) if (text(left[key]) !== text(right[key])) return false;
  return true;
};

export interface PatchContext {
  conceptId: string;
  columns: ManualColumn[];
  newId: () => string;
  /** How many records the model already holds; new records are laid out after them. */
  existingCount: number;
}

/**
 * The operations that write `patches` into rows: row `i` is the existing record `rows[i]`, or a new record when
 * that is null. A cell left empty clears its value. A new row with nothing in it is not created, and a record
 * never loses its name (it cannot be empty).
 */
export function patchOperations(rows: Array<SemanticRecord | null>, patches: RowPatch[], context: PatchContext): SemanticGraphOperation[] {
  const operations: SemanticGraphOperation[] = [];
  let created = 0;
  patches.forEach((patch, index) => {
    const record = rows[index] ?? null;
    const values: Record<string, unknown> = { ...(record?.values ?? {}) };
    let name = '';
    for (const [position, raw] of Object.entries(patch)) {
      const column = context.columns[Number(position)];
      if (!column) continue;
      if (column.attribute === null) name = raw;
      else if (raw === '') delete values[column.attribute];
      else values[column.attribute] = raw;
    }
    if (!record) {
      const label = deriveLabel(name, values, context.columns);
      if (!label) return;
      operations.push({ type: 'record.create', entity: { id: context.newId(), nodeTypeId: context.conceptId, label, values, status: 'active', position: recordPosition(context.existingCount + created) } });
      created += 1;
      return;
    }
    const changes: { label?: string; values?: Record<string, unknown> } = {};
    if (name.trim() && name.trim() !== record.label) changes.label = name.trim();
    if (!sameValues(values, record.values ?? {})) changes.values = values;
    if (Object.keys(changes).length) operations.push({ type: 'record.update', id: record.id, changes });
  });
  return operations;
}
