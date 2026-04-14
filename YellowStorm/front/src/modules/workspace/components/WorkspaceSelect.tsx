import { useState, useCallback, useEffect } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandInput, CommandList, CommandItem, CommandGroup } from '@/components/ui/command';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { BadgeCount } from '@/components/ui/badge-count';
import { Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWorkspaceStore, useWorkspaces, useWorkspaceLoading } from '../store';
import type { Workspace } from '../types';
import { useModuleTranslation } from '@/modules/localization';

type WorkspaceSelectProps = Readonly<{
  selectedIds: string[];
  onChange: (workspaceIds: string[]) => void;
  disabled?: boolean;
  className?: string;
}>;

export function WorkspaceSelect({ selectedIds, onChange, disabled, className }: WorkspaceSelectProps) {
  const { t } = useModuleTranslation('workspace');
  const [open, setOpen] = useState(false);
  const workspaces = useWorkspaces();
  const { isLoadingWorkspaces } = useWorkspaceLoading();
  const { fetchWorkspaces } = useWorkspaceStore();

  // Load workspaces on mount if list is empty
  useEffect(() => {
    if (workspaces.length === 0 && !isLoadingWorkspaces) {
      fetchWorkspaces(1);
    }
  }, [workspaces.length, isLoadingWorkspaces, fetchWorkspaces]);

  const handleToggle = useCallback(
    (workspaceId: string) => {
      if (selectedIds.includes(workspaceId)) {
        onChange(selectedIds.filter((id) => id !== workspaceId));
      } else {
        onChange([...selectedIds, workspaceId]);
      }
    },
    [selectedIds, onChange],
  );

  const selectedCount = selectedIds.length;
  const hasSelection = selectedCount > 0;

  const renderContent = () => {
    if (isLoadingWorkspaces) {
      return (
        <div className='flex items-center justify-center py-8'>
          <div className='h-4 w-4 animate-spin border-2 border-current border-t-transparent rounded-full' />
        </div>
      );
    }

    if (workspaces.length === 0) {
      return <div className='text-center py-8 text-sm text-muted-foreground'>{t('select.noWorkspaces')}</div>;
    }

    return (
      <CommandGroup>
        {workspaces.map((workspace) => (
          <CommandItem
            key={workspace.id}
            value={workspace.name}
            onSelect={() => handleToggle(workspace.id)}
            onClick={(e) => {
              e?.stopPropagation?.();
              handleToggle(workspace.id);
            }}
            className='cursor-pointer'>
            <div className={cn('mr-2 h-4 w-4 rounded border border-primary flex items-center justify-center', selectedIds.includes(workspace.id) && 'bg-primary text-primary-foreground')}>
              {selectedIds.includes(workspace.id) && (
                <svg className='h-3 w-3' fill='currentColor' viewBox='0 0 20 20'>
                  <path d='M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z' />
                </svg>
              )}
            </div>
            <span className='flex-1 truncate'>{workspace.name}</span>
            {workspace.documentCount > 0 && (
              <Badge variant='outline' className='ml-2 text-xs'>
                {workspace.documentCount}
              </Badge>
            )}
          </CommandItem>
        ))}
      </CommandGroup>
    );
  };

  const onOpenChange = useCallback(() => {
    if (isLoadingWorkspaces) return;
    setOpen((prevSate) => !prevSate);
  }, [isLoadingWorkspaces]);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <div className='relative'>
          <Button type='button' variant={hasSelection ? 'secondary' : 'ghost'} size='icon' className={cn('h-8 w-8 shrink-0', hasSelection && 'text-primary', className)} disabled={disabled || isLoadingWorkspaces}>
            <Layers className={cn('h-4 w-4', hasSelection && 'fill-current', isLoadingWorkspaces && 'opacity-50')} />
          </Button>
          <BadgeCount count={selectedCount} />
        </div>
      </PopoverTrigger>
      <PopoverContent className='w-75 p-0' align='start' sideOffset={4}>
        <Command>
          <div className='flex items-center border-b px-3'>
            <Layers className='mr-2 h-4 w-4 text-muted-foreground' />
            <CommandInput placeholder={t('select.searchPlaceholder')} className='border-0 focus:ring-0' />
          </div>
          <CommandList>{renderContent()}</CommandList>
        </Command>
        {hasSelection && (
          <div className='flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground'>
            <span>{t(`select.selectedCount_${selectedCount === 1 ? 'one' : 'other'}`, { count: selectedCount })}</span>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
