import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronsUpDown, Database } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  getSharedWorkspaces,
  getWorkspaces,
  isSharedWorkspace,
  type SharedWorkspaceResponse,
  type Workspace,
} from '@/modules/workspace';
import { useModuleTranslation } from '@/modules/localization';

interface Props {
  value: string[];
  onChange: (value: string[]) => void;
}

export function PlaybookWorkspaceSelect({ value, onChange }: Props) {
  const { t } = useModuleTranslation('playbook');
  const [open, setOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<Array<Workspace | SharedWorkspaceResponse>>([]);
  const [fetchError, setFetchError] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [triggerWidth, setTriggerWidth] = useState(0);

  const fetchWorkspaces = useCallback(() => {
    Promise.allSettled([getWorkspaces({ limit: 100 }), getSharedWorkspaces({ limit: 100 })])
      .then(([ownedResult, sharedResult]) => {
        const owned = ownedResult.status === 'fulfilled' ? ownedResult.value.workspaces : [];
        const shared = sharedResult.status === 'fulfilled' ? sharedResult.value.workspaces : [];
        setWorkspaces([...owned, ...shared]);
        setFetchError(owned.length === 0 && shared.length === 0);
      });
  }, []);

  // Fetch workspaces every time the popover opens (catches newly created ones)
  useEffect(() => {
    if (open) {
      if (triggerRef.current) setTriggerWidth(triggerRef.current.offsetWidth);
      fetchWorkspaces();
    }
  }, [open, fetchWorkspaces]);

  // Also fetch on mount so badges can resolve names
  useEffect(() => {
    fetchWorkspaces();
  }, [fetchWorkspaces]);

  const selectedWorkspaceId = value[0] ?? null;

  const selectWorkspace = useCallback(
    (workspaceId: string) => {
      if (selectedWorkspaceId === workspaceId) {
        setOpen(false);
        return;
      }

      onChange([workspaceId]);
      setOpen(false);
    },
    [selectedWorkspaceId, onChange],
  );

  const selectedWorkspaceName = selectedWorkspaceId
    ? workspaces.find((ws) => ws.id === selectedWorkspaceId)?.name ?? null
    : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          ref={triggerRef}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between h-8 font-normal overflow-hidden"
          size="sm"
        >
          <div className="flex items-center gap-1.5 flex-1 min-w-0 overflow-hidden">
            <Database className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            {selectedWorkspaceName ? (
              <span className="truncate text-xs">
                {selectedWorkspaceName}
              </span>
            ) : (
              <span className="text-muted-foreground text-xs truncate">
                {t('workspace.selectPlaceholder')}
              </span>
            )}
          </div>
          <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="p-0"
        align="start"
        style={{ width: triggerWidth > 0 ? triggerWidth : undefined }}
      >
        <Command>
          <CommandInput placeholder={t('workspace.searchPlaceholder')} />
          <CommandList className="max-h-60 overflow-y-auto">
            <CommandEmpty>
              {fetchError ? (
                <button type="button" className="text-destructive cursor-pointer" onClick={fetchWorkspaces}>
                  {t('workspace.retryLoad')}
                </button>
              ) : (
                t('workspace.empty')
              )}
            </CommandEmpty>
            <CommandGroup>
              {workspaces.map((ws) => (
                <CommandItem
                  key={ws.id}
                  value={ws.name}
                  onSelect={() => selectWorkspace(ws.id)}
                  className="cursor-pointer"
                >
                  <div
                    className={cn(
                      'mr-2 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-primary',
                       selectedWorkspaceId === ws.id
                         ? 'bg-primary text-primary-foreground'
                         : 'opacity-50',
                     )}
                   >
                     {selectedWorkspaceId === ws.id && <Check className="h-3 w-3" />}
                   </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm truncate">{ws.name}</span>
                    {ws.description && (
                      <span className="text-xs text-muted-foreground truncate">
                        {ws.description}
                      </span>
                    )}
                    </div>
                    {isSharedWorkspace(ws) && (
                      <Badge variant="outline" className="ml-2 text-[10px] shrink-0">
                        {t('workspace.sharedBadge')}
                      </Badge>
                    )}
                    {selectedWorkspaceId === ws.id && (
                      <Badge variant="secondary" className="ml-auto text-[10px] shrink-0">
                        {ws.documentCount}
                      </Badge>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
