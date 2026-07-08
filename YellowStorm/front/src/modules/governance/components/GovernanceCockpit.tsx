import { useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowRight, BookOpen, Plus, Trash2, X } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { parseApiError } from '@/lib/api-error';
import { showError } from '@/lib/notifications';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { useDeleteGovernanceScope, useGovernanceScopeOverviews, useGovernanceScopes, type GovernanceScope, type GovernanceScopeOverview } from '@/modules/governance';
import { useGovernanceCheckLabel } from '../useGovernanceCheckLabel';
import { GovernanceAgentName } from './GovernanceAgentSelector';
import { ReadinessRing } from './ReadinessRing';
import type { TabKey } from './GovernanceScopeWorkspace';

interface Props {
  programId: string | null;
  onSelectScope: (scopeId: string, tab?: TabKey) => void;
  onCreateScope: () => void;
}

type ScopeFilter = 'all' | 'published' | 'draft' | 'ready' | 'needs_attention';

const actionLabelKeys: Partial<Record<string, string>> = {
  agents_mapped: 'cockpit.attention.actions.mapAgents',
  knowledge_mapped: 'cockpit.attention.actions.mapKnowledge',
  ownership_assigned: 'cockpit.attention.actions.assignOwnership',
  guardrails_reviewed: 'cockpit.attention.actions.reviewGuardrails',
  draft_revision: 'cockpit.attention.actions.createDraft',
  dry_run_passed: 'cockpit.attention.actions.runDryRun',
  scope_active: 'cockpit.attention.actions.activateScope',
  channel_ready: 'cockpit.attention.actions.configureChannel',
};

const actionHelpKeys: Partial<Record<string, string>> = {
  agents_mapped: 'cockpit.attention.help.mapAgents',
  knowledge_mapped: 'cockpit.attention.help.mapKnowledge',
  ownership_assigned: 'cockpit.attention.help.assignOwnership',
  guardrails_reviewed: 'cockpit.attention.help.reviewGuardrails',
  draft_revision: 'cockpit.attention.help.createDraft',
  dry_run_passed: 'cockpit.attention.help.runDryRun',
  scope_active: 'cockpit.attention.help.activateScope',
  channel_ready: 'cockpit.attention.help.configureChannel',
};

function tabForAttentionItem(targetType?: string, key?: string): TabKey {
  if (targetType === 'source' || targetType === 'workspace' || key === 'knowledge_mapped') return 'knowledge';
  if (targetType === 'agent' || key === 'agents_mapped') return 'agents';
  if (targetType === 'channel' || key?.startsWith('channel_')) return 'agents';
  if (key === 'ownership_assigned') return 'ownership';
  if (targetType === 'dry_run' || key === 'draft_revision' || key === 'draft_revision_publishable' || key === 'dry_run_passed') return 'testPublish';
  return 'overview';
}

function isVisibleAttentionItem(key: string): boolean {
  return !key.startsWith('deployment_') && key !== 'draft_revision_publishable';
}

