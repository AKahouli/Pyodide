/**
 * Workspace Content
 * Main content area showing documents table for the selected workspace
 */

import { useMemo, useState, useCallback } from 'react';
import { Search, MoreHorizontal, Pencil, Settings, FileX, Trash2, Layers, ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useWorkspaceStore, useSelectedWorkspace, useWorkspaceLoading } from '../store';
import { useModalCloseEffect, useDebouncedSearch, useIndexingNotifications } from '../hooks';
import { formatFileSize } from '../utils';
import { DocumentsTable } from './DocumentsTable';
import { UploadDropZone } from './UploadDropZone';
import { UploadButton } from './UploadButton';
import { ConfirmDialog, RenameDialog } from './dialogs';
import { Progress } from '@/components/ui/progress';
import { useModuleTranslation } from '@/modules/localization';

export function WorkspaceContent() {
  const { t } = useModuleTranslation('workspace');
  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleteDocsDialogOpen, setIsDeleteDocsDialogOpen] = useState(false);

  // Subscribe to indexing notifications for real-time status updates
  useIndexingNotifications();

  const selectedWorkspace = useSelectedWorkspace();
  const { isDeleting, isLoadingWorkspaces } = useWorkspaceLoading();
  const totalWorkspaces = useWorkspaceStore((state) => state.totalWorkspaces);

  const searchDocuments = useWorkspaceStore((state) => state.searchDocuments);
  const renameWorkspace = useWorkspaceStore((state) => state.renameWorkspace);
  const deleteWorkspace = useWorkspaceStore((state) => state.deleteWorkspace);
  const deleteAllDocuments = useWorkspaceStore((state) => state.deleteAllDocuments);
  const openSettingsModal = useWorkspaceStore((state) => state.openSettingsModal);
  const toggleMobileSidebar = useWorkspaceStore((state) => state.toggleMobileSidebar);

  // Debounced search
  const { value: searchInput, onChange: handleSearchChange, reset: resetSearch } = useDebouncedSearch(useCallback((value: string) => searchDocuments(value), [searchDocuments]));

  // Close all nested dialogs when parent modal closes
  useModalCloseEffect(
    useCallback(() => {
      setIsRenameDialogOpen(false);
      setIsDeleteDialogOpen(false);
      setIsDeleteDocsDialogOpen(false);
      resetSearch();
    }, [resetSearch]),
  );

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleSearchChange(e.target.value);
  };

  const handleRename = async (newName: string) => {
    if (selectedWorkspace) {
      await renameWorkspace(selectedWorkspace.id, newName);
    }
  };

  const handleDelete = async () => {
    if (selectedWorkspace) {
      await deleteWorkspace(selectedWorkspace.id);
    }
    setIsDeleteDialogOpen(false);
  };

  const handleDeleteAllDocs = async () => {
    if (selectedWorkspace) {
      await deleteAllDocuments(selectedWorkspace.id);
    }
    setIsDeleteDocsDialogOpen(false);
  };

  const countsLabel = useMemo(() => {
    if (!selectedWorkspace) return '';
    return t('content.counts', {
      count: selectedWorkspace.documentCount,
      used: formatFileSize(selectedWorkspace.usedStorage),
      allocated: formatFileSize(selectedWorkspace.allocatedStorage),
    });
  }, [t, selectedWorkspace]);
  const menuLabels = useMemo(
    () => ({
      rename: t('item.menu.rename'),
      settings: t('item.menu.settings'),
      deleteDocs: t('content.menu.deleteDocs'),
      deleteWorkspace: t('content.menu.deleteWorkspace'),
    }),
    [t],
  );
  const deleteWorkspaceLabels = useMemo(
    () => ({
      title: t('item.dialogs.deleteWorkspace.title'),
      description: t('item.dialogs.deleteWorkspace.description', {
        name: selectedWorkspace?.name ?? '',
        count: selectedWorkspace?.documentCount ?? 0,
      }),
      confirm: t('item.dialogs.deleteWorkspace.confirm'),
      deleting: t('item.dialogs.deleteWorkspace.deleting'),
    }),
    [t, selectedWorkspace?.name, selectedWorkspace?.documentCount],
  );
  const deleteDocumentsLabels = useMemo(
    () => ({
      title: t('item.dialogs.deleteDocuments.title'),
      description: t('item.dialogs.deleteDocuments.description', {
        name: selectedWorkspace?.name ?? '',
        count: selectedWorkspace?.documentCount ?? 0,
      }),
      confirm: t('item.dialogs.deleteDocuments.confirm'),
      deleting: t('item.dialogs.deleteDocuments.deleting'),
    }),
    [t, selectedWorkspace?.name, selectedWorkspace?.documentCount],
  );

  // No workspace selected - show placeholder
  if (!selectedWorkspace) {
    const showCreateWorkspaceMessage = !isLoadingWorkspaces && totalWorkspaces === 0;
    return (
      <div className='flex-1 flex flex-col items-center justify-center text-center p-8 bg-muted/10'>
        {/* Mobile: show back button */}
        <Button variant='ghost' size='sm' className='md:hidden absolute top-4 left-4' onClick={toggleMobileSidebar}>
          <ChevronLeft className='h-4 w-4 mr-1' />
          {t('content.empty.back')}
        </Button>
        <Layers className='h-16 w-16 text-muted-foreground/50 mb-4' />
        <h3 className='text-lg font-medium text-muted-foreground'>{t(showCreateWorkspaceMessage ? 'content.empty.createTitle' : 'content.empty.title')}</h3>
        <p className='text-sm text-muted-foreground mt-1'>{t(showCreateWorkspaceMessage ? 'content.empty.createDescription' : 'content.empty.description')}</p>
      </div>
    );
  }

  return (
    <UploadDropZone>
      {/* Header */}
      <div className='p-3 md:p-4 border-b shrink-0'>
        {/* Mobile layout */}
        <div className='md:hidden space-y-2'>
          {/* Row 1: back button, title, actions */}
          <div className='flex items-center gap-2'>
            <Button variant='ghost' size='icon' className='shrink-0 h-8 w-8' onClick={toggleMobileSidebar}>
              <ChevronLeft className='h-4 w-4' />
            </Button>
            <h2 className='text-base font-semibold truncate flex-1 min-w-0'>{selectedWorkspace.name}</h2>
            <div className='flex items-center gap-1 shrink-0'>
              <UploadButton />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant='ghost' size='icon' className='h-8 w-8'>
                    <MoreHorizontal className='h-4 w-4' />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='end'>
                  <DropdownMenuItem onClick={() => setIsRenameDialogOpen(true)} className='cursor-pointer'>
                    <Pencil className='mr-2 h-4 w-4' />
                    {menuLabels.rename}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => openSettingsModal()} className='cursor-pointer'>
                    <Settings className='mr-2 h-4 w-4' />
                    {menuLabels.settings}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setIsDeleteDocsDialogOpen(true)} className='cursor-pointer' disabled={selectedWorkspace.documentCount === 0}>
                    <FileX className='mr-2 h-4 w-4' />
                    {menuLabels.deleteDocs}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setIsDeleteDialogOpen(true)} className='cursor-pointer text-destructive focus:text-destructive'>
                    <Trash2 className='mr-2 h-4 w-4' />
                    {menuLabels.deleteWorkspace}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          {/* Row 2: storage info + progress */}
          <div className='space-y-1'>
            <p className='text-xs text-muted-foreground'>{countsLabel}</p>
            <Progress value={(selectedWorkspace.usedStorage / selectedWorkspace.allocatedStorage) * 100} className='h-1.5' />
          </div>
          {/* Row 3: search */}
          <div className='relative w-full'>
            <Search className='absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground' />
            <Input placeholder={t('content.searchPlaceholder')} value={searchInput} onChange={handleSearch} className='pl-9 h-9' />
          </div>
        </div>

        {/* Desktop layout */}
        <div className='hidden md:flex items-center gap-4'>
          {/* Title and info */}
          <div className='min-w-0 flex-1'>
            <h2 className='text-lg font-semibold truncate'>{selectedWorkspace.name}</h2>
            <p className='text-sm text-muted-foreground truncate'>{countsLabel}</p>
            <Progress value={(selectedWorkspace.usedStorage / selectedWorkspace.allocatedStorage) * 100} className='mt-1' />
          </div>

          {/* Search bar */}
          <div className='relative w-64'>
            <Search className='absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground' />
            <Input placeholder={t('content.searchPlaceholder')} value={searchInput} onChange={handleSearch} className='pl-9 h-9' />
          </div>

          {/* Actions */}
          <div className='flex items-center gap-2 shrink-0'>
            <UploadButton />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant='ghost' size='icon' className='h-9 w-9'>
                  <MoreHorizontal className='h-4 w-4' />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end'>
                <DropdownMenuItem onClick={() => setIsRenameDialogOpen(true)} className='cursor-pointer'>
                  <Pencil className='mr-2 h-4 w-4' />
                  {menuLabels.rename}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => openSettingsModal()} className='cursor-pointer'>
                  <Settings className='mr-2 h-4 w-4' />
                  {menuLabels.settings}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setIsDeleteDocsDialogOpen(true)} className='cursor-pointer' disabled={selectedWorkspace.documentCount === 0}>
                  <FileX className='mr-2 h-4 w-4' />
                  {menuLabels.deleteDocs}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setIsDeleteDialogOpen(true)} className='cursor-pointer text-destructive focus:text-destructive'>
                  <Trash2 className='mr-2 h-4 w-4' />
                  {menuLabels.deleteWorkspace}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {/* Documents table */}
      <ScrollArea className='flex-1'>
        <DocumentsTable />
      </ScrollArea>

      <RenameDialog open={isRenameDialogOpen} onOpenChange={setIsRenameDialogOpen} currentName={selectedWorkspace.name} entityType='workspace' onRename={handleRename} />

      <ConfirmDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen} title={deleteWorkspaceLabels.title} description={deleteWorkspaceLabels.description} confirmLabel={isDeleting ? deleteWorkspaceLabels.deleting : deleteWorkspaceLabels.confirm} variant='destructive' isLoading={isDeleting} onConfirm={handleDelete} />

      <ConfirmDialog open={isDeleteDocsDialogOpen} onOpenChange={setIsDeleteDocsDialogOpen} title={deleteDocumentsLabels.title} description={deleteDocumentsLabels.description} confirmLabel={isDeleting ? deleteDocumentsLabels.deleting : deleteDocumentsLabels.confirm} variant='destructive' isLoading={isDeleting} onConfirm={handleDeleteAllDocs} />
    </UploadDropZone>
  );
}
