import type { JSX } from 'react';
import { HelpCircle } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';
import type { WorkyExecutiveViewModel } from '../../executive/executiveModel';
import { InteractionCard } from './InteractionCard';
import { RuntimeAskCard } from './RuntimeAskCard';
import { PendingApprovalCard } from './PendingApprovalCard';

export function NeedsYouSection({ streamId, model, onReviewApproval }: { streamId: string; model: WorkyExecutiveViewModel; onReviewApproval: () => void }): JSX.Element | null {
  const { t } = useModuleTranslation('worky');
  if (model.runtimeAsks.length === 0 && model.interactions.length === 0 && model.pendingApprovals.length === 0) return null;
  return (
    <section id='worky-input-queue' className='rounded-2xl border border-amber-500/20 bg-card p-5 shadow-sm'>
      <h2 className='mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-[0.16em] text-foreground'>
        <HelpCircle className='size-4 text-amber-600' />
        {t('executive.needsYou.title')}
      </h2>
      <div className='grid gap-3 lg:grid-cols-2'>
        {model.runtimeAsks.map((ask) => {
          const item = model.currentWork.find((work) => work.task.id === ask.taskId);
          return <div key={ask.interruptId} className='min-w-0'><RuntimeAskCard streamId={streamId} ask={ask} />{item && <p className='mt-1 px-1 text-xs text-muted-foreground'>{item.task.assigneeName || item.task.assigneeKey || t('command.queue.unassigned')}{item.downstreamCount ? ` · ${t('command.queue.downstream', { count: item.downstreamCount })}` : ''}</p>}</div>;
        })}
        {model.interactions.map((interaction) => <div key={interaction.id} className='min-w-0'><InteractionCard streamId={streamId} interaction={interaction} />{interaction.blocksTaskIds.length > 0 && <p className='mt-1 px-1 text-xs text-muted-foreground'>{t('command.queue.downstream', { count: interaction.blocksTaskIds.length })}</p>}</div>)}
        {/* Interactive approve/decline/edit card (pre-merge behaviour), not a
            passive "review in chat" button — the owner acts on the gate here. */}
        {model.pendingApprovals.map((approval) => <PendingApprovalCard key={approval.questionId} streamId={streamId} approval={approval} />)}
      </div>
    </section>
  );
}
