import { useState } from 'react';
import { Check, ChevronsUpDown, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { cn } from '@/lib/utils';
import { useClassifierStore, useClassifierWorkspaces, useSelectedWorkspace } from '../store';
import type { ClassifierWorkspace } from '../types';

type Props = {
  triggerClassName?: string;
  variant?: 'compact' | 'hero';
};

export function WorkspacePicker({ triggerClassName, variant = 'compact' }: Props) {
  const [open, setOpen] = useState(false);
  const workspaces = useClassifierWorkspaces();
  const selected = useSelectedWorkspace();
  const selectWorkspace = useClassifierStore((s) => s.selectWorkspace);

  if (variant === 'hero') {
    return (
      <div className='w-full max-w-md mx-auto'>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type='button'
              className={cn(
                'group w-full flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3.5',
                'transition-colors hover:border-primary/40 hover:bg-accent/50',
                triggerClassName,
              )}
            >
              <div className='flex items-center gap-3 min-w-0'>
                <div className='flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground'>
                  <Layers className='h-5 w-5' />
                </div>
                <div className='min-w-0 text-left'>
                  <div className='text-xs text-muted-foreground'>Workspace</div>
                  <div className='text-sm font-medium truncate'>
                    {selected ? selected.name : 'Sélectionner un workspace'}
                  </div>
                </div>
              </div>
              <ChevronsUpDown className='h-4 w-4 text-muted-foreground' />
            </button>
          </PopoverTrigger>
          <PopoverContent className='w-[var(--radix-popover-trigger-width)] p-0' align='start'>
            <WorkspaceList
              selectedId={selected?.id ?? null}
              onSelect={(id) => {
                selectWorkspace(id);
                setOpen(false);
              }}
              workspaces={workspaces}
            />
          </PopoverContent>
        </Popover>
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant='outline'
          className={cn('h-9 gap-2 max-w-[260px]', triggerClassName)}
        >
          <Layers className='h-4 w-4 shrink-0 text-muted-foreground' />
          <span className='truncate text-sm'>
            {selected ? selected.name : 'Sélectionner un workspace'}
          </span>
          <ChevronsUpDown className='ml-auto h-4 w-4 shrink-0 text-muted-foreground' />
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-72 p-0' align='start'>
        <WorkspaceList
          selectedId={selected?.id ?? null}
          onSelect={(id) => {
            selectWorkspace(id);
            setOpen(false);
          }}
          workspaces={workspaces}
        />
      </PopoverContent>
    </Popover>
  );
}

function WorkspaceList({
  workspaces,
  selectedId,
  onSelect,
}: {
  workspaces: ClassifierWorkspace[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <Command>
      <CommandInput placeholder='Rechercher un workspace…' />
      <CommandList>
        <CommandEmpty>Aucun workspace trouvé.</CommandEmpty>
        <CommandGroup heading='Workspaces'>
          {workspaces.map((w) => {
            const isSelected = selectedId === w.id;
            return (
              <CommandItem key={w.id} value={w.name} onSelect={() => onSelect(w.id)} className='gap-2'>
                <span className='flex-1 truncate'>{w.name}</span>
                {isSelected && <Check className='h-4 w-4 text-primary' />}
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}
