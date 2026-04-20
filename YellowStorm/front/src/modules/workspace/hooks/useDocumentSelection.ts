/**
 * useDocumentSelection Hook
 * Manages document multi-selection state
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { WorkspaceDocument } from '../types';

export function useDocumentSelection(documents: WorkspaceDocument[]) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const previousDocIdsRef = useRef<string>('');
console.log('documents', documents);
  // Clear selection when documents change (e.g., page navigation, search)
  // We compare document IDs to detect actual data changes
  useEffect(() => {
    const currentDocIds = documents.map((d) => d.id).join(',');
    if (previousDocIdsRef.current && previousDocIdsRef.current !== currentDocIds) {
      setSelectedIds(new Set());
    }
    previousDocIdsRef.current = currentDocIds;
  }, [documents]);

  const isAllSelected = useMemo(() => documents.length > 0 && selectedIds.size === documents.length, [documents.length, selectedIds.size]);

  const isSomeSelected = useMemo(() => selectedIds.size > 0 && selectedIds.size < documents.length, [documents.length, selectedIds.size]);

  const selectedCount = selectedIds.size;

  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (isAllSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(documents.map((d) => d.id)));
    }
  }, [isAllSelected, documents]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const getSelectedDocuments = useCallback(() => {
    return documents.filter((d) => selectedIds.has(d.id));
  }, [documents, selectedIds]);

  const getSelectedIds = useCallback(() => {
    return Array.from(selectedIds);
  }, [selectedIds]);

  return {
    selectedIds,
    selectedCount,
    isAllSelected,
    isSomeSelected,
    isSelected,
    toggleSelect,
    toggleSelectAll,
    clearSelection,
    getSelectedDocuments,
    getSelectedIds,
  };
}
