import { memo, useCallback, useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { TableCell, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { FileText, Download, Eye, RefreshCw, Search, Trash2, Loader2, Folder, Upload, FolderPlus } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';

import { formatFileSize, getFileTypeLabel } from '../../utils';
import { useIsMobile } from '@/hooks/use-mobile';
import type { WorkspaceDocument } from '../../types';
import { useDocumentActions, useWorkspaceStore, useSelectedWorkspace } from '../../hooks';
import { IndexingStatusBadge } from './IndexingStatusBadge';
import { ConfirmDialog, RenameDialog } from '../dialogs';
import { CreateFolderDialog } from '../CreateFolderDialog';

type DocumentRowProps = Readonly<{
  document: WorkspaceDocument;
  isSelected: boolean;
  onToggleSelect: () => void;
  onFolderUpload?: (folderId: string, input: HTMLInputElement) => void;
}>;

export const DocumentRow = memo(function DocumentRow({ document, isSelected, onToggleSelect, onFolderUpload }: DocumentRowProps) {
  const { t } = useModuleTranslation('workspace');
  const { isDeleteDialogOpen, setIsDeleteDialogOpen, isDownloading, isDeleting, isReindexing, canIndex, canReindex, isViewable, handleDownload, handleDelete, handleReindex, handleViewFile } = useDocumentActions(document);

  const selectedWorkspace = useSelectedWorkspace();
  const isUploading = useWorkspaceStore((state) => state.isUploading);

  const isMobile = useIsMobile();
  const [isSubFolderDialogOpen, setIsSubFolderDialogOpen] = useState(false);

  const handleDeleteClick = useCallback(() => {
    setIsDeleteDialogOpen(true);
  }, [setIsDeleteDialogOpen]);

  const handleUploadClick = useCallback(() => {
    onFolderUpload?.(document.id);
  }, [document.id, onFolderUpload]);

  const handleCreateSubFolder = useCallback(async () => {
    setIsSubFolderDialogOpen(true);
  }, []);

  return (
    <>
      <TableRow className='group'>
        <TableCell>
          <Checkbox checked={isSelected} onCheckedChange={onToggleSelect} aria-label={t('documents.row.selectCheckbox', { name: document.originalName })} />
        </TableCell>
        <TableCell>
          <div className='flex items-center gap-2'>
            {document.isFolder ? (
              <Folder className='h-4 w-4 text-blue-500 shrink-0' />
            ) : (
              <FileText className='h-4 w-4 text-muted-foreground shrink-0' />
            )}
            <span className='font-medium truncate max-w-50 md:max-w-75'>{document.originalName}</span>
          </div>
        </TableCell>
        <TableCell className='text-muted-foreground hidden md:table-cell'>{document.isFolder ? '-' : formatFileSize(document.size)}</TableCell>
        <TableCell className='hidden md:table-cell'>
          <Badge variant='outline' className='text-xs'>
            {document.isFolder ? 'Folder' : getFileTypeLabel(document.mimeType)}
          </Badge>
        </TableCell>
        <TableCell className='hidden lg:table-cell'>
          {!document.isFolder && <IndexingStatusBadge status={document.indexingStatus} error={document.indexingError} />}
        </TableCell>
        <TableCell>
          <div className='flex gap-1 md:opacity-0 md:group-hover:opacity-100 transition-opacity'>
            {document.isFolder && (
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
      {document.isFolder && (
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
