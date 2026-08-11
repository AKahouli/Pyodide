import { useState, useCallback } from 'react';
import { toast } from 'sonner';

import { useSelectedWorkspace, useWorkspaceLoading, useWorkspaceStore } from '../store';
import { useModalCloseEffect } from './useModalCloseEffect';
import type { WorkspaceDocument } from '../types';
import { getErrorMessage } from '@/lib/error-codes';
import type { ApiError } from '@/lib/api/client';
import { isViewableFile, openFileViewer } from '@/modules/file-viewer';

export function useDocumentActions(document: WorkspaceDocument) {
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isReindexing, setIsReindexing] = useState(false);

  const selectedWorkspace = useSelectedWorkspace();
  const { isDeleting } = useWorkspaceLoading();

  const deleteDocument = useWorkspaceStore((state) => state.deleteDocument);
  const getDownloadUrl = useWorkspaceStore((state) => state.getDownloadUrl);
  const reindexDocument = useWorkspaceStore((state) => state.reindexDocument);

  useModalCloseEffect(
    useCallback(() => {
      setIsDeleteDialogOpen(false);
    }, []),
  );

  const handleDownload = async () => {
    if (!selectedWorkspace) return;

    setIsDownloading(true);
    try {
      const url = await getDownloadUrl(selectedWorkspace.id, document.id);
      window.open(url, '_blank');
    } catch (error) {
      const apiError = error as ApiError;
      const message = apiError?.code ? getErrorMessage(apiError.code) : 'Failed to download document';
      toast.error('Download failed', { description: message });
    } finally {
      setIsDownloading(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedWorkspace) return;

    await deleteDocument(selectedWorkspace.id, document.id);
    setIsDeleteDialogOpen(false);
  };

  const handleReindex = async () => {
    if (!selectedWorkspace) return;

    setIsReindexing(true);
    try {
      await reindexDocument(selectedWorkspace.id, document.id);
    } catch {
      // handled in store
    } finally {
      setIsReindexing(false);
    }
  };

  const canIndex = document.indexingStatus === 'none';
  const canReindex = document.indexingStatus === 'failed' || document.indexingStatus === 'ready';
  const isViewable = isViewableFile(document.mimeType);

  const handleViewFile = () => {
    if (!selectedWorkspace || !isViewable) return;
    openFileViewer(selectedWorkspace.id, document.id, document.path, document.originalName, document.mimeType);
  };

  return {
    isDeleteDialogOpen,
    setIsDeleteDialogOpen,
    isDownloading,
    isDeleting,
    isReindexing,
    canIndex,
    canReindex,
    isViewable,
    handleDownload,
    handleDelete,
    handleReindex,
    handleViewFile,
  };
}
