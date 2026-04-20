/**
 * Workspace Content
 * Main content area showing documents table with Drive-like folder navigation
 */

import { useState, useCallback, useMemo } from 'react';
import { Search, Layers, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useWorkspaceStore, useSelectedWorkspace, useWorkspaceLoading, useDocuments } from '../store';
import { useDocumentDragDrop } from '../hooks';
import { formatFileSize } from '../utils';
import { DocumentsTable } from './DocumentsTable';
import { CreateFolderDialog } from './CreateFolderDialog';
import { UploadDropZone } from './UploadDropZone';
import { FolderTreeSidebar } from './FolderTreeSidebar';
import { FolderNavigation, BreadcrumbItem } from './FolderNavigation';
import { useModuleTranslation } from '@/modules/localization';

export function WorkspaceContent() {
  const { t } = useModuleTranslation('workspace');
  const selectedWorkspace = useSelectedWorkspace();
  const { isLoadingWorkspaces } = useWorkspaceLoading();
  const { documents } = useDocuments();
  const createFolder = useWorkspaceStore((state) => state.createFolder);
  const deleteFolder = useWorkspaceStore((state) => state.deleteFolder);
  const selectedWorkspaceId = useWorkspaceStore((state) => state.selectedWorkspaceId);

  // Folder navigation state
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);

  // Dialog states
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
  const [createFolderParentId, setCreateFolderParentId] = useState<string | undefined>(undefined);
  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false);
  const [renameFolderId, setRenameFolderId] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState('');

  // Drag and drop hook
  const { isDragging, draggedItems, handleDropOnRoot } = useDocumentDragDrop();

  // Get current folder contents
  const currentDocuments = useMemo(() => {
    return documents.filter((d) => {
      // For root (null), show items with no parentId
      if (currentFolderId === null) {
        return d.parentId === null || d.parentId === undefined;
      }
      // For specific folder, show items matching the parentId
      return d.parentId === currentFolderId;
    });
  }, [documents, currentFolderId]);

  // Build breadcrumbs
  const breadcrumbs = useMemo(() => {
    const items: BreadcrumbItem[] = [];
    let currentId = currentFolderId;

    while (currentId) {
      const folder = documents.find((d) => d.id === currentId && d.isFolder);
      if (folder) {
        items.unshift({
          id: folder.id,
          name: folder.folderName || folder.originalName,
        });
        currentId = folder.parentId || null;
      } else {
        break;
      }
    }

    return items;
  }, [currentFolderId, documents]);

  // Handle folder navigation
  const handleNavigate = useCallback((folderId: string | null) => {
    setCurrentFolderId(folderId);
  }, []);

  // Handle create folder
  const handleCreateFolder = useCallback(async (name: string) => {
    if (selectedWorkspaceId) {
      await createFolder(selectedWorkspaceId, {
        name,
        parentId: createFolderParentId,
      });
      setIsCreateFolderOpen(false);
      setCreateFolderParentId(undefined);
    }
  }, [selectedWorkspaceId, createFolder, createFolderParentId]);

  const handleOpenCreateFolder = useCallback((parentId?: string) => {
    setCreateFolderParentId(parentId);
    setIsCreateFolderOpen(true);
  }, []);

  // Handle rename folder
  const handleRenameFolder = useCallback((folderId: string) => {
    const folder = documents.find((d) => d.id === folderId && d.isFolder);
    if (folder) {
      setRenameFolderId(folderId);
      setNewFolderName(folder.folderName || folder.originalName);
      setIsRenameDialogOpen(true);
    }
  }, [documents]);

  const handleConfirmRename = useCallback(async () => {
    if (renameFolderId && selectedWorkspaceId && newFolderName.trim()) {
      // TODO: Implement rename in store
      setIsRenameDialogOpen(false);
      setRenameFolderId(null);
      setNewFolderName('');
    }
  }, [renameFolderId, selectedWorkspaceId, newFolderName]);

  // Handle delete folder
  const handleDeleteFolder = useCallback(async (folderId: string) => {
    if (selectedWorkspaceId && confirm(t('folder.deleteConfirm'))) {
      try {
        await deleteFolder(selectedWorkspaceId, folderId);
        if (currentFolderId === folderId) {
          setCurrentFolderId(null);
        }
      } catch (error) {
        console.error('Failed to delete folder:', error);
      }
    }
  }, [selectedWorkspaceId, deleteFolder, currentFolderId, t]);

  return (
    <div className="flex-1 min-w-0 h-full overflow-hidden bg-background flex flex-col">
      {!selectedWorkspace ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-8 bg-muted/10">
          <div className="w-16 h-16 text-muted-foreground/30 mb-4">
            <Layers className="h-8 w-8" />
          </div>
          <p className="text-sm text-muted-foreground">{t('content.noWorkspace')}</p>
        </div>
      ) : (
        <UploadDropZone
          onDrop={handleDropOnRoot}
          workspaceId={selectedWorkspaceId}
          folderId={currentFolderId}
        >
          {/* Header */}
          <div className="p-3 md:p-4 border-b shrink-0 bg-card">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold">{selectedWorkspace.name}</h2>
                <span className="text-sm text-muted-foreground">
                  {currentDocuments.filter(d => !d.isFolder).length} {t('content.documents')}
                </span>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                {/* Search */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input placeholder={t('content.searchPlaceholder')} className="pl-9 h-9" />
                </div>

                {/* Create folder button */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleOpenCreateFolder(currentFolderId || undefined)}
                  className="gap-2"
                >
                  <Plus className="h-4 w-4" />
                  {t('content.createFolder')}
                </Button>
              </div>
            </div>

            {/* Storage info */}
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span>{t('content.storageUsed')} {formatFileSize(selectedWorkspace.usedStorage)}</span>
              <span>/</span>
              <span>{formatFileSize(selectedWorkspace.allocatedStorage)}</span>
            </div>
          </div>

          {/* Main content area with sidebar and content */}
          <div className="flex-1 flex min-h-0">
            {/* Left Sidebar - Folder Tree */}
            <div className="w-64 shrink-0 hidden md:flex border-r bg-muted/30">
              <FolderTreeSidebar
                documents={documents}
                currentFolderId={currentFolderId}
                onFolderSelect={handleNavigate}
                onCreateFolder={handleOpenCreateFolder}
                onDeleteFolder={handleDeleteFolder}
                onRenameFolder={handleRenameFolder}
              />
            </div>

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col min-w-0">
              {/* Folder Navigation (Breadcrumbs) */}
              <FolderNavigation breadcrumbs={breadcrumbs} onNavigate={handleNavigate} />

              {/* Content */}
              <ScrollArea className="flex-1 bg-background">
                <div className="p-4">
                  {/* Documents table for current folder */}
                  <DocumentsTable folderId={currentFolderId} />
                </div>
              </ScrollArea>
            </div>
          </div>

          {/* Create Folder Dialog */}
          <CreateFolderDialog
            open={isCreateFolderOpen}
            onOpenChange={setIsCreateFolderOpen}
            workspaceId={selectedWorkspaceId}
            parentFolderId={createFolderParentId}
          />

          {/* Rename Folder Dialog */}
          <Dialog open={isRenameDialogOpen} onOpenChange={setIsRenameDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t('folder.renameTitle')}</DialogTitle>
              </DialogHeader>
              <Input
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder={t('folder.namePlaceholder')}
                autoFocus
              />
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsRenameDialogOpen(false)}>
                  {t('folder.cancel')}
                </Button>
                <Button onClick={handleConfirmRename} disabled={!newFolderName.trim()}>
                  {t('folder.rename')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Drag overlay indicator */}
          {isDragging && (
            <div className="fixed inset-0 z-50 bg-black/5 flex items-center justify-center pointer-events-none">
              <div className="bg-white rounded-lg p-6 shadow-xl">
                <p className="text-sm text-muted-foreground">
                  {draggedItems.length > 0 ? (
                    <>
                      <span className="h-5 w-5 text-blue-500 mr-2 inline-block">📁</span>
                      {t('folder.draggingMultiple', { count: draggedItems.length })}
                    </>
                  ) : (
                    <>
                      <span className="h-5 w-5 text-blue-500 mr-2 inline-block">📄</span>
                      {t('folder.draggingSingle')}
                    </>
                  )}
                </p>
              </div>
            </div>
          )}
        </UploadDropZone>
      )}
    </div>
  );
}
