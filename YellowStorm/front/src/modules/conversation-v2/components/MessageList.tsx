import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { BotIcon } from 'lucide-react';
import {
  ChatConversation,
  ChatConversationContent,
  ChatConversationEmptyState,
  ChatScrollButton,
} from '@/components/ai-elements/chat-conversation';
import { useConversationV2Store } from '../store';
import { useConversationV2Translation } from '../translation';
import { buildTimeline } from '../utils/timeline';
import { isTurnOpen } from '../utils/session-reducer';
import { MessageBubble } from './MessageBubble';
import { ToolCallCard } from './ToolCallCard';
import { StepBlock } from './StepBlock';
import { ThinkingIndicator } from './ThinkingIndicator';
import type { AgentEvent } from '../types';

interface MessageListProps {
  events?: AgentEvent[];
  /** When true, attachment chips open the file viewer (requires files.read). */
  canOpenAttachments?: boolean;
}

export function MessageList({ events: eventsProp, canOpenAttachments = true }: MessageListProps = {}) {
  const { storeEvents, streaming, liveAssistantIds, applicationComponent } = useConversationV2Store(
    useShallow((s) => ({
      storeEvents: s.events,
      streaming: s.streaming,
      liveAssistantIds: s.liveAssistantIds,
      applicationComponent: s.applicationComponent,
    })),
  );
  const events = eventsProp ?? storeEvents;
  const turnOpen = isTurnOpen(events);
  // Preview opens on finalize before APImanus emits `done`; hide the spinner once the app is ready.
  const showThinking = !eventsProp && (streaming || turnOpen) && !applicationComponent;
  const { t } = useConversationV2Translation();

  const { nodes } = useMemo(() => buildTimeline(events), [events]);

  return (
    <ChatConversation className='flex-1 min-h-0'>
      <ChatConversationContent className='mx-auto w-full max-w-3xl px-2 py-6'>
        {nodes.length === 0 ? (
          <ChatConversationEmptyState
            title={t('conversation.emptyTitle')}
            description={t('conversation.emptyDescription')}
            icon={
              <div className='rounded-full bg-gradient-to-br from-rose-500/20 to-red-500/20 p-4'>
                <BotIcon className='size-8 text-rose-500' />
              </div>
            }
          />
        ) : (
          nodes.map((node, idx) => {
            if (node.kind === 'message') {
              const prev = nodes[idx - 1];
              const hideHeader =
                node.event.role === 'assistant' && prev?.kind === 'message' && prev.event.role === 'assistant';
              const animate =
                node.event.role === 'assistant' && liveAssistantIds.has(node.event.event_id);
              return (
                <MessageBubble
                  key={node.key}
                  event={node.event}
                  canOpenAttachments={canOpenAttachments}
                  hideAssistantHeader={hideHeader}
                  animate={animate}
                />
              );
            }
            if (node.kind === 'tool') {
              return <ToolCallCard key={node.key} event={node.event} />;
            }
            if (node.kind === 'step') {
              return <StepBlock key={node.key} step={node.step} tools={node.tools} />;
            }
            return null;
          })
        )}
        {showThinking && <ThinkingIndicator className='mt-2' />}
      </ChatConversationContent>
      <ChatScrollButton />
    </ChatConversation>
  );
}
