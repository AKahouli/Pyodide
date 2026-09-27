import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import type { SemanticReadiness } from '../../types';

export type JourneyStep = 'describe' | 'connect' | 'verify' | 'publish';
export type JourneyAction =
  | { kind: 'addConcept' }
  | { kind: 'connectSource' }
  | { kind: 'openItem'; id: string; label: 'identity' | 'link' }
  | { kind: 'prepare' }
  | { kind: 'review' }
  | { kind: 'publish' };

export interface JourneyInput {
  readiness?: SemanticReadiness;
  conceptCount: number;
  /** Records have been prepared from the current sources (Explore data has something to show). */
  hasRecords: boolean;
  published: boolean;
}

export interface JourneyState {
  current: JourneyStep | null;
  done: Record<JourneyStep, boolean>;
  message: string;
  action: JourneyAction | null;
}

const STEPS: JourneyStep[] = ['describe', 'connect', 'verify', 'publish'];

/** Where the user is in Describe → Connect sources → Check → Publish, with the one thing to do next. */
export function journeyState({ readiness, conceptCount, hasRecords, published }: JourneyInput): JourneyState {
  const area = (key: SemanticReadiness['areas'][number]['key']) => readiness?.areas.find((item) => item.key === key);
  const complete = (key: SemanticReadiness['areas'][number]['key']) => Boolean(area(key)?.complete);
  const done: Record<JourneyStep, boolean> = {
    describe: conceptCount > 0 && readiness?.status !== 'not_configured',
    connect: complete('sources') && complete('identity') && complete('relationships'),
    verify: hasRecords && complete('quality'),
    publish: published,
  };
  done.connect &&= done.describe;
  done.verify &&= done.connect;
  const current = STEPS.find((step) => !done[step]) ?? null;
  switch (current) {
    case 'describe':
      return { current, done, message: 'journey.describeTodo', action: { kind: 'addConcept' } };
    case 'connect': {
      if (!complete('sources')) return { current, done, message: 'journey.connectSources', action: { kind: 'connectSource' } };
      if (!complete('identity')) {
        const id = area('identity')?.targetId;
        return { current, done, message: 'journey.connectIdentity', action: id ? { kind: 'openItem', id, label: 'identity' } : null };
      }
      const id = area('relationships')?.targetId;
      return { current, done, message: 'journey.connectRelationships', action: id ? { kind: 'openItem', id, label: 'link' } : null };
    }
    case 'verify':
      return hasRecords
        ? { current, done, message: 'journey.verifyReview', action: { kind: 'review' } }
        : { current, done, message: 'journey.verifyPrepare', action: { kind: 'prepare' } };
    case 'publish':
      return { current, done, message: 'journey.publishTodo', action: { kind: 'publish' } };
    default:
      return { current: null, done, message: 'journey.publishDone', action: { kind: 'publish' } };
  }
}

const ACTION_LABEL: Record<string, string> = {
  addConcept: 'journey.actionAddConcept',
  connectSource: 'journey.actionConnect',
  identity: 'journey.actionIdentity',
  link: 'journey.actionLink',
  prepare: 'journey.actionPrepare',
  review: 'journey.actionReview',
  publish: 'journey.actionPublish',
};

/** The always-visible guide at the top of the editor: the four steps, where the model stands, and one next action. */
export function ModelJourney({ state, canEdit, busy = false, onAction }: Readonly<{
  state: JourneyState;
  canEdit: boolean;
  busy?: boolean;
  onAction: (action: JourneyAction) => void;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const translate = t as (key: string, options?: Record<string, unknown>) => string;
  const labels: Record<JourneyStep, string> = { describe: t('journey.describe'), connect: t('journey.connect'), verify: t('journey.verify'), publish: t('journey.publish') };
  const action = state.action;
  return <nav aria-label={t('journey.title')} className='flex shrink-0 flex-col gap-2 border-b bg-background px-4 py-2 lg:flex-row lg:items-center lg:justify-between'>
    <ol className='flex min-w-0 flex-wrap items-center gap-1.5'>
      {STEPS.map((step, index) => {
        const current = state.current === step;
        return <li key={step} className='flex items-center gap-1.5' aria-current={current ? 'step' : undefined}>
          {index > 0 && <span className='h-px w-4 bg-border' aria-hidden />}
          <span className={cn('flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs',
            current && 'bg-primary text-primary-foreground font-semibold',
            !current && state.done[step] && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
            !current && !state.done[step] && 'text-muted-foreground')}>
            {state.done[step] ? <Check className='h-3.5 w-3.5' aria-label={t('journey.stepDone')} /> : <span className='text-[10px]'>{index + 1}</span>}
            {labels[step]}
          </span>
        </li>;
      })}
    </ol>
    <div className='flex min-w-0 flex-wrap items-center gap-2'>
      <p className='text-sm text-muted-foreground'>{translate(state.message)}</p>
      {canEdit && action && <Button size='sm' disabled={busy} onClick={() => onAction(action)}>
        {translate(ACTION_LABEL[action.kind === 'openItem' ? action.label : action.kind])}
      </Button>}
    </div>
  </nav>;
}
