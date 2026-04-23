import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceDocument } from '../types';
import { useDocumentSelection } from './useDocumentSelection';

function makeDocument(id: string): WorkspaceDocument {
  return {
    id,
    filename: `${id}.txt`,
    originalName: `${id}.txt`,
    mimeType: 'text/plain',
    size: 128,
    path: `/docs/${id}.txt`,
    workspaceId: 'ws-1',
    createdBy: 'user-1',
    status: 'completed',
    indexingStatus: 'ready',
    isFolder: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('useDocumentSelection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('toggles selection and returns selected documents', () => {
    const documents = [makeDocument('doc-1'), makeDocument('doc-2')];
    const { result } = renderHook(({ docs }) => useDocumentSelection(docs), {
      initialProps: { docs: documents },
    });

    act(() => {
      result.current.toggleSelect('doc-1');
    });

    expect(result.current.isSelected('doc-1')).toBe(true);
    expect(result.current.selectedCount).toBe(1);
    expect(result.current.getSelectedIds()).toEqual(['doc-1']);
    expect(result.current.getSelectedDocuments().map((d) => d.id)).toEqual(['doc-1']);

    act(() => {
      result.current.toggleSelectAll();
    });

    expect(result.current.isAllSelected).toBe(true);
    expect(result.current.selectedCount).toBe(2);

    act(() => {
      result.current.clearSelection();
    });

    expect(result.current.selectedCount).toBe(0);
    expect(result.current.isSomeSelected).toBe(false);
  });

  it('clears selection when document ids change', () => {
    const docsPage1 = [makeDocument('doc-1'), makeDocument('doc-2')];
    const docsPage2 = [makeDocument('doc-3')];

    const { result, rerender } = renderHook(({ docs }) => useDocumentSelection(docs), {
      initialProps: { docs: docsPage1 },
    });

    act(() => {
      result.current.toggleSelect('doc-1');
    });
    expect(result.current.selectedCount).toBe(1);

    rerender({ docs: docsPage2 });
    expect(result.current.selectedCount).toBe(0);
    expect(result.current.getSelectedIds()).toEqual([]);
  });
});
