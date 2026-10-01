import { useCallback, useMemo } from 'react';
import { Bot } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';
import {
  ChatConversation,
  ChatConversationContent,
  ChatScrollButton,
} from '@/components/ai-elements/chat-conversation';
import { AssistantActivity, AssistantMarkdown } from '@/components/ai-elements/assistant-response';
import { AIMessageContent } from '@/components/ai-elements/ai-message-content';
import type { ChoiceComponentAction } from '@/components/ai-elements/choice/ChoicePartRenderer';
import { MessageProvider } from '@/components/ai-elements/message-context';
import { formatChoiceSubmissionContent, mapComponentsToContentParts } from '@/modules/conversation/utils';
import { useSendMessage } from '../query/hooks';
import { useWorkyMessages, useWorkyStore } from '../store';
import { cn } from '@/lib/utils';
import type { WorkyMessage } from '../types';

const ACTIVITY_COMPONENT_TYPES = new Set(['agentActivity', 'toolActivity', 'checkpoint', 'plan', 'task', 'queue']);

/** A standalone send-approval gate (email/Teams `confirm::` choice). These are
 *  surfaced in the "Needs you" section instead, so they're dropped from the chat
 *  thread — the owner never has to hunt for them in the message stream. */
function isConfirmGateMessage(message: WorkyMessage): boolean {
  return (message.components ?? []).some((component) => {
    const questionId = (component.data as { questionId?: unknown } | undefined)?.questionId;
    return component.type === 'choice' && typeof questionId === 'string' && questionId.startsWith('confirm::');
  });
}

/** An owner's answer to a runtime ask card ({askInterruptId, answer}). The
 *  question + answer live on the ask card in "Needs you", so this control payload
 *  is dropped from the chat thread rather than shown as a bubble. */
function isAskCardAnswer(message: WorkyMessage): boolean {
  if (message.role !== 'owner') return false;
  const raw = (message.content ?? '').trim();
  if (!raw.startsWith('{')) return false;
  try {
    return typeof (JSON.parse(raw) as { askInterruptId?: unknown }).askInterruptId === 'string';
  } catch {
    return false;
  }
}

export function ChatMessageThread({
  streamId,
  className,
}: { streamId?: string; className?: string } = {}): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const allMessages = useWorkyMessages();
  const messages = useMemo(
    () => allMessages.filter((message) => !isConfirmGateMessage(message) && !isAskCardAnswer(message)),
    [allMessages]);
  const streaming = useWorkyStore((s) => s.streaming);
  const beginTurn = useWorkyStore((s) => s.beginTurn);
  const finishTurn = useWorkyStore((s) => s.finishTurn);
  const send = useSendMessage(streamId ?? '');
  // A choice card (e.g. the approve/decline gate on a send tool) submits the
  // selected option's submitText as a normal message; the session is parked on
  // that interrupt, so the backend routes it to resume the waiting turn.
  const onComponentAction = useCallback(
    async (action: ChoiceComponentAction) => {
      if (!streamId) return;
      const turnId = crypto.randomUUID();
      beginTurn(turnId);
      try {
        await send.mutateAsync({ content: action.submitText, turnId });
      } catch {
        finishTurn(turnId);
      }
    },
    [streamId, send, beginTurn, finishTurn],
  );
  // Clarifications are surfaced in the "Needs you" section (InteractionCard),
  // not interleaved into the chat — the owner acts on them there, not by
  // scrolling the conversation.
  const threadItems = useMemo(
    () => messages.map((message) => ({ kind: 'message' as const, message })),
    [messages],
  );
  const hasContent = messages.length > 0 || streaming;
  const activityLabels = {
    title: t('messages.activity.title'),
    reasoning: t('messages.activity.reasoning'),
    status: {
      running: t('messages.activity.status.running'),
      completed: t('messages.activity.status.completed'),
      failed: t('messages.activity.status.failed'),
      pending: t('messages.activity.status.pending'),
    },
  };

  return (
    <section
      data-testid='worky-message-thread'
      aria-label={t('messages.title')}
      className={cn(
        'flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border/60 bg-background/30',
        className,
      )}
    >
      <header className='flex items-center justify-between border-b border-border/60 px-3 py-1.5'>
        <h3 className='text-[10px] font-semibold uppercase tracking-wide text-muted-foreground'>
          {t('messages.title')}
        </h3>
      </header>
      {hasContent ? (
        <MessageProvider fileViewerDisplayMode='floating'>
        <ChatConversation className='min-h-0 flex-1'>
          <ChatConversationContent
            className='min-w-0 gap-5 px-4 py-5'
            data-testid='worky-message-list'
            aria-live='polite'
          >
            {threadItems.map((item) => (
              <article
                key={item.message.id}
                className={cn('min-w-0 max-w-full', item.message.role === 'owner' ? 'ml-8' : 'w-full')}
                data-testid={`worky-message-${item.message.role}`}
              >
                <div className='mb-1.5 flex items-center gap-2 text-[11px] font-medium text-muted-foreground'>
                  {item.message.role !== 'owner' && <Bot className='size-3.5' aria-hidden='true' />}
                  {t(`messages.role.${item.message.role}`)}
                </div>
                {item.message.role === 'owner' ? (
                  <div className='rounded-2xl rounded-tr-sm bg-primary px-4 py-3 text-sm text-primary-foreground shadow-sm'>
                    <p className='whitespace-pre-wrap break-words'>{formatChoiceSubmissionContent(item.message.content)}</p>
                  </div>
                ) : (
                  <div className='min-w-0 max-w-full overflow-hidden text-sm leading-6 text-foreground'>
                    {item.message.components?.length ? (
                      <>
                        <AssistantActivity components={item.message.components} isStreaming={false} labels={activityLabels} />
                        <AIMessageContent
                          parts={mapComponentsToContentParts(item.message.components.filter((component) => !ACTIVITY_COMPONENT_TYPES.has(component.type)))}
                          onComponentAction={onComponentAction}
                        />
                      </>
                    ) : (
                      <AssistantMarkdown>{item.message.content}</AssistantMarkdown>
                    )}
                  </div>
                )}
              </article>
            ))}
            {streaming ? (
              <article
                role='status'
                data-testid='worky-message-thinking'
                className='w-full min-w-0 text-sm text-muted-foreground'
              >
                <div className='mb-1.5 flex items-center gap-2 text-[11px] font-medium'>
                  <Bot className='size-3.5' aria-hidden='true' />
                  {t('messages.role.manager')}
                </div>
                <div className='flex items-center gap-2 rounded-2xl rounded-tl-sm border border-border/60 bg-muted/40 px-4 py-3'>
                  <span>{t('stream.working')}</span>
                  <span className='flex items-center gap-1' aria-hidden='true'>
                    {[0, 1, 2].map((index) => (
                      <span
                        key={index}
                        className='size-1.5 animate-bounce rounded-full bg-current motion-reduce:animate-none'
                        style={{ animationDelay: `${index * 150}ms` }}
                      />
                    ))}
                  </span>
                </div>
              </article>
            ) : null}
          </ChatConversationContent>
          <ChatScrollButton />
        </ChatConversation>
        </MessageProvider>
      ) : (
        <p className='m-auto text-center text-xs text-muted-foreground'>
          {t('messages.empty')}
        </p>
      )}
    </section>
  );
}
