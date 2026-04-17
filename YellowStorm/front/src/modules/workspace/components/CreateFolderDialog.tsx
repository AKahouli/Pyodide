/**
 * Create Folder Dialog
 * Dialog for creating a new folder in personal workspace
 */

import { useState, useCallback } from 'react';
import { Plus } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useModuleTranslation } from '@/modules/localization';
import { useWorkspaceStore } from '../store';

interface CreateFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId?: string;
  parentFolderId?: string;
}

export function CreateFolderDialog({
  open,
  onOpenChange,
  workspaceId,
  parentFolderId,
}: CreateFolderDialogProps) {
  const { t } = useModuleTranslation('workspace');
  const createFolder = useWorkspaceStore((state) => state.createFolder);
  const isCreating = useWorkspaceStore((state) => state.isCreating);

  const [folderName, setFolderName] = useState('');
  const [error, setError] = useState('');

  const handleClose = useCallback(() => {
    onOpenChange(false);
    setFolderName('');
    setError('');
  }, [onOpenChange]);

  const handleCreate = useCallback(async () => {
    if (!folderName.trim()) {
      setError(t('folder.nameRequired'));
      return;
    }

    if (!workspaceId) return;

    try {
      await createFolder(workspaceId, {
        name: folderName.trim(),
        parentId: parentFolderId,
      });
      handleClose();
    } catch (err) {
      // Error is handled in the store
    }
  }, [workspaceId, parentFolderId, folderName, createFolder, handleClose, t]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !isCreating) {
        e.preventDefault();
        handleCreate();
      }
    },
    [handleCreate, isCreating],
  );

  // Reset form when dialog opens
  useState(() => {
    if (open && !folderName) {
      setFolderName('');
      setError('');
    }
  }, [open, folderName]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5 text-blue-500" />
            {t('folder.createTitle')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <label htmlFor="folder-name" className="block text-sm font-medium mb-2">
              {t('folder.nameLabel')}
            </label>
            <Input
              id="folder-name"
              value={folderName}
              onChange={(e) => {
                setFolderName(e.target.value);
                setError('');
              }}
              onKeyDown={handleKeyDown}
              placeholder={t('folder.namePlaceholder')}
              className={error ? 'border-red-500 focus:border-red-500' : ''}
              maxLength={50}
              autoFocus
            />
            {error && (
              <p className="text-sm text-red-500 mt-1">{error}</p>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={handleClose}
              disabled={isCreating}
            >
              {t('folder.cancel')}
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!folderName.trim() || isCreating}
            >
              {isCreating ? t('folder.creating') : t('folder.create')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
