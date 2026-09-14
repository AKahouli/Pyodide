import { useState, useCallback, useEffect } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandInput, CommandList, CommandItem, CommandGroup } from '@/components/ui/command';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { BadgeCount } from '@/components/ui/badge-count';
import { Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWorkspaceStore, useWorkspaces, useWorkspaceLoading, useSharedWorkspaces, usePublicWorkspaces } from '../store';
import { useModuleTranslation } from '@/modules/localization';

type WorkspaceSelectProps = Readonly<{
  selectedIds: string[];
  onChange: (workspaceIds: string[]) => void;
  disabled?: boolean;
  className?: string;
  label?: string;
  workspaceOptions?: Array<{ id: string; name: string; documentCount: number }>;
}>;

export function WorkspaceSelect({ selectedIds, onChange, disabled, className, workspaceOptions, label }: WorkspaceSelectProps) {
  const { t } = useModuleTranslation('workspace');
  const [open, setOpen] = useState(false);
  const workspaces = useWorkspaces();
  const sharedWorkspaces = useSharedWorkspaces();
  const publicWorkspaces = usePublicWorkspaces();
  const { isLoadingWorkspaces } = useWorkspaceLoading();
  const { fetchWorkspaces, fetchSharedWorkspaces, fetchPublicWorkspaces } = useWorkspaceStore();

  // Load both own and shared-with-me workspaces on mount if the lists are empty.
  useEffect(() => {
    if (workspaces.length === 0 && !isLoadingWorkspaces) {
      fetchWorkspaces(1);
    }
  }, [workspaces.length, isLoadingWorkspaces, fetchWorkspaces]);

  useEffect(() => {
    if (sharedWorkspaces.length === 0 && !isLoadingWorkspaces) {
      fetchSharedWorkspaces(1);
    }
    // Only run on mount-equivalent; guarded by length check above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchSharedWorkspaces]);

  useEffect(() => {
    if (publicWorkspaces.length === 0 && !isLoadingWorkspaces) {
      fetchPublicWorkspaces(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchPublicWorkspaces]);

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

  const visibleSelectedIds = workspaceOptions ? selectedIds.filter((id) => workspaceOptions.some((workspace) => workspace.id === id)) : selectedIds;
  const selectedCount = visibleSelectedIds.length;
  const hasSelection = selectedCount > 0;

  const renderItem = (ws: { id: string; name: string; documentCount: number }, subtitle?: string) => (
    <CommandItem
      key={ws.id}
      value={`${ws.name} ${subtitle ?? ''}`}
      onSelect={() => handleToggle(ws.id)}
      onClick={(e) => {
        e?.stopPropagation?.();
        handleToggle(ws.id);
      }}
      className='cursor-pointer'>
      <div className={cn('mr-2 h-4 w-4 rounded border border-primary flex items-center justify-center', selectedIds.includes(ws.id) && 'bg-primary text-primary-foreground')}>
        {selectedIds.includes(ws.id) && (
          <svg className='h-3 w-3' fill='currentColor' viewBox='0 0 20 20'>
            <path d='M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z' />
          </svg>
        )}
      </div>
      <div className='flex-1 min-w-0'>
        <span className='block truncate'>{ws.name}</span>
        {subtitle && <span className='block truncate text-xs text-muted-foreground'>{subtitle}</span>}
      </div>
      {ws.documentCount > 0 && (
        <Badge variant='outline' className='ml-2 text-xs'>
          {ws.documentCount}
        </Badge>
      )}
    </CommandItem>
  );

  const renderContent = () => {
    if (workspaceOptions) {
      return workspaceOptions.length > 0 ? (
        <CommandGroup heading={t('select.ownGroup')}>
          {workspaceOptions.map((workspace) => renderItem(workspace))}
        </CommandGroup>
      ) : <div className='text-center py-8 text-sm text-muted-foreground'>{t('select.noWorkspaces')}</div>;
    }

    if (isLoadingWorkspaces && workspaces.length === 0 && sharedWorkspaces.length === 0 && publicWorkspaces.length === 0) {
      return (
        <div className='flex items-center justify-center py-8'>
          <div className='h-4 w-4 animate-spin border-2 border-current border-t-transparent rounded-full' />
        </div>
      );
    }

    if (workspaces.length === 0 && sharedWorkspaces.length === 0 && publicWorkspaces.length === 0) {
      return <div className='text-center py-8 text-sm text-muted-foreground'>{t('select.noWorkspaces')}</div>;
    }

    const ownerName = (o: { firstName?: string; lastName?: string; email: string }) =>
      [o.firstName, o.lastName].filter(Boolean).join(' ').trim() || o.email;

    return (
      <>
        {workspaces.length > 0 && (
          <CommandGroup heading={t('select.ownGroup', { defaultValue: 'Mes workspaces' })}>
            {workspaces.map((workspace) => renderItem(workspace))}
          </CommandGroup>
        )}
        {sharedWorkspaces.length > 0 && (
          <CommandGroup heading={t('select.sharedGroup', { defaultValue: 'Partagés avec moi' })}>
            {sharedWorkspaces.map((workspace) =>
              renderItem(workspace, t('select.sharedBy', { defaultValue: 'Partagé par {{name}}', name: ownerName(workspace.owner) })),
            )}
          </CommandGroup>
        )}
        {publicWorkspaces.length > 0 && (
          <CommandGroup heading={t('select.publicGroup', { defaultValue: 'Publics' })}>
            {publicWorkspaces.map((workspace) =>
              renderItem(workspace, t('select.publicBy', { defaultValue: 'Public · {{name}}', name: ownerName(workspace.owner) })),
            )}
          </CommandGroup>
        )}
      </>
    );
  };

  const onOpenChange = useCallback(() => {
    if (isLoadingWorkspaces) return;
    setOpen((prevSate) => !prevSate);
  }, [isLoadingWorkspaces]);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <div className='relative'>
        <PopoverTrigger asChild>
          <Button type='button' variant={hasSelection ? 'secondary' : 'ghost'} size='icon' aria-label={label ? `${label}: ${t('select.triggerLabel')}` : t('select.triggerLabel')} title={t('select.triggerLabel')} className={cn('h-8 w-8 shrink-0', hasSelection && 'text-primary', className)} disabled={disabled || isLoadingWorkspaces}>
            <Layers className={cn('h-4 w-4', hasSelection && 'fill-current', isLoadingWorkspaces && 'opacity-50')} />
            {label && <span>{label}</span>}
          </Button>
        </PopoverTrigger>
        <BadgeCount count={selectedCount} />
      </div>
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
