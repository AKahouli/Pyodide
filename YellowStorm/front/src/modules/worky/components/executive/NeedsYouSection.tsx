import type { JSX } from 'react';
import { HelpCircle } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';
import type { WorkyExecutiveViewModel } from '../../executive/executiveModel';
import { InteractionCard } from './InteractionCard';
import { RuntimeAskCard } from './RuntimeAskCard';

export function NeedsYouSection({ streamId, model, onReviewApproval }: { streamId: string; model: WorkyExecutiveViewModel; onReviewApproval: () => void }): JSX.Element | null {
  const { t } = useModuleTranslation('worky');
  if (model.runtimeAsks.length === 0 && model.interactions.length === 0 && model.pendingApprovals.length === 0) return null;
  return (
    <section className='rounded-2xl border border-amber-500/20 bg-card p-5 shadow-sm'>
      <h2 className='mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-[0.16em] text-foreground'>
        <HelpCircle className='size-4 text-amber-600' />
        {t('executive.needsYou.title')}
      </h2>
      <div className='grid gap-3 lg:grid-cols-2'>
        {model.runtimeAsks.map((ask) => <RuntimeAskCard key={ask.interruptId} streamId={streamId} ask={ask} />)}
        {model.interactions.map((interaction) => <InteractionCard key={interaction.id} streamId={streamId} interaction={interaction} />)}
        {model.pendingApprovals.map(({ questionId, component }) => <article key={questionId} className='rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-4'>
          <p className='text-sm font-medium'>{String(component.data.prompt)}</p>
          <button type='button' onClick={onReviewApproval} className='mt-3 rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary'>{t('executive.needsYou.reviewInChat')}</button>
        </article>)}
      </div>
    </section>
  );
}
