import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import {
  useCreateGovernanceDeployment,
  useCreateGovernanceDryRun,
  useCreateGovernanceRevision,
  useCreateGovernanceSource,
  useGovernanceDryRuns,
  useMarkGovernanceDryRun,
  usePublishGovernanceDeployment,
  useSuspendGovernanceDeployment,
  useUpdateGovernanceScope,
  type GovernanceMembership,
  type GovernanceMetric,
  type GovernanceScopeOverview,
} from '@/modules/governance';
import { GovernanceAgentName, GovernanceAgentSelector } from './GovernanceAgentSelector';
import { GovernanceUserName } from './GovernanceUserName';
import { GovernanceWorkspaceSelector } from './GovernanceWorkspaceSelector';

export type TabKey = 'overview' | 'knowledge' | 'agents' | 'access' | 'channels' | 'testPublish' | 'monitor';

export const governanceScopeTabs: TabKey[] = ['overview', 'knowledge', 'agents', 'access', 'channels', 'testPublish', 'monitor'];

const channelLabelKeys = {
  widget: 'scopeShell.channels.widget',
  whatsapp: 'scopeShell.channels.whatsapp',
  telegram: 'scopeShell.channels.telegram',
  api: 'scopeShell.channels.api',
} as const;

const channelStatusKeys = {
  enabled: 'scopeShell.channels.status.enabled',
  not_configured: 'scopeShell.channels.status.not_configured',
  ready: 'scopeShell.channels.status.ready',
  blocked: 'scopeShell.channels.status.blocked',
  warning: 'scopeShell.channels.status.warning',
  active: 'scopeShell.channels.status.active',
  inactive: 'scopeShell.channels.status.inactive',
} as const;

interface Props {
  programId: string | null;
  scopeId: string | null;
  overview?: GovernanceScopeOverview;
  memberships: GovernanceMembership[];
  metrics: GovernanceMetric[];
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
}

export function GovernanceScopeWorkspace({ programId, scopeId, overview, memberships, metrics, activeTab, onTabChange }: Readonly<Props>): JSX.Element {
  const { t } = useModuleTranslation('governance');

  if (!overview || !scopeId) {
    return <section className='rounded-2xl border bg-card p-8 text-center shadow-sm'><h2 className='text-xl font-semibold'>{t('scopeShell.workspace.emptyTitle')}</h2><p className='mt-2 text-sm text-muted-foreground'>{t('scopeShell.workspace.emptyDescription')}</p></section>;
  }

  return (
    <section className='min-w-0 rounded-2xl border bg-card shadow-sm'>
      <div className='border-b p-5'>
        <p className='text-xs font-semibold uppercase tracking-wide text-primary'>{t('scopeShell.workspace.kicker')}</p>
        <h2 className='mt-1 text-2xl font-semibold'>{overview.scope.name}</h2>
        <p className='mt-2 text-sm text-muted-foreground'>{t('scopeShell.workspace.description')}</p>
      </div>
      <div className='flex gap-2 overflow-x-auto border-b p-3'>
        {governanceScopeTabs.map((tab) => <button key={tab} type='button' className={cn('rounded-full px-3 py-1.5 text-sm text-muted-foreground transition hover:bg-muted', activeTab === tab && 'bg-primary text-primary-foreground hover:bg-primary')} onClick={() => onTabChange(tab)}>{t(`scopeShell.tabs.${tab}`)}</button>)}
      </div>
      <div className='p-5'>
        {activeTab === 'overview' && <OverviewTab overview={overview} />}
        {activeTab === 'knowledge' && <KnowledgeTab programId={programId} scopeId={scopeId} overview={overview} />}
        {activeTab === 'agents' && <AgentsTab programId={programId} scopeId={scopeId} overview={overview} />}
        {activeTab === 'access' && <AccessTab memberships={memberships} scopeId={scopeId} />}
        {activeTab === 'channels' && <ChannelsTab overview={overview} />}
        {activeTab === 'testPublish' && <TestPublishTab programId={programId} scopeId={scopeId} overview={overview} />}
        {activeTab === 'monitor' && <MonitorTab overview={overview} metrics={metrics} scopeId={scopeId} />}
      </div>
    </section>
  );
}

