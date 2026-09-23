import type { JSX } from 'react';
import type { WorkyExecutiveViewModel } from '../../executive/executiveModel';
import type { WorkyTask } from '../../types';
import { CurrentWorkSection } from './CurrentWorkSection';
import { DelegationSummary } from './DelegationSummary';
import { ExecutiveBriefCard } from './ExecutiveBriefCard';
import { ExecutionDetailsPanel } from './ExecutionDetailsPanel';
import { NeedsYouSection } from './NeedsYouSection';

export function WorkyExecutiveView({ streamId, model, onTaskClick, onReviewApproval, readOnly = false, attention, focusAttention = true }: { streamId: string; model: WorkyExecutiveViewModel; onTaskClick: (task: WorkyTask) => void; onReviewApproval: () => void; readOnly?: boolean; attention?: { taskId: string; sequence: number } | null; focusAttention?: boolean }): JSX.Element {
  return (
    <div className='mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 pb-28 md:p-6 md:pb-28'>
      <ExecutiveBriefCard model={model} />
      <fieldset disabled={readOnly} className="border-0 p-0">
        <NeedsYouSection streamId={streamId} model={model} onReviewApproval={onReviewApproval} />
      </fieldset>
      <div className='grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(260px,0.8fr)]'>
        <CurrentWorkSection items={model.currentWork} onTaskClick={onTaskClick} attention={attention} focusAttention={focusAttention} />
        <DelegationSummary items={model.delegations} />
      </div>
      <ExecutionDetailsPanel streamId={streamId} onTaskClick={onTaskClick} readOnly={readOnly} />
    </div>
  );
}
