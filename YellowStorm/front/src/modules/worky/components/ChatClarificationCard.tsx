import { useState } from 'react';
import { Bot, Send, X } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useRespondInteraction } from '../query/hooks';
import { useWorkyPendingClarifications, useWorkyStore } from '../store';
import type { WorkyPendingClarification } from '../types';

interface ChatClarificationCardProps {
  streamId: string;
  clarification: WorkyPendingClarification;
}

/**
 * Compact inline clarification bubble in the chat thread. Option chips submit
 * in one tap; free-text uses a single slim input row with icon actions.
 */
export function ChatClarificationCard({
  streamId,
  clarification,
}: ChatClarificationCardProps): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const respond = useRespondInteraction(streamId);
  const clarifications = useWorkyPendingClarifications();
  const setPendingClarifications = useWorkyStore((s) => s.setPendingClarifications);
  const setStreaming = useWorkyStore((s) => s.setStreaming);
  const setStreamError = useWorkyStore((s) => s.setStreamError);
  const [value, setValue] = useState('');
  const hasOptions = clarification.options.length > 0;

  const remove = () =>
    setPendingClarifications(clarifications.filter((c) => c.id !== clarification.id));

  const submit = (content: string) => {
    const trimmed = content.trim();
    if (!trimmed || respond.isPending) return;
    respond.mutate(
      { interactionId: clarification.id, content: trimmed },
      {
        onSuccess: (result) => {
          remove();
          setStreamError(null);
          if (result.followUpTurnStarted) setStreaming(true);
          setValue('');
        },
      },
    );
  };

  const dismiss = () => {
    respond.mutate(
      { interactionId: clarification.id, content: '', cancel: true },
      { onSuccess: remove },
    );
  };

  return (
    <li className='flex w-full justify-start gap-1.5' data-testid='worky-chat-clarification'>
      <div className='flex-none pt-0.5'>
        <Bot className='h-3.5 w-3.5 text-primary' aria-hidden />
      </div>
      <div
        className={cn(
          'min-w-0 max-w-[85%] rounded-2xl rounded-bl-sm border border-border/60',
          'border-l-2 border-l-amber-500/60 bg-background/80 px-2.5 py-1.5 shadow-sm',
        )}
      >
        <div className='flex flex-wrap items-center gap-x-1.5 gap-y-0.5'>
          <span className='text-[10px] font-semibold uppercase tracking-wide text-muted-foreground'>
            {t('messages.role.manager')}
          </span>
          <span className='rounded bg-amber-500/10 px-1 py-px text-[9px] font-medium text-amber-700 dark:text-amber-400'>
            {t('interactions.heading')}
          </span>
        </div>
        <p className='mt-0.5 whitespace-pre-wrap break-words text-xs leading-snug text-foreground/90'>
          {clarification.question}
        </p>
        {hasOptions ? (
          <div className='mt-1 flex flex-wrap gap-1' role='group' aria-label={t('interactions.heading')}>
            {clarification.options.map((opt) => (
              <button
                key={opt}
                type='button'
                disabled={respond.isPending}
                onClick={() => submit(opt)}
                className={cn(
                  'h-6 max-w-full truncate rounded-full border border-border/50 bg-muted/30 px-2',
                  'text-[10px] leading-none text-foreground/80 transition-colors',
                  'hover:bg-muted/60 disabled:opacity-50',
                )}
              >
                {opt}
              </button>
            ))}
          </div>
        ) : null}
        <form
          className={cn('flex items-center gap-1', hasOptions ? 'mt-1' : 'mt-1.5')}
          onSubmit={(e) => {
            e.preventDefault();
            submit(value);
          }}
        >
          <Input
            type='text'
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t('interactions.placeholder')}
            disabled={respond.isPending}
            className='h-7 min-h-0 flex-1 border-border/50 bg-background/60 px-2 py-0 text-xs shadow-none'
          />
          <Button
            type='submit'
            size='icon'
            variant='secondary'
            className='h-7 w-7 shrink-0'
            disabled={respond.isPending || !value.trim()}
            aria-label={t('interactions.answer')}
          >
            <Send className='h-3.5 w-3.5' aria-hidden />
          </Button>
          <Button
            type='button'
            variant='ghost'
            size='icon'
            className='h-7 w-7 shrink-0 text-muted-foreground'
            onClick={dismiss}
            disabled={respond.isPending}
            aria-label={t('interactions.dismiss')}
          >
            <X className='h-3.5 w-3.5' aria-hidden />
          </Button>
        </form>
      </div>
    </li>
  );
}
