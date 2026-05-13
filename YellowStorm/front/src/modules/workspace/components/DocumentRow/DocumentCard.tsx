import { memo, useCallback, useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FileText, Download, RefreshCw, Search, Trash2, Loader2, Folder, Upload, FolderPlus, FolderOpen } from 'lucide-react';
import { cn } from '@/lib/utils';

import { formatFileSize, getFileTypeLabel, formatDate } from '../../utils';
import type { WorkspaceDocument } from '../../types';
import { useDocumentActions, useWorkspaceStore, useSelectedWorkspace } from '../../hooks';
import { IndexingStatusBadge } from './IndexingStatusBadge';
import { ConfirmDialog } from '../dialogs';
import { CreateFolderDialog } from '../CreateFolderDialog';
import { useModuleTranslation } from '@/modules/localization';

interface DocumentCardProps {
  document: WorkspaceDocument;
  isSelected: boolean;
  onToggleSelect: () => void;
  onFolderUpload?: (folderId: string) => void;
  onFolderDoubleClick?: (folderId: string) => void;
  onDragStart?: (e: React.DragEvent, documentId: string, isFolder: boolean, workspaceId: string, name?: string) => void;
  onDragEnd?: () => void;
  onDropOnFolder?: (e: React.DragEvent, folderId: string, workspaceId: string) => void;
  onDragOver?: (e: React.DragEvent, folderId: string) => void;
  onDragLeave?: (e: React.DragEvent, folderId: string) => void;
  isDropTarget?: boolean;
}

