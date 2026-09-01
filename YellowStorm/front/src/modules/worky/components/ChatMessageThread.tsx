import { useMemo } from 'react';
import { Bot } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';
import {
  ChatConversation,
  ChatConversationContent,
  ChatScrollButton,
} from '@/components/ai-elements/chat-conversation';
import { AssistantActivity, AssistantMarkdown } from '@/components/ai-elements/assistant-response';
import { AIMessageContent } from '@/components/ai-elements/ai-message-content';
import { MessageProvider } from '@/components/ai-elements/message-context';
import { mapComponentsToContentParts } from '@/modules/conversation/utils';
import { useWorkyMessages, useWorkyStore } from '../store';
import { cn } from '@/lib/utils';
import { ChatClarificationCard } from './ChatClarificationCard';
import type { WorkyMessage, WorkyPendingClarification } from '../types';

type ChatThreadItem =
  | { kind: 'message'; message: WorkyMessage }
  | { kind: 'clarification'; clarification: WorkyPendingClarification };

/** Extracts a numeric sort key from a createdAt ISO string, falling back to
 *  the timestamp encoded in a MongoDB ObjectId, then to `fallback`. */
function resolveItemTimestamp(createdAt: string | undefined, id: string, fallback: number): number {
  if (createdAt) {
    const parsed = new Date(createdAt).getTime();
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (/^[0-9a-f]{24}$/i.test(id)) return parseInt(id.slice(0, 8), 16) * 1000;
  return fallback;
}

/** Builds a chronologically-ordered thread by interleaving persisted messages
 *  with pending clarifications so each owner turn is followed immediately by
 *  the manager's reply or question. */
function toChronologicalThread(
  messages: WorkyMessage[],
  clarifications: WorkyPendingClarification[],
): ChatThreadItem[] {
  type SortableItem = ChatThreadItem & { sortAt: number; tieBreaker: number };

  const sortable: SortableItem[] = [
    ...messages.map((message, index): SortableItem => ({
      kind: 'message',
      message,
      sortAt: resolveItemTimestamp(message.createdAt, message.id, 0),
      tieBreaker: index,
    })),
    ...clarifications.map((clarification, index): SortableItem => ({
      kind: 'clarification',
      clarification,
      sortAt: resolveItemTimestamp(clarification.createdAt, clarification.id, Number.MAX_SAFE_INTEGER),
      tieBreaker: messages.length + index,
    })),
  ];

  return sortable
    .sort((a, b) => {
      if (a.sortAt !== b.sortAt) return a.sortAt - b.sortAt;
      // When timestamps are equal, messages come before clarifications.
      if (a.kind !== b.kind) return a.kind === 'message' ? -1 : 1;
      return a.tieBreaker - b.tieBreaker;
    })
    .map(({ kind, ...rest }): ChatThreadItem =>
      kind === 'message'
        ? { kind, message: (rest as { message: WorkyMessage }).message }
        : { kind, clarification: (rest as { clarification: WorkyPendingClarification }).clarification },
    );
}

const ACTIVITY_COMPONENT_TYPES = new Set(['agentActivity', 'toolActivity', 'checkpoint', 'plan', 'task', 'queue']);

export function ChatMessageThread({
  streamId,
  className,
}: { streamId?: string; className?: string } = {}): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const messages = useWorkyMessages();
  const streaming = useWorkyStore((s) => s.streaming);
  const pendingClarifications = useWorkyStore((s) => s.pendingClarifications) ?? [];
  const showClarifications = Boolean(streamId) && pendingClarifications.length > 0;
  const threadItems = useMemo(
    () =>
      showClarifications
        ? toChronologicalThread(messages, pendingClarifications)
        : messages.map((message) => ({ kind: 'message' as const, message })),
    [messages, pendingClarifications, showClarifications],
  );
  const hasContent = messages.length > 0 || showClarifications;
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
        {streaming ? (
          <span className='text-[10px] italic text-muted-foreground'>
            {t('messages.streamingLabel')}
          </span>
        ) : null}
      </header>
      {hasContent ? (
        <MessageProvider fileViewerDisplayMode='floating'>
        <ChatConversation className='min-h-0 flex-1'>
          <ChatConversationContent
            className='min-w-0 gap-5 px-4 py-5'
            data-testid='worky-message-list'
            aria-live='polite'
          >
            {threadItems.map((item) =>
              item.kind === 'message' ? (
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
                      <p className='whitespace-pre-wrap break-words'>{item.message.content}</p>
                    </div>
                  ) : (
                    <div className='min-w-0 max-w-full overflow-hidden text-sm leading-6 text-foreground'>
                      {item.message.components?.length ? (
                        <>
                          <AssistantActivity components={item.message.components} isStreaming={false} labels={activityLabels} />
                          <AIMessageContent
                            parts={mapComponentsToContentParts(item.message.components.filter((component) => !ACTIVITY_COMPONENT_TYPES.has(component.type)))}
                          />
                        </>
                      ) : (
                        <AssistantMarkdown>{item.message.content}</AssistantMarkdown>
                      )}
                    </div>
                  )}
                </article>
              ) : (
                <ChatClarificationCard
                  key={item.clarification.id}
                  streamId={streamId as string}
                  clarification={item.clarification}
                />
              ),
            )}
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