export function GovernanceCockpit({ programId, onSelectScope, onCreateScope }: Readonly<Props>): JSX.Element {
  const { t } = useModuleTranslation('governance');
  const [activeFilter, setActiveFilter] = useState<ScopeFilter>('all');
  const { data: scopes = [] } = useGovernanceScopes(programId);
  const deleteScope = useDeleteGovernanceScope(programId);
  const scopeIds = useMemo(() => scopes.map((scope) => scope.id), [scopes]);
  const { byScopeId } = useGovernanceScopeOverviews(programId, scopeIds);
  const { translateBlocker } = useGovernanceCheckLabel();

  const overviews = scopes.map((scope) => byScopeId[scope.id]).filter((value): value is GovernanceScopeOverview => Boolean(value));
  const scored = overviews.map((overview) => overview.readiness.score);
  const avgReadiness = scored.length > 0 ? Math.round(scored.reduce((sum, value) => sum + value, 0) / scored.length) : 0;
  const publishedCount = overviews.filter((overview) => Boolean(overview.publishedRevision)).length;
  const readyCount = overviews.filter((overview) => overview.readiness.status === 'ready').length;
  const attentionItems = overviews.flatMap((overview) =>
    overview.readiness.blockers.filter((blocker) => isVisibleAttentionItem(blocker.key)).map((blocker) => {
      const tab = tabForAttentionItem(blocker.targetType, blocker.key);
      const labelKey = actionLabelKeys[blocker.key] ?? actionLabelKeys.channel_ready;
      const helpKey = actionHelpKeys[blocker.key] ?? actionHelpKeys.channel_ready;
      return {
        scopeId: overview.scope.id,
        scopeName: overview.scope.name,
        label: labelKey ? t(labelKey as never) : translateBlocker(blocker.key, blocker.label),
        helper: helpKey ? t(helpKey as never) : translateBlocker(blocker.key, blocker.label),
        tab,
        actionLabel: t(`scopeShell.tabs.${tab}`),
      };
    }),
  );
  const visibleScopes = scopes.filter((scope) => {
    const overview = byScopeId[scope.id];
    if (activeFilter === 'all') return true;
    if (activeFilter === 'published') return Boolean(overview?.publishedRevision);
    if (activeFilter === 'draft') return !overview?.publishedRevision;
    if (activeFilter === 'ready') return overview?.readiness.status === 'ready';
    return Boolean(overview?.readiness.blockers.some((blocker) => isVisibleAttentionItem(blocker.key)));
  });

  return (
    <div className='grid gap-5'>
      <section className='grid gap-4 sm:grid-cols-2 xl:grid-cols-4'>
        <KpiTile label={t('cockpit.kpis.scopes')} value={scopes.length} active={activeFilter === 'all'}>
          <div className='mt-2 flex flex-wrap gap-1.5'>
            <button type='button' className='rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-600 transition hover:bg-emerald-500/20 dark:text-emerald-400' onClick={() => setActiveFilter('published')}>{t('cockpit.kpis.publishedCount', { count: publishedCount })}</button>
            <button type='button' className='rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground transition hover:bg-muted/80' onClick={() => setActiveFilter('draft')}>{t('cockpit.kpis.draftCount', { count: Math.max(scopes.length - publishedCount, 0) })}</button>
          </div>
        </KpiTile>
        <KpiTile label={t('cockpit.kpis.readiness')} value={`${avgReadiness}%`} />
        <KpiTile label={t('cockpit.kpis.ready')} value={readyCount} accent active={activeFilter === 'ready'} onClick={() => setActiveFilter('ready')} />
        <KpiTile label={t('cockpit.kpis.attention')} value={attentionItems.length} tone={attentionItems.length > 0 ? 'warn' : undefined} active={activeFilter === 'needs_attention'} onClick={() => setActiveFilter('needs_attention')} />
      </section>

      <div className='grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]'>
        <section className='rounded-2xl border bg-card shadow-sm'>
          <header className='flex flex-wrap items-center gap-3 border-b p-4'>
            <h3 className='text-sm font-semibold'>{t('cockpit.scopes.title')}</h3>
            <span className='rounded-full border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground'>{t('cockpit.scopes.count', { count: visibleScopes.length })}</span>
            {activeFilter !== 'all' && <span className='inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary'>{t(`cockpit.filters.${activeFilter}`)}<button type='button' onClick={() => setActiveFilter('all')} aria-label={t('cockpit.filters.clear')}><X className='h-3 w-3' /></button></span>}
            <span className='flex-1' />
            {programId && <Button type='button' size='sm' onClick={onCreateScope}><Plus className='h-4 w-4' />{t('cockpit.newScope')}</Button>}
          </header>
          {scopes.length === 0 ? (
            <div className='m-4 grid justify-items-center gap-3 rounded-xl border border-dashed p-6 text-center'>
              <p className='text-sm text-muted-foreground'>{t('cockpit.scopes.empty')}</p>
              {programId && (
                <Button type='button' variant='outline' size='sm' onClick={onCreateScope}>
                  <Plus className='h-4 w-4' />{t('cockpit.newScope')}
                </Button>
              )}
            </div>
          ) : (
            <div className='grid gap-3 p-4 sm:grid-cols-2'>
              {visibleScopes.map((scope) => (
                <ScopeCard key={scope.id} scope={scope} overview={byScopeId[scope.id]} onOpen={() => onSelectScope(scope.id)} onDelete={() => deleteScope.mutate(scope.id, { onError: (error) => showError(t('cockpit.scopes.deleteError'), { description: parseApiError(error).message }) })} isDeleting={deleteScope.isPending && deleteScope.variables === scope.id} translateBlocker={translateBlocker} translateDryRunStatus={(status) => t(`scopeShell.testPublish.status.${status}` as never)} typeLabel={t(`scopeShell.scopeTypes.${scope.type}`)} statusReady={t('cockpit.scopes.ready')} statusPublished={t('cockpit.scopes.published')} statusDraft={t('cockpit.scopes.draft')} ownerReady={t('cockpit.scopes.ownerReady')} ownerMissing={t('cockpit.scopes.ownerMissing')} dryRunLabel={t('cockpit.scopes.dryRun')} noAgent={t('cockpit.scopes.noAgent')} noDryRun={t('cockpit.scopes.noDryRun')} deleteLabel={t('cockpit.scopes.delete')} deleteConfirmTitle={t('cockpit.scopes.deleteConfirmTitle')} deleteConfirmBody={t('cockpit.scopes.deleteConfirmBody', { name: scope.name })} deleteCancel={t('scopeShell.settings.deleteCancel')} />
              ))}
              {visibleScopes.length === 0 && <p className='rounded-xl border border-dashed p-4 text-sm text-muted-foreground sm:col-span-2'>{t('cockpit.scopes.filteredEmpty')}</p>}
            </div>
          )}
        </section>

        <div className='grid content-start gap-4'>
          <section className='rounded-2xl border bg-card shadow-sm'>
            <header className='flex items-center gap-3 border-b p-4'>
              <h3 className='text-sm font-semibold'>{t('cockpit.attention.title')}</h3>
              <span className='rounded-full border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground'>{attentionItems.length}</span>
            </header>
            {attentionItems.length === 0 ? (
              <div className='m-4 rounded-xl border border-dashed p-4'>
                <p className='text-sm font-medium'>{t('cockpit.attention.emptyTitle')}</p>
                <p className='mt-1 text-sm text-muted-foreground'>{t('cockpit.attention.empty')}</p>
                <Button type='button' variant='outline' size='sm' className='mt-3' onClick={() => setActiveFilter('ready')}>{t('cockpit.attention.reviewReady')}</Button>
              </div>
            ) : (
              <div className='flex flex-col p-2'>
                {attentionItems.slice(0, 8).map((item, index) => (
                  <button key={`${item.scopeId}-${index}`} type='button' onClick={() => onSelectScope(item.scopeId, item.tab)} className='grid grid-cols-[28px_1fr_auto] gap-3 rounded-xl p-2.5 text-left transition hover:bg-muted/60'>
                    <span className='mt-0.5 grid h-7 w-7 place-items-center rounded-lg bg-red-500/15 text-red-600 dark:text-red-400'><AlertTriangle className='h-4 w-4' /></span>
                    <span className='min-w-0'>
                      <span className='block truncate text-sm font-medium'>{item.label}</span>
                      <span className='block truncate text-xs text-muted-foreground'>{item.scopeName}</span>
                      <span className='mt-1 block text-xs text-muted-foreground'>{item.helper}</span>
                    </span>
                    <span className='inline-flex items-center gap-1 self-center text-xs font-medium text-primary'>{t('cockpit.attention.openTab', { tab: item.actionLabel })}<ArrowRight className='h-4 w-4' /></span>
                  </button>
                ))}
              </div>
            )}
          </section>

        </div>
      </div>
    </div>
  );
}

