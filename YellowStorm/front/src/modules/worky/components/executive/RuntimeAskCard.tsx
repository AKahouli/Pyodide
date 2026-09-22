import { useState, type JSX } from 'react';
import { ChevronDown, HelpCircle, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { useSendMessage } from '../../query/hooks';
import { useWorkyStore } from '../../store';
import { useWorkyUiStore } from '../../uiStore';
import type { WorkyRuntimeAttentionItem } from '../../executive/executiveModel';

/** A question the plan is asking the owner (a `kind='ask'` step), shown in
 *  "Needs you" as a compact row: a one-line question with a status chip and an
 *  "Aperçu" toggle for the full text. The answer box shows when it's the active
 *  ask. Same visual language as PendingApprovalCard. */
export function RuntimeAskCard({ streamId, ask }: { streamId: string; ask: WorkyRuntimeAttentionItem }): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const [answer, setAnswer] = useState('');
  const [expanded, setExpanded] = useState(false);
  const send = useSendMessage(streamId);
  const beginTurn = useWorkyStore((state) => state.beginTurn);
  const finishTurn = useWorkyStore((state) => state.finishTurn);
  const notifySendError = useWorkyUiStore((state) => state.notifySendError);

  const submit = (): void => {
    const text = answer.trim();
    if (!ask.active || !text || send.isPending) return;
    const turnId = crypto.randomUUID();
    beginTurn(turnId);
    // Target THIS ask by its interrupt id (card-only answers): with several asks
    // open the answer resolves the right one, never the session default.
    const content = JSON.stringify({ askInterruptId: ask.interruptId, answer: text });
    send.mutate({ content, turnId }, {
      onSuccess: () => setAnswer(''),
      onError: (error) => {
        finishTurn(turnId);
        notifySendError(error.message || t('promptBar.sendFailed'));
      },
    });
  };

  return (
    <article className='rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-3'>
      <div className='flex items-start gap-3'>
        <HelpCircle className='mt-0.5 size-4 shrink-0 text-amber-600' aria-hidden='true' />
        <div className='min-w-0 flex-1'>
          <div className='flex items-center justify-between gap-2'>
            <span className='text-[11px] font-semibold uppercase tracking-wide text-muted-foreground'>
              {t('executive.needsYou.clarificationLabel')}
            </span>
            <span className='shrink-0 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300'>
              {t(ask.active ? 'executive.needsYou.active' : 'executive.needsYou.parked')}
            </span>
          </div>
          <p className='mt-0.5 line-clamp-1 text-sm font-medium text-foreground'>{ask.question}</p>
        </div>
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
          <p className='whitespace-pre-wrap break-words text-sm text-foreground'>{ask.question}</p>
        </div>
      ) : null}

      {ask.active ? (
        <div className='mt-2 flex items-end gap-2'>
          <Textarea
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            placeholder={t('executive.needsYou.answerPlaceholder')}
            rows={2}
            aria-label={t('executive.needsYou.answerPlaceholder')}
          />
          <Button size='icon' onClick={submit} disabled={!answer.trim() || send.isPending} aria-label={t('executive.needsYou.send')}>
            <Send className='size-4' />
          </Button>
        </div>
      ) : null}
    </article>
  );
}
