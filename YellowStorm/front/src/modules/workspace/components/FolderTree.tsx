/**
 * Folder Tree
 * Recursive tree component for displaying folders and documents
 */

import { useMemo } from 'react';
import { File, Folder, FolderOpen, ChevronRight, FileText, Download, MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import type { WorkspaceDocument, WorkspaceFolder } from '../types';

interface FolderTreeProps {
  items: (WorkspaceDocument | WorkspaceFolder)[];
  workspaceId: string;
  selectedIds: string[];
  onToggleExpand?: (folderId: string) => void;
  onSelectDocument?: (documentId: string) => void;
  onRenameFolder?: (folderId: string) => void;
  onRenameDocument?: (documentId: string) => void;
  onDeleteFolder?: (folderId: string) => void;
  onDeleteDocument?: (documentId: string) => void;
  onDownloadDocument?: (documentId: string) => void;
  onCreateFolder?: (parentId?: string) => void;
  onCreateDocument?: (folderId?: string) => void;
  onMoveDocument?: (documentId: string, targetFolderId?: string) => void;
}

export function FolderTree({
  items,
  workspaceId,
  selectedIds = [],
  onToggleExpand,
  onSelectDocument,
  onRenameFolder,
  onRenameDocument,
  onDeleteFolder,
  onDeleteDocument,
  onDownloadDocument,
  onCreateFolder,
  onCreateDocument,
  onMoveDocument,
}: FolderTreeProps) {
  const { t } = useModuleTranslation('workspace');

  // Separate folders and documents
  const { folders, documents } = useMemo(() => {
    const folderItems = items.filter((item) => item.isFolder) as WorkspaceFolder[];
    const documentItems = items.filter((item) => !item.isFolder) as WorkspaceDocument[];
    return { folders: folderItems, documents: documentItems };
  }, [items]);

  const handleDragStart = (e: React.DragEvent, itemId: string, isFolder: boolean) => {
    e.dataTransfer.setData('text/plain', JSON.stringify({ itemId, isFolder, workspaceId }));
  };

  const handleDrop = (e: React.DragEvent, targetFolderId?: string) => {
    e.preventDefault();
    e.stopPropagation();

    if (!targetFolderId) return;

    try {
      const data = JSON.parse(e.dataTransfer.getData('text/plain') || '');
      if (!data.itemId || !data.isFolder) return;

      if (data.isFolder) {
        // Moving a folder is not supported in this implementation
        return;
      }

      // Only allow moving documents
      onMoveDocument?.(data.itemId, targetFolderId);
    } catch (error) {
      console.error('Failed to handle drop:', error);
    }
  };

  const renderFolder = (folder: WorkspaceFolder, level = 0) => {
    return (
      <div className="ml-4">
        <div
          className="flex items-center py-2 px-3 hover:bg-accent/30 rounded-md cursor-pointer transition-colors group/folder"
          draggable
          onDragStart={(e) => handleDragStart(e, folder.id, true)}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDrop={(e) => {
            handleDrop(e, folder.id);
          }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <button
              className="flex items-center gap-2 hover:bg-accent/50 rounded transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand?.(folder.id);
              }}
            >
              <FolderOpen className={cn(
                'h-4 w-4 text-blue-500',
                folder.isExpanded && 'text-blue-600',
              )} />
              <ChevronRight
                className={cn(
                  'h-3 w-3 text-muted-foreground transition-transform',
                  folder.isExpanded && 'rotate-90',
                )}
              />
            </button>
            <span className="font-medium text-sm">{folder.folderName}</span>
            <span className="text-xs text-muted-foreground ml-2">
              {folder.children.length} {t('folder.items')}
            </span>
          </div>

          {/* Folder actions */}
          <div className="flex items-center gap-1 ml-auto opacity-0 group-hover/folder:opacity-100 transition-opacity">
            <button
              className="h-7 w-7 flex items-center justify-center rounded hover:bg-accent text-muted-foreground"
              onClick={(e) => {
                e.stopPropagation();
                onRenameFolder?.(folder.id);
              }}
            >
              <FileText className="h-3.5 w-3.5" />
            </button>
            <button
              className="h-7 w-7 flex items-center justify-center rounded hover:bg-accent text-muted-foreground"
              onClick={(e) => {
                e.stopPropagation();
                onDeleteFolder?.(folder.id);
              }}
            >
              <Download className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Render children if expanded */}
        {folder.isExpanded && folder.children.length > 0 && (
          <div className="mt-1">
            {folder.children.map((item) => {
              if (item.isFolder) {
                return (
                  <FolderTreeItem
                    key={item.id}
                    item={item as WorkspaceFolder}
                    level={level + 1}
                    workspaceId={workspaceId}
                    selectedIds={selectedIds}
                    onToggleExpand={onToggleExpand}
                    onSelectDocument={onSelectDocument}
                    onRenameFolder={onRenameFolder}
                    onDeleteFolder={onDeleteFolder}
                    onDownloadDocument={onDownloadDocument}
                    onCreateFolder={onCreateFolder}
                    onCreateDocument={onCreateDocument}
                    onMoveDocument={onMoveDocument}
                  />
                );
              } else {
                return (
                  <DocumentTreeItem
                    key={item.id}
                    item={item as WorkspaceDocument}
                    workspaceId={workspaceId}
                    isSelected={selectedIds.includes(item.id)}
                    onSelectDocument={onSelectDocument}
                    onRenameDocument={onRenameDocument}
                    onDeleteDocument={onDeleteDocument}
                    onDownloadDocument={onDownloadDocument}
                  />
                );
              }
            })}
          </div>
        )}
      </div>
    );
  };

  const renderDocument = (document: WorkspaceDocument) => {
    return (
      <div
        className={cn(
          'flex items-center py-2 px-3 hover:bg-accent/30 rounded-md cursor-pointer transition-colors group/document',
          selectedIds.includes(document.id) && 'bg-accent/50',
        )}
        onClick={() => onSelectDocument?.(document.id)}
        draggable
        onDragStart={(e) => handleDragStart(e, document.id, false)}
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {getDocumentIcon(document.mimeType)}
            <span className="font-medium text-sm truncate">{document.originalName}</span>
            <span className="text-xs text-muted-foreground">
              {formatFileSize(document.size)}
            </span>
          </div>

          {/* Document status */}
          <div className="flex items-center gap-1">
            {document.indexingStatus === 'processing' && (
              <span className="text-xs text-blue-500">{t('documents.indexing')}</span>
            )}
            {document.indexingStatus === 'failed' && (
              <span className="text-xs text-red-500">{t('documents.indexingFailed')}</span>
            )}
          </div>

          {/* Document actions */}
          <div className="flex items-center gap-1 ml-auto opacity-0 group-hover/document:opacity-100 transition-opacity">
            <button
              className="h-7 w-7 flex items-center justify-center rounded hover:bg-accent text-muted-foreground"
              onClick={(e) => {
                e.stopPropagation();
                onRenameDocument?.(document.id);
              }}
            >
              <FileText className="h-3.5 w-3.5" />
            </button>
            <button
              className="h-7 w-7 flex items-center justify-center rounded hover:bg-accent text-muted-foreground"
              onClick={(e) => {
                e.stopPropagation();
                if (!document.isFolder) {
                  onDownloadDocument?.(document.id);
                }
              }}
              disabled={document.isFolder}
            >
              <Download className="h-3.5 w-3.5" />
            </button>
            <button
              className="h-7 w-7 flex items-center justify-center rounded hover:bg-red-50 hover:text-red-600 text-muted-foreground"
              onClick={(e) => {
                e.stopPropagation();
                onDeleteDocument?.(document.id);
              }}
            >
              <File className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Checkbox for selection */}
        <input
          type="checkbox"
          checked={selectedIds.includes(document.id)}
          onChange={() => {
            onSelectDocument?.(document.id);
          }}
          onClick={(e) => e.stopPropagation()}
          className="w-4 h-4 cursor-pointer"
        />
      </div>
    );
  };

  return (
    <div className="space-y-1">
      {/* Folders */}
      {folders.map((folder) => (
        <FolderTreeItem
          key={folder.id}
          item={folder}
          level={0}
          workspaceId={workspaceId}
          selectedIds={selectedIds}
          onToggleExpand={onToggleExpand}
          onSelectDocument={onSelectDocument}
          onRenameFolder={onRenameFolder}
          onDeleteFolder={onDeleteFolder}
          onDownloadDocument={onDownloadDocument}
          onCreateFolder={onCreateFolder}
          onCreateDocument={onCreateDocument}
          onMoveDocument={onMoveDocument}
        />
      ))}

      {/* Documents */}
      {documents.map((document) => (
        <DocumentTreeItem
          key={document.id}
          item={document}
          workspaceId={workspaceId}
          isSelected={selectedIds.includes(document.id)}
          onSelectDocument={onSelectDocument}
          onRenameDocument={onRenameDocument}
          onDeleteDocument={onDeleteDocument}
          onDownloadDocument={onDownloadDocument}
        />
      ))}

      {/* Empty state */}
      {folders.length === 0 && documents.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <Folder className="h-12 w-12 mx-auto mb-3 opacity-50" />
          <p className="text-sm">{t('folder.empty')}</p>
          <p className="text-xs">{t('folder.emptyDescription')}</p>
        </div>
      )}
    </div>
  );
}

