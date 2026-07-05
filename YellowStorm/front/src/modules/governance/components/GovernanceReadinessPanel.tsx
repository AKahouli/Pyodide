import { AlertTriangle, Check, Circle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import type { GovernanceScopeOverview } from '@/modules/governance';
import { useGovernanceCheckLabel } from '../useGovernanceCheckLabel';
import { ReadinessRing } from './ReadinessRing';
import type { TabKey } from './GovernanceScopeWorkspace';

const checkTabKeys: Record<string, TabKey> = {
  scope_active: 'overview',
  agents_mapped: 'agents',
  knowledge_mapped: 'knowledge',
  deployment_exists: 'testPublish',
  draft_revision: 'testPublish',
  dry_run_passed: 'testPublish',
  channel_ready: 'channels',
};

function tabForCheck(key: string): TabKey {
  if (key.startsWith('source_')) return 'knowledge';
  return checkTabKeys[key] ?? 'overview';
}

interface Props {
  overview?: GovernanceScopeOverview;
  onNavigateTab: (tab: TabKey) => void;
}

export function GovernanceReadinessPanel({ overview, onNavigateTab }: Readonly<Props>): JSX.Element {
  const { t } = useModuleTranslation('governance');
  const { translateCheck, translateBlocker } = useGovernanceCheckLabel();
  if (!overview) {
    return (
      <aside className='rounded-2xl border bg-card p-5 shadow-sm lg:sticky lg:top-4 lg:self-start'>
        <h2 className='text-lg font-semibold'>{t('scopeShell.readiness.title')}</h2>
        <p className='mt-2 text-sm text-muted-foreground'>{t('scopeShell.readiness.noScope')}</p>
      </aside>
    );
  }

  const nextAction = overview.readiness.blockers[0] ?? overview.readiness.warnings[0];
  const nextActionLabel = nextAction ? translateBlocker(nextAction.key, nextAction.label) : undefined;
  const nextActionTab = nextAction ? tabForCheck(nextAction.key) : undefined;
  const checks = overview.readiness.checks.filter((check) => !check.key.startsWith('source_'));
  const firstPendingIndex = checks.findIndex((check) => check.status !== 'passed');

  return (
    <aside className='rounded-2xl border bg-card p-5 shadow-sm lg:sticky lg:top-4 lg:self-start'>
      <p className='text-xs font-semibold uppercase tracking-wide text-primary'>{t('scopeShell.readiness.kicker')}</p>
      <div className='mt-2 flex items-center gap-3'>
        <ReadinessRing score={overview.readiness.score} size={56} />
        <div className='min-w-0'>
          <h2 className='text-sm font-medium'>{t(`scopeShell.readiness.status.${overview.readiness.status}`)}</h2>
          {nextActionLabel && nextActionTab ? (
            <button type='button' onClick={() => onNavigateTab(nextActionTab)} className='mt-0.5 text-left text-xs text-primary underline-offset-2 hover:underline'>{t('scopeShell.readiness.nextAction', { action: nextActionLabel })}</button>
          ) : (
            <p className='mt-0.5 text-xs text-muted-foreground'>{t('scopeShell.readiness.readyAction')}</p>
          )}
        </div>
      </div>

      <div className='mt-4 space-y-1'>
        <h3 className='text-sm font-semibold'>{t('scopeShell.readiness.blockers')}</h3>
        {overview.readiness.blockers.map((check) => <ReadinessLine key={check.key} icon='warning' label={translateBlocker(check.key, check.label)} onClick={() => onNavigateTab(tabForCheck(check.key))} />)}
        {overview.readiness.blockers.length === 0 && <ReadinessLine icon='check' label={t('scopeShell.readiness.noBlockers')} />}
      </div>

      <div className='mt-4 space-y-1'>
        <h3 className='text-sm font-semibold'>{t('scopeShell.readiness.cycle')}</h3>
        {checks.map((check, index) => {
          const state = check.status === 'passed' ? 'done' : index === firstPendingIndex ? 'now' : 'todo';
          return <CycleLine key={check.key} state={state} label={translateCheck(check.key, check.label)} onClick={() => onNavigateTab(tabForCheck(check.key))} />;
        })}
      </div>

      {nextActionLabel && nextActionTab && (
        <div className='mt-4 rounded-xl border border-primary/30 bg-primary/5 p-4'>
          <p className='text-xs font-semibold uppercase tracking-wide text-primary'>{t('scopeShell.readiness.bestNextAction')}</p>
          <p className='mt-1.5 text-sm text-muted-foreground'>{t('scopeShell.readiness.nextAction', { action: nextActionLabel })}</p>
          <Button type='button' size='sm' className='mt-3 w-full justify-center' onClick={() => onNavigateTab(nextActionTab)}>{t('scopeShell.readiness.goToAction')}</Button>
        </div>
      )}
    </aside>
  );
}

function ReadinessLine({ icon, label, onClick }: Readonly<{ icon: 'check' | 'warning'; label: string; onClick?: () => void }>): JSX.Element {
  const Icon = icon === 'check' ? Check : AlertTriangle;
  if (onClick) {
    return (
      <button type='button' onClick={onClick} className='flex w-full items-center gap-2 rounded-lg p-1.5 text-left text-sm text-muted-foreground transition hover:bg-muted/60 hover:text-foreground'>
        <Icon className='h-4 w-4 flex-none' /> <span>{label}</span>
      </button>
    );
  }
  return <div className='flex items-center gap-2 p-1.5 text-sm text-muted-foreground'><Icon className='h-4 w-4 flex-none' /> <span>{label}</span></div>;
}

function CycleLine({ state, label, onClick }: Readonly<{ state: 'done' | 'now' | 'todo'; label: string; onClick: () => void }>): JSX.Element {
  const Icon = state === 'done' ? Check : state === 'now' ? AlertTriangle : Circle;
  return (
    <button type='button' onClick={onClick} className={cn('flex w-full items-center gap-2 rounded-lg p-1.5 text-left text-sm transition hover:bg-muted/60', state === 'now' && 'bg-primary/10 text-primary hover:bg-primary/15', state === 'done' && 'text-muted-foreground', state === 'todo' && 'text-muted-foreground')}>
      <span className={cn('grid h-5 w-5 flex-none place-items-center rounded-full', state === 'done' && 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400', state === 'now' && 'bg-primary/15 text-primary', state === 'todo' && 'bg-muted text-muted-foreground')}>
        <Icon className='h-3 w-3' />
      </span>
      <span className='truncate'>{label}</span>
    </button>
  );
}
