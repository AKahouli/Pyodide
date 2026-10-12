import { describe, expect, it } from 'vitest';
import type { AttributeDefinition, SemanticGraphOperation, SemanticRecord } from '../types';
import { manualColumns } from './manual-table';
import { chunkOperations, deriveLabel, patchOperations } from './manual-table-ops';

const field = (key: string, label: string): AttributeDefinition => ({ key, label, type: 'text', required: false });
const columns = manualColumns([field('email', 'Email'), field('city', 'City')], 'Name');
const record = (id: string, label: string, values: Record<string, unknown> = {}): SemanticRecord => ({ id, nodeTypeId: 'customer', label, values, status: 'active', position: { x: 0, y: 0 } });
let counter = 0;
const context = { conceptId: 'customer', columns, newId: () => `new-${++counter}`, existingCount: 0 };

describe('patchOperations', () => {
  it('creates a record for a row past the end, named by the Name cell', () => {
    counter = 0;
    const [operation] = patchOperations([null], [{ 0: 'Ann', 1: 'ann@x.fr' }], context);
    expect(operation).toMatchObject({ type: 'record.create', entity: { id: 'new-1', nodeTypeId: 'customer', label: 'Ann', values: { email: 'ann@x.fr' }, status: 'active' } });
  });

  it('names a row without a Name after its first value, and skips a row with nothing in it', () => {
    expect(deriveLabel('', { city: 'Paris' }, columns)).toBe('Paris');
    const operations = patchOperations([null, null], [{ 2: 'Paris' }, { 0: '', 1: '' }], context);
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({ entity: { label: 'Paris', values: { city: 'Paris' } } });
  });

  it('updates only what changed in an existing record, and clears a value left empty', () => {
    const existing = record('r1', 'Ann', { email: 'old@x.fr', city: 'Paris' });
    expect(patchOperations([existing], [{ 1: 'new@x.fr', 2: '' }], context)).toEqual([
      { type: 'record.update', id: 'r1', changes: { values: { email: 'new@x.fr' } } },
    ]);
    expect(patchOperations([existing], [{ 0: 'Anne' }], context)).toEqual([{ type: 'record.update', id: 'r1', changes: { label: 'Anne' } }]);
    expect(patchOperations([existing], [{ 0: 'Ann', 1: 'old@x.fr' }], context)).toEqual([]);
  });

  it('never empties the name of a record', () => {
    expect(patchOperations([record('r1', 'Ann')], [{ 0: '' }], context)).toEqual([]);
  });

  it('mixes updates and creations along a pasted block', () => {
    counter = 0;
    const operations = patchOperations([record('r1', 'Ann'), null, null], [{ 0: 'Ann B' }, { 0: 'Bob' }, { 0: 'Cy' }], context);
    expect(operations.map((operation) => operation.type)).toEqual(['record.update', 'record.create', 'record.create']);
  });
});

describe('chunkOperations', () => {
  it('keeps every step within what one save takes', () => {
    const operations: SemanticGraphOperation[] = Array.from({ length: 4500 }, (_, index) => ({ type: 'record.delete', id: String(index) }));
    expect(chunkOperations(operations).map((chunk) => chunk.length)).toEqual([2000, 2000, 500]);
    expect(chunkOperations([])).toEqual([]);
  });
});
