import { useMemo, useState, useEffect } from 'react';
import { Folder, FolderTree, Home, Move } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useClassifierStore } from '../store';
import type { ClassifierFolder } from '../types';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folder: ClassifierFolder | null;
};

export function MoveFolderDialog({ open, onOpenChange, folder }: Props) {
  const moveFolder = useClassifierStore((s) => s.moveFolder);
  const folders = useClassifierStore((s) => s.folders);
  const workspaceId = useClassifierStore((s) => s.selectedWorkspaceId);

  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    if (open) setTarget(null);
  }, [open]);

  const invalidIds = useMemo(() => {
    if (!folder) return new Set<string>();
    const blocked = new Set<string>([folder.id]);
    const stack = [folder.id];
    while (stack.length) {
      const next = stack.pop()!;
      folders
        .filter((f) => f.parentId === next)
        .forEach((child) => {
          blocked.add(child.id);
          stack.push(child.id);
        });
    }
    return blocked;
  }, [folder, folders]);

  const tree = useMemo(() => {
    if (!workspaceId) return [];
    const wsFolders = folders.filter((f) => f.workspaceId === workspaceId);
    type Node = ClassifierFolder & { children: Node[] };
    const byId = new Map<string, Node>();
    wsFolders.forEach((f) => byId.set(f.id, { ...f, children: [] }));
    const roots: Node[] = [];
    wsFolders.forEach((f) => {
      const node = byId.get(f.id)!;
      if (f.parentId && byId.has(f.parentId)) {
        byId.get(f.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    });
    return roots;
  }, [folders, workspaceId]);

  const renderNode = (node: ClassifierFolder & { children: any[] }, depth = 0) => {
    const disabled = invalidIds.has(node.id);
    const selected = target === node.id;
    return (
      <div key={node.id}>
        <button
          type='button'
          disabled={disabled}
          onClick={() => setTarget(node.id)}
          className={cn(
            'w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition',
            'hover:bg-accent hover:text-accent-foreground',
            selected && 'bg-primary/10 text-primary',
            disabled && 'opacity-40 cursor-not-allowed hover:bg-transparent hover:text-current',
          )}
          style={{ paddingLeft: 8 + depth * 16 }}
        >
          <Folder className='h-4 w-4 shrink-0' />
          <span className='truncate'>{node.name}</span>
        </button>
        {node.children.map((child: any) => renderNode(child, depth + 1))}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <div className='flex items-center gap-3'>
            <div className='flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary'>
              <Move className='h-5 w-5' />
            </div>
            <div>
              <DialogTitle>Déplacer le dossier</DialogTitle>
              <DialogDescription>
                {folder ? <>Choisir une nouvelle destination pour <strong>{folder.name}</strong>.</> : null}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className='border rounded-md'>
          <ScrollArea className='h-72'>
            <div className='p-2 space-y-0.5'>
              <button
                type='button'
                onClick={() => setTarget(null)}
                className={cn(
                  'w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition',
                  'hover:bg-accent hover:text-accent-foreground',
                  target === null && 'bg-primary/10 text-primary',
                )}
              >
                <Home className='h-4 w-4' />
                Racine du workspace
              </button>
              {tree.length === 0 ? (
                <div className='flex flex-col items-center justify-center py-6 text-muted-foreground'>
                  <FolderTree className='h-6 w-6 mb-2 opacity-50' />
                  <p className='text-xs'>Aucun autre dossier disponible</p>
                </div>
              ) : (
                tree.map((node) => renderNode(node))
              )}
            </div>
          </ScrollArea>
        </div>

        <DialogFooter>
          <Button variant='ghost' onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            onClick={() => {
              if (!folder) return;
              moveFolder(folder.id, target);
              onOpenChange(false);
            }}
          >
            Déplacer ici
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
