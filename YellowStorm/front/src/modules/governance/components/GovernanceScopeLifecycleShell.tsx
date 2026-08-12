import { useEffect, useRef, useState } from 'react';
import { GovernanceReadinessPanel } from './GovernanceReadinessPanel';
import { GovernanceScopeWorkspace } from './GovernanceScopeWorkspace';
import type { TabKey } from './scope-readiness';
import { useGovernanceMemberships, useGovernanceMetrics, useGovernanceScopeOverview, useGovernanceScopes, useGovernanceUiStore } from '@/modules/governance';

interface Props {
  programId: string | null;
  initialTab?: TabKey;
  onActiveTabChange?: (tab: TabKey) => void;
}

export function GovernanceScopeLifecycleShell({ programId, initialTab = 'overview', onActiveTabChange }: Readonly<Props>): JSX.Element {
  const selectedScopeId = useGovernanceUiStore((state) => state.selectedScopeId);
  const setSelectedScopeId = useGovernanceUiStore((state) => state.setSelectedScopeId);
  const { data: scopes = [] } = useGovernanceScopes(programId);
  const { data: memberships = [], isLoading: membershipsLoading } = useGovernanceMemberships(programId);
  const { data: metrics = [] } = useGovernanceMetrics(programId);
  const { data: overview } = useGovernanceScopeOverview(programId, selectedScopeId);
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);
  const previousScopeId = useRef(selectedScopeId);

  const handleTabChange = (tab: TabKey) => {
    setActiveTab(tab);
    onActiveTabChange?.(tab);
  };

  useEffect(() => {
    if (selectedScopeId && scopes.length > 0 && !scopes.some((scope) => scope.id === selectedScopeId)) setSelectedScopeId(null);
  }, [scopes, selectedScopeId, setSelectedScopeId]);

  useEffect(() => {
    if (previousScopeId.current && previousScopeId.current !== selectedScopeId) {
      setActiveTab('overview');
      onActiveTabChange?.('overview');
    }
    previousScopeId.current = selectedScopeId;
  }, [onActiveTabChange, selectedScopeId]);

  return (
    <div className='grid min-w-0 items-start gap-4 lg:grid-cols-[280px_minmax(0,1fr)]'>
      <div className='grid min-w-0 gap-4 lg:col-start-2 lg:row-start-1'>
        <GovernanceScopeWorkspace programId={programId} scopeId={selectedScopeId} overview={overview} memberships={memberships} membershipsLoading={membershipsLoading} metrics={metrics} activeTab={activeTab} onTabChange={handleTabChange} />
      </div>
      <GovernanceReadinessPanel className='lg:col-start-1 lg:row-start-1' overview={overview} onNavigateTab={handleTabChange} />
    </div>
  );
}
