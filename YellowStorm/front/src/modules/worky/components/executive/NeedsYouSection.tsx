import type { JSX } from 'react';
import { HelpCircle } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';
import type { WorkyExecutiveViewModel } from '../../executive/executiveModel';
import { InteractionCard } from './InteractionCard';
import { RuntimeAskCard } from './RuntimeAskCard';
import { PendingApprovalCard } from './PendingApprovalCard';

export function NeedsYouSection({ streamId, model }: { streamId: string; model: WorkyExecutiveViewModel }): JSX.Element | null {
  const { t } = useModuleTranslation('worky');
  if (model.runtimeAsks.length === 0 && model.interactions.length === 0 && model.pendingApprovals.length === 0) return null;
  return (
    <section className='rounded-2xl border border-amber-500/20 bg-card p-5 shadow-sm'>
      <h2 className='mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-[0.16em] text-foreground'>
        <HelpCircle className='size-4 text-amber-600' />
        {t('executive.needsYou.title')}
      </h2>
      {model.pendingApprovals.length > 0 ? (
        <div className='mb-4'>
          <h3 className='mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground'>
            {t('executive.needsYou.approvalsTitle')}
          </h3>
          <div className='grid gap-2'>
            {model.pendingApprovals.map((approval) => (
              <PendingApprovalCard key={approval.questionId} streamId={streamId} approval={approval} />
            ))}
          </div>
        </div>
      ) : null}
      {model.runtimeAsks.length > 0 || model.interactions.length > 0 ? (
        <div className='grid gap-3 lg:grid-cols-2'>
          {model.runtimeAsks.map((ask) => <RuntimeAskCard key={ask.interruptId} streamId={streamId} ask={ask} />)}
          {model.interactions.map((interaction) => <InteractionCard key={interaction.id} streamId={streamId} interaction={interaction} />)}
        </div>
      ) : null}
    </section>
  );
}
