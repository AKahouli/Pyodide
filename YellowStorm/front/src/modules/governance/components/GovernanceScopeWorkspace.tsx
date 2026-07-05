import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import {
  useCreateGovernanceDeployment,
  useCreateGovernanceDryRun,
  useCreateGovernanceMembership,
  useCreateGovernanceRevision,
  useCreateGovernanceSource,
  useDeleteGovernanceMembership,
  useDeleteGovernanceScope,
  useDeleteGovernanceSource,
  useGovernanceDryRuns,
  useGovernanceUiStore,
  useMarkGovernanceDryRun,
  usePublishGovernanceDeployment,
  useSuspendGovernanceDeployment,
  useUpdateGovernanceDeployment,
  useUpdateGovernanceScope,
  type GovernanceChannelConfig,
  type GovernanceMembership,
  type GovernanceMembershipRole,
  type GovernanceMetric,
  type GovernanceScope,
  type GovernanceScopeOverview,
} from '@/modules/governance';
import { GovernanceAgentName, GovernanceAgentSelector } from './GovernanceAgentSelector';
import { GovernanceUserName } from './GovernanceUserName';
import { GovernanceWorkspaceSelector } from './GovernanceWorkspaceSelector';

const channelKeys = ['widget', 'whatsapp', 'telegram', 'api'] as const;

const scopeTypeOptions: GovernanceScope['type'][] = ['organization', 'municipality', 'department', 'business_unit', 'country', 'team', 'custom'];

const inviteRoles: GovernanceMembershipRole[] = ['program_admin', 'scope_admin', 'scope_editor', 'scope_reviewer', 'scope_viewer'];

function normalizeChannels(channels: GovernanceScopeOverview['channels']): Record<string, GovernanceChannelConfig> {
  const source = (channels ?? {}) as Record<string, GovernanceChannelConfig>;
  const result: Record<string, GovernanceChannelConfig> = {};
  for (const key of channelKeys) {
    const existing = source[key] ?? {};
    result[key] = { enabled: existing.enabled ?? false, status: existing.status ?? 'not_configured', allowedOrigins: existing.allowedOrigins ?? [] };
  }
  return result;
}

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
        {activeTab === 'overview' && <OverviewTab programId={programId} overview={overview} />}
        {activeTab === 'knowledge' && <KnowledgeTab programId={programId} scopeId={scopeId} overview={overview} />}
        {activeTab === 'agents' && <AgentsTab programId={programId} scopeId={scopeId} overview={overview} />}
        {activeTab === 'access' && <AccessTab programId={programId} memberships={memberships} scopeId={scopeId} />}
        {activeTab === 'channels' && <ChannelsTab programId={programId} scopeId={scopeId} overview={overview} />}
        {activeTab === 'testPublish' && <TestPublishTab programId={programId} scopeId={scopeId} overview={overview} />}
        {activeTab === 'monitor' && <MonitorTab overview={overview} metrics={metrics} scopeId={scopeId} />}
      </div>
    </section>
  );
}

