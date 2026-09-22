import { useState, type JSX } from 'react';
import { CheckSquare, ChevronDown, HelpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { useRespondInteraction } from '../../query/hooks';
import type { WorkyPendingClarification } from '../../types';

/** A clarification / approval the owner must answer, shown in "Needs you" as a
 *  quick-action row: a one-line question with the primary action on the row
 *  (Approve/Reject for approval-like), and a "Review" toggle that expands the
 *  full question plus the options / free-text answer. Mirrors PendingApprovalCard. */
export function InteractionCard({ streamId, interaction }: { streamId: string; interaction: WorkyPendingClarification }): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const [expanded, setExpanded] = useState(false);
  const [answer, setAnswer] = useState('');
  const respond = useRespondInteraction(streamId);
  const submit = (content: string, options?: { approve?: boolean; cancel?: boolean }): void => {
    if (!content.trim() || respond.isPending) return;
    respond.mutate({ interactionId: interaction.id, content: content.trim(), ...options });
  };
  const approvalLike = interaction.type === 'approval' || interaction.type === 'replan_review';
  const Icon = approvalLike ? CheckSquare : HelpCircle;
  const label = approvalLike ? t('executive.needsYou.approvalLabel') : t('executive.needsYou.clarificationLabel');

  return (
    <article className='rounded-xl border border-border bg-background/70 p-3'>
      <div className='flex items-start gap-3'>
        <Icon className='mt-0.5 size-4 shrink-0 text-amber-600' aria-hidden='true' />
        <div className='min-w-0 flex-1'>
          <div className='text-[11px] font-semibold uppercase tracking-wide text-muted-foreground'>{label}</div>
          <p className='mt-0.5 line-clamp-1 text-sm font-medium text-foreground'>{interaction.question}</p>
        </div>
        {approvalLike ? (
          <div className='flex shrink-0 items-center gap-1.5'>
            <Button size='sm' onClick={() => submit('approved', { approve: true })} disabled={respond.isPending}>{t('approval.approve')}</Button>
            <Button size='sm' variant='outline' onClick={() => submit('rejected', { approve: false })} disabled={respond.isPending}>{t('approval.reject')}</Button>
          </div>
        ) : null}
      </div>

      <button
        type='button'
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className='mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground'
      >
        <ChevronDown className={cn('size-3.5 transition-transform', expanded && 'rotate-180')} aria-hidden='true' />
        {t('executive.needsYou.approvalReview')}
      </button>

      {expanded ? (
        <div className='mt-2 rounded-lg border bg-background/60 p-3'>
          <p className='whitespace-pre-wrap break-words text-sm text-foreground'>{interaction.question}</p>
          {approvalLike ? (
            <div className='mt-3'>
              <Button type='button' size='sm' variant='ghost' onClick={() => submit('dismissed', { cancel: true })} disabled={respond.isPending}>{t('interactions.dismiss')}</Button>
            </div>
          ) : (
            <div>
              {interaction.options.length > 0 ? (
                <div className='mt-3 flex flex-wrap gap-2'>
                  {interaction.options.map((option) => (
                    <Button key={option} type='button' size='sm' variant='outline' onClick={() => submit(option)} disabled={respond.isPending}>{option}</Button>
                  ))}
                </div>
              ) : null}
              <div className='mt-3 flex gap-2'>
                <Input value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder={t('interactions.placeholder')} />
                <Button type='button' onClick={() => submit(answer)} disabled={!answer.trim() || respond.isPending}>{t('interactions.answer')}</Button>
                <Button type='button' variant='ghost' onClick={() => submit('dismissed', { cancel: true })} disabled={respond.isPending}>{t('interactions.dismiss')}</Button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </article>
  );
}
