import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';
import { GovernanceOperationsPanel } from './GovernanceOperationsPanel';
import { GovernanceReadinessPanel } from './GovernanceReadinessPanel';
import { GovernanceScopeTree } from './GovernanceScopeTree';
import { GovernanceScopeWorkspace, type TabKey } from './GovernanceScopeWorkspace';
import { useGovernanceMemberships, useGovernanceMetrics, useGovernanceScopeOverviews, useGovernanceScopes, useGovernanceUiStore } from '@/modules/governance';

interface Props {
  programId: string | null;
  onCreateScope: () => void;
}

export function GovernanceScopeLifecycleShell({ programId, onCreateScope }: Readonly<Props>): JSX.Element {
  const { t } = useModuleTranslation('governance');
  const selectedScopeId = useGovernanceUiStore((state) => state.selectedScopeId);
  const setSelectedScopeId = useGovernanceUiStore((state) => state.setSelectedScopeId);
  const { data: scopes = [] } = useGovernanceScopes(programId);
  const { data: memberships = [] } = useGovernanceMemberships(programId);
  const { data: metrics = [] } = useGovernanceMetrics(programId);
  const scopeIds = useMemo(() => scopes.map((scope) => scope.id), [scopes]);
  const { byScopeId } = useGovernanceScopeOverviews(programId, scopeIds);
  const overview = selectedScopeId ? byScopeId[selectedScopeId] : undefined;
  const [activeTab, setActiveTab] = useState<TabKey>('overview');

  useEffect(() => {
    if (selectedScopeId && scopes.length > 0 && !scopes.some((scope) => scope.id === selectedScopeId)) setSelectedScopeId(null);
  }, [scopes, selectedScopeId, setSelectedScopeId]);

  useEffect(() => {
    setActiveTab('overview');
  }, [selectedScopeId]);

  return (
    <div className='grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)_320px]'>
      <GovernanceScopeTree scopes={scopes} selectedScopeId={selectedScopeId} overviewsByScopeId={byScopeId} onSelectScope={setSelectedScopeId} onCreateScope={onCreateScope} />
      <div className='grid min-w-0 gap-4'>
        <GovernanceScopeWorkspace programId={programId} scopeId={selectedScopeId} overview={overview} memberships={memberships} metrics={metrics} activeTab={activeTab} onTabChange={setActiveTab} />
        <details className='rounded-2xl border bg-card p-4 shadow-sm'>
          <summary className='cursor-pointer text-sm font-semibold'>{t('scopeShell.advanced.title')}</summary>
          <p className='mt-2 text-sm text-muted-foreground'>{t('scopeShell.advanced.description')}</p>
          <div className='mt-4'>
            <GovernanceOperationsPanel programId={programId} scopes={scopes} />
          </div>
          <Button className='sr-only' type='button'>{t('scopeShell.advanced.title')}</Button>
        </details>
      </div>
      <GovernanceReadinessPanel overview={overview} onNavigateTab={setActiveTab} />
    </div>
  );
}
