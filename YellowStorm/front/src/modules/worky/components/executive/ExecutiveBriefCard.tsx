import type { JSX } from 'react';
import { Target } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';
import type { WorkyExecutiveViewModel } from '../../executive/executiveModel';
import { MissionHealthBadge } from './MissionHealthBadge';

export function ExecutiveBriefCard({ model }: { model: WorkyExecutiveViewModel }): JSX.Element {
  const { t } = useModuleTranslation('worky');
  return (
    <section className='overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm'>
      <div className='flex items-start justify-between gap-4 border-b border-border/60 bg-gradient-to-r from-primary/10 via-transparent to-transparent px-5 py-4'>
        <div className='min-w-0'>
          <p className='text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground'>{t('executive.brief.eyebrow')}</p>
          <h1 className='mt-1 truncate text-xl font-bold text-foreground'>{model.plan?.title || t('executive.brief.preparing')}</h1>
        </div>
        <MissionHealthBadge health={model.health} />
      </div>
      <div className='grid gap-5 p-5 md:grid-cols-[1fr_auto]'>
        <div>
          <div className='mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
            <Target className='size-4 text-primary' />
            {t('executive.brief.goal')}
          </div>
          <p className='max-w-3xl text-sm leading-6 text-foreground'>
            {model.plan?.goal || t('executive.brief.goalUnavailable')}
          </p>
        </div>
        <div className='grid grid-cols-3 gap-2 text-center'>
          <Metric value={`${model.summary.completed}/${model.summary.total}`} label={t('executive.brief.complete')} />
          <Metric value={String(model.summary.active)} label={t('executive.brief.active')} />
          <Metric value={String(model.summary.waitingExternal)} label={t('executive.brief.waiting')} />
        </div>
      </div>
    </section>
  );
}

function Metric({ value, label }: { value: string; label: string }): JSX.Element {
  return (
    <div className='min-w-20 rounded-xl bg-muted/60 px-3 py-3'>
      <div className='text-lg font-bold text-foreground'>{value}</div>
      <div className='text-[10px] font-medium uppercase tracking-wide text-muted-foreground'>{label}</div>
    </div>
  );
}
