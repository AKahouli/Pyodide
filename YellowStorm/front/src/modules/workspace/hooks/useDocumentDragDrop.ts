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
}

interface DropData {
  documentId: string;
  isFolder: boolean;
  workspaceId: string;
  targetFolderId?: string;
}

export function useDocumentDragDrop() {
  const { t } = useModuleTranslation('workspace');
  const moveDocuments = useWorkspaceStore((state) => state.moveDocuments);
  const selectedWorkspace = useWorkspaceStore((state) => state.selectedWorkspace);
  const workspaceId = selectedWorkspace?.id ?? '';

  const [isDragging, setIsDragging] = useState(false);
  const [draggedItems, setDraggedItems] = useState<DragItem[]>([]);

  // Reference to track the current drop target
  const dropTargetRef = useRef<string | null>(null);

  const handleDragStart = useCallback((e: React.DragEvent, documentId: string, isFolder: boolean, workspaceId: string) => {
    setIsDragging(true);
    setDraggedItems([{ documentId, isFolder, workspaceId }]);

    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/json', JSON.stringify({
      documentId,
      isFolder,
      workspaceId,
    }));
  }, []);

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
    setDraggedItems([]);
    dropTargetRef.current = null;
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDropOnFolder = useCallback(async (e: React.DragEvent, targetFolderId: string, workspaceId: string) => {
    e.preventDefault();
    e.stopPropagation();

    dropTargetRef.current = targetFolderId;

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

      // Move documents
      const documentIds = [dropData.documentId];

      await moveDocuments(workspaceId, documentIds, targetFolderId);

      // Success message
      toast.success(t('folder.dropSuccess'), {
        description: t('folder.dropSuccessDescription', {
          count: documentIds.length,
        }),
      });
    } catch (error) {
      console.error('Failed to drop on folder:', error);
    }
  }, [workspaceId, moveDocuments, t]);

  const handleDropOnRoot = useCallback(async (e: React.DragEvent, workspaceId: string) => {
    e.preventDefault();
    e.stopPropagation();

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
        }),
      });
    } catch (error) {
      console.error('Failed to drop on root:', error);
    }
  }, [workspaceId, moveDocuments, t]);

  return {
    isDragging,
    draggedItems,
    dropTargetId: dropTargetRef.current,
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDropOnFolder,
    handleDropOnRoot,
    clearDraggedItems: useCallback(() => setDraggedItems([]), []),
  };
}