function OverviewTab({ overview }: Readonly<{ overview: GovernanceScopeOverview }>): JSX.Element {
  const { t } = useModuleTranslation('governance');
  return <div className='grid gap-3 md:grid-cols-2'><SummaryCard label={t('scopeShell.overview.knowledge')} value={String(overview.knowledge.sharedSources.length + overview.knowledge.localSources.length)} /><SummaryCard label={t('scopeShell.overview.agents')} value={String(overview.agents.mappedAgents.length)} /><SummaryCard label={t('scopeShell.overview.deployment')} value={overview.deployment?.status ?? t('scopeShell.overview.none')} /><SummaryCard label={t('scopeShell.overview.dryRun')} value={overview.latestDryRun?.status ?? t('scopeShell.overview.none')} /></div>;
}

function KnowledgeTab({ programId, scopeId, overview }: Readonly<{ programId: string | null; scopeId: string; overview: GovernanceScopeOverview }>): JSX.Element {
  const { t } = useModuleTranslation('governance');
  const createSource = useCreateGovernanceSource(programId);
  const [title, setTitle] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim() || !workspaceId) return;
    createSource.mutate({ title: title.trim(), visibility: 'scope_specific', sourceType: 'manual_record', scopeIds: [scopeId], workspaceId }, { onSuccess: () => { setTitle(''); setWorkspaceId(''); } });
  };
  return <div className='grid gap-5'><form className='grid gap-3' onSubmit={handleSubmit}><Input id='governance-scope-source-title' name='sourceTitle' aria-label={t('scopeShell.knowledge.sourceTitle')} value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t('scopeShell.knowledge.sourceTitle')} /><GovernanceWorkspaceSelector selectedWorkspaceId={workspaceId} onChange={setWorkspaceId} /><Button type='submit' disabled={createSource.isPending || !workspaceId || !title.trim()}>{t('scopeShell.knowledge.map')}</Button></form><SourceGroup title={t('scopeShell.knowledge.shared')} sources={overview.knowledge.sharedSources} /><SourceGroup title={t('scopeShell.knowledge.local')} sources={overview.knowledge.localSources} /><SourceGroup title={t('scopeShell.knowledge.workspaces')} sources={overview.knowledge.workspaceMappings} /></div>;
}

function AgentsTab({ programId, scopeId, overview }: Readonly<{ programId: string | null; scopeId: string; overview: GovernanceScopeOverview }>): JSX.Element {
  const { t } = useModuleTranslation('governance');
  const updateScope = useUpdateGovernanceScope(programId, scopeId);
  const [agentIds, setAgentIds] = useState<string[]>(overview.scope.agentIds);
  useEffect(() => {
    setAgentIds(overview.scope.agentIds);
  }, [overview.scope.id]);
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    updateScope.mutate({ agentIds });
  };
  return <div className='grid gap-4'><form className='grid gap-3' onSubmit={handleSubmit}><GovernanceAgentSelector selectedAgentIds={agentIds} onChange={setAgentIds} /><Button type='submit' disabled={updateScope.isPending}>{t('scopeShell.agents.save')}</Button></form>{overview.agents.mappedAgents.map((agent) => <div key={agent.id} className='rounded-xl border p-3'><div className='font-medium'><GovernanceAgentName agentId={agent.id} /></div><p className='text-xs text-muted-foreground'>{agent.isPrimary ? t('scopeShell.agents.primary') : t('scopeShell.agents.secondary')}</p></div>)}{overview.agents.mappedAgents.length === 0 && <p className='rounded-xl border border-dashed p-4 text-sm text-muted-foreground'>{t('scopeShell.agents.empty')}</p>}</div>;
}

function AccessTab({ memberships, scopeId }: Readonly<{ memberships: GovernanceMembership[]; scopeId: string }>): JSX.Element {
  const { t } = useModuleTranslation('governance');
  const scopeMemberships = memberships.filter((membership) => !membership.scopeId || membership.scopeId === scopeId);
  return <div className='grid gap-2'>{scopeMemberships.map((membership) => <div key={membership.id} className='rounded-xl border p-3'><div className='font-medium'><GovernanceUserName userId={membership.userId} /></div><p className='text-xs text-muted-foreground'>{t(`scopeShell.access.roles.${membership.role}`)} · {t(`scopeShell.access.status.${membership.status}`)}</p></div>)}{scopeMemberships.length === 0 && <p className='text-sm text-muted-foreground'>{t('access.empty')}</p>}</div>;
}

