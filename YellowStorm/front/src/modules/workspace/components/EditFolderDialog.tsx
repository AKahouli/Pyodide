import { useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

import { useWorkspaceStore } from '../store';
import type { WorkspaceFolder } from '../types';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folder: WorkspaceFolder | null;
};

export function EditFolderDialog({ open, onOpenChange, folder }: Props) {
  const updatePageFolder = useWorkspaceStore((s) => s.updatePageFolder);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (open && folder) {
      setName(folder.name);
      setDescription(folder.description);
    }
  }, [open, folder]);

  const canSubmit = name.trim().length >= 2 && description.trim().length >= 5;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <div className='flex items-center gap-3'>
            <div className='flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary'>
              <Pencil className='h-5 w-5' />
            </div>
            <div>
              <DialogTitle>Modifier le dossier</DialogTitle>
              <DialogDescription>Mettre à jour le nom et la description.</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className='space-y-4 py-2'>
          <div className='space-y-2'>
            <Label htmlFor='edit-folder-name'>Nom du dossier</Label>
            <Input id='edit-folder-name' value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className='space-y-2'>
            <Label htmlFor='edit-folder-description'>Description</Label>
            <Textarea
              id='edit-folder-description'
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant='ghost' onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            onClick={() => {
              if (!folder || !canSubmit) return;
              void updatePageFolder(folder.id, { name, description });
              onOpenChange(false);
            }}
            disabled={!canSubmit}
          >
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
