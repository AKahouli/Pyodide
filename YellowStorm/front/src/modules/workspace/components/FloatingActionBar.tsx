/**
 * Floating Action Bar
 * Shows bulk actions when documents are selected
 */

import { useState, useCallback } from 'react';
import { Download, Trash2, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { useModuleTranslation } from '@/modules/localization';
import { useWorkspaceStore, useSelectedWorkspace, useWorkspaceLoading, useCanWriteWorkspace } from '../store';
import { useModalCloseEffect } from '../hooks';
import { ConfirmDialog } from './dialogs';
import { getErrorMessage } from '@/lib/error-codes';
import type { ApiError } from '@/lib/api/client';

interface FloatingActionBarProps {
  selectedCount: number;
  selectedIds: string[];
  onClearSelection: () => void;
}

export function FloatingActionBar({ selectedCount, selectedIds, onClearSelection }: FloatingActionBarProps) {
  const { t } = useModuleTranslation('workspace');
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  const selectedWorkspace = useSelectedWorkspace();
  const { isDeleting } = useWorkspaceLoading();
  const canWrite = useCanWriteWorkspace();

  const bulkDeleteDocuments = useWorkspaceStore((state) => state.bulkDeleteDocuments);
  const getDownloadUrl = useWorkspaceStore((state) => state.getDownloadUrl);

  // Close dialog when parent modal closes
  useModalCloseEffect(
    useCallback(() => {
      setIsDeleteDialogOpen(false);
    }, []),
  );

  const handleBulkDownload = async () => {
    if (!selectedWorkspace) return;

    setIsDownloading(true);
    try {
      // Download each selected document
      for (const docId of selectedIds) {
        const url = await getDownloadUrl(selectedWorkspace.id, docId);
        window.open(url, '_blank');
        // Small delay to prevent browser from blocking multiple downloads
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    } catch (error) {
      const apiError = error as ApiError;
      const message = apiError?.code ? getErrorMessage(apiError.code) : 'Failed to download documents';
      toast.error('Download failed', { description: message });
    } finally {
      setIsDownloading(false);
    }
  };

  const handleBulkDelete = async () => {
    if (!selectedWorkspace) return;

    await bulkDeleteDocuments(selectedWorkspace.id, selectedIds);
    onClearSelection();
    setIsDeleteDialogOpen(false);
  };

  return (
    <>
      <div className='fixed bottom-4 md:bottom-6 left-1/2 -translate-x-1/2 bg-background border rounded-lg shadow-lg p-2 md:p-3 flex items-center gap-2 md:gap-4 z-50 max-w-[calc(100vw-2rem)]'>
        <span className='text-xs md:text-sm font-medium whitespace-nowrap'>{t('floating.selected', { count: selectedCount })}</span>
        <Separator orientation='vertical' className='h-5 md:h-6' />
        <Button variant='outline' size='sm' onClick={handleBulkDownload} disabled={isDownloading} className='h-8 px-2 md:px-3'>
          {isDownloading ? <Loader2 className='h-4 w-4 md:mr-2 animate-spin' /> : <Download className='h-4 w-4 md:mr-2' />}
          <span className='hidden md:inline'>{t('floating.actions.download')}</span>
        </Button>
        {canWrite && (
          <Button variant='destructive' size='sm' onClick={() => setIsDeleteDialogOpen(true)} className='h-8 px-2 md:px-3'>
            <Trash2 className='h-4 w-4 md:mr-2' />
            <span className='hidden md:inline'>{t('floating.actions.delete')}</span>
          </Button>
        )}
        <Button variant='ghost' size='sm' onClick={onClearSelection} className='h-8 w-8 p-0'>
          <X className='h-4 w-4' />
        </Button>
      </div>

      {/* Bulk Delete Dialog */}
      <ConfirmDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen} title={t('floating.deleteDialog.title')} description={t('floating.deleteDialog.description', { count: selectedCount })} confirmLabel={isDeleting ? t('floating.deleteDialog.deleting') : t('floating.deleteDialog.confirm', { count: selectedCount })} variant='destructive' isLoading={isDeleting} onConfirm={handleBulkDelete} />
    </>
  );
}
