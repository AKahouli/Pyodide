import { useState, type JSX } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useModuleTranslation } from '@/modules/localization';
import { useRespondInteraction } from '../../query/hooks';
import type { WorkyPendingClarification } from '../../types';

export function InteractionCard({ streamId, interaction }: { streamId: string; interaction: WorkyPendingClarification }): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const [answer, setAnswer] = useState('');
  const respond = useRespondInteraction(streamId);
  const submit = (content: string, options?: { approve?: boolean; cancel?: boolean }): void => {
    if (!content.trim() || respond.isPending) return;
    respond.mutate({ interactionId: interaction.id, content: content.trim(), ...options });
  };
  const approvalLike = interaction.type === 'approval' || interaction.type === 'replan_review';
  return (
    <article className='rounded-xl border border-border bg-background/70 p-4'>
      <p className='font-medium text-foreground'>{interaction.question}</p>
      {approvalLike ? (
        <div className='mt-3 flex flex-wrap gap-2'>
          <Button type='button' size='sm' variant='outline' onClick={() => submit('rejected', { approve: false })} disabled={respond.isPending}>
            {t('approval.reject')}
          </Button>
          <Button type='button' size='sm' onClick={() => submit('approved', { approve: true })} disabled={respond.isPending}>
            {t('approval.approve')}
          </Button>
          <Button type='button' size='sm' variant='ghost' onClick={() => submit('dismissed', { cancel: true })} disabled={respond.isPending}>
            {t('interactions.dismiss')}
          </Button>
        </div>
      ) : (
        <div>
          {interaction.options.length > 0 ? (
            <div className='mt-3 flex flex-wrap gap-2'>
              {interaction.options.map((option) => (
                <Button key={option} type='button' size='sm' variant='outline' onClick={() => submit(option)} disabled={respond.isPending}>
                  {option}
                </Button>
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
    </article>
  );
}
