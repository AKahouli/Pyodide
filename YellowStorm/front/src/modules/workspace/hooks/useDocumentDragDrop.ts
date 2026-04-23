/**
 * useDocumentDragDrop Hook
 * Custom hook for handling drag and drop operations for documents
 */

import { useState, useCallback, useRef } from 'react';
import { useModuleTranslation } from '@/modules/localization';
import { useWorkspaceStore } from '../store';
import { toast } from 'sonner';

interface DragItem {
  documentId: string;
  isFolder: boolean;
  workspaceId: string;
  name?: string;
}

interface DropData {
  documentId: string;
  isFolder: boolean;
  workspaceId: string;
  name?: string;
}

export function useDocumentDragDrop() {
  const { t } = useModuleTranslation('workspace');
  const moveDocuments = useWorkspaceStore((state) => state.moveDocuments);
  const selectedWorkspace = useWorkspaceStore((state) => state.selectedWorkspace);
  const workspaceId = selectedWorkspace?.id ?? '';

  const [isDragging, setIsDragging] = useState(false);
  const [draggedItems, setDraggedItems] = useState<DragItem[]>([]);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  const handleDragStart = useCallback((e: React.DragEvent, documentId: string, isFolder: boolean, workspaceId: string, name?: string) => {
    setIsDragging(true);
    setDraggedItems([{ documentId, isFolder, workspaceId, name }]);

    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/json', JSON.stringify({
      documentId,
      isFolder,
      workspaceId,
      name,
    }));
  }, []);

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
    setDraggedItems([]);
    setDropTargetId(null);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, folderId?: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (folderId) {
      setDropTargetId(folderId);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent, folderId?: string) => {
    e.preventDefault();
    e.stopPropagation();
    // Only clear drop target if we're leaving the folder row
    if (folderId && dropTargetId === folderId) {
      // Check if we're actually leaving the element (not just entering a child)
      const rect = (e.target as HTMLElement).getBoundingClientRect();
      const x = e.clientX;
      const y = e.clientY;
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
        setDropTargetId(null);
      }
    }
  }, [dropTargetId]);

  const handleDropOnFolder = useCallback(async (e: React.DragEvent, targetFolderId: string, workspaceId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDropTargetId(null);

    try {
      const data = e.dataTransfer.getData('application/json');
      if (!data) return;

      const dropData = JSON.parse(data) as DropData;

      // Prevent dropping a folder into itself
      if (dropData.documentId === targetFolderId) {
        return;
      }

      // Validate workspace matches
      if (dropData.workspaceId !== workspaceId) {
        toast.error(t('folder.dropError'), {
          description: t('folder.crossWorkspaceDrop'),
        });
        return;
      }

      // Move documents
      const documentIds = [dropData.documentId];

      await moveDocuments(workspaceId, documentIds, targetFolderId);

      // Success message
      toast.success(t('folder.dropSuccess'), {
        description: t('folder.dropSuccessDescription', {
          count: documentIds.length,
          name: dropData.name,
        }),
      });
    } catch (error) {
      console.error('Failed to drop on folder:', error);
    }
  }, [moveDocuments, t]);

  const handleDropOnRoot = useCallback(async (e: React.DragEvent, workspaceId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDropTargetId(null);

    try {
      const data = e.dataTransfer.getData('application/json');
      if (!data) return;

      const dropData = JSON.parse(data) as DropData;

      // Validate workspace matches
      if (dropData.workspaceId !== workspaceId) {
        toast.error(t('folder.dropError'), {
          description: t('folder.crossWorkspaceDrop'),
        });
        return;
      }

      // Move documents to root (targetFolderId = undefined)
      await moveDocuments(workspaceId, [dropData.documentId], undefined);

      // Success message
      toast.success(t('folder.dropSuccess'), {
        description: t('folder.dropToRootSuccessDescription', {
          count: 1,
          name: dropData.name,
        }),
      });
    } catch (error) {
      console.error('Failed to drop on root:', error);
    }
  }, [moveDocuments, t]);

  return {
    isDragging,
    draggedItems,
    dropTargetId,
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDragLeave,
    handleDropOnFolder,
    handleDropOnRoot,
    clearDraggedItems: useCallback(() => setDraggedItems([]), []),
  };
}
