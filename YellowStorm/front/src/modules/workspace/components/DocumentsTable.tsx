/**
 * Documents Table
 * Table showing documents with multi-select capability
 * Responsive: Card layout on mobile, table on larger screens
 */

import { useState, useRef, useCallback } from 'react';
import { Loader2, Upload, ChevronLeft, ChevronRight, FolderPlus } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useModuleTranslation } from '@/modules/localization';
import { useWorkspaceStore, useDocuments, useDocumentPagination, useWorkspaceLoading, useSelectedWorkspace } from '../store';
import { DEFAULT_PAGE_LIMIT, ACCEPT_EXTENSIONS, validateFiles } from '../utils';
import { useDocumentSelection } from '../hooks';
import { useDocumentDragDrop } from '../hooks/useDocumentDragDrop';
import { FloatingActionBar } from './FloatingActionBar';
import DocumentRow from './DocumentRow';
import { DocumentCard } from './DocumentRow/DocumentCard';
import { CreateFolderDialog } from './CreateFolderDialog';

interface DocumentsTableProps {
  onFolderDoubleClick?: (folderId: string) => void;
}

export function DocumentsTable({ onFolderDoubleClick }: DocumentsTableProps) {
  const { t } = useModuleTranslation('workspace');
  const { documents } = useDocuments();
  const selectedWorkspace = useSelectedWorkspace();
  const { currentPage, totalPages, totalDocuments } = useDocumentPagination();
  const { isLoadingDocuments } = useWorkspaceLoading();
  const fetchDocuments = useWorkspaceStore((state) => state.fetchDocuments);
  const addFilesToQueue = useWorkspaceStore((state) => state.addFilesToQueue);
  const startUpload = useWorkspaceStore((state) => state.startUpload);
  const createFolder = useWorkspaceStore((state) => state.createFolder);
  const currentFolderId = useWorkspaceStore((state) => state.currentFolderId);

  // Drag and drop
  const {
    isDragging,
    dropTargetId,
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDragLeave,
    handleDropOnFolder,
    handleDropOnRoot,
  } = useDocumentDragDrop();

  const { selectedCount, isAllSelected, isSomeSelected, isSelected, toggleSelect, toggleSelectAll, clearSelection, getSelectedIds } = useDocumentSelection(documents);

  // Create folder dialog
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);

  const handleCreateFolder = useCallback(async (name: string) => {
    if (selectedWorkspace) {
      await createFolder(selectedWorkspace.id, {
        name,
        parentId: currentFolderId || undefined,
      });
      setIsCreateFolderOpen(false);
      // Refresh folders in sidebar and documents list
      const fetchAllFolders = useWorkspaceStore.getState().fetchAllFolders;
      const fetchDocuments = useWorkspaceStore.getState().fetchDocuments;
      await fetchAllFolders(selectedWorkspace.id);
      await fetchDocuments(selectedWorkspace.id, 1);
    }
  }, [selectedWorkspace, createFolder, currentFolderId]);

  // Shared file input ref for folder uploads
  const folderFileInputRef = useRef<HTMLInputElement>(null);
  const [currentUploadFolderId, setCurrentUploadFolderId] = useState<string | null>(null);

  const handlePrevPage = () => {
    if (selectedWorkspace && currentPage > 1) {
      fetchDocuments(selectedWorkspace.id, currentPage - 1);
    }
  };

  const handleNextPage = () => {
    if (selectedWorkspace && currentPage < totalPages) {
      fetchDocuments(selectedWorkspace.id, currentPage + 1);
    }
  };

  const handleFolderUpload = (folderId: string) => {
    setCurrentUploadFolderId(folderId);
    folderFileInputRef.current?.click();
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0 || !selectedWorkspace) return;

    const { validFiles } = validateFiles(files);
    if (validFiles.length > 0) {
      addFilesToQueue(validFiles, selectedWorkspace.id, currentUploadFolderId ?? undefined);
      startUpload();
    }

    e.target.value = '';
    setCurrentUploadFolderId(null);
  };

  if (isLoadingDocuments) {
    return (
      <div className='flex items-center justify-center py-12'>
        <Loader2 className='h-8 w-8 animate-spin text-muted-foreground' />
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <div className='flex flex-col items-center justify-center py-16 text-center w-full'>
        <div className='rounded-full bg-muted/50 p-6 mb-6'>
          <Upload className='h-12 w-12 text-muted-foreground/70' />
        </div>
        <h3 className='text-lg font-medium text-foreground mb-2'>{t('documents.empty.title')}</h3>
        <p className='text-sm text-muted-foreground max-w-sm mb-4'>{t('documents.empty.description', { action: t('upload.button.add') })}</p>
        <div className='flex gap-2'>
          <Button variant='outline' size='sm' onClick={() => setIsCreateFolderOpen(true)} className='gap-2'>
            <FolderPlus className='h-4 w-4' />
            {t('content.createFolder')}
          </Button>
        </div>
        <p className='text-xs text-muted-foreground mt-3'>{t('documents.empty.supported')}</p>
      </div>
    );
  }

  const PaginationBar = () => {
    if (totalPages <= 1) return null;
    const startIndex = (currentPage - 1) * DEFAULT_PAGE_LIMIT + 1;
    const endIndex = Math.min(currentPage * DEFAULT_PAGE_LIMIT, totalDocuments);
    return (
      <div className='flex flex-col sm:flex-row items-center justify-between gap-2 px-3 md:px-4 py-3 border-t bg-background shrink-0'>
        <p className='text-xs sm:text-sm text-muted-foreground text-center sm:text-left'>
          <span className='hidden sm:inline'>{t('documents.pagination.range', { start: startIndex, end: endIndex, total: totalDocuments })}</span>
          <span className='sm:hidden'>{t('documents.pagination.mobile', { total: totalDocuments })}</span>
        </p>
        <div className='flex items-center gap-2'>
          <Button variant='ghost' size='icon' className='h-8 w-8' disabled={currentPage === 1} onClick={handlePrevPage}>
            <ChevronLeft className='h-4 w-4' />
          </Button>
          <span className='text-sm text-muted-foreground min-w-12.5 text-center'>
            {currentPage} / {totalPages}
          </span>
          <Button variant='ghost' size='icon' className='h-8 w-8' disabled={currentPage === totalPages} onClick={handleNextPage}>
            <ChevronRight className='h-4 w-4' />
          </Button>
        </div>
      </div>
    );
  };

  return (
    <>
      <div className='relative h-full flex flex-col'>
        {/* Hidden shared file input for folder uploads */}
      <input
        ref={folderFileInputRef}
        type='file'
        accept={ACCEPT_EXTENSIONS}
        multiple
        style={{ position: 'absolute', left: -9999, visibility: 'hidden' }}
        onChange={handleFileInputChange}
      />

      {/* Mobile: Card layout */}
      <div className='flex flex-col sm:hidden flex-1 min-h-0'>
        {/* Mobile select all header */}
        <div className='flex items-center gap-3 px-3 py-2 border-b bg-muted/30 shrink-0'>
          <Checkbox checked={isAllSelected} onCheckedChange={toggleSelectAll} aria-label={t('documents.selection.selectAll')} {...(isSomeSelected ? { 'data-state': 'indeterminate' } : {})} />
          <span className='text-sm text-muted-foreground'>{selectedCount > 0 ? t('documents.selection.selected', { count: selectedCount }) : t('documents.selection.selectAll')}</span>
        </div>
        {/* Height: viewport - modal chrome (40px) - header (~180px) - select bar (44px) - pagination (56px) = ~320px */}
        <ScrollArea className='h-[calc(100vh-320px)]'>
          <div className='divide-y w-full'>
            {documents.map((document) => (
              <DocumentCard
                key={document.id}
                document={document}
                isSelected={isSelected(document.id)}
                onToggleSelect={() => toggleSelect(document.id)}
                onFolderUpload={handleFolderUpload}
                onFolderDoubleClick={onFolderDoubleClick}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onDropOnFolder={handleDropOnFolder}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                isDropTarget={dropTargetId === document.id}
              />
            ))}
          </div>
        </ScrollArea>
        {/* Mobile pagination */}
        <PaginationBar />
      </div>

      {/* Desktop/Tablet: Table layout */}
      <div className='hidden sm:flex sm:flex-col flex-1 min-h-0'>
        <div className='flex-1 overflow-auto'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className='w-10 md:w-12'>
                  <Checkbox checked={isAllSelected} onCheckedChange={toggleSelectAll} aria-label={t('documents.selection.selectAll')} {...(isSomeSelected ? { 'data-state': 'indeterminate' } : {})} />
                </TableHead>
                <TableHead>{t('documents.table.headers.name')}</TableHead>
                <TableHead className='w-24 hidden md:table-cell'>{t('documents.table.headers.size')}</TableHead>
                <TableHead className='w-28 hidden md:table-cell'>{t('documents.table.headers.type')}</TableHead>
                <TableHead className='w-36 hidden lg:table-cell'>{t('documents.table.headers.indexing')}</TableHead>
                <TableHead className='w-24'>{t('documents.table.headers.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((document) => (
                <DocumentRow
                  key={document.id}
                  document={document}
                  isSelected={isSelected(document.id)}
                  onToggleSelect={() => toggleSelect(document.id)}
                  onFolderUpload={handleFolderUpload}
                  onFolderDoubleClick={onFolderDoubleClick}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onDropOnFolder={handleDropOnFolder}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  isDropTarget={dropTargetId === document.id}
                />
              ))}
            </TableBody>
          </Table>
        </div>
        {/* Desktop pagination */}
        <PaginationBar />
      </div>

        {/* Floating action bar for bulk operations */}
        {selectedCount > 0 && <FloatingActionBar selectedCount={selectedCount} selectedIds={getSelectedIds()} onClearSelection={clearSelection} />}
      </div>

      {/* Create Folder Dialog */}
    <CreateFolderDialog
      open={isCreateFolderOpen}
      onOpenChange={setIsCreateFolderOpen}
      workspaceId={selectedWorkspace?.id || ''}
      parentFolderId={currentFolderId || undefined}
    />
  </>
  );
}