function OverviewTab({ programId, overview }: Readonly<{ programId: string | null; overview: GovernanceScopeOverview }>): JSX.Element {
  const { t } = useModuleTranslation('governance');
  const channelEntries = Object.entries(overview.channels);
  return (
    <div className='grid gap-3'>
      <ScopeSettingsCard programId={programId} overview={overview} />
      <div className='grid gap-3 md:grid-cols-2'>
      <OverviewCard title={t('scopeShell.overview.knowledgeCard')}>
        <OverviewRow label={t('scopeShell.knowledge.shared')} value={String(overview.knowledge.sharedSources.length)} />
        <OverviewRow label={t('scopeShell.knowledge.local')} value={String(overview.knowledge.localSources.length)} />
        <OverviewRow label={t('scopeShell.knowledge.workspaces')} value={String(overview.knowledge.workspaceMappings.length)} />
      </OverviewCard>
      <OverviewCard title={t('scopeShell.overview.agentsCard')}>
        <OverviewRow label={t('scopeShell.overview.agents')} value={String(overview.agents.mappedAgents.length)} />
        <OverviewRow label={t('scopeShell.overview.primaryAgent')} value={overview.agents.primaryAgentId ? <GovernanceAgentName agentId={overview.agents.primaryAgentId} /> : t('scopeShell.overview.none')} />
        <OverviewRow
          label={t('scopeShell.overview.knowledgeCoverage')}
          value={overview.agents.missingAgent
            ? <span className='rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-600 dark:text-red-400'>{t('scopeShell.overview.missing')}</span>
            : <span className='rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400'>{t('scopeShell.overview.ok')}</span>}
        />
      </OverviewCard>
      <OverviewCard title={t('scopeShell.overview.channelsCard')}>
        {channelEntries.map(([name, value]) => {
          const labelKey = channelLabelKeys[name as keyof typeof channelLabelKeys];
          return <OverviewRow key={name} label={labelKey ? t(labelKey) : name} value={<ChannelStatusPill value={value} />} />;
        })}
        {channelEntries.length === 0 && <p className='text-sm text-muted-foreground'>{t('scopeShell.channels.empty')}</p>}
      </OverviewCard>
      <OverviewCard title={t('scopeShell.overview.lifecycleCard')}>
        <OverviewRow label={t('scopeShell.testPublish.draft')} value={overview.draftRevision ? t('scopeShell.testPublish.revisionNumber', { number: overview.draftRevision.revisionNumber }) : t('scopeShell.overview.none')} />
        <OverviewRow label={t('scopeShell.testPublish.published')} value={overview.publishedRevision ? t('scopeShell.testPublish.revisionNumber', { number: overview.publishedRevision.revisionNumber }) : t('scopeShell.overview.none')} />
        <OverviewRow label={t('scopeShell.testPublish.latestDryRun')} value={overview.latestDryRun?.status ? t(`scopeShell.testPublish.status.${overview.latestDryRun.status}`) : t('scopeShell.overview.none')} />
      </OverviewCard>
      </div>
    </div>
  );
}

function ScopeSettingsCard({ programId, overview }: Readonly<{ programId: string | null; overview: GovernanceScopeOverview }>): JSX.Element {
  const { t } = useModuleTranslation('governance');
  const setSelectedScopeId = useGovernanceUiStore((state) => state.setSelectedScopeId);
  const updateScope = useUpdateGovernanceScope(programId, overview.scope.id);
  const deleteScope = useDeleteGovernanceScope(programId);
  const [name, setName] = useState(overview.scope.name);
  const [type, setType] = useState<GovernanceScope['type']>(overview.scope.type);

  useEffect(() => {
    setName(overview.scope.name);
    setType(overview.scope.type);
  }, [overview.scope.id, overview.scope.name, overview.scope.type]);

  const isDirty = name.trim() !== overview.scope.name || type !== overview.scope.type;

  const handleSave = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim() || !isDirty) return;
    updateScope.mutate({ name: name.trim(), type });
  };

  const handleDelete = () => {
    deleteScope.mutate(overview.scope.id, { onSuccess: () => setSelectedScopeId(null) });
  };

  return (
    <form onSubmit={handleSave} className='rounded-xl border bg-background p-4'>
      <p className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>{t('scopeShell.settings.title')}</p>
      <div className='mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_200px]'>
        <div className='grid gap-1.5'>
          <Label htmlFor='governance-scope-name'>{t('scopes.nameLabel')}</Label>
          <Input id='governance-scope-name' value={name} onChange={(event) => setName(event.target.value)} placeholder={t('scopes.namePlaceholder')} />
        </div>
        <div className='grid gap-1.5'>
          <Label htmlFor='governance-scope-type'>{t('scopeShell.settings.typeLabel')}</Label>
          <select id='governance-scope-type' className='h-10 rounded-md border bg-background px-3 text-sm' value={type} onChange={(event) => setType(event.target.value as GovernanceScope['type'])}>
            {scopeTypeOptions.map((option) => <option key={option} value={option}>{t(`scopeShell.scopeTypes.${option}`)}</option>)}
          </select>
        </div>
      </div>
      <div className='mt-3 flex items-center gap-2'>
        <Button type='submit' size='sm' disabled={!isDirty || !name.trim() || updateScope.isPending}>{t('scopeShell.settings.save')}</Button>
        <span className='flex-1' />
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button type='button' variant='outline' size='sm' className='text-destructive hover:text-destructive'>{t('scopeShell.settings.delete')}</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('scopeShell.settings.deleteConfirmTitle')}</AlertDialogTitle>
              <AlertDialogDescription>{t('scopeShell.settings.deleteConfirmBody', { name: overview.scope.name })}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('scopeShell.settings.deleteCancel')}</AlertDialogCancel>
              <AlertDialogAction className='bg-destructive text-destructive-foreground hover:bg-destructive/90' onClick={handleDelete} disabled={deleteScope.isPending}>{t('scopeShell.settings.delete')}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </form>
  );
}

