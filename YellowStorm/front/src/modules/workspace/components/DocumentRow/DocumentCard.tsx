import { memo, useCallback } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FileText, Download, RefreshCw, Search, Trash2, Loader2 } from 'lucide-react';

import { formatFileSize, formatDate, getFileTypeLabel } from '../../utils';
import type { WorkspaceDocument } from '../../types';
import { useDocumentActions } from '../../hooks';
import { IndexingStatusBadge } from './IndexingStatusBadge';
import { ConfirmDialog } from '../dialogs';
import { useModuleTranslation } from '@/modules/localization';

interface DocumentCardProps {
  document: WorkspaceDocument;
  isSelected: boolean;
  onToggleSelect: () => void;
}

export const DocumentCard = memo(function DocumentCard({ document, isSelected, onToggleSelect }: DocumentCardProps) {
  const { t } = useModuleTranslation('workspace');
  const { isDeleteDialogOpen, setIsDeleteDialogOpen, isDownloading, isDeleting, isReindexing, canIndex, canReindex, handleDownload, handleDelete, handleReindex } = useDocumentActions(document);

  const handleDeleteClick = useCallback(() => {
    setIsDeleteDialogOpen(true);
  }, [setIsDeleteDialogOpen]);

  return (
    <>
      <div className={`p-3 overflow-hidden ${isSelected ? 'bg-muted/50' : ''}`}>
        <div className='flex items-center gap-2 w-full min-w-0'>
          <Checkbox checked={isSelected} onCheckedChange={onToggleSelect} aria-label={t('documents.row.selectCheckbox', { name: document.originalName })} className='shrink-0' />
          <FileText className='h-4 w-4 text-muted-foreground shrink-0' />
          <span className='font-medium text-sm truncate block max-w-[calc(100vw-180px)]'>{document.originalName}</span>
          <div className='flex gap-0.5 shrink-0 ml-auto'>
            <Button variant='ghost' size='icon' className='h-7 w-7' onClick={handleDownload} disabled={isDownloading}>
              {isDownloading ? <Loader2 className='h-3.5 w-3.5 animate-spin' /> : <Download className='h-3.5 w-3.5' />}
            </Button>
            {canIndex && (
              <Button variant='ghost' size='icon' className='h-7 w-7' onClick={handleReindex} disabled={isReindexing}>
                {isReindexing ? <Loader2 className='h-3.5 w-3.5 animate-spin' /> : <Search className='h-3.5 w-3.5' />}
              </Button>
            )}
            {canReindex && (
              <Button variant='ghost' size='icon' className='h-7 w-7' onClick={handleReindex} disabled={isReindexing}>
                {isReindexing ? <Loader2 className='h-3.5 w-3.5 animate-spin' /> : <RefreshCw className='h-3.5 w-3.5' />}
              </Button>
            )}
            <Button variant='ghost' size='icon' className='h-7 w-7 text-destructive hover:text-destructive' onClick={handleDeleteClick}>
              <Trash2 className='h-3.5 w-3.5' />
            </Button>
          </div>
        </div>
        <div className='flex items-center gap-2 mt-1.5 ml-6 pl-0.5 flex-wrap'>
          <span className='text-xs text-muted-foreground'>{formatFileSize(document.size)}</span>
          <Badge variant='outline' className='text-[10px] h-4 px-1.5'>
            {getFileTypeLabel(document.mimeType)}
          </Badge>
          <IndexingStatusBadge status={document.indexingStatus} error={document.indexingError} taskName={document.indexingTaskName} />
          <span className='text-xs text-muted-foreground'>{formatDate(document.uploadedAt || document.createdAt)}</span>
        </div>
      </div>

      <ConfirmDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen} title={t('documents.row.delete.title')} description={t('documents.row.delete.description', { name: document.originalName })} confirmLabel={isDeleting ? t('documents.row.delete.deleting') : t('documents.row.delete.confirm')} variant='destructive' isLoading={isDeleting} onConfirm={handleDelete} />
    </>
  );
});
