/**
 * RenameDialog
 * Reusable rename dialog with input validation.
 */

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface RenameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentName: string;
  entityType?: 'workspace' | 'document';
  onRename: (newName: string) => Promise<void>;
}

export function RenameDialog({
  open,
  onOpenChange,
  currentName,
  entityType = 'workspace',
  onRename,
}: RenameDialogProps) {
  const [newName, setNewName] = useState(currentName);
  const [isLoading, setIsLoading] = useState(false);

  // Reset name when dialog opens with new currentName
  useEffect(() => {
    if (open) {
      setNewName(currentName);
    }
  }, [open, currentName]);

  const handleRename = async () => {
    if (!newName.trim() || newName === currentName) {
      onOpenChange(false);
      return;
    }

    setIsLoading(true);
    try {
      await onRename(newName.trim());
      onOpenChange(false);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleRename();
    }
  };

  const entityLabel = entityType === 'workspace' ? 'Workspace' : 'Document';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename {entityLabel}</DialogTitle>
          <DialogDescription>
            Enter a new name for this {entityType}.
          </DialogDescription>
        </DialogHeader>
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={`${entityLabel} name`}
          onKeyDown={handleKeyDown}
          autoFocus
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleRename}
            disabled={!newName.trim() || isLoading}
          >
            {isLoading ? 'Renaming...' : 'Rename'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