function OverviewCard({ title, children }: Readonly<{ title: string; children: ReactNode }>): JSX.Element {
  return (
    <div className='rounded-xl border bg-background p-4'>
      <p className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>{title}</p>
      <div className='mt-2'>{children}</div>
    </div>
  );
}

function OverviewRow({ label, value }: Readonly<{ label: string; value: ReactNode }>): JSX.Element {
  return (
    <div className='flex items-center justify-between gap-3 border-b py-2 text-sm last:border-0'>
      <span className='text-muted-foreground'>{label}</span>
      <span className='font-medium'>{value}</span>
    </div>
  );
}

function ChannelStatusPill({ value }: Readonly<{ value: unknown }>): JSX.Element {
  const { t } = useModuleTranslation('governance');
  const config = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const isEnabled = config.enabled === true;
  const status = typeof config.status === 'string' ? config.status : isEnabled ? 'enabled' : 'not_configured';
  const statusKey = channelStatusKeys[status as keyof typeof channelStatusKeys];
  const isReady = status === 'ready' || status === 'active';
  const isBlocked = status === 'blocked';
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', isReady && 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400', isBlocked && 'bg-red-500/15 text-red-600 dark:text-red-400', !isReady && !isBlocked && 'bg-muted text-muted-foreground')}>
      {statusKey ? t(statusKey) : status}
    </span>
  );
}

function KnowledgeTab({ programId, scopeId, overview }: Readonly<{ programId: string | null; scopeId: string; overview: GovernanceScopeOverview }>): JSX.Element {
  const { t } = useModuleTranslation('governance');
  const createSource = useCreateGovernanceSource(programId);
  const deleteSource = useDeleteGovernanceSource(programId);
  const [workspaceId, setWorkspaceId] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [title, setTitle] = useState('');
  const [titleTouched, setTitleTouched] = useState(false);

  const handleSelectWorkspace = (id: string, name?: string) => {
    setWorkspaceId(id);
    setWorkspaceName(name ?? '');
    if (!titleTouched) setTitle(name ?? '');
  };

  const resetForm = () => {
    setWorkspaceId('');
    setWorkspaceName('');
    setTitle('');
    setTitleTouched(false);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!workspaceId) return;
    const finalTitle = (title.trim() || workspaceName).trim();
    if (!finalTitle) return;
    createSource.mutate({ title: finalTitle, visibility: 'scope_specific', sourceType: 'manual_record', scopeIds: [scopeId], workspaceId }, { onSuccess: resetForm });
  };

  return (
    <div className='grid gap-5'>
      <form className='grid gap-3 rounded-xl border bg-background p-4' onSubmit={handleSubmit}>
        <div>
          <h3 className='text-sm font-semibold'>{t('scopeShell.knowledge.mapTitle')}</h3>
          <p className='mt-0.5 text-xs text-muted-foreground'>{t('scopeShell.knowledge.mapHint')}</p>
        </div>
        <GovernanceWorkspaceSelector selectedWorkspaceId={workspaceId} onChange={handleSelectWorkspace} />
        {workspaceId && (
          <div className='grid gap-1.5'>
            <label className='text-xs font-medium text-muted-foreground' htmlFor='governance-scope-source-title'>{t('scopeShell.knowledge.titleOptional')}</label>
            <Input id='governance-scope-source-title' name='sourceTitle' value={title} onChange={(event) => { setTitle(event.target.value); setTitleTouched(true); }} placeholder={workspaceName || t('scopeShell.knowledge.sourceTitle')} />
          </div>
        )}
        <Button type='submit' disabled={createSource.isPending || !workspaceId} className='w-fit'>{t('scopeShell.knowledge.map')}</Button>
      </form>
      <SourceGroup title={t('scopeShell.knowledge.shared')} sources={overview.knowledge.sharedSources} />
      <SourceGroup title={t('scopeShell.knowledge.local')} sources={overview.knowledge.localSources} onRemove={(id) => deleteSource.mutate(id)} removingId={deleteSource.isPending ? deleteSource.variables ?? null : null} />
      <SourceGroup title={t('scopeShell.knowledge.workspaces')} sources={overview.knowledge.workspaceMappings} onRemove={(id) => deleteSource.mutate(id)} removingId={deleteSource.isPending ? deleteSource.variables ?? null : null} />
    </div>
  );
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

