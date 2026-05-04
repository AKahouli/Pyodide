import { memo, useCallback, useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { TableCell, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { FileText, Download, Eye, RefreshCw, Search, Trash2, Loader2, Folder, Upload, FolderPlus, FolderOpen } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';

import { formatFileSize, getFileTypeLabel } from '../../utils';
import { useIsMobile } from '@/hooks/use-mobile';
import type { WorkspaceDocument } from '../../types';
import { useDocumentActions, useWorkspaceStore, useSelectedWorkspace } from '../../hooks';
import { IndexingStatusBadge } from './IndexingStatusBadge';
import { ConfirmDialog } from '../dialogs';
import { CreateFolderDialog } from '../CreateFolderDialog';
import { cn } from '@/lib/utils';

type DocumentRowProps = Readonly<{
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
}>;

export const DocumentRow = memo(function DocumentRow({
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
}: DocumentRowProps) {
  const { t } = useModuleTranslation('workspace');
  const { isDeleteDialogOpen, setIsDeleteDialogOpen, isDownloading, isDeleting, isReindexing, canIndex, canReindex, isViewable, handleDownload, handleDelete, handleReindex, handleViewFile } = useDocumentActions(document);

  const selectedWorkspace = useSelectedWorkspace();
  const isPersonalWorkspace = selectedWorkspace?.isPersonal ?? false;
  const isUploading = useWorkspaceStore((state) => state.isUploading);
  const isMobile = useIsMobile();
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

  const handleRowDragStart = useCallback((e: React.DragEvent) => {
    onDragStart?.(e, document.id, document.isFolder, document.workspaceId, document.originalName);
  }, [document.id, document.isFolder, document.workspaceId, document.originalName, onDragStart]);

  const handleRowDragEnd = useCallback(() => {
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
      <TableRow
        className={cn(
          'group',
          document.isFolder && isDropTarget && 'bg-blue-50 dark:bg-blue-950/30',
          document.isFolder && 'cursor-grab active:cursor-grabbing',
        )}
        draggable={true}
        onDragStart={handleRowDragStart}
        onDragEnd={handleRowDragEnd}
        onDrop={handleFolderDrop}
        onDragOver={handleFolderDragOver}
        onDragLeave={handleFolderDragLeave}
      >
        <TableCell>
          <Checkbox
            checked={isSelected}
            onCheckedChange={onToggleSelect}
            aria-label={t('documents.row.selectCheckbox', { name: document.originalName })}
            onPointerDown={(e) => e.stopPropagation()}
          />
        </TableCell>
        <TableCell>
          <div className='flex items-center gap-2'>
            {document.isFolder ? (
              <>
                {isDropTarget ? <FolderOpen className='h-4 w-4 text-blue-600 shrink-0' /> : <Folder className='h-4 w-4 text-blue-500 shrink-0' />}
                <span
                  className={cn(
                    'font-medium truncate max-w-50 md:max-w-75 cursor-pointer hover:text-blue-600',
                    isDropTarget && 'text-blue-600',
                  )}
                  onDoubleClick={() => document.isFolder && onFolderDoubleClick?.(document.id)}
                >
                  {document.originalName}
                </span>
              </>
            ) : (
              <>
                <FileText className='h-4 w-4 text-muted-foreground shrink-0' />
                <span className='font-medium truncate max-w-50 md:max-w-75'>{document.originalName}</span>
              </>
            )}
          </div>
        </TableCell>
        <TableCell className='text-muted-foreground hidden md:table-cell'>{document.isFolder ? '-' : formatFileSize(document.size)}</TableCell>
        <TableCell className='hidden md:table-cell'>
          <Badge variant='outline' className='text-xs'>
            {document.isFolder ? 'Folder' : getFileTypeLabel(document.mimeType)}
          </Badge>
        </TableCell>
        <TableCell className='hidden lg:table-cell'>
          <IndexingStatusBadge status={!document.isFolder ? document.indexingStatus : 'none'} />
        </TableCell>
        <TableCell>
          <div className='flex gap-1 md:opacity-0 md:group-hover:opacity-100 transition-opacity'>
            {document.isFolder && isPersonalWorkspace && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant='ghost' size='icon' className='h-8 w-8' onClick={handleUploadClick} disabled={isUploading}>
                      {isUploading ? <Loader2 className='h-4 w-4 animate-spin' /> : <Upload className='h-4 w-4' />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{t('documents.row.actions.upload')}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {document.isFolder && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant='ghost' size='icon' className='h-8 w-8' onClick={handleCreateSubFolder}>
                      <FolderPlus className='h-4 w-4' />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{t('documents.row.actions.createSubFolder')}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {!document.isFolder && (
              <Button variant='ghost' size='icon' className='h-8 w-8' onClick={handleDownload} disabled={isDownloading}>
                {isDownloading ? <Loader2 className='h-4 w-4 animate-spin' /> : <Download className='h-4 w-4' />}
              </Button>
            )}
            {isViewable && !isMobile && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant='ghost' size='icon' className='h-8 w-8' onClick={handleViewFile}>
                      <Eye className='h-4 w-4' />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{t('documents.row.actions.view')}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {canIndex && !document.isFolder && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant='ghost' size='icon' className='h-8 w-8' onClick={handleReindex} disabled={isReindexing}>
                      {isReindexing ? <Loader2 className='h-4 w-4 animate-spin' /> : <Search className='h-4 w-4' />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{t('documents.row.actions.index')}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {canReindex && !document.isFolder && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant='ghost' size='icon' className='h-8 w-8' onClick={handleReindex} disabled={isReindexing}>
                      {isReindexing ? <Loader2 className='h-4 w-4 animate-spin' /> : <RefreshCw className='h-4 w-4' />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{t('documents.row.actions.reindex')}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            <Button variant='ghost' size='icon' className='h-8 w-8 text-destructive hover:text-destructive' onClick={handleDeleteClick}>
              <Trash2 className='h-4 w-4' />
            </Button>
          </div>
        </TableCell>
      </TableRow>

      <ConfirmDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen} title={t('documents.row.delete.title')} description={t('documents.row.delete.description', { name: document.originalName })} confirmLabel={isDeleting ? t('documents.row.delete.deleting') : t('documents.row.delete.confirm')} variant='destructive' isLoading={isDeleting} onConfirm={handleDelete} />

      {/* Create Subfolder Dialog */}
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

export default DocumentRow;