function KpiTile({ label, value, children, accent, tone, active, onClick }: Readonly<{ label: string; value: string | number; children?: ReactNode; accent?: boolean; tone?: 'warn'; active?: boolean; onClick?: () => void }>): JSX.Element {
  const className = cn('rounded-2xl border bg-card p-4 text-left shadow-sm transition', active && 'border-primary ring-2 ring-primary/20', onClick && 'hover:-translate-y-0.5 hover:border-primary/40');
  const content = (
    <>
      <p className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>{label}</p>
      <p className={cn('mt-2 text-3xl font-semibold tabular-nums tracking-tight', accent && 'text-primary', tone === 'warn' && 'text-amber-600 dark:text-amber-400')}>{value}</p>
      {children}
    </>
  );
  if (onClick) return <button type='button' className={className} onClick={onClick}>{content}</button>;
  return <div className={className}>{content}</div>;
}

interface ScopeCardProps {
  scope: GovernanceScope;
  overview?: GovernanceScopeOverview;
  onOpen: () => void;
  onDelete: () => void;
  isDeleting: boolean;
  translateBlocker: (key: string, fallback: string) => string;
  translateDryRunStatus: (status: string) => string;
  typeLabel: string;
  statusReady: string;
  statusPublished: string;
  statusDraft: string;
  ownerReady: string;
  ownerMissing: string;
  dryRunLabel: string;
  noAgent: string;
  noDryRun: string;
  deleteLabel: string;
  deleteConfirmTitle: string;
  deleteConfirmBody: string;
  deleteCancel: string;
}