export const DocumentCard = memo(function DocumentCard({
  document,
  isSelected,
  onToggleSelect,
  onFolderUpload,
  onFolderDoubleClick,
  onDragStart,
  onDragEnd,
  onDropOnFolder,
  onDragOver,
  onDragLeave,
  isDropTarget,
}: DocumentCardProps) {
  const { t } = useModuleTranslation('workspace');
  const { isDeleteDialogOpen, setIsDeleteDialogOpen, isDownloading, isDeleting, isReindexing, canIndex, canReindex, handleDownload, handleDelete, handleReindex } = useDocumentActions(document);

  const selectedWorkspace = useSelectedWorkspace();
  const isPersonalWorkspace = selectedWorkspace?.isPersonal ?? false;
  const isUploading = useWorkspaceStore((state) => state.isUploading);

  const [isSubFolderDialogOpen, setIsSubFolderDialogOpen] = useState(false);

  const handleDeleteClick = useCallback(() => {
    setIsDeleteDialogOpen(true);
  }, [setIsDeleteDialogOpen]);

  const handleUploadClick = useCallback(() => {
    onFolderUpload?.(document.id);
  }, [document.id, onFolderUpload]);

  const handleCreateSubFolder = useCallback(() => {
    setIsSubFolderDialogOpen(true);
  }, []);

  const handleCardDragStart = useCallback((e: React.DragEvent) => {
    onDragStart?.(e, document.id, document.isFolder, document.workspaceId, document.originalName);
  }, [document.id, document.isFolder, document.workspaceId, document.originalName, onDragStart]);

  const handleCardDragEnd = useCallback(() => {
    onDragEnd?.();
  }, [onDragEnd]);

  const handleFolderDrop = useCallback((e: React.DragEvent) => {
    if (document.isFolder && onDropOnFolder) {
      onDropOnFolder(e, document.id, document.workspaceId);
    }
  }, [document.isFolder, document.id, document.workspaceId, onDropOnFolder]);

  const handleFolderDragOver = useCallback((e: React.DragEvent) => {
    if (document.isFolder && onDragOver) {
      onDragOver(e, document.id);
    }
  }, [document.isFolder, document.id, onDragOver]);

  const handleFolderDragLeave = useCallback((e: React.DragEvent) => {
    if (document.isFolder && onDragLeave) {
      onDragLeave(e, document.id);
    }
  }, [document.isFolder, document.id, onDragLeave]);

  return (
    <>
      <div
        className={cn(
          `p-3 overflow-hidden ${isSelected ? 'bg-muted/50' : ''}`,
          document.isFolder && 'cursor-grab active:cursor-grabbing',
          document.isFolder && isDropTarget && 'bg-blue-50 dark:bg-blue-950/30',
        )}
        draggable={true}
        onDragStart={handleCardDragStart}
        onDragEnd={handleCardDragEnd}
        onDrop={handleFolderDrop}
        onDragOver={handleFolderDragOver}
        onDragLeave={handleFolderDragLeave}
      >
        <div className='flex items-center gap-2 w-full min-w-0'>
          <Checkbox
            checked={isSelected}
            onCheckedChange={onToggleSelect}
            aria-label={t('documents.row.selectCheckbox', { name: document.originalName })}
            className='shrink-0'
            onPointerDown={(e) => e.stopPropagation()}
          />
          <div
            className='flex items-center gap-2 cursor-pointer min-w-0'
            onDoubleClick={() => document.isFolder && onFolderDoubleClick?.(document.id)}
          >
            {document.isFolder ? (
              <>
                {isDropTarget ? <FolderOpen className='h-4 w-4 text-blue-600 shrink-0' /> : <Folder className='h-4 w-4 text-blue-500 shrink-0' />}
                <span className={cn('font-medium text-sm truncate block max-w-[calc(100vw-180px)]', document.isFolder && 'hover:text-blue-600', isDropTarget && 'text-blue-600')}>
                  {document.originalName}
                </span>
              </>
            ) : (
              <>
                <FileText className='h-4 w-4 text-muted-foreground shrink-0' />
                <span className='font-medium text-sm truncate block max-w-[calc(100vw-180px)]'>{document.originalName}</span>
              </>
            )}
          </div>
          <div className='flex gap-0.5 shrink-0 ml-auto'>
            {document.isFolder && (
              <Button variant='ghost' size='icon' className='h-7 w-7' onClick={handleUploadClick} disabled={isUploading}>
                {isUploading ? <Loader2 className='h-3.5 w-3.5 animate-spin' /> : <Upload className='h-3.5 w-3.5' />}
              </Button>
            )}
            {!document.isFolder && (
              <Button variant='ghost' size='icon' className='h-7 w-7' onClick={handleDownload} disabled={isDownloading}>
                {isDownloading ? <Loader2 className='h-3.5 w-3.5 animate-spin' /> : <Download className='h-3.5 w-3.5' />}
              </Button>
            )}
            {document.isFolder && isPersonalWorkspace && (
              <Button variant='ghost' size='icon' className='h-7 w-7' onClick={handleCreateSubFolder}>
                <FolderPlus className='h-3.5 w-3.5' />
              </Button>
            )}
            {canIndex && !document.isFolder && (
              <Button variant='ghost' size='icon' className='h-7 w-7' onClick={handleReindex} disabled={isReindexing}>
                {isReindexing ? <Loader2 className='h-3.5 w-3.5 animate-spin' /> : <Search className='h-3.5 w-3.5' />}
              </Button>
            )}
            {canReindex && !document.isFolder && (
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
          <span className='text-xs text-muted-foreground'>{document.isFolder ? '-' : formatFileSize(document.size)}</span>
          <Badge variant='outline' className='text-[10px] h-4 px-1.5'>
            {document.isFolder ? 'Folder' : getFileTypeLabel(document.mimeType)}
          </Badge>
          <IndexingStatusBadge status={document.indexingStatus} error={document.indexingError} taskName={document.indexingTaskName} />
          <span className='text-xs text-muted-foreground'>{formatDate(document.uploadedAt || document.createdAt)}</span>
        </div>
      </div>

      <ConfirmDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen} title={t('documents.row.delete.title')} description={t('documents.row.delete.description', { name: document.originalName })} confirmLabel={isDeleting ? t('documents.row.delete.deleting') : t('documents.row.delete.confirm')} variant='destructive' isLoading={isDeleting} onConfirm={handleDelete} />

      {document.isFolder && isPersonalWorkspace && (
        <CreateFolderDialog
          open={isSubFolderDialogOpen}
          onOpenChange={setIsSubFolderDialogOpen}
          workspaceId={selectedWorkspace?.id || ''}
          parentFolderId={document.id}
        />
      )}
    </>
  );
});
