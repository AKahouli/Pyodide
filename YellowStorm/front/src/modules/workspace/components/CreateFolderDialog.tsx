import { useEffect, useState } from 'react';
import { FolderPlus } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

import { useWorkspaceStore } from '../store';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parentId: string | null;
};

export function CreateFolderDialog({ open, onOpenChange, parentId }: Props) {
  const createPageFolder = useWorkspaceStore((s) => s.createPageFolder);
  const folders = useWorkspaceStore((s) => s.pageFolders);
  const parent = parentId ? folders.find((f) => f.id === parentId) : null;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (open) {
      setName('');
      setDescription('');
    }
  }, [open]);

  const nameValid = name.trim().length >= 2;
  const descriptionValid = description.trim().length >= 5;
  const canSubmit = nameValid && descriptionValid;

  const handleSubmit = () => {
    if (!canSubmit) return;
    void createPageFolder({ name, description, parentId });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <div className='flex items-center gap-3'>
            <div className='flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary'>
              <FolderPlus className='h-5 w-5' />
            </div>
            <div>
              <DialogTitle>Nouveau dossier</DialogTitle>
              <DialogDescription>
                {parent ? (
                  <>Dans <span className='font-medium text-foreground'>{parent.name}</span></>
                ) : (
                  'À la racine du workspace'
                )}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className='space-y-4 py-2'>
          <div className='space-y-2'>
            <Label htmlFor='folder-name'>
              Nom du dossier <span className='text-destructive'>*</span>
            </Label>
            <Input
              id='folder-name'
              autoFocus
              placeholder='Ex: Contrats fournisseurs'
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className='space-y-2'>
            <Label htmlFor='folder-description'>
              Description <span className='text-destructive'>*</span>
            </Label>
            <Textarea
              id='folder-description'
              placeholder='Décrivez le type de documents qui doivent aller dans ce dossier. Cette description sera utilisée par le playbook pour classifier automatiquement les fichiers.'
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
            />
            <p className='text-xs text-muted-foreground'>
              Cette description guide la classification automatique. Plus elle est précise, meilleurs sont les
              résultats.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant='ghost' onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            Créer le dossier
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