function AccessTab({ programId, memberships, scopeId }: Readonly<{ programId: string | null; memberships: GovernanceMembership[]; scopeId: string }>): JSX.Element {
  const { t } = useModuleTranslation('governance');
  const createMembership = useCreateGovernanceMembership(programId);
  const deleteMembership = useDeleteGovernanceMembership(programId);
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<GovernanceMembershipRole>('scope_viewer');
  const [level, setLevel] = useState<'scope' | 'program'>('scope');
  const scopeMemberships = memberships.filter((membership) => !membership.scopeId || membership.scopeId === scopeId);

  const handleInvite = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!userId.trim()) return;
    createMembership.mutate({ userId: userId.trim(), scopeId: level === 'scope' ? scopeId : undefined, role, status: 'active' }, { onSuccess: () => setUserId('') });
  };

  return (
    <div className='grid gap-4'>
      <form onSubmit={handleInvite} className='grid gap-3 rounded-xl border bg-background p-4'>
        <div>
          <h3 className='text-sm font-semibold'>{t('scopeShell.access.inviteTitle')}</h3>
          <p className='mt-0.5 text-xs text-muted-foreground'>{t('scopeShell.access.inviteHint')}</p>
        </div>
        <div className='grid gap-3 md:grid-cols-3'>
          <Input aria-label={t('access.userIdLabel')} value={userId} onChange={(event) => setUserId(event.target.value)} placeholder={t('access.userIdPlaceholder')} />
          <select aria-label={t('access.roleLabel')} className='h-10 rounded-md border bg-background px-3 text-sm' value={role} onChange={(event) => setRole(event.target.value as GovernanceMembershipRole)}>
            {inviteRoles.map((option) => <option key={option} value={option}>{t(`scopeShell.access.roles.${option}`)}</option>)}
          </select>
          <select aria-label={t('scopeShell.access.levelLabel')} className='h-10 rounded-md border bg-background px-3 text-sm' value={level} onChange={(event) => setLevel(event.target.value as 'scope' | 'program')}>
            <option value='scope'>{t('scopeShell.access.thisScope')}</option>
            <option value='program'>{t('access.programLevel')}</option>
          </select>
        </div>
        <Button type='submit' className='w-fit' disabled={createMembership.isPending || !userId.trim()}>{t('access.invite')}</Button>
      </form>
      <div className='grid gap-2'>
        {scopeMemberships.map((membership) => (
          <div key={membership.id} className='flex items-center justify-between gap-3 rounded-xl border p-3'>
            <div className='min-w-0'>
              <div className='truncate font-medium'><GovernanceUserName userId={membership.userId} /></div>
              <p className='text-xs text-muted-foreground'>{t(`scopeShell.access.roles.${membership.role}`)} · {t(`scopeShell.access.status.${membership.status}`)}{membership.scopeId ? '' : ` · ${t('access.programLevel')}`}</p>
            </div>
            <Button type='button' variant='ghost' size='icon' className='h-8 w-8 flex-none text-muted-foreground hover:text-destructive' aria-label={t('access.disable')} disabled={deleteMembership.isPending} onClick={() => deleteMembership.mutate(membership.id)}>
              <Trash2 className='h-4 w-4' />
            </Button>
          </div>
        ))}
        {scopeMemberships.length === 0 && <p className='text-sm text-muted-foreground'>{t('access.empty')}</p>}
      </div>
    </div>
  );
}

