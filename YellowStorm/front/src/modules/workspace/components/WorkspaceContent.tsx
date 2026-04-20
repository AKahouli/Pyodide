/**
 * Workspace Content
 * Main content area showing documents table for selected workspace
 */

import { useMemo, useState, useCallback } from 'react';
import { Search, MoreHorizontal, Settings, Layers, List, Grid, Plus, FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useWorkspaceStore, useSelectedWorkspace, useWorkspaceLoading, useDocuments, useAllDocuments } from '../store';
import { useModalCloseEffect, useDebouncedSearch, useIndexingNotifications, useDocumentDragDrop } from '../hooks';
import { formatFileSize } from '../utils';
import { DocumentsTable } from './DocumentsTable';
import { FolderTree } from './FolderTree';
import { CreateFolderDialog } from './CreateFolderDialog';
import { ConfirmDialog, RenameDialog } from './dialogs';
import { UploadDropZone } from './UploadDropZone';
import { UploadButton } from './UploadButton';
import { useModuleTranslation } from '@/modules/localization';

export function WorkspaceContent() {
  const { t } = useModuleTranslation('workspace');
  const selectedWorkspace = useSelectedWorkspace();
  const { isLoadingWorkspaces } = useWorkspaceLoading();
  const { documents } = useAllDocuments();
  const createFolder = useWorkspaceStore((state) => state.createFolder);
  const getFolderContents = useWorkspaceStore((state) => state.getFolderContents);
  const isCreating = useWorkspaceStore((state) => state.isCreating);
  const selectedWorkspaceId = useWorkspaceStore((state) => state.selectedWorkspaceId);

  // Drag and drop hook
  const { isDragging, draggedItems, handleDragStart, handleDragEnd, handleDragOver, handleDropOnFolder, handleDropOnRoot } = useDocumentDragDrop();

  // View mode: list vs tree
  const [viewMode, setViewMode] = useState<'list' | 'tree'>('list');

  // Folder states
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  // Handle folder selection
  const handleFolderClick = useCallback((folderId: string) => {
    setSelectedFolderId(folderId);
    if (selectedWorkspaceId) {
      getFolderContents(selectedWorkspaceId, folderId);
    }
  }, [selectedWorkspaceId, getFolderContents]);

  // Handle folder expand/collapse
  const handleToggleExpand = useCallback((folderId: string) => {
    setExpandedFolders((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(folderId)) {
        newSet.delete(folderId);
      } else {
        newSet.add(folderId);
      }
      return newSet;
    });
  }, []);

  // Handle document selection
  const handleDocumentClick = useCallback((documentId: string) => {
    // Toggle selection (could be extended for multi-select)
    // For now, just log it
    console.log('Document selected:', documentId);
  }, []);

  // Handle document download
  const handleDocumentDownload = useCallback(async (documentId: string) => {
    // Implementation would call getDownloadUrl
    console.log('Download document:', documentId);
  }, []);

  // Handle document rename
  const handleDocumentRename = useCallback(async (documentId: string, newName: string) => {
    // Implementation would call renameDocument
    console.log('Rename document:', documentId, 'to:', newName);
  }, []);

  // Handle document delete
  const handleDocumentDelete = useCallback(async (documentId: string) => {
    // Implementation would call deleteDocument
    console.log('Delete document:', documentId);
  }, []);

  // Handle folder rename
  const handleFolderRename = useCallback(async (folderId: string, newName: string) => {
    if (selectedWorkspaceId) {
      await createFolder(selectedWorkspaceId, { name: newName, parentId: null });
    }
  }, [selectedWorkspaceId, createFolder]);

  // Handle folder delete
  const handleFolderDelete = useCallback(async (folderId: string) => {
    if (selectedWorkspaceId) {
      const deleteFolder = useWorkspaceStore.getState().deleteFolder;
      await deleteFolder(selectedWorkspaceId, folderId);
    }
  }, [selectedWorkspaceId]);

  // Handle create folder
  const handleCreateFolder = useCallback(async (name: string) => {
    if (selectedWorkspaceId) {
      await createFolder(selectedWorkspaceId, {
        name,
        parentId: selectedFolderId || undefined,
      });
      setIsCreateFolderOpen(false);
    }
  }, [selectedWorkspaceId, createFolder]);

  // Organize documents into folder structure for tree view
  const folderStructure = useMemo(() => {
    if (!selectedWorkspace || !selectedWorkspaceId) {
      return { folders: [], documents: [] };
    }

    // Filter folders and documents
    const folders = documents.filter((doc) => doc.isFolder) as WorkspaceDocument[];
    const docs = documents.filter((doc) => !doc.isFolder) as WorkspaceDocument[];

    // Create a map of folder children
    const folderMap = new Map<string, WorkspaceFolder>();
    const rootFolders: WorkspaceFolder[] = [];

    folders.forEach((folder) => {
      const folderData: WorkspaceFolder = {
        id: folder.id,
        folderName: folder.folderName!,
        parentId: folder.parentId,
        createdAt: folder.createdAt,
        children: [],
        isExpanded: expandedFolders.has(folder.id),
      };

      if (!folder.parentId) {
        rootFolders.push(folderData);
      }

      folderMap.set(folder.id, folderData);
    });

    // Organize documents into folders
    docs.forEach((doc) => {
      const folder = folderMap.get(doc.parentId || '');
      if (folder) {
        folder.children.push(doc);
      }
    });

    return { folders: rootFolders, documents: [] };
  }, [documents, expandedFolders]);

  return (
    <div className="flex-1 min-w-0 h-full overflow-hidden bg-background">
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
        >
          {/* Header */}
          <div className="p-3 md:p-4 border-b shrink-0 bg-card">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold">{selectedWorkspace.name}</h2>
                <span className="text-sm text-muted-foreground">
                  {documents.length} {t('content.documents')}
                </span>
              </div>

              {/* View mode toggle */}
              <div className="flex items-center gap-1">
                <Tabs value={viewMode} onValueChange={setViewMode} className="w-auto">
                  <TabsList className="w-auto">
                    <TabsTrigger value="list" className="w-auto">
                      <List className="h-4 w-4" />
                    </TabsTrigger>
                    <TabsTrigger value="tree" className="w-auto">
                      <FolderOpen className="h-4 w-4" />
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
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
                  onClick={() => setIsCreateFolderOpen(true)}
                  className="gap-2"
                >
                  <Plus className="h-4 w-4" />
                  {t('content.createFolder')}
                </Button>

                {/* Dropdown menu */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-9 w-9">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuItem>
                      <Grid className="h-4 w-4 mr-2" />
                      {t('content.gridView')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Storage info */}
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span>{t('content.storageUsed')} {formatFileSize(selectedWorkspace.usedStorage)}</span>
              <span>/</span>
              <span>{formatFileSize(selectedWorkspace.allocatedStorage)}</span>
            </div>
          </div>

          {/* Main content */}
          <ScrollArea className="flex-1 bg-background">
            <div className="p-4">
              {viewMode === 'tree' ? (
                <>
                  {/* Tree view */}
                  <div className="space-y-2">
                    <FolderTree
                      workspaceId={selectedWorkspaceId}
                      items={folderStructure.folders.concat(folderStructure.documents)}
                      selectedIds={[]}
                      onToggleExpand={handleToggleExpand}
                      onSelectDocument={handleDocumentClick}
                      onRenameFolder={handleFolderRename}
                      onDeleteFolder={handleFolderDelete}
                      onDownloadDocument={handleDocumentDownload}
                      onCreateFolder={handleCreateFolder}
                    />
                  </div>
                </>
              ) : (
                <>
                  {/* List view - existing DocumentsTable */}
                  <DocumentsTable />
                </>
              )}
            </div>
          </ScrollArea>

          {/* Create Folder Dialog */}
          <CreateFolderDialog
            open={isCreateFolderOpen}
            onOpenChange={setIsCreateFolderOpen}
            workspaceId={selectedWorkspaceId}
            parentFolderId={selectedFolderId}
          />

          {/* Drag overlay indicator */}
          {isDragging && (
            <div className="fixed inset-0 z-50 bg-black/5 flex items-center justify-center pointer-events-none">
              <div className="bg-white rounded-lg p-6 shadow-xl">
                <p className="text-sm text-muted-foreground">
                  {draggedItems.length > 0 ? (
                    <>
                      <FolderOpen className="h-5 w-5 text-blue-500 mr-2 inline-block" />
                      {t('folder.draggingMultiple', { count: draggedItems.length })}
                    </>
                  ) : (
                    <>
                      <FileText className="h-5 w-5 text-blue-500 mr-2 inline-block" />
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