function ChannelsTab({ overview }: Readonly<{ overview: GovernanceScopeOverview }>): JSX.Element {
  const { t } = useModuleTranslation('governance');
  const channels = Object.entries(overview.channels);
  return <div className='grid gap-3 md:grid-cols-3'>{channels.map(([name, value]) => <ChannelCard key={name} name={name} value={value} />)}{channels.length === 0 && <p className='text-sm text-muted-foreground'>{t('scopeShell.channels.empty')}</p>}</div>;
}

function TestPublishTab({ programId, scopeId, overview }: Readonly<{ programId: string | null; scopeId: string; overview: GovernanceScopeOverview }>): JSX.Element {
  const { t } = useModuleTranslation('governance');
  const deploymentId = overview.deployment?.id ?? null;
  const createDeployment = useCreateGovernanceDeployment(programId);
  const createRevision = useCreateGovernanceRevision(deploymentId);
  const createDryRun = useCreateGovernanceDryRun(deploymentId);
  const markDryRun = useMarkGovernanceDryRun(deploymentId);
  const publishDeployment = usePublishGovernanceDeployment(deploymentId);
  const suspendDeployment = useSuspendGovernanceDeployment(deploymentId);
  const { data: dryRuns = [] } = useGovernanceDryRuns(deploymentId);
  const [dryRunInput, setDryRunInput] = useState('');

  const handleCreateDeployment = () => {
    createDeployment.mutate({ scopeId, name: overview.scope.name, channels: { widget: { enabled: true, status: 'not_configured', allowedOrigins: [] } } });
  };

  const handleCreateRevision = () => {
    const agentId = overview.agents.primaryAgentId;
    if (!agentId) return;
    const workspaceIds = overview.knowledge.workspaceMappings.map((source) => source.workspaceId).filter((id): id is string => Boolean(id));
    createRevision.mutate({ agentId, workspaceIds });
  };

  const handleDryRun = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!dryRunInput.trim()) return;
    createDryRun.mutate({ input: dryRunInput.trim(), simulatedChannel: 'widget' }, { onSuccess: () => setDryRunInput('') });
  };

  const draftDryRuns = dryRuns.filter((dryRun) => dryRun.revisionId === overview.draftRevision?.id);
  const canPublish = overview.draftRevision !== undefined && draftDryRuns.some((dryRun) => dryRun.status === 'passed') && overview.readiness.blockers.length === 0;

  return (
    <div className='grid gap-4'>
      <div className='grid gap-3 md:grid-cols-3'>
        <SummaryCard label={t('scopeShell.testPublish.draft')} value={overview.draftRevision ? t('scopeShell.testPublish.revisionNumber', { number: overview.draftRevision.revisionNumber }) : t('scopeShell.overview.none')} />
        <SummaryCard label={t('scopeShell.testPublish.published')} value={overview.publishedRevision ? t('scopeShell.testPublish.revisionNumber', { number: overview.publishedRevision.revisionNumber }) : t('scopeShell.overview.none')} />
        <SummaryCard label={t('scopeShell.testPublish.latestDryRun')} value={overview.latestDryRun?.status ? t(`scopeShell.testPublish.status.${overview.latestDryRun.status}`) : t('scopeShell.overview.none')} />
      </div>

      {overview.readiness.blockers.length > 0 && <div className='rounded-xl border border-dashed p-4 text-sm text-muted-foreground'>{t('scopeShell.testPublish.blockedHelp')}</div>}

      {!overview.deployment && (
        <div className='flex items-center justify-between gap-3 rounded-xl border bg-background p-4'>
          <p className='text-sm text-muted-foreground'>{t('scopeShell.testPublish.noDeployment')}</p>
          <Button type='button' onClick={handleCreateDeployment} disabled={createDeployment.isPending}>{t('deployment.create')}</Button>
        </div>
      )}

      {overview.deployment && !overview.draftRevision && (
        <div className='flex items-center justify-between gap-3 rounded-xl border bg-background p-4'>
          <p className='text-sm text-muted-foreground'>{t('scopeShell.testPublish.noDraftRevision')}</p>
          <Button type='button' onClick={handleCreateRevision} disabled={createRevision.isPending || !overview.agents.primaryAgentId}>{t('deployment.createRevision')}</Button>
        </div>
      )}

      {overview.draftRevision && (
        <div className='rounded-xl border bg-background p-4'>
          <h3 className='text-sm font-semibold'>{t('dryRun.title')}</h3>
          <form className='mt-3 flex gap-2' onSubmit={handleDryRun}>
            <Input id='governance-test-publish-dry-run-input' name='dryRunInput' aria-label={t('dryRun.inputLabel')} value={dryRunInput} onChange={(event) => setDryRunInput(event.target.value)} placeholder={t('dryRun.inputPlaceholder')} />
            <Button type='submit' disabled={createDryRun.isPending || !dryRunInput.trim()}>{t('dryRun.run')}</Button>
          </form>
          <div className='mt-3 grid gap-2'>
            {draftDryRuns.map((dryRun) => (
              <div key={dryRun.id} className='flex items-center justify-between gap-3 rounded-lg border p-3'>
                <span className='text-sm'>{t(`scopeShell.testPublish.status.${dryRun.status}`)}</span>
                {dryRun.status !== 'passed' && <Button type='button' variant='outline' size='sm' onClick={() => markDryRun.mutate({ dryRunId: dryRun.id, status: 'passed' })} disabled={markDryRun.isPending}>{t('dryRun.pass')}</Button>}
              </div>
            ))}
            {draftDryRuns.length === 0 && <p className='text-sm text-muted-foreground'>{t('dryRun.empty')}</p>}
          </div>
        </div>
      )}

      {overview.draftRevision && (
        <div className='flex items-center gap-2'>
          <Button type='button' onClick={() => publishDeployment.mutate()} disabled={!canPublish || publishDeployment.isPending}>{t('publish.publish')}</Button>
          {overview.publishedRevision && <Button type='button' variant='outline' onClick={() => suspendDeployment.mutate()} disabled={suspendDeployment.isPending}>{t('publish.suspend')}</Button>}
        </div>
      )}
    </div>
  );
}

