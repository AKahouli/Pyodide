import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { AlertTriangle, ArrowRight, BookOpen, Plus, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { useCreateGovernanceScope, useGovernanceScopeOverviews, useGovernanceScopes, type GovernanceScope, type GovernanceScopeOverview } from '@/modules/governance';

const checkLabelKeys = {
  scope_active: 'scopeShell.checks.scope_active',
  agents_mapped: 'scopeShell.checks.agents_mapped',
  knowledge_mapped: 'scopeShell.checks.knowledge_mapped',
  deployment_exists: 'scopeShell.checks.deployment_exists',
  draft_revision: 'scopeShell.checks.draft_revision',
  dry_run_passed: 'scopeShell.checks.dry_run_passed',
  channel_ready: 'scopeShell.checks.channel_ready',
} as const;

interface Props {
  programId: string | null;
  onSelectScope: (scopeId: string) => void;
}

function readinessTone(score: number): { hex: string; text: string } {
  if (score >= 80) return { hex: '#10b981', text: 'text-emerald-600 dark:text-emerald-400' };
  if (score >= 50) return { hex: '#f59e0b', text: 'text-amber-600 dark:text-amber-400' };
  return { hex: '#ef4444', text: 'text-red-600 dark:text-red-400' };
}

function ReadinessRing({ score, size = 44 }: Readonly<{ score: number; size?: number }>): JSX.Element {
  const tone = readinessTone(score);
  return (
    <span className='relative grid flex-none place-items-center rounded-full' style={{ width: size, height: size, background: `conic-gradient(${tone.hex} ${score}%, hsl(var(--border)) 0)` }}>
      <span className='absolute rounded-full bg-card' style={{ inset: Math.round(size * 0.1) }} />
      <span className={cn('relative text-xs font-semibold tabular-nums', tone.text)}>{score}</span>
    </span>
  );
}

export function GovernanceCockpit({ programId, onSelectScope }: Readonly<Props>): JSX.Element {
  const { t } = useModuleTranslation('governance');
  const { data: scopes = [] } = useGovernanceScopes(programId);
  const scopeIds = useMemo(() => scopes.map((scope) => scope.id), [scopes]);
  const { byScopeId } = useGovernanceScopeOverviews(programId, scopeIds);
  const createScope = useCreateGovernanceScope(programId);
  const [scopeName, setScopeName] = useState('');

  const translateCheckLabel = (key: string, fallback: string): string => {
    if (key.startsWith('source_')) return fallback;
    const translationKey = checkLabelKeys[key as keyof typeof checkLabelKeys];
    return translationKey ? t(translationKey) : fallback;
  };

  const overviews = scopes.map((scope) => byScopeId[scope.id]).filter((value): value is GovernanceScopeOverview => Boolean(value));
  const scored = overviews.map((overview) => overview.readiness.score);
  const avgReadiness = scored.length > 0 ? Math.round(scored.reduce((sum, value) => sum + value, 0) / scored.length) : 0;
  const publishedCount = overviews.filter((overview) => Boolean(overview.publishedRevision)).length;
  const readyCount = overviews.filter((overview) => overview.readiness.status === 'ready').length;
  const attentionItems = overviews.flatMap((overview) =>
    overview.readiness.blockers.map((blocker) => ({
      scopeId: overview.scope.id,
      scopeName: overview.scope.name,
      label: translateCheckLabel(blocker.key, blocker.label),
    })),
  );

  const handleCreateScope = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = scopeName.trim();
    if (!name || !programId) return;
    createScope.mutate({ name, type: 'custom' }, { onSuccess: (scope) => { setScopeName(''); onSelectScope(scope.id); } });
  };

  return (
    <div className='grid gap-5'>
      <section className='grid gap-4 rounded-2xl border bg-card p-5 shadow-sm sm:flex sm:items-center sm:justify-between'>
        <div>
          <p className='text-xs font-semibold uppercase tracking-wide text-primary'>{t('cockpit.kicker')}</p>
          <h2 className='mt-1 text-xl font-semibold'>{t('cockpit.title')}</h2>
          <p className='mt-1 max-w-xl text-sm text-muted-foreground'>{t('cockpit.description')}</p>
        </div>
        <form className='flex gap-2 sm:justify-end' onSubmit={handleCreateScope}>
          <Input id='governance-cockpit-new-scope' name='scopeName' aria-label={t('scopes.nameLabel')} value={scopeName} onChange={(event) => setScopeName(event.target.value)} placeholder={t('scopes.namePlaceholder')} disabled={!programId} className='sm:w-56' />
          <Button type='submit' disabled={!programId || createScope.isPending}><Plus className='h-4 w-4' />{t('cockpit.newScope')}</Button>
        </form>
      </section>

      <section className='grid gap-4 sm:grid-cols-2 xl:grid-cols-4'>
        <KpiTile label={t('cockpit.kpis.scopes')} value={scopes.length}>
          <div className='mt-2 flex flex-wrap gap-1.5'>
            <span className='rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400'>{t('cockpit.kpis.publishedCount', { count: publishedCount })}</span>
            <span className='rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'>{t('cockpit.kpis.draftCount', { count: Math.max(scopes.length - publishedCount, 0) })}</span>
          </div>
        </KpiTile>
        <KpiTile label={t('cockpit.kpis.readiness')} value={`${avgReadiness}%`} />
        <KpiTile label={t('cockpit.kpis.ready')} value={readyCount} accent />
        <KpiTile label={t('cockpit.kpis.attention')} value={attentionItems.length} tone={attentionItems.length > 0 ? 'warn' : undefined} />
      </section>

      <div className='grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]'>
        <section className='rounded-2xl border bg-card shadow-sm'>
          <header className='flex items-center gap-3 border-b p-4'>
            <h3 className='text-sm font-semibold'>{t('cockpit.scopes.title')}</h3>
            <span className='rounded-full border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground'>{t('cockpit.scopes.count', { count: scopes.length })}</span>
          </header>
          {scopes.length === 0 ? (
            <p className='m-4 rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground'>{t('cockpit.scopes.empty')}</p>
          ) : (
            <div className='grid gap-3 p-4 sm:grid-cols-2'>
              {scopes.map((scope) => (
                <ScopeCard key={scope.id} scope={scope} overview={byScopeId[scope.id]} onOpen={() => onSelectScope(scope.id)} translateCheckLabel={translateCheckLabel} typeLabel={t(`scopeShell.scopeTypes.${scope.type}`)} statusReady={t('cockpit.scopes.ready')} statusPublished={t('cockpit.scopes.published')} />
              ))}
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
              <p className='m-4 rounded-xl border border-dashed p-4 text-sm text-muted-foreground'>{t('cockpit.attention.empty')}</p>
            ) : (
              <div className='flex flex-col p-2'>
                {attentionItems.slice(0, 8).map((item, index) => (
                  <button key={`${item.scopeId}-${index}`} type='button' onClick={() => onSelectScope(item.scopeId)} className='grid grid-cols-[28px_1fr_auto] items-center gap-3 rounded-xl p-2.5 text-left transition hover:bg-muted/60'>
                    <span className='grid h-7 w-7 place-items-center rounded-lg bg-red-500/15 text-red-600 dark:text-red-400'><AlertTriangle className='h-4 w-4' /></span>
                    <span className='min-w-0'>
                      <span className='block truncate text-sm font-medium'>{item.label}</span>
                      <span className='block truncate text-xs text-muted-foreground'>{item.scopeName}</span>
                    </span>
                    <ArrowRight className='h-4 w-4 text-muted-foreground' />
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className='rounded-2xl border bg-card p-4 shadow-sm'>
            <p className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>{t('cockpit.guardrails.title')}</p>
            <div className='mt-3 flex items-center gap-3 rounded-xl border bg-muted/30 p-3'>
              <span className='grid h-8 w-8 flex-none place-items-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'><ShieldCheck className='h-4 w-4' /></span>
              <span className='min-w-0 flex-1'>
                <span className='block text-sm font-medium'>{t('cockpit.guardrails.status')}</span>
                <span className='block text-xs text-muted-foreground'>{t('cockpit.guardrails.managedIn')}</span>
              </span>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function KpiTile({ label, value, children, accent, tone }: Readonly<{ label: string; value: string | number; children?: ReactNode; accent?: boolean; tone?: 'warn' }>): JSX.Element {
  return (
    <div className='rounded-2xl border bg-card p-4 shadow-sm'>
      <p className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>{label}</p>
      <p className={cn('mt-2 text-3xl font-semibold tabular-nums tracking-tight', accent && 'text-primary', tone === 'warn' && 'text-amber-600 dark:text-amber-400')}>{value}</p>
      {children}
    </div>
  );
}

interface ScopeCardProps {
  scope: GovernanceScope;
  overview?: GovernanceScopeOverview;
  onOpen: () => void;
  translateCheckLabel: (key: string, fallback: string) => string;
  typeLabel: string;
  statusReady: string;
  statusPublished: string;
}

function ScopeCard({ scope, overview, onOpen, translateCheckLabel, typeLabel, statusReady, statusPublished }: Readonly<ScopeCardProps>): JSX.Element {
  const score = overview?.readiness.score ?? 0;
  const topBlocker = overview?.readiness.blockers[0];
  const isPublished = Boolean(overview?.publishedRevision);
  const isReady = overview?.readiness.status === 'ready';
  return (
    <button type='button' onClick={onOpen} className='grid grid-cols-[44px_1fr] items-center gap-3 rounded-xl border bg-card p-4 text-left transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-sm'>
      <ReadinessRing score={score} />
      <span className='min-w-0'>
        <span className='block truncate font-medium'>{scope.name}</span>
        <span className='mt-1 flex flex-wrap items-center gap-1.5'>
          <span className='rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground'>{typeLabel}</span>
          {isPublished && <span className='rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400'>{statusPublished}</span>}
          {!isPublished && isReady && <span className='rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary'>{statusReady}</span>}
          {topBlocker && (
            <span className='inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-600 dark:text-red-400'>
              <BookOpen className='h-3 w-3' />{translateCheckLabel(topBlocker.key, topBlocker.label)}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}
