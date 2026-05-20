import { useState } from 'react';
import { CheckIcon, ChevronDownIcon, ChevronUpIcon, ClockIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useConversationV2Translation } from '../translation';

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
  const { t } = useConversationV2Translation();

  if (items.length === 0) return null;

  const completed = items.filter((s) => s.status === 'completed').length;
  const allDone = completed === items.length;
  const progress = `${completed} / ${items.length}`;
  const current = items.find((s) => s.status === 'running') ?? items.find((s) => s.status === 'pending');
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
                className='flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent'
              >
                <ChevronDownIcon className='size-4' />
              </button>
            </div>
          </div>
          <ul className='max-h-[40vh] overflow-y-auto px-2 pb-3 pt-1'>
            {items.map((s) => (
              <li key={s.id} className='flex items-start gap-2 px-2 py-1.5 text-sm'>
                <StepDot status={s.status} />
                <span className='min-w-0 flex-1 truncate text-foreground'>{s.description}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <button
          type='button'
          onClick={() => setExpanded(true)}
          className='flex w-full items-center justify-between gap-2 rounded-xl border bg-card px-3 py-2 text-left shadow-sm transition-colors hover:bg-accent/40'
        >
          <div className='flex min-w-0 items-center gap-2'>
            <StepDot status={allDone ? 'completed' : 'running'} />
            <span className='truncate text-sm text-muted-foreground'>{currentLabel}</span>
          </div>
          <div className='flex shrink-0 items-center gap-2 text-xs text-muted-foreground'>
            <span>{progress}</span>
            <ChevronUpIcon className='size-4' />
          </div>
        </button>
      )}
    </div>
  );
}

function StepDot({ status }: { status: string }) {
  const completed = status === 'completed';
  return (
    <span
      className={cn(
        'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full',
        completed ? 'bg-muted-foreground/70' : 'border border-muted-foreground/50',
      )}
    >
      {completed ? (
        <CheckIcon className='size-2.5 text-background' />
      ) : (
        <ClockIcon className='size-2.5 text-muted-foreground' />
      )}
    </span>
  );
}