// Sub-components for recursive rendering
interface FolderTreeItemProps {
  item: WorkspaceFolder;
  level: number;
  workspaceId: string;
  selectedIds: string[];
  onToggleExpand?: (folderId: string) => void;
  onSelectDocument?: (documentId: string) => void;
  onRenameFolder?: (folderId: string) => void;
  onDeleteFolder?: (folderId: string) => void;
  onDownloadDocument?: (documentId: string) => void;
  onCreateFolder?: (parentId?: string) => void;
  onCreateDocument?: (folderId?: string) => void;
  onMoveDocument?: (documentId: string, targetFolderId?: string) => void;
}

function FolderTreeItem({
  item,
  level,
  workspaceId,
  selectedIds,
  onToggleExpand,
  onSelectDocument,
  onRenameFolder,
  onDeleteFolder,
  onDownloadDocument,
  onCreateFolder,
  onCreateDocument,
  onMoveDocument,
}: FolderTreeItemProps) {
  const { t } = useModuleTranslation('workspace');

  const handleDragStart = (e: React.DragEvent, itemId: string, isFolder: boolean) => {
    e.dataTransfer.setData('text/plain', JSON.stringify({ itemId, isFolder, workspaceId }));
  };

  const handleDrop = (e: React.DragEvent, targetFolderId?: string) => {
    e.preventDefault();
    e.stopPropagation();

    if (!targetFolderId) return;

    try {
      const data = JSON.parse(e.dataTransfer.getData('text/plain') || '');
      if (!data.itemId) return;

      if (data.isFolder) {
        // Moving a folder is not supported
        return;
      }

      onMoveDocument?.(data.itemId, targetFolderId);
    } catch (error) {
      console.error('Failed to handle drop:', error);
    }
  };

  return (
    <div className={cn('group/folder', 'ml-4')} style={{ marginLeft: `${level * 16}px` }}>
      <div
        className="flex items-center py-2 px-3 hover:bg-accent/30 rounded-md cursor-pointer transition-colors group/folder"
        draggable
        onDragStart={(e) => handleDragStart(e, item.id, true)}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDrop={(e) => {
          handleDrop(e, item.id);
        }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <button
            className="flex items-center gap-2 hover:bg-accent/50 rounded transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand?.(item.id);
            }}
          >
            <FolderOpen className={cn(
              'h-4 w-4 text-blue-500',
              item.isExpanded && 'text-blue-600',
            )} />
            <ChevronRight
              className={cn(
                  'h-3 w-3 text-muted-foreground transition-transform',
                  item.isExpanded && 'rotate-90',
                )}
              />
            </button>
            <span className="font-medium text-sm">{item.folderName}</span>
            <span className="text-xs text-muted-foreground ml-2">
              {item.children.length} {t('folder.items')}
            </span>
          </div>
        </div>

      {item.isExpanded && item.children.length > 0 && (
        <div className="mt-1">
          {item.children.map((child) => {
            if (child.isFolder) {
              return (
                <FolderTreeItem
                  key={child.id}
                  item={child as WorkspaceFolder}
                  level={level + 1}
                  workspaceId={workspaceId}
                  selectedIds={selectedIds}
                  onToggleExpand={onToggleExpand}
                  onSelectDocument={onSelectDocument}
                  onRenameFolder={onRenameFolder}
                  onDeleteFolder={onDeleteFolder}
                  onDownloadDocument={onDownloadDocument}
                  onCreateFolder={onCreateFolder}
                  onCreateDocument={onCreateDocument}
                  onMoveDocument={onMoveDocument}
                />
              );
            } else {
              return (
                <DocumentTreeItem
                  key={child.id}
                  item={child as WorkspaceDocument}
                  workspaceId={workspaceId}
                  isSelected={selectedIds.includes(child.id)}
                  onSelectDocument={onSelectDocument}
                  onRenameDocument={onRenameDocument}
                  onDeleteDocument={onDeleteDocument}
                  onDownloadDocument={onDownloadDocument}
                />
              );
            }
          })}
        </div>
      )}
    </div>
  );
}

