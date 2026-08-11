/**
 * Folder Row
 * Single folder item for hierarchical tree view
 */

import { memo, useState } from 'react';
import { Folder, FolderOpen, ChevronRight, MoreVertical, Trash2, Edit2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { useWorkspaceStore } from '../store';
import type { WorkspaceDocument } from '../types';

interface FolderRowProps {
  folder: WorkspaceDocument;
  workspaceId: string;
  level?: number;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  onRename?: (folderId: string, newName: string) => void;
  onDelete?: (folderId: string) => void;
}

export const FolderRow = memo(function FolderRow({
  folder,
  workspaceId,
  level = 0,
  isExpanded = false,
  onToggleExpand,
  onRename,
  onDelete,
}: FolderRowProps) {
  const { t } = useModuleTranslation('workspace');
  const createFolder = useWorkspaceStore((state) => state.createFolder);
  const renameFolder = useWorkspaceStore((state) => state.renameFolder);
  const deleteFolder = useWorkspaceStore((state) => state.deleteFolder);
  const isDeleting = useWorkspaceStore((state) => state.isDeleting);

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(folder.folderName || '');

  const handleToggleExpand = () => {
    onToggleExpand?.();
  };

  const handleRenameClick = () => {
    setIsDropdownOpen(false);
    setRenameValue(folder.folderName || '');
    setIsRenameOpen(true);
  };

  const handleRenameSubmit = async () => {
    if (!renameValue.trim()) return;
    await renameFolder(workspaceId, folder.id, { name: renameValue.trim() });
    setIsRenameOpen(false);
  };

  const handleDeleteClick = () => {
    setIsDropdownOpen(false);
    onDelete?.(folder.id);
  };

  const indentStyle = {
    marginLeft: `${level * 16}px`,
  };

  const handleDropdownChange = (open: boolean) => {
    setIsDropdownOpen(open);
    setIsRenameOpen(false);
  };

  return (
    <>
      <div
        className="flex items-center py-2 px-3 hover:bg-accent/50 transition-colors"
        style={indentStyle}
      >
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={handleToggleExpand}
            className="flex items-center gap-2 hover:bg-accent/30 p-1 rounded transition-colors"
          >
            {isExpanded ? (
              <FolderOpen className="h-4 w-4 text-blue-500" />
            ) : (
              <Folder className="h-4 w-4 text-blue-500" />
            )}
            <ChevronRight
              className={cn(
                'h-3 w-3 text-muted-foreground transition-transform',
                isExpanded && 'rotate-90',
              )}
            />
            <span className="font-medium text-sm">{folder.folderName}</span>
          </button>

          <DropdownMenu open={isDropdownOpen} onOpenChange={handleDropdownChange}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 opacity-0 hover:opacity-100 transition-opacity"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={handleRenameClick} className="cursor-pointer">
                <Edit2 className="mr-2 h-4 w-4" />
                {t('folder.menu.rename')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={handleDeleteClick}
                className="cursor-pointer text-destructive focus:text-destructive"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {t('folder.menu.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Rename Dialog */}
      {isRenameOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">
              {t('folder.renameTitle')}
            </h3>
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              placeholder={t('folder.namePlaceholder')}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-4">
              <Button
                variant="outline"
                onClick={() => setIsRenameOpen(false)}
              >
                {t('folder.cancel')}
              </Button>
              <Button
                onClick={handleRenameSubmit}
                disabled={!renameValue.trim() || isDeleting}
              >
                {isDeleting ? t('folder.renaming') : t('folder.save')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
});
