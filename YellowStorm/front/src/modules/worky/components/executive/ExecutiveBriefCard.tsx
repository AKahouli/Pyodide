import { useId, useState, type JSX } from 'react';
import { Target, BellRing, ChevronDown } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';
import type { WorkyExecutiveViewModel } from '../../executive/executiveModel';
import { MissionHealthBadge } from './MissionHealthBadge';
import { cn } from '@/lib/utils';

export function ExecutiveBriefCard({ model }: { model: WorkyExecutiveViewModel }): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const [goalExpanded, setGoalExpanded] = useState(false);
  const goalId = useId();
  return (
    <section className='@container overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm'>
      <div className='flex items-start justify-between gap-4 border-b border-border/60 bg-gradient-to-r from-primary/10 via-transparent to-transparent px-4 py-3'>
        <div className='min-w-0'>
          <p className='text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground'>{t('executive.brief.eyebrow')}</p>
          <h1 className='mt-1 truncate text-xl font-bold text-foreground'>{model.plan?.title || t('executive.brief.preparing')}</h1>
        </div>
        <MissionHealthBadge health={model.health} />
      </div>
      <div className='grid items-center gap-4 p-4 @2xl:grid-cols-[minmax(0,1fr)_minmax(340px,440px)]'>
        <div className='min-w-0'>
          <div className='mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
            <Target className='size-4 text-primary' />
            {t('executive.brief.goal')}
            <button type='button' className='-my-3 ml-1 flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary @4xl:hidden' onClick={() => setGoalExpanded((value) => !value)} aria-expanded={goalExpanded} aria-controls={goalId} aria-label={t(goalExpanded ? 'executive.brief.collapseGoal' : 'executive.brief.expandGoal')}>
              <ChevronDown className={cn('size-4 transition-transform', goalExpanded && 'rotate-180')} />
            </button>
          </div>
          <p id={goalId} className={cn('max-w-3xl text-sm leading-6 text-foreground', !goalExpanded && 'line-clamp-2 @2xl:line-clamp-3 @4xl:line-clamp-none')} title={model.plan?.goal || undefined}>
            {model.plan?.goal || t('executive.brief.goalUnavailable')}
          </p>
        </div>
        <div className={cn('grid w-full max-w-[440px] gap-2 text-center', model.summary.needsInput > 0 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3')}>
          <Metric value={`${model.summary.completed}/${model.summary.total}`} label={t('executive.brief.complete')} />
          <Metric value={String(model.summary.remaining)} label={t('executive.brief.remaining')} />
          <Metric value={String(model.summary.blocked)} label={t('executive.brief.blocked')} attention={model.summary.blocked > 0} />
          {model.summary.needsInput > 0 && (
            <Metric value={String(model.summary.needsInput)} label={t('executive.brief.needsInput')} attention />
          )}
        </div>
      </div>
    </section>
  );
}

function Metric({ value, label, attention }: { value: string; label: string; attention?: boolean }): JSX.Element {
  if (attention) {
    return (
      <div className='min-w-0 rounded-xl border border-amber-400/60 bg-amber-400/15 px-2 py-2'>
        <div className='flex items-center justify-center gap-1 text-lg font-bold text-amber-600 dark:text-amber-400'>
          <BellRing className='size-4' />
          {value}
        </div>
        <div className='text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400'>{label}</div>
      </div>
    );
  }
  return (
    <div className='min-w-0 rounded-xl bg-muted/60 px-2 py-2'>
      <div className='text-lg font-bold text-foreground'>{value}</div>
      <div className='text-[10px] font-medium uppercase tracking-wide text-muted-foreground'>{label}</div>
    </div>
  );
}