function ChannelsTab({ programId, scopeId, overview }: Readonly<{ programId: string | null; scopeId: string; overview: GovernanceScopeOverview }>): JSX.Element {
  const { t } = useModuleTranslation('governance');
  const deploymentId = overview.deployment?.id ?? null;
  const createDeployment = useCreateGovernanceDeployment(programId);
  const updateDeployment = useUpdateGovernanceDeployment(programId, deploymentId);
  const [draft, setDraft] = useState<Record<string, GovernanceChannelConfig>>(() => normalizeChannels(overview.channels));
  const channelsSignature = JSON.stringify(overview.channels);

  useEffect(() => {
    setDraft(normalizeChannels(overview.channels));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deploymentId, channelsSignature]);

  if (!overview.deployment) {
    return (
      <div className='flex items-center justify-between gap-3 rounded-xl border bg-background p-4'>
        <p className='text-sm text-muted-foreground'>{t('scopeShell.channels.noDeployment')}</p>
        <Button type='button' onClick={() => createDeployment.mutate({ scopeId, name: overview.scope.name, channels: { widget: { enabled: true, status: 'not_configured', allowedOrigins: [] } } })} disabled={createDeployment.isPending}>{t('deployment.create')}</Button>
      </div>
    );
  }

  const setChannel = (key: string, patch: Partial<GovernanceChannelConfig>) => setDraft((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));

  const handleSave = () => updateDeployment.mutate({ channels: draft });

  return (
    <div className='grid gap-4'>
      <p className='text-sm text-muted-foreground'>{t('scopeShell.channels.editHint')}</p>
      <div className='grid gap-3'>
        {channelKeys.map((key) => {
          const config = draft[key] ?? {};
          const labelKey = channelLabelKeys[key];
          return (
            <div key={key} className='rounded-xl border bg-background p-4'>
              <div className='flex items-center justify-between gap-3'>
                <div>
                  <p className='text-sm font-medium'>{t(labelKey)}</p>
                  <p className='text-xs text-muted-foreground'>{config.status === 'ready' ? t('scopeShell.channels.status.ready') : t('scopeShell.channels.status.not_configured')}</p>
                </div>
                <Switch checked={config.enabled ?? false} onCheckedChange={(checked) => setChannel(key, { enabled: checked, status: checked ? config.status : 'not_configured' })} aria-label={t(labelKey)} />
              </div>
              {config.enabled && (
                <div className='mt-3 grid gap-3 border-t pt-3'>
                  {key === 'widget' && (
                    <div className='grid gap-1.5'>
                      <Label htmlFor='governance-widget-origins'>{t('scopeShell.channels.allowedOrigins')}</Label>
                      <Input
                        id='governance-widget-origins'
                        value={(config.allowedOrigins ?? []).join(', ')}
                        onChange={(event) => {
                          const origins = event.target.value.split(',').map((origin) => origin.trim()).filter(Boolean);
                          setChannel(key, { allowedOrigins: origins, status: origins.length > 0 ? 'ready' : 'not_configured' });
                        }}
                        placeholder={t('scopeShell.channels.allowedOriginsPlaceholder')}
                      />
                      <p className='text-xs text-muted-foreground'>{t('scopeShell.channels.allowedOriginsHint')}</p>
                    </div>
                  )}
                  {key !== 'widget' && (
                    <label className='flex items-center gap-2 text-sm'>
                      <Switch checked={config.status === 'ready'} onCheckedChange={(checked) => setChannel(key, { status: checked ? 'ready' : 'not_configured' })} aria-label={t('scopeShell.channels.markReady')} />
                      <span>{t('scopeShell.channels.markReady')}</span>
                    </label>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <Button type='button' className='w-fit' onClick={handleSave} disabled={updateDeployment.isPending}>{t('scopeShell.channels.save')}</Button>
    </div>
  );
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

function SourceGroup({ title, sources, onRemove, removingId }: Readonly<{ title: string; sources: GovernanceScopeOverview['knowledge']['localSources']; onRemove?: (sourceId: string) => void; removingId?: string | null }>): JSX.Element {
  const { t } = useModuleTranslation('governance');
  return (
    <div>
      <h3 className='text-sm font-semibold'>{title}</h3>
      <div className='mt-2 grid gap-2'>
        {sources.map((source) => (
          <div key={source.id} className='flex items-center justify-between gap-3 rounded-xl border p-3'>
            <div className='min-w-0'>
              <div className='truncate font-medium'>{source.title}</div>
              <p className='text-xs text-muted-foreground'>{source.workspaceId ? t('scopeShell.knowledge.workspaceMapped') : t(`sources.visibility.${source.visibility}`)} · {t(`scopeShell.knowledge.status.${source.status}`)}</p>
            </div>
            {onRemove && (
              <Button type='button' variant='ghost' size='icon' className='h-8 w-8 flex-none text-muted-foreground hover:text-destructive' aria-label={t('scopeShell.knowledge.remove')} disabled={removingId === source.id} onClick={() => onRemove(source.id)}>
                <Trash2 className='h-4 w-4' />
              </Button>
            )}
          </div>
        ))}
        {sources.length === 0 && <p className='text-sm text-muted-foreground'>{t('sources.empty')}</p>}
      </div>
    </div>
  );
}

function SummaryCard({ label, value }: Readonly<{ label: string; value: string }>): JSX.Element {
  return <div className='min-w-0 rounded-xl border bg-background p-4'><p className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>{label}</p><p className='mt-2 truncate text-sm font-medium'>{value}</p></div>;
}
