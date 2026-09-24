import type { JSX } from 'react';
import type { WorkyExecutiveViewModel } from '../../executive/executiveModel';
import type { WorkyTask } from '../../types';
import { CurrentWorkSection } from './CurrentWorkSection';
import { DelegationSummary } from './DelegationSummary';
import { ExecutiveBriefCard } from './ExecutiveBriefCard';
import { ExecutionDetailsPanel } from './ExecutionDetailsPanel';
import { NeedsYouSection } from './NeedsYouSection';

export function WorkyExecutiveView({ streamId, model, onTaskClick }: { streamId: string; model: WorkyExecutiveViewModel; onTaskClick: (task: WorkyTask) => void }): JSX.Element {
  return (
    <div className='mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 pb-28 md:p-6 md:pb-28'>
      <ExecutiveBriefCard model={model} />
      <NeedsYouSection streamId={streamId} model={model} />
      <div className='grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(260px,0.8fr)]'>
        <CurrentWorkSection items={model.currentWork} onTaskClick={onTaskClick} />
        <DelegationSummary items={model.delegations} />
      </div>
      <ExecutionDetailsPanel streamId={streamId} onTaskClick={onTaskClick} />
    </div>
  );
}
