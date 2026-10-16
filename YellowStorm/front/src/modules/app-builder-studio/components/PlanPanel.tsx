import { useState } from 'react';
import { CheckIcon, ChevronDownIcon, ChevronUpIcon, Loader2Icon, TriangleIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppBuilderStudioTranslation } from '../translation';
import { ACTIVITY_TONE_CLASS, classifyStatus, type ActivityStatus } from '../utils/activity-status';

interface Step {
  id: string;
  status: string;
  description: string;
}

interface PlanPanelProps {
  steps?: Step[] | null;
}

export function PlanPanel({ steps }: PlanPanelProps) {
  const items = steps ?? [];
  const [expanded, setExpanded] = useState(false);
  const { t } = useAppBuilderStudioTranslation();

  if (items.length === 0) return null;

  const completed = items.filter((s) => classifyStatus(s.status) === 'success').length;
  const allDone = completed === items.length;
  const progress = `${completed} / ${items.length}`;
  const percent = Math.round((completed / items.length) * 100);
  const current = items.find((s) => classifyStatus(s.status) === 'running') ?? items.find((s) => classifyStatus(s.status) === 'pending');
  const currentLabel = current?.description ?? t('plan.completed');

  return (
    <div className='mx-auto w-full max-w-3xl px-2'>
      {expanded ? (
        <div className='rounded-xl border bg-card shadow-sm'>
          <div className='flex items-center justify-between px-4 pt-3'>
            <div className='text-sm font-semibold text-foreground'>{t('plan.title')}</div>
            <div className='flex items-center gap-3'>
              <span className='text-xs text-muted-foreground'>{progress}</span>
              <button
                type='button'
                onClick={() => setExpanded(false)}
                aria-label={t('plan.collapse')}
                className='flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent'
              >
                <ChevronDownIcon className='size-4' />
              </button>
            </div>
          </div>
          <ProgressBar percent={percent} />
          <ul className='max-h-[40vh] overflow-y-auto px-2 pb-3 pt-1'>
            {items.map((s) => (
              <li key={s.id} className='flex items-start gap-2 px-2 py-1.5 text-sm'>
                <StepDot status={s.status} />
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate',
                    classifyStatus(s.status) === 'error' ? 'text-fail' : 'text-foreground',
                  )}
                >
                  {s.description}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <button
          type='button'
          onClick={() => setExpanded(true)}
          aria-expanded={false}
          className='group/plan flex w-full items-center justify-between gap-3 rounded-xl border bg-card px-3 py-2 text-left shadow-sm transition-colors hover:bg-accent/40'
        >
          <div className='flex min-w-0 flex-1 items-center gap-2'>
            <StepDot status={allDone ? 'completed' : 'running'} />
            <span className='truncate text-sm text-muted-foreground'>{currentLabel}</span>
          </div>
          <div className='flex shrink-0 items-center gap-2 text-xs text-muted-foreground'>
            <span>{progress}</span>
            <ChevronUpIcon className='size-4 transition-transform duration-200 group-hover/plan:-translate-y-0.5 motion-reduce:transition-none' />
          </div>
          <div className='absolute inset-x-0 bottom-0 h-px' aria-hidden>
            <div
              className='h-full bg-primary transition-[width] duration-500 ease-out motion-reduce:transition-none'
              style={{ width: `${percent}%` }}
            />
          </div>
        </button>
      )}
    </div>
  );
}

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div
      className='mx-4 mt-2 h-1.5 overflow-hidden rounded-full bg-muted'
      role='progressbar'
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <div
        className='h-full rounded-full bg-primary transition-[width] duration-500 ease-out motion-reduce:transition-none'
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

function StepDot({ status }: { status: string }) {
  const activity = classifyStatus(status);
  return (
    <span
      className={cn(
        'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full',
        activity === 'success'
          ? 'bg-muted-foreground/70 text-background'
          : ACTIVITY_TONE_CLASS[activity],
      )}
    >
      {activity === 'success' ? (
        <CheckIcon className='size-2.5' aria-hidden />
      ) : activity === 'running' ? (
        <Loader2Icon className='size-2.5 animate-spin motion-reduce:animate-none' aria-hidden />
      ) : activity === 'error' ? (
        <TriangleIcon className='size-2.5' aria-hidden />
      ) : (
        <span className='size-1.5 rounded-full bg-current opacity-50' aria-hidden />
      )}
    </span>
  );
}
