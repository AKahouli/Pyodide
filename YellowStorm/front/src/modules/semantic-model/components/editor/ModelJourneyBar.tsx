import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';

export type JourneyStep = 'describe' | 'connect' | 'verify' | 'publish';

export interface JourneyState {
  concepts: number;
  sources: number;
  /** Readiness score, or undefined while it is unknown. */
  score?: number;
  findings: number;
  blockingFindings: number;
  published: boolean;
}

interface StepView {
  id: JourneyStep;
  label: string;
  detail: string;
  done: boolean;
}

/**
 * The four steps of building a model, in the order a business user lives them.
 * It replaces the readiness badge, so "how far am I?" and "what is next?" have one answer.
 */
export function ModelJourneyBar({ state, onStep }: Readonly<{ state: JourneyState; onStep: (step: JourneyStep) => void }>) {
  const { t } = useModuleTranslation('semantic-model');
  const steps = journeySteps(state, t);
  const current = steps.find((step) => !step.done)?.id ?? 'publish';

  return <nav aria-label={t('journey.title')} className='flex shrink-0 items-center gap-1 overflow-x-auto border-b bg-background/80 px-3 py-1.5'>
    <ol className='flex items-center gap-1'>
      {steps.map((step, index) => <li key={step.id} className='flex items-center gap-1'>
        <button
          type='button'
          aria-current={step.id === current ? 'step' : undefined}
          onClick={() => onStep(step.id)}
          className={cn(
            'flex items-center gap-2 whitespace-nowrap rounded-full px-2.5 py-1 text-left transition-colors hover:bg-muted',
            step.id === current && 'bg-primary/10 ring-1 ring-primary/30',
          )}
        >
          <span className={cn(
            'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold',
            step.done ? 'border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              : step.id === current ? 'border-primary text-primary' : 'border-muted-foreground/40 text-muted-foreground',
          )}>
            {step.done ? <Check className='h-3 w-3' /> : index + 1}
          </span>
          <span className='flex flex-col leading-tight'>
            <span className={cn('text-xs font-semibold', step.id === current || step.done ? 'text-foreground' : 'text-muted-foreground')}>{step.label}</span>
            <span className='text-[10px] text-muted-foreground'>{step.detail}</span>
          </span>
        </button>
        {index < steps.length - 1 && <span aria-hidden='true' className='h-px w-4 bg-border' />}
      </li>)}
    </ol>
  </nav>;
}

function journeySteps(state: JourneyState, t: (key: string, options?: Record<string, unknown>) => string): StepView[] {
  const verifyDone = state.blockingFindings === 0 && state.findings === 0 && (state.score ?? 0) >= 100;
  return [
    {
      id: 'describe',
      label: t('journey.describe'),
      detail: state.concepts ? t('journey.conceptCount', { count: state.concepts }) : t('journey.todo'),
      done: state.concepts > 0,
    },
    {
      id: 'connect',
      label: t('journey.connect'),
      detail: state.sources ? t('journey.sourceCount', { count: state.sources }) : t('journey.todo'),
      done: state.sources > 0,
    },
    {
      id: 'verify',
      label: t('journey.verify'),
      detail: state.findings > 0
        ? t('journey.toFix', { count: state.findings })
        : state.score === undefined ? t('journey.todo') : t('journey.score', { score: state.score }),
      done: verifyDone,
    },
    {
      id: 'publish',
      label: t('journey.publish'),
      detail: state.published ? t('journey.published') : t('journey.draft'),
      done: state.published,
    },
  ];
}
