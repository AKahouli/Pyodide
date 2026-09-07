import { useState, type JSX } from 'react';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useModuleTranslation } from '@/modules/localization';
import { useSendMessage } from '../../query/hooks';
import { useWorkyStore } from '../../store';
import { useWorkyUiStore } from '../../uiStore';
import type { WorkyRuntimeAttentionItem } from '../../executive/executiveModel';

export function RuntimeAskCard({ streamId, ask }: { streamId: string; ask: WorkyRuntimeAttentionItem }): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const [answer, setAnswer] = useState('');
  const send = useSendMessage(streamId);
  const beginTurn = useWorkyStore((state) => state.beginTurn);
  const finishTurn = useWorkyStore((state) => state.finishTurn);
  const notifySendError = useWorkyUiStore((state) => state.notifySendError);

  const submit = (): void => {
    const content = answer.trim();
    if (!ask.active || !content || send.isPending) return;
    const turnId = crypto.randomUUID();
    beginTurn(turnId);
    send.mutate({ content, turnId }, {
      onSuccess: () => setAnswer(''),
      onError: (error) => {
        finishTurn(turnId);
        notifySendError(error.message || t('promptBar.sendFailed'));
      },
    });
  };

  return (
    <article className='rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-4'>
      <div className='flex items-center justify-between gap-3'>
        <p className='font-medium text-foreground'>{ask.question}</p>
        <span className='shrink-0 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300'>
          {t(ask.active ? 'executive.needsYou.active' : 'executive.needsYou.parked')}
        </span>
      </div>
      {ask.active ? (
        <div className='mt-3 flex items-end gap-2'>
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
