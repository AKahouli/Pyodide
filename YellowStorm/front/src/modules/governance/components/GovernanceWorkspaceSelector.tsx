import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useModuleTranslation } from '@/modules/localization';
import { useWorkspaceStore, useWorkspaces, type Workspace } from '@/modules/workspace';

interface Props {
  selectedWorkspaceId: string;
  onChange: (workspaceId: string, workspaceName?: string) => void;
}

export function GovernanceWorkspaceSelector({ selectedWorkspaceId, onChange }: Readonly<Props>): JSX.Element {
  const { t } = useModuleTranslation('governance');
  const workspaces = useWorkspaces();
  const fetchWorkspaces = useWorkspaceStore((state) => state.fetchWorkspaces);
  const searchWorkspaces = useWorkspaceStore((state) => state.searchWorkspaces);
  const isLoading = useWorkspaceStore((state) => state.isLoadingWorkspaces);
  const [search, setSearch] = useState('');

  useEffect(() => {
    void fetchWorkspaces(1);
  }, [fetchWorkspaces]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void searchWorkspaces(search);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [search, searchWorkspaces]);

  const selectedWorkspace = workspaces.find((workspace) => workspace.id === selectedWorkspaceId);

  return (
    <div className='grid gap-2'>
      <Input
        aria-label={t('scopeShell.knowledge.workspaceSearch')}
        placeholder={t('scopeShell.knowledge.workspaceSearch')}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className='grid max-h-48 gap-2 overflow-y-auto rounded-xl border bg-background p-2'>
        {workspaces.map((workspace) => (
          <WorkspaceOption key={workspace.id} workspace={workspace} isSelected={workspace.id === selectedWorkspaceId} onSelect={() => onChange(workspace.id, workspace.name)} />
        ))}
        {!isLoading && workspaces.length === 0 && <p className='p-2 text-sm text-muted-foreground'>{t('scopeShell.knowledge.noWorkspaces')}</p>}
        {isLoading && <p className='p-2 text-sm text-muted-foreground'>{t('scopeShell.knowledge.loadingWorkspaces')}</p>}
      </div>
      {selectedWorkspace && <p className='text-xs text-muted-foreground'>{t('scopeShell.knowledge.selectedWorkspace', { name: selectedWorkspace.name })}</p>}
    </div>
  );
}

function WorkspaceOption({ workspace, isSelected, onSelect }: Readonly<{ workspace: Workspace; isSelected: boolean; onSelect: () => void }>): JSX.Element {
  const { t } = useModuleTranslation('governance');
  return (
    <Button type='button' variant={isSelected ? 'default' : 'ghost'} className='h-auto justify-start px-3 py-2 text-left' onClick={onSelect}>
      <span className='min-w-0'>
        <span className='block truncate font-medium'>{workspace.name}</span>
        <span className='block truncate text-xs opacity-80'>{t('scopeShell.knowledge.workspaceDetails', { count: workspace.documentCount })}</span>
      </span>
    </Button>
  );
}