function MonitorTab({ overview, metrics, scopeId }: Readonly<{ overview: GovernanceScopeOverview; metrics: GovernanceMetric[]; scopeId: string }>): JSX.Element {
  const { t } = useModuleTranslation('governance');
  const scopeMetrics = metrics.filter((metric) => metric.scopeId === scopeId);
  return <div className='grid gap-3 md:grid-cols-2'><SummaryCard label={t('scopeShell.monitor.total')} value={String(overview.metricsSummary.totalEvents)} />{scopeMetrics.map((metric) => <SummaryCard key={metric.id} label={metric.type} value={String(metric.value)} />)}</div>;
}

function SourceGroup({ title, sources }: Readonly<{ title: string; sources: GovernanceScopeOverview['knowledge']['localSources'] }>): JSX.Element {
  const { t } = useModuleTranslation('governance');
  return <div><h3 className='text-sm font-semibold'>{title}</h3><div className='mt-2 grid gap-2'>{sources.map((source) => <div key={source.id} className='rounded-xl border p-3'><div className='font-medium'>{source.title}</div><p className='text-xs text-muted-foreground'>{source.workspaceId ? t('scopeShell.knowledge.workspaceMapped') : t(`sources.visibility.${source.visibility}`)} · {t(`scopeShell.knowledge.status.${source.status}`)}</p></div>)}{sources.length === 0 && <p className='text-sm text-muted-foreground'>{t('sources.empty')}</p>}</div></div>;
}

function ChannelCard({ name, value }: Readonly<{ name: string; value: unknown }>): JSX.Element {
  const { t } = useModuleTranslation('governance');
  const config = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const isEnabled = config.enabled === true;
  const status = typeof config.status === 'string' ? config.status : isEnabled ? 'enabled' : 'not_configured';
  const labelKey = channelLabelKeys[name as keyof typeof channelLabelKeys];
  const statusKey = channelStatusKeys[status as keyof typeof channelStatusKeys];
  return <div className='rounded-xl border bg-background p-4'><p className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>{labelKey ? t(labelKey) : name}</p><p className='mt-2 text-sm font-medium'>{statusKey ? t(statusKey) : status}</p><p className='mt-1 text-xs text-muted-foreground'>{isEnabled ? t('scopeShell.channels.configured') : t('scopeShell.channels.configureInAdvanced')}</p></div>;
}

function SummaryCard({ label, value }: Readonly<{ label: string; value: string }>): JSX.Element {
  return <div className='min-w-0 rounded-xl border bg-background p-4'><p className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>{label}</p><p className='mt-2 truncate text-sm font-medium'>{value}</p></div>;
}