function ScopeCard({ scope, overview, onOpen, onDelete, isDeleting, translateBlocker, translateDryRunStatus, typeLabel, statusReady, statusPublished, statusDraft, ownerReady, ownerMissing, dryRunLabel, noAgent, noDryRun, deleteLabel, deleteConfirmTitle, deleteConfirmBody, deleteCancel }: Readonly<ScopeCardProps>): JSX.Element {
  const score = overview?.readiness.score ?? 0;
  const topBlocker = overview?.readiness.blockers.find((blocker) => isVisibleAttentionItem(blocker.key));
  const isPublished = Boolean(overview?.publishedRevision);
  const isReady = overview?.readiness.status === 'ready';
  const hasOwner = !overview?.readiness.blockers.some((blocker) => blocker.key === 'ownership_assigned');
  const primaryAgent = overview?.agents.primaryAgentId ? <GovernanceAgentName agentId={overview.agents.primaryAgentId} /> : noAgent;
  const dryRun = overview?.latestDryRun?.status ? `${dryRunLabel}: ${translateDryRunStatus(overview.latestDryRun.status)}` : noDryRun;
  return (
    <article className='group relative rounded-xl border bg-card transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-sm'>
      <button type='button' onClick={onOpen} className='grid w-full grid-cols-[44px_1fr] items-center gap-3 p-4 text-left sm:pr-12'>
        <ReadinessRing score={score} />
        <span className='min-w-0'>
          <span className='block truncate font-medium'>{scope.name}</span>
          <span className='mt-1 flex flex-wrap items-center gap-1.5'>
            <span className='rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground'>{typeLabel}</span>
            {isPublished && <span className='rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400'>{statusPublished}</span>}
            {!isPublished && <span className='rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'>{statusDraft}</span>}
            {isReady && <span className='rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary'>{statusReady}</span>}
            {topBlocker && (
              <span className='inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-600 dark:text-red-400'>
                <BookOpen className='h-3 w-3' />{translateBlocker(topBlocker.key, topBlocker.label)}
              </span>
            )}
          </span>
          <span className='mt-2 grid gap-1 text-xs text-muted-foreground'>
            <span className='truncate'>{primaryAgent} · {hasOwner ? ownerReady : ownerMissing}</span>
            <span className='truncate'>{dryRun}</span>
          </span>
        </span>
      </button>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button type='button' variant='ghost' size='icon' className='absolute right-2 top-2 h-8 w-8 text-muted-foreground opacity-100 hover:text-destructive sm:opacity-0 sm:transition sm:group-hover:opacity-100 sm:group-focus-within:opacity-100' aria-label={deleteLabel} disabled={isDeleting}>
            <Trash2 className='h-4 w-4' />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{deleteConfirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{deleteConfirmBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{deleteCancel}</AlertDialogCancel>
            <AlertDialogAction className='bg-destructive text-destructive-foreground hover:bg-destructive/90' onClick={onDelete} disabled={isDeleting}>{deleteLabel}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
}
