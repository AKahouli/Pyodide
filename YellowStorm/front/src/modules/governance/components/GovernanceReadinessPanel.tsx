import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';
import type { GovernanceScopeOverview } from '@/modules/governance';

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
  overview?: GovernanceScopeOverview;
}

export function GovernanceReadinessPanel({ overview }: Readonly<Props>): JSX.Element {
  const { t } = useModuleTranslation('governance');
  const translateCheckLabel = (key: string, fallback: string): string => {
    if (key.startsWith('source_')) return fallback;
    const translationKey = checkLabelKeys[key as keyof typeof checkLabelKeys];
    return translationKey ? t(translationKey) : fallback;
  };
  if (!overview) {
    return (
      <aside className='rounded-2xl border bg-card p-5 shadow-sm lg:sticky lg:top-4 lg:self-start'>
        <h2 className='text-lg font-semibold'>{t('scopeShell.readiness.title')}</h2>
        <p className='mt-2 text-sm text-muted-foreground'>{t('scopeShell.readiness.noScope')}</p>
      </aside>
    );
  }

  const nextAction = overview.readiness.blockers[0] ?? overview.readiness.warnings[0];
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
        <p className='mt-1 text-sm text-muted-foreground'>{nextAction ? t('scopeShell.readiness.nextAction', { action: translateCheckLabel(nextAction.key, nextAction.label) }) : t('scopeShell.readiness.readyAction')}</p>
      </div>
      <div className='mt-4 space-y-3'>
        <h3 className='text-sm font-semibold'>{t('scopeShell.readiness.blockers')}</h3>
        {overview.readiness.blockers.map((check) => <ReadinessLine key={check.key} icon='warning' label={translateCheckLabel(check.key, check.label)} />)}
        {overview.readiness.blockers.length === 0 && <ReadinessLine icon='check' label={t('scopeShell.readiness.noBlockers')} />}
      </div>
      <div className='mt-4 space-y-3'>
        <h3 className='text-sm font-semibold'>{t('scopeShell.readiness.warnings')}</h3>
        {overview.readiness.warnings.map((check) => <ReadinessLine key={check.key} icon='warning' label={translateCheckLabel(check.key, check.label)} />)}
        {overview.readiness.warnings.length === 0 && <ReadinessLine icon='check' label={t('scopeShell.readiness.noWarnings')} />}
      </div>
    </aside>
  );
}

function ReadinessLine({ icon, label }: Readonly<{ icon: 'check' | 'warning'; label: string }>): JSX.Element {
  const Icon = icon === 'check' ? CheckCircle2 : AlertTriangle;
  return <div className='flex items-center gap-2 text-sm text-muted-foreground'><Icon className='h-4 w-4' /> <span>{label}</span></div>;
}
