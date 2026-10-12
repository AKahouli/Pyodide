import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SourceFieldMapping } from '../../types';
import { FieldMappingList, withMode } from './FieldMappingList';

const attributes = [{ key: 'file', label: 'File' }, { key: 'workspace', label: 'Workspace' }];

function Harness({ initial, onChange }: Readonly<{ initial: SourceFieldMapping[]; onChange: (mappings: SourceFieldMapping[]) => void }>) {
  const [mappings, setMappings] = useState(initial);
  return <FieldMappingList kind='document' modelId='model-1' attributes={attributes} mappings={mappings}
    recipeSource={{ kind: 'document', fileSamples: [] }} onChange={(next) => { setMappings(next); onChange(next); }} />;
}

const extract = (targetAttribute: string): SourceFieldMapping => ({ sourceField: null, targetAttribute, mode: 'extract', extractionStrategy: 'deterministic' });

describe('document field modes', () => {
  it('reads a document property through the metadata mode, one source field per property', () => {
    const base = extract('file');
    expect(withMode(base, 'metadata', 'document')).toMatchObject({ mode: 'metadata', sourceField: 'document_name' });
    expect(withMode(base, 'metadata', 'document', undefined, 'workspace_id')).toMatchObject({ mode: 'metadata', sourceField: 'workspace_id' });
    const documentId = withMode(base, 'metadata', 'document', undefined, 'document_id');
    expect(documentId).toEqual({ sourceField: 'document_id', targetAttribute: 'file', mode: 'metadata' });
    // Back to reading the text: the property is dropped.
    expect(withMode(documentId, 'extract', 'document').sourceField).toBeNull();
  });

  it('lists the document properties apart, under their own label, after the other modes', async () => {
    render(<Harness initial={[extract('file')]} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('combobox', { name: 'mapping.methodFor' }));
    const names = (await screen.findAllByRole('option')).map((option) => option.textContent);
    expect(names).toEqual(['mapping.method.extract', 'mapping.method.constant', 'mapping.method.computed', 'mapping.method.ignore',
      'mapping.method.metadata', 'mapping.method.workspaceId', 'mapping.method.documentId']);
    const group = screen.getByText('mapping.methodGroupDocument').closest('[role="group"]') as HTMLElement;
    expect(within(group).getAllByRole('option')).toHaveLength(3);
  });

  it.each([
    ['mapping.method.workspaceId', 'workspace_id'],
    ['mapping.method.documentId', 'document_id'],
    ['mapping.method.metadata', 'document_name'],
  ])('saves %s as a metadata mapping reading %s', async (option, sourceField) => {
    const onChange = vi.fn();
    render(<Harness initial={[extract('file')]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('combobox', { name: 'mapping.methodFor' }));
    fireEvent.click(await screen.findByRole('option', { name: option }));
    expect(onChange).toHaveBeenLastCalledWith([{ sourceField, targetAttribute: 'file', mode: 'metadata' }]);
    expect(screen.getByRole('combobox', { name: 'mapping.methodFor' })).toHaveTextContent(option);
  });

  it('shows a saved workspace id mapping as such and can switch it back to extraction', async () => {
    const onChange = vi.fn();
    render(<Harness initial={[{ sourceField: 'workspace_id', targetAttribute: 'file', mode: 'metadata' }]} onChange={onChange} />);
    const select = screen.getByRole('combobox', { name: 'mapping.methodFor' });
    expect(select).toHaveTextContent('mapping.method.workspaceId');
    fireEvent.click(select);
    fireEvent.click(await screen.findByRole('option', { name: 'mapping.method.extract' }));
    expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ mode: 'extract', sourceField: null })]);
  });
});
