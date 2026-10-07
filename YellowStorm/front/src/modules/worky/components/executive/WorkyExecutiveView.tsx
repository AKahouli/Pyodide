import type { JSX } from 'react';
import type { WorkyExecutiveViewModel } from '../../executive/executiveModel';
import type { WorkyTask } from '../../types';
import { CurrentWorkSection } from './CurrentWorkSection';
import { DelegationSummary } from './DelegationSummary';
import { ExecutiveBriefCard } from './ExecutiveBriefCard';
import { ExecutionDetailsPanel } from './ExecutionDetailsPanel';
import { NeedsYouSection } from './NeedsYouSection';
import { AttentionQueue } from './AttentionQueue';
import { DeliveryPathsSection } from './DeliveryPathsSection';
import { ChangeDigest } from './ChangeDigest';
import { useModuleTranslation } from '@/modules/localization';

export function WorkyExecutiveView({ streamId, model, onTaskClick, onReviewApproval, readOnly = false, attention, focusAttention = true }: { streamId: string; model: WorkyExecutiveViewModel; onTaskClick: (task: WorkyTask) => void; onReviewApproval: () => void; readOnly?: boolean; attention?: { taskId: string; sequence: number } | null; focusAttention?: boolean }): JSX.Element {
  const { t } = useModuleTranslation('worky');
  return (
    <div className='mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 pb-28 md:p-6 md:pb-28'>
      <ExecutiveBriefCard model={model} onTaskClick={onTaskClick} />
      <fieldset disabled={readOnly} className="border-0 p-0">
        <NeedsYouSection streamId={streamId} model={model} onReviewApproval={onReviewApproval} />
      </fieldset>
      <AttentionQueue items={model.currentWork} onTaskClick={onTaskClick} />
      <div className='grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(260px,0.8fr)]'>
        <DeliveryPathsSection paths={model.deliveryPaths} onTaskClick={onTaskClick} />
        <ChangeDigest streamId={streamId} tasks={model.allTasks} recentTasks={model.recentTasks} onTaskClick={onTaskClick} />
      </div>
      <CurrentWorkSection key={streamId} items={model.currentWork} completed={model.completedTasks} onTaskClick={onTaskClick} attention={attention} focusAttention={focusAttention} />
      <details className='rounded-2xl border border-border/70 bg-card p-4'><summary className='cursor-pointer text-sm font-semibold text-foreground'>{t('command.people.title')}</summary><div className='pt-3'><DelegationSummary items={model.delegations} /></div></details>
      <ExecutionDetailsPanel streamId={streamId} onTaskClick={onTaskClick} readOnly={readOnly} />
    </div>
  );
}