interface DocumentTreeItemProps {
  item: WorkspaceDocument;
  workspaceId: string;
  isSelected: boolean;
  onSelectDocument?: (documentId: string) => void;
  onRenameDocument?: (documentId: string) => void;
  onDeleteDocument?: (documentId: string) => void;
  onDownloadDocument?: (documentId: string) => void;
}

function DocumentTreeItem({
  item,
  workspaceId,
  isSelected,
  onSelectDocument,
  onRenameDocument,
  onDeleteDocument,
  onDownloadDocument,
}: DocumentTreeItemProps) {
  const { t } = useModuleTranslation('workspace');

  return (
    <div
      className={cn(
        'flex items-center py-2 px-3 hover:bg-accent/30 rounded-md cursor-pointer transition-colors group/document',
        isSelected && 'bg-accent/50',
      )}
      onClick={() => onSelectDocument?.(item.id)}
      draggable
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {getDocumentIcon(item.mimeType)}
          <span className="font-medium text-sm truncate">{item.originalName}</span>
          <span className="text-xs text-muted-foreground">
            {formatFileSize(item.size)}
          </span>
        </div>

        {/* Document status */}
        <div className="flex items-center gap-1">
          {item.indexingStatus === 'processing' && (
            <span className="text-xs text-blue-500">{t('documents.indexing')}</span>
          )}
          {item.indexingStatus === 'failed' && (
            <span className="text-xs text-red-500">{t('documents.indexingFailed')}</span>
          )}
        </div>

        {/* Document actions */}
        <div className="flex items-center gap-1 ml-auto opacity-0 group-hover/document:opacity-100 transition-opacity">
          <button
            className="h-7 w-7 flex items-center justify-center rounded hover:bg-accent text-muted-foreground"
            onClick={(e) => {
              e.stopPropagation();
              onRenameDocument?.(item.id);
            }}
          >
            <FileText className="h-3.5 w-3.5" />
          </button>
          <button
            className="h-7 w-7 flex items-center justify-center rounded hover:bg-accent text-muted-foreground"
            onClick={(e) => {
              e.stopPropagation();
              onDownloadDocument?.(item.id);
            }}
          >
            <Download className="h-3.5 w-3.5" />
          </button>
          <button
            className="h-7 w-7 flex items-center justify-center rounded hover:bg-red-50 hover:text-red-600 text-muted-foreground"
            onClick={(e) => {
              e.stopPropagation();
              onDeleteDocument?.(item.id);
            }}
          >
            <File className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

// Helper function to get document icon based on MIME type
function getDocumentIcon(mimeType?: string) {
  // Handle folders
  if (mimeType === 'folder') {
    return <Folder className="h-4 w-4 text-blue-500" />;
  }

  // Handle undefined mimeType
  if (!mimeType) {
    return <File className="h-4 w-4" />;
  }

  const iconMap: Record<string, string> = {
    'application/pdf': 'FileText',
    'application/msword': 'FileText',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'FileText',
    'application/vnd.ms-excel': 'FileText',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'FileText',
    'text/plain': 'FileText',
    'text/csv': 'FileText',
    'application/zip': 'Archive',
    'application/x-rar-compressed': 'Archive',
    'application/x-tar': 'Archive',
    'image/jpeg': 'Image',
    'image/png': 'Image',
    'image/gif': 'Image',
    'image/svg+xml': 'Image',
    'image/webp': 'Image',
    'video/mp4': 'Video',
    'video/mpeg': 'Video',
    'video/quicktime': 'Video',
  };

  const baseIcon = iconMap[mimeType.split('/')[0]] || 'File';
  return <File className="h-4 w-4" />;
}

// Helper function to format file size
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const m = k * 1024;
  const g = m * 1024;
  const t = g * 1024;

  if (bytes < k) return bytes + ' B';
  if (bytes < m) return (bytes / k).toFixed(1) + ' KB';
  if (bytes < g) return (bytes / m).toFixed(1) + ' MB';
  return (bytes / g).toFixed(2) + ' GB';
}
