import { describe, expect, it } from 'vitest';
import type { SemanticNodeType } from '../types';
import { copySource, pasteConcept } from './canvas-clipboard';
import type { DesignerSource } from './designer-flow';

const source = (overrides: Partial<DesignerSource>): DesignerSource => ({
  id: 'source:w:d:', kind: 'spreadsheet', label: 'clients.xlsx', detail: '', position: { x: 0, y: 0 }, tone: 'idle',
  mappings: [{ id: 'm', conceptId: 'c', workspaceId: 'w', documentId: 'd', documentName: 'clients.xlsx', sheetName: 'Sheet1', assetKind: 'excel_sheet', fieldMappings: [], status: 'ready', createdBy: 'u', createdAt: '', updatedAt: '', identityFields: [] }],
  ...overrides,
});

describe('canvas clipboard', () => {
  it('copies a source as the file and table it reads, but not a manual table or whole workspaces', () => {
    expect(copySource(source({}))).toEqual({ kind: 'source', resource: expect.objectContaining({ kind: 'document', workspaceId: 'w', documentId: 'd', sheetName: 'Sheet1', structured: true, mappable: true }) });
    expect(copySource(source({ kind: 'typed', mappings: [] }))).toBeNull();
    expect(copySource(source({ kind: 'workspace' }))).toBeNull();
  });

  it('pastes a concept under a free key, as a plain business object clear of the others', () => {
    const node = (id: string, key: string, x: number): SemanticNodeType => ({ id, key, label: key, description: 'd', category: 'system_collection', recordPolicy: 'optional', systemKey: 'sys', aliases: ['a'], attributes: [{ key: 'name', label: 'name', type: 'text', required: true }], position: { x, y: 0 } });
    const original = node('1', 'customer', 0);
    const pasted = pasteConcept(original, [original, { ...node('2', 'customer_copy', 0), position: { x: 48, y: 48 } }], 'Customer copy');
    expect(pasted).toMatchObject({ key: 'customer_copy_2', label: 'Customer copy', systemKey: null, category: 'business_object', aliases: ['a'], attributes: original.attributes });
    expect(pasted.id).not.toBe('1');
    expect(pasted.position).toEqual({ x: 96, y: 96 });
    expect(pasted.attributes).not.toBe(original.attributes);
  });
});
