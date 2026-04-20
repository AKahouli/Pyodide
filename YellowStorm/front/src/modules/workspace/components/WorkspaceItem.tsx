/**
 * Workspace Item
 * Single workspace item in the sidebar with hover-reveal 3-dot menu
 */

import { useState, useCallback, useMemo } from 'react';
import { MoreHorizontal, Pencil, Settings, FileX, Trash2, FileText, User, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { useWorkspaceStore } from '../store';
import { useModalCloseEffect } from '../hooks';
import { formatFileSize } from '../utils';
import { ConfirmDialog, RenameDialog } from './dialogs';
import type { Workspace } from '../types';

interface WorkspaceItemProps {
  workspace: Workspace;
  isSelected: boolean;
}

export function WorkspaceItem({ workspace, isSelected }: WorkspaceItemProps) {
  const { t } = useModuleTranslation('workspace');
  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleteDocsDialogOpen, setIsDeleteDocsDialogOpen] = useState(false);

  const selectWorkspace = useWorkspaceStore((state) => state.selectWorkspace);
  const renameWorkspace = useWorkspaceStore((state) => state.renameWorkspace);
  const deleteWorkspace = useWorkspaceStore((state) => state.deleteWorkspace);
  const deleteAllDocuments = useWorkspaceStore((state) => state.deleteAllDocuments);
  const openSettingsModal = useWorkspaceStore((state) => state.openSettingsModal);
  const isDeleting = useWorkspaceStore((state) => state.isDeleting);
  const menuLabels = useMemo(
    () => ({
      rename: t('item.menu.rename'),
      settings: t('item.menu.settings'),
      deleteDocs: t('item.menu.deleteDocs'),
      delete: t('item.menu.delete'),
    }),
    [t],
  );
  const deleteWorkspaceLabels = useMemo(
    () => ({
      title: t('item.dialogs.deleteWorkspace.title'),
      description: t('item.dialogs.deleteWorkspace.description', {
        name: workspace.name,
        count: workspace.documentCount,
      }),
      confirm: t('item.dialogs.deleteWorkspace.confirm'),
      deleting: t('item.dialogs.deleteWorkspace.deleting'),
    }),
    [t, workspace.name, workspace.documentCount],
  );
  const deleteDocumentsLabels = useMemo(
    () => ({
      title: t('item.dialogs.deleteDocuments.title'),
      description: t('item.dialogs.deleteDocuments.description', {
        name: workspace.name,
        count: workspace.documentCount,
      }),
      confirm: t('item.dialogs.deleteDocuments.confirm'),
      deleting: t('item.dialogs.deleteDocuments.deleting'),
    }),
    [t, workspace.name, workspace.documentCount],
  );

  // Close all nested dialogs when parent modal closes
  useModalCloseEffect(
    useCallback(() => {
      setIsRenameDialogOpen(false);
      setIsDeleteDialogOpen(false);
      setIsDeleteDocsDialogOpen(false);
    }, []),
  );

  const handleSelect = useCallback(() => {
    selectWorkspace(workspace.id);
  }, [workspace.id, selectWorkspace]);

  const handleRename = useCallback(
    async (newName: string) => {
      await renameWorkspace(workspace.id, newName);
    },
    [workspace.id, renameWorkspace],
  );

  const handleDelete = useCallback(async () => {
    await deleteWorkspace(workspace.id);
    setIsDeleteDialogOpen(false);
  }, [workspace.id, deleteWorkspace]);

  const handleDeleteAllDocs = useCallback(async () => {
    await deleteAllDocuments(workspace.id);
    setIsDeleteDocsDialogOpen(false);
  }, [workspace.id, deleteAllDocuments]);

  const handleRenameClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsRenameDialogOpen(true);
  }, []);

  const handleSettingsClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      openSettingsModal(workspace);
    },
    [workspace, openSettingsModal],
  );

  const handleDeleteDocsClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsDeleteDocsDialogOpen(true);
  }, []);

  const handleDeleteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsDeleteDialogOpen(true);
  }, []);

  // Check if workspace is personal (cannot be renamed/deleted)
  const isPersonal = workspace.isPersonal || false;

  return (
    <>
      <div
        className={cn(
          'group/item relative flex items-center p-2 rounded-lg cursor-pointer transition-colors',
          isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
          isPersonal && 'border-l-2 border-l-primary',
        )}
        onClick={handleSelect}
      >
        <div className='flex-1 min-w-0 pr-8'>
          <div className='flex items-center gap-2'>
            {isPersonal ? (
              <Home className='h-4 w-4 text-primary' />
            ) : null}
            <div className='font-medium text-sm truncate'>{workspace.name}</div>
            {isPersonal && (
              <span className='text-xs text-primary ml-2'>{t('item.personalBadge')}</span>
            )}
          </div>
          <div className='flex items-center gap-2 text-xs text-muted-foreground'>
            <span className='flex items-center gap-1'>
              <FileText className='h-3 w-3' />
              {workspace.documentCount}
            </span>
            <span>{formatFileSize(workspace.usedStorage)}</span>
          </div>
        </div>

        {/* Dropdown menu - show all options for regular workspaces, only settings for personal */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant='ghost'
              size='icon'
              className='absolute right-1 h-7 w-7 opacity-0 group-hover/item:opacity-100 transition-opacity'
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className='h-4 w-4' />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            {!isPersonal && (
              <>
                <DropdownMenuItem onClick={handleRenameClick} className='cursor-pointer'>
                  <Pencil className='mr-2 h-4 w-4' />
                  {menuLabels.rename}
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuItem onClick={handleSettingsClick} className='cursor-pointer'>
              <Settings className='mr-2 h-4 w-4' />
              {menuLabels.settings}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleDeleteDocsClick} className='cursor-pointer' disabled={workspace.documentCount === 0}>
              <FileX className='mr-2 h-4 w-4' />
              {menuLabels.deleteDocs}
            </DropdownMenuItem>
            {!isPersonal && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleDeleteClick} className='cursor-pointer text-destructive focus:text-destructive'>
                  <Trash2 className='mr-2 h-4 w-4' />
                  {menuLabels.delete}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Rename Dialog */}
      <RenameDialog
        open={isRenameDialogOpen}
        onOpenChange={setIsRenameDialogOpen}
        currentName={workspace.name}
        entityType='workspace'
        onRename={handleRename}
      />

      {/* Delete Workspace Dialog */}
      <ConfirmDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        title={deleteWorkspaceLabels.title}
        description={deleteWorkspaceLabels.description}
        confirmLabel={isDeleting ? deleteWorkspaceLabels.deleting : deleteWorkspaceLabels.confirm}
        variant='destructive'
        isLoading={isDeleting}
        onConfirm={handleDelete}
      />

      {/* Delete All Docs Dialog */}
      <ConfirmDialog
        open={isDeleteDocsDialogOpen}
        onOpenChange={setIsDeleteDocsDialogOpen}
        title={deleteDocumentsLabels.title}
        description={deleteDocumentsLabels.description}
        confirmLabel={isDeleting ? deleteDocumentsLabels.deleting : deleteDocumentsLabels.confirm}
        variant='destructive'
        isLoading={isDeleting}
        onConfirm={handleDeleteAllDocs}
      />
    </>
  );
}
