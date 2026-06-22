import { useEffect, useRef } from 'react';
import { Bot, User } from 'lucide-react';
import { format } from 'date-fns';
import { useModuleTranslation } from '@/modules/localization';
import { useWorkyAssistantText, useWorkyMessages, useWorkyStore } from '../store';
import { cn } from '@/lib/utils';

function formatMessageTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return format(date, 'HH:mm');
}

export function ChatMessageThread(): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const messages = useWorkyMessages();
  const assistantText = useWorkyAssistantText();
  const streaming = useWorkyStore((s) => s.streaming);
  const containerRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages.length, assistantText]);

  const hasContent = messages.length > 0 || assistantText.length > 0;

  return (
    <section
      data-testid='worky-message-thread'
      aria-label={t('messages.title')}
      className='flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border/60 bg-background/30'
    >
      <header className='flex items-center justify-between border-b border-border/60 px-3 py-1.5'>
        <h3 className='text-[10px] font-semibold uppercase tracking-wide text-muted-foreground'>
          {t('messages.title')}
        </h3>
        {streaming ? (
          <span className='text-[10px] italic text-muted-foreground'>
            {t('messages.streamingLabel')}
          </span>
        ) : null}
      </header>
      {hasContent ? (
        <ul
          ref={containerRef}
          className='flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3 text-xs'
          data-testid='worky-message-list'
        >
          {messages.map((m) => (
            <li
              key={m.id}
              data-testid={`worky-message-${m.role}`}
              className={cn(
                'flex w-full gap-2',
                m.role === 'owner' ? 'justify-end' : 'justify-start',
              )}
            >
              <div className={cn('flex-none pt-1', m.role === 'owner' ? 'order-2' : 'order-1')}>
                {m.role === 'owner' ? (
                  <User className='h-3.5 w-3.5 text-muted-foreground' aria-hidden />
                ) : (
                  <Bot className='h-3.5 w-3.5 text-primary' aria-hidden />
                )}
              </div>
              <div
                className={cn(
                  'min-w-0 max-w-[82%] rounded-2xl border px-3 py-2 shadow-sm',
                  m.role === 'owner'
                    ? 'order-1 rounded-br-sm border-primary/30 bg-primary/10'
                    : 'order-2 rounded-bl-sm border-border/60 bg-background/80',
                )}
              >
                <div className='flex items-baseline justify-between gap-2'>
                  <span className='text-[10px] font-semibold uppercase tracking-wide text-muted-foreground'>
                    {t(`messages.role.${m.role}`)}
                  </span>
                  <span className='text-[10px] tabular-nums text-muted-foreground'>
                    {formatMessageTime(m.createdAt)}
                  </span>
                </div>
                <p className='mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground/90'>
                  {m.content}
                </p>
              </div>
            </li>
          ))}
          {streaming && assistantText ? (
            <li
              data-testid='worky-message-streaming'
              className='flex w-full justify-start gap-2'
            >
              <div className='flex-none pt-1'>
                <Bot className='h-3.5 w-3.5 text-primary' aria-hidden />
              </div>
              <div className='min-w-0 max-w-[82%] rounded-2xl rounded-bl-sm border border-primary/30 bg-primary/5 px-3 py-2 shadow-sm'>
                <div className='flex items-baseline justify-between gap-2'>
                  <span className='text-[10px] font-semibold uppercase tracking-wide text-primary'>
                    {t('messages.role.manager')}
                  </span>
                </div>
                <p className='mt-1 whitespace-pre-wrap break-words text-xs italic leading-relaxed text-foreground/90'>
                  {assistantText}
                </p>
              </div>
            </li>
          ) : null}
        </ul>
      ) : (
        <p className='m-auto text-center text-xs text-muted-foreground'>
          {t('messages.empty')}
        </p>
      )}
    </section>
  );
}
