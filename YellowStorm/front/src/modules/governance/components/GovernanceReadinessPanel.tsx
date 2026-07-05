import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';
import type { GovernanceScopeOverview } from '@/modules/governance';
import { useGovernanceCheckLabel } from '../useGovernanceCheckLabel';
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
  const { translateBlocker } = useGovernanceCheckLabel();
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
  return (
    <aside className='rounded-2xl border bg-card p-5 shadow-sm lg:sticky lg:top-4 lg:self-start'>
      <div className='flex items-center justify-between gap-3'>
        <div>
          <p className='text-xs font-semibold uppercase tracking-wide text-primary'>{t('scopeShell.readiness.kicker')}</p>
          <h2 className='mt-1 text-lg font-semibold'>{t('scopeShell.readiness.title')}</h2>
        </div>
        <div className='rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary'>{t('scopeShell.readiness.scoreValue', { score: overview.readiness.score })}</div>
      </div>
      <div className='mt-4 rounded-xl border p-4'>
        <p className='text-sm font-medium'>{t(`scopeShell.readiness.status.${overview.readiness.status}`)}</p>
        {nextActionLabel && nextActionTab ? (
          <button type='button' onClick={() => onNavigateTab(nextActionTab)} className='mt-1 text-left text-sm text-primary underline-offset-2 hover:underline'>{t('scopeShell.readiness.nextAction', { action: nextActionLabel })}</button>
        ) : (
          <p className='mt-1 text-sm text-muted-foreground'>{t('scopeShell.readiness.readyAction')}</p>
        )}
      </div>
      <div className='mt-4 space-y-1'>
        <h3 className='text-sm font-semibold'>{t('scopeShell.readiness.blockers')}</h3>
        {overview.readiness.blockers.map((check) => <ReadinessLine key={check.key} icon='warning' label={translateBlocker(check.key, check.label)} onClick={() => onNavigateTab(tabForCheck(check.key))} />)}
        {overview.readiness.blockers.length === 0 && <ReadinessLine icon='check' label={t('scopeShell.readiness.noBlockers')} />}
      </div>
      <div className='mt-4 space-y-1'>
        <h3 className='text-sm font-semibold'>{t('scopeShell.readiness.warnings')}</h3>
        {overview.readiness.warnings.map((check) => <ReadinessLine key={check.key} icon='warning' label={translateBlocker(check.key, check.label)} onClick={() => onNavigateTab(tabForCheck(check.key))} />)}
        {overview.readiness.warnings.length === 0 && <ReadinessLine icon='check' label={t('scopeShell.readiness.noWarnings')} />}
      </div>
    </aside>
  );
}

function ReadinessLine({ icon, label, onClick }: Readonly<{ icon: 'check' | 'warning'; label: string; onClick?: () => void }>): JSX.Element {
  const Icon = icon === 'check' ? CheckCircle2 : AlertTriangle;
  if (onClick) {
    return (
      <button type='button' onClick={onClick} className='flex w-full items-center gap-2 rounded-lg p-1.5 text-left text-sm text-muted-foreground transition hover:bg-muted/60 hover:text-foreground'>
        <Icon className='h-4 w-4 flex-none' /> <span>{label}</span>
      </button>
    );
  }
  return <div className='flex items-center gap-2 p-1.5 text-sm text-muted-foreground'><Icon className='h-4 w-4 flex-none' /> <span>{label}</span></div>;
}
