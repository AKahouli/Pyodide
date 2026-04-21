import { memo, useMemo, useState, useCallback } from 'react';
import { ChevronRight, Folder, FolderOpen, Plus, MoreHorizontal, Trash2, Edit2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useModuleTranslation } from '@/modules/localization';
import type { WorkspaceDocument } from '../types';

interface FolderTreeSidebarProps {
  documents: WorkspaceDocument[];
  currentFolderId: string | null;
  onFolderSelect: (folderId: string | null) => void;
  onCreateFolder?: (parentId?: string) => void;
  onDeleteFolder?: (folderId: string) => void;
  onRenameFolder?: (folderId: string) => void;
}

export function FolderTreeSidebar({ documents, currentFolderId, onFolderSelect, onCreateFolder, onDeleteFolder, onRenameFolder }: FolderTreeSidebarProps) {
  const { t } = useModuleTranslation('workspace');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  // Build folder tree structure
  const folderTree = useMemo(() => {
    const folders = documents.filter((d) => d.isFolder);
    const folderMap = new Map<string, FolderNode>();

    // Create nodes
    folders.forEach((folder) => {
      folderMap.set(folder.id, {
        id: folder.id,
        name: folder.folderName || folder.originalName,
        children: [],
        parentId: folder.parentId ?? null,
        document: folder,
      });
    });

    // Build hierarchy
    const rootFolders: FolderNode[] = [];
    folderMap.forEach((node) => {
      if (node.parentId && folderMap.has(node.parentId)) {
        folderMap.get(node.parentId)!.children.push(node);
      } else {
        rootFolders.push(node);
      }
    });

    return rootFolders;
  }, [documents]);

  const toggleExpand = useCallback((folderId: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  }, []);

  const handleFolderClick = useCallback(
    (folderId: string) => {
      onFolderSelect(folderId);
      // Auto-expand parent folders
      const expandParents = (id: string, nodes: FolderNode[]): boolean => {
        for (const node of nodes) {
          if (node.id === id) return true;
          if (node.children.length > 0 && expandParents(id, node.children)) {
            setExpandedFolders((prev) => {
              const next = new Set(prev);
              next.add(node.id);
              return next;
            });
            return true;
          }
        }
        return false;
      };
      expandParents(folderId, folderTree);
    },
    [onFolderSelect, folderTree],
  );

  const renderFolderNode = (node: FolderNode, level: number = 0) => {
    const isExpanded = expandedFolders.has(node.id);
    const isCurrent = currentFolderId === node.id;
    const hasChildren = node.children.length > 0;

    return (
      <div key={node.id}>
        <div className={cn('flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-accent/50 group/folder', isCurrent && 'bg-accent text-accent-foreground')} style={{ paddingLeft: `${8 + level * 16}px` }} onClick={() => handleFolderClick(node.id)}>
          {hasChildren && (
            <button
              className='w-4 h-4 flex items-center justify-center rounded hover:bg-accent/70'
              onClick={(e) => {
                e.stopPropagation();
                toggleExpand(node.id);
              }}>
              <ChevronRight className={cn('h-3 w-3 text-muted-foreground transition-transform', isExpanded && 'rotate-90')} />
            </button>
          )}
          {!hasChildren && <div className='w-4' />}
          {isExpanded ? <FolderOpen className='h-4 w-4 text-blue-500' /> : <Folder className='h-4 w-4 text-blue-500' />}
          <span className='text-sm truncate flex-1'>{node.name}</span>

          {/* Actions */}
          <div className='flex items-center gap-1 opacity-0 group-hover/folder:opacity-100 transition-opacity'>
            <Button
              variant='ghost'
              size='icon'
              className='h-6 w-6'
              onClick={(e) => {
                e.stopPropagation();
                onCreateFolder?.(node.id);
              }}>
              <Plus className='h-3 w-3' />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button variant='ghost' size='icon' className='h-6 w-6'>
                  <MoreHorizontal className='h-3 w-3' />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end'>
                <DropdownMenuItem onClick={() => onRenameFolder?.(node.id)}>
                  <Edit2 className='h-4 w-4 mr-2' />
                  {t('folder.rename')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onDeleteFolder?.(node.id)} className='text-destructive'>
                  <Trash2 className='h-4 w-4 mr-2' />
                  {t('folder.delete')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {isExpanded && hasChildren && <div>{node.children.map((child) => renderFolderNode(child, level + 1))}</div>}
      </div>
    );
  };

  return (
    <div className='h-full flex flex-col border-r bg-muted/30 w-full'>
      <div className='p-3 border-b bg-background'>
        <div className='flex items-center justify-between'>
          <span className='text-sm font-medium'>{t('folder.folders')}</span>
            <div className='w-6 h-6' />
        </div>
      </div>
      <ScrollArea className='flex-1'>
        <div className='py-2'>
          {/* Root folder */}
          <div className={cn('flex items-center gap-2 px-3 py-1.5 rounded-md cursor-pointer hover:bg-accent/50 group/folder', currentFolderId === null && 'bg-accent text-accent-foreground')} onClick={() => onFolderSelect(null)}>
            <Folder className='h-4 w-4 text-blue-500' />
            <span className='text-sm flex-1'>{t('folder.root')}</span>
            <Button
              variant='ghost'
              size='icon'
              className='h-6 w-6 opacity-0 group-hover/folder:opacity-100 transition-opacity'
                onClick={(e) => {
                e.stopPropagation();
                onCreateFolder?.();
              }}>
              <Plus className='h-3 w-3' />
            </Button>
          </div>

          {/* Folder tree */}
          {folderTree.map((node) => renderFolderNode(node))}
        </div>
      </ScrollArea>
    </div>
  );
}

interface FolderNode {
  id: string;
  name: string;
  children: FolderNode[];
  parentId: string | null;
  document: WorkspaceDocument;
}
