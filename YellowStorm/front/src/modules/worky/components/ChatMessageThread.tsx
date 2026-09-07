import { useCallback, useMemo } from 'react';
import { useModuleTranslation } from '@/modules/localization';
import {
  ChatConversation,
  ChatConversationContent,
  ChatMessageBubble,
  ChatScrollButton,
  type ChatMessage,
} from '@/components/ai-elements/chat-conversation';
import type { ChoiceComponentAction } from '@/components/ai-elements/choice/ChoicePartRenderer';
import { MessageProvider } from '@/components/ai-elements/message-context';
import { mapComponentsToContentParts } from '@/modules/conversation/utils';
import { useSendMessage } from '../query/hooks';
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

/** Maps a worky message onto the shared ChatMessage shape the conversation chat
 *  bubble consumes: owner→user (right, primary), manager/system→assistant (left).
 *  Rich components render when present; otherwise the plain-text content. */
function toChatMessage(
  message: WorkyMessage,
  onComponentAction?: (action: ChoiceComponentAction) => Promise<void>,
): ChatMessage {
  const content =
    message.components && message.components.length > 0
      ? mapComponentsToContentParts(message.components)
      : message.content;
  const timestamp = message.createdAt ? new Date(message.createdAt) : undefined;
  const role = message.role === 'owner' ? 'user' : 'assistant';
  return {
    id: message.id,
    role,
    content,
    timestamp: timestamp && !Number.isNaN(timestamp.getTime()) ? timestamp : undefined,
    // A choice card (e.g. the approve/decline gate on a send tool) submits the
    // selected option's submitText as a normal message; the session is waiting
    // on that interrupt, so the backend routes it to resume the parked turn.
    ...(role === 'assistant' && onComponentAction ? { onComponentAction } : {}),
  };
}

export function ChatMessageThread({
  streamId,
  className,
}: { streamId?: string; className?: string } = {}): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const messages = useWorkyMessages();
  const streaming = useWorkyStore((s) => s.streaming);
  const setStreaming = useWorkyStore((s) => s.setStreaming);
  const send = useSendMessage(streamId ?? '');
  const onComponentAction = useCallback(
    async (action: ChoiceComponentAction) => {
      if (!streamId) return;
      setStreaming(true);
      try {
        await send.mutateAsync({ content: action.submitText });
      } catch {
        setStreaming(false);
      }
    },
    [streamId, send, setStreaming],
  );
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
            className='gap-3 px-2 py-2'
            data-testid='worky-message-list'
          >
            {threadItems.map((item) =>
              item.kind === 'message' ? (
                <ChatMessageBubble
                  key={item.message.id}
                  message={toChatMessage(item.message, onComponentAction)}
                  density='compact'
                  data-testid={`worky-message-${item.message.role}`}
                />
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
