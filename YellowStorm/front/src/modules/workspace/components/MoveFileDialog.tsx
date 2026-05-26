import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, ChevronRight, Folder, FolderOpen, Home } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

import { useWorkspaceStore } from '../store';
import type { WorkspaceFile, WorkspaceFolder } from '../types';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  file: WorkspaceFile | null;
};

export function MoveFileDialog({ open, onOpenChange, file }: Props) {
  const folders = useWorkspaceStore((s) => s.pageFolders);
  const setFileFolderAssignment = useWorkspaceStore((s) => s.setFileFolderAssignment);
  const workspaceId = useWorkspaceStore((s) => s.selectedWorkspaceId);

  const [pickerFolderId, setPickerFolderId] = useState<string | null>(null);

  useEffect(() => {
    if (open && file) {
      const current = file.folderId
        ? folders.find((f) => f.id === file.folderId) ?? null
        : null;
      setPickerFolderId(current?.parentId ?? null);
    }
  }, [open, file, folders]);

  const wsFolders = useMemo(
    () => folders.filter((f) => f.workspaceId === workspaceId),
    [folders, workspaceId],
  );

  const breadcrumbs = useMemo(() => {
    if (!pickerFolderId) return [] as WorkspaceFolder[];
    const chain: WorkspaceFolder[] = [];
    let cursor: WorkspaceFolder | undefined = wsFolders.find((f) => f.id === pickerFolderId);
    while (cursor) {
      chain.unshift(cursor);
      cursor = cursor.parentId ? wsFolders.find((f) => f.id === cursor!.parentId) : undefined;
    }
    return chain;
  }, [wsFolders, pickerFolderId]);

  const subFolders = useMemo(
    () => wsFolders.filter((f) => f.parentId === pickerFolderId).sort((a, b) => a.name.localeCompare(b.name)),
    [wsFolders, pickerFolderId],
  );

  const currentFolder = pickerFolderId
    ? wsFolders.find((f) => f.id === pickerFolderId) ?? null
    : null;

  const isAlreadyHere = file?.folderId === pickerFolderId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <div className='flex items-center gap-3'>
            <div className='flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary'>
              <ArrowRight className='h-5 w-5' />
            </div>
            <div className='min-w-0'>
              <DialogTitle>Déplacer le fichier</DialogTitle>
              <DialogDescription className='truncate'>{file?.name ?? ''}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className='flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm'>
          {currentFolder ? (
            <FolderOpen className='h-4 w-4 shrink-0 text-primary' />
          ) : (
            <Home className='h-4 w-4 shrink-0 text-muted-foreground' />
          )}
          <span className='text-xs text-muted-foreground'>Destination :</span>
          <span className='truncate font-medium'>
            {currentFolder ? currentFolder.name : 'Aucun dossier (Non classé)'}
          </span>
        </div>

        <div className='flex items-center gap-1 flex-wrap text-sm'>
          <BreadcrumbButton
            isActive={pickerFolderId === null}
            onClick={() => setPickerFolderId(null)}
          >
            <Home className='h-3.5 w-3.5' />
            Accueil
          </BreadcrumbButton>
          {breadcrumbs.map((crumb, idx) => {
            const isLast = idx === breadcrumbs.length - 1;
            return (
              <div key={crumb.id} className='flex items-center gap-1'>
                <ChevronRight className='h-3.5 w-3.5 text-muted-foreground' />
                <BreadcrumbButton
                  isActive={isLast}
                  onClick={() => setPickerFolderId(crumb.id)}
                >
                  {crumb.name}
                </BreadcrumbButton>
              </div>
            );
          })}
        </div>

        <div className='border rounded-md'>
          <ScrollArea className='h-64'>
            <div className='p-1'>
              {subFolders.length === 0 ? (
                <div className='flex flex-col items-center justify-center py-10 text-center text-muted-foreground'>
                  <Folder className='h-6 w-6 mb-2 opacity-50' />
                  <p className='text-xs'>Aucun sous-dossier</p>
                  <p className='text-[11px] opacity-70'>Tu peux déplacer le fichier ici.</p>
                </div>
              ) : (
                subFolders.map((folder) => (
                  <button
                    type='button'
                    key={folder.id}
                    onClick={() => setPickerFolderId(folder.id)}
                    className={cn(
                      'group w-full flex items-center gap-3 rounded-md px-3 py-2 text-left transition',
                      'hover:bg-accent',
                    )}
                  >
                    <Folder className='h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary' />
                    <div className='min-w-0 flex-1'>
                      <div className='text-sm font-medium truncate'>{folder.name}</div>
                      {folder.description && (
                        <div className='text-xs text-muted-foreground line-clamp-1'>
                          {folder.description}
                        </div>
                      )}
                    </div>
                    <ChevronRight className='h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100' />
                  </button>
                ))
              )}
            </div>
          </ScrollArea>
        </div>

        <DialogFooter className='items-center'>
          {isAlreadyHere && (
            <p className='mr-auto text-xs text-muted-foreground'>
              Le fichier est déjà ici.
            </p>
          )}
          <Button variant='ghost' onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            disabled={isAlreadyHere}
            onClick={() => {
              if (!file) return;
              void setFileFolderAssignment(file.id, pickerFolderId);
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

function BreadcrumbButton({
  children,
  isActive,
  onClick,
}: {
  children: React.ReactNode;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors',
        isActive
          ? 'bg-secondary text-secondary-foreground font-medium'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}
