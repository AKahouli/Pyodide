import type { JSX } from 'react';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import type { WorkyMissionHealth } from '../../executive/executiveModel';

const HEALTH_STYLES: Record<WorkyMissionHealth, string> = {
  planning: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  on_track: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  needs_attention: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  at_risk: 'border-destructive/30 bg-destructive/10 text-destructive',
  paused: 'border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300',
  completed: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  stopped: 'border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300',
};

export function MissionHealthBadge({ health }: { health: WorkyMissionHealth }): JSX.Element {
  const { t } = useModuleTranslation('worky');
  return (
    <span className={cn('inline-flex rounded-full border px-2.5 py-1 text-xs font-bold uppercase tracking-[0.16em]', HEALTH_STYLES[health])}>
      {t(`executive.health.${health}`)}
    </span>
  );
}
