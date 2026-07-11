import { useMemo, memo, useEffect, useRef, useLayoutEffect, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { ChatConversation, ChatConversationContent, ChatMessageBubble, ChatScrollButton, ChatConversationEmptyState } from '@/components/ai-elements/chat-conversation';
import { MessageProvider } from '@/components/ai-elements/message-context';
import { useAuth } from '@/modules/auth';
import { useConversationStore, useDisplayMessages, useIsAwaitingFirstChunk, useMessagesHasMore, useMessagesLoadingOlder, useBranchCache, useActiveBranches, useEditingMessageId } from '../store';
import { messageToChat, mapComponentsToContentParts } from '../utils';
import { MessageActions } from './MessageActions';
import { UserMessageActions } from './UserMessageActions';
import { EditableUserMessage } from './EditableUserMessage';
import { BranchNavigation } from './BranchNavigation';
import { LoadingIndicator } from './LoadingIndicator';
import { MessageAttachments } from './MessageAttachments';
import { MentionMessageJump } from './MentionMessageJump';
import type { Message } from '../types';
import { ParentMessagePreview } from './ParentMessagePreview';
import { MessageAvatar } from './MessageAvatar';
import { cn } from '@/lib/utils';
import type { ChoiceComponentAction } from '@/components/ai-elements/choice/ChoicePartRenderer';

/** Find the scrollable ancestor element */
function getScrollContainer(element: HTMLElement | null): HTMLElement | null {
  let current = element?.parentElement;
  while (current) {
    const { overflowY } = getComputedStyle(current);
    if (overflowY === 'auto' || overflowY === 'scroll') {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

/** Invisible trigger at top - loads more when scrolled into view */
function TopLoadTrigger({ onTrigger, disabled }: Readonly<{ onTrigger: () => void; disabled: boolean }>) {
  const ref = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || disabled) return;

    // Delay to prevent firing immediately on initial render
    const timeoutId = setTimeout(() => {
      initializedRef.current = true;
    }, 100);

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (initializedRef.current && entry.isIntersecting) {
          onTrigger();
        }
      },
      { rootMargin: '200px 0px 0px 0px' },
    );

    observer.observe(el);
    return () => {
      clearTimeout(timeoutId);
      observer.disconnect();
      initializedRef.current = false;
    };
  }, [onTrigger, disabled]);

  return <div ref={ref} className='h-px' aria-hidden='true' />;
}


const MemoizedMessageBubble = memo(function MemoizedMessageBubble({ 
  message, 
  isLastAiMessage, 
  isLastUserMessage, 
  conversationId,
  currentUserId,
  allMessages,
}: { 
  message: Message; 
  isLastAiMessage: boolean; 
  isLastUserMessage: boolean; 
  conversationId: string;
  currentUserId?: string;
  allMessages: Message[];
}) {
  const sendMessage = useConversationStore((s) => s.sendMessage);
  const handleComponentAction = useCallback(async (action: ChoiceComponentAction) => {
    await sendMessage(conversationId, { content: action.submitText, interaction: { ...action.interaction, sourceMessageId: message.id } });
  }, [conversationId, message.id, sendMessage]);
  const chatMessage = useMemo(() => {
    const chatMsg = messageToChat(message);
    // Force the role to 'assistant' for other members' messages so ChatMessageBubble renders them on the left
    if (message.conversationType === 'user' && message.senderId && currentUserId && message.senderId !== currentUserId) {
      return { ...chatMsg, role: 'assistant', onComponentAction: handleComponentAction } as const;
    }
    return { ...chatMsg, onComponentAction: handleComponentAction } as const;
  }, [message, currentUserId, handleComponentAction]);
  const branchCache = useBranchCache();
  const activeBranches = useActiveBranches();
  const editingMessageId = useEditingMessageId();
  const isStreaming = useConversationStore((s) => s.isStreaming);
  const currentConversation = useConversationStore((s) => s.currentConversation);

  const isEditing = editingMessageId === message.id;
  const isUser = message.conversationType === 'user';
  const isCurrentUser = isUser && (!message.senderId || !currentUserId || message.senderId === currentUserId);
  const markMentionSeen = useConversationStore((s) => s.markMentionSeen);

  // Mark mention as seen when message becomes visible
  useEffect(() => {
    if (!currentConversation || !currentUserId) return;
    
    // Check if this specific message has an unseen mention for the current user
    const member = currentConversation.groupMeta?.members.find(m => m.userId === currentUserId);
    const hasUnseenMention = member?.mentions?.some(mn => mn.messageId === message.id && !mn.seenAt);
    
    if (!hasUnseenMention) return;

    const el = document.getElementById(`message-${message.id}`);
    if (!el) return;
    const scrollRoot = getScrollContainer(el);

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          // Message is visible, mark it seen!
          markMentionSeen(currentConversation.id, message.id);
          observer.disconnect();
        }
      },
      { root: scrollRoot, threshold: 0.5 } // Trigger when 50% of the message is visible inside chat container
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [message.id, currentConversation, currentUserId, markMentionSeen]);

  // Branch nav for AI messages
  const branches = message.questionMessageId ? branchCache.get(message.questionMessageId) : undefined;
  const activeBranchId = message.questionMessageId ? activeBranches.get(message.questionMessageId) : undefined;
  const showBranchNav = !isStreaming && message.conversationType === 'ai' && message.questionMessageId && branches && branches.length > 1 && activeBranchId;

  return (
    <div className='group/msg' id={`message-${message.id}`}>
      {isUser && message.attachedFiles && message.attachedFiles.length > 0 && <MessageAttachments files={message.attachedFiles} />}
      <MessageProvider isLastAiMessage={isLastAiMessage} isStreaming={isStreaming}>
        {isUser && isEditing ? (
          <EditableUserMessage message={message} conversationId={conversationId} />
        ) : (
          <div className={cn(
            "grid w-full gap-x-2 md:gap-x-3 gap-y-1",
            isCurrentUser ? "grid-cols-[1fr_auto]" : "grid-cols-[auto_1fr]"
          )}>
            {/* Row 1: Parent Message Preview (if exists) */}
            {message.parentMessageId && (
              <>
                {!isCurrentUser && <div />} 
                <div className={cn("flex min-w-0", isCurrentUser ? "justify-end" : "justify-start")}>
                  <ParentMessagePreview
                    parentMessageId={message.parentMessageId}
                    allMessages={allMessages}
                    currentUserId={currentUserId}
                    currentConversation={currentConversation}
                  />
                </div>
                {isCurrentUser && <div />} 
              </>
            )}

            {/* Row 2: Avatar and Bubble */}
            {isCurrentUser ? (
              <>
                <div className="flex justify-end min-w-0">
                  <ChatMessageBubble message={chatMessage} />
                </div>
                <MessageAvatar message={message} currentConversation={currentConversation} />
              </>
            ) : (
              <>
                <MessageAvatar message={message} currentConversation={currentConversation} />
                <div className="flex justify-start min-w-0">
                  <ChatMessageBubble 
                    message={chatMessage} 
                    className="[&>div:first-child]:w-auto [&>div:first-child]:min-w-0"
                  />
                </div>
              </>
            )}

            {!isEditing && (
              <>
                {!isCurrentUser && <div />} 
                <div className={cn("flex min-w-0", isCurrentUser ? "justify-end" : "justify-start")}>
                  {isUser ? (
                    <UserMessageActions 
                      message={message} 
                      isLastUserMessage={isLastUserMessage} 
                      currentUserId={currentUserId} 
                    />
                  ) : (
                    <MessageActions 
                      message={message} 
                      isLastAiMessage={isLastAiMessage} 
                      conversationId={conversationId} 
                    />
                  )}
                </div>
                {isCurrentUser && <div />} 
              </>
            )}
          </div>
        )}
      </MessageProvider>
      {showBranchNav && <BranchNavigation userMessageId={message.questionMessageId!} branches={branches!} activeBranchId={activeBranchId!} />}
    </div>
  );
});

export function GroupConversationContent() {
  const messages = useDisplayMessages();
  const { user } = useAuth();
  const isStreaming = useConversationStore((s) => s.isStreaming);
  const streamingComponents = useConversationStore((s) => s.streamingComponents);
  const streamingConversationId = useConversationStore((s) => s.streamingConversationId);
  const isAwaitingFirstChunk = useIsAwaitingFirstChunk();
  const hasMore = useMessagesHasMore();
  const loadingOlder = useMessagesLoadingOlder();
  const loadMoreMessages = useConversationStore((s) => s.loadMoreMessages);
  const messagesLoading = useConversationStore((s) => s.messagesLoading);
  const currentConversationId = useConversationStore((s) => s.currentConversationId);
  const streamingMessageId = useConversationStore((s) => s.streamingMessageId);
  const currentConversation = useConversationStore((s) => s.currentConversation);
  const fetchBranches = useConversationStore((s) => s.fetchBranches);
  const branchCache = useConversationStore((s) => s.branchCache);
  const mentionNavigationLock = useConversationStore((s) => s.mentionNavigationLock);
  const sendMessage = useConversationStore((s) => s.sendMessage);

  // Refs for branch fetching
  const fetchedRef = useRef(new Set<string>());

  // Refs for scroll position preservation
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const prevScrollHeightRef = useRef(0);
  const prevScrollTopRef = useRef(0);
  const isLoadingOlderRef = useRef(false);

  // Reset fetched branches when conversation changes
  useEffect(() => {
    fetchedRef.current = new Set();
  }, [currentConversationId]);

  // Cache the scroll container reference
  useEffect(() => {
    scrollContainerRef.current = getScrollContainer(contentRef.current);
  }, []);

  // Lazily fetch branches for user messages that have answers
  useEffect(() => {
    if (!currentConversationId) return;
    for (const msg of messages) {
      if (msg.conversationType === 'user' && msg.answerMessageId && !branchCache.has(msg.id) && !fetchedRef.current.has(msg.id)) {
        fetchedRef.current.add(msg.id);
        fetchBranches(currentConversationId, msg.id);
      }
    }
  }, [messages, currentConversationId, fetchBranches, branchCache]);

  // Preserve scroll position when older messages are prepended
  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || !isLoadingOlderRef.current) return;

    const heightDiff = container.scrollHeight - prevScrollHeightRef.current;
    if (heightDiff > 0) {
      container.scrollTop = prevScrollTopRef.current + heightDiff;
    }

    isLoadingOlderRef.current = false;
  }, [messages]);

  // Save scroll state before loading more
  const handleLoadMore = useCallback(() => {
    const container = scrollContainerRef.current;
    if (container) {
      prevScrollHeightRef.current = container.scrollHeight;
      prevScrollTopRef.current = container.scrollTop;
      isLoadingOlderRef.current = true;
    }
    loadMoreMessages();
  }, [loadMoreMessages]);

  const lastAiMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].conversationType === 'ai') return messages[i].id;
    }
    return null;
  }, [messages]);

  const lastUserMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].conversationType === 'user') return messages[i].id;
    }
    return null;
  }, [messages]);

  const streamingChatMessage = useMemo(() => {
    if (!isStreaming || !streamingComponents.length) return null;
    if (streamingConversationId !== currentConversationId) return null;

    const parts = mapComponentsToContentParts(streamingComponents);
    const lastPart = parts.at(-1);
    if (lastPart?.type === 'text') {
      (lastPart as { showCursor?: boolean }).showCursor = true;
    }

    return {
      id: streamingMessageId || 'streaming',
      role: 'assistant',
      conversationType: 'ai',
      content: parts,
      onComponentAction: async (action: ChoiceComponentAction) => {
        if (!currentConversationId) throw new Error('No active conversation');
        await sendMessage(currentConversationId, { content: action.submitText, interaction: action.interaction });
      },
    } as const;
  }, [isStreaming, streamingComponents, streamingConversationId, currentConversationId, streamingMessageId, sendMessage]);

  return (
    <ChatConversation className='flex-1 min-h-0'>
      <ChatConversationContent className='py-6'>
        <div ref={contentRef}>
          {/* Load trigger - hidden during initial load to prevent immediate firing */}
          {hasMore && !messagesLoading && <TopLoadTrigger onTrigger={handleLoadMore} disabled={loadingOlder} />}

          {loadingOlder && (
            <div className='flex justify-center py-4'>
              <Loader2 className='h-5 w-5 animate-spin text-muted-foreground' />
            </div>
          )}

          {messages.length === 0 && !isAwaitingFirstChunk && !messagesLoading ? (
            <ChatConversationEmptyState />
          ) : (
            messages.map((message) => (
              <MemoizedMessageBubble 
                key={message.id} 
                message={message} 
                isLastAiMessage={message.id === lastAiMessageId} 
                isLastUserMessage={message.id === lastUserMessageId} 
                conversationId={currentConversationId!} 
                currentUserId={user?.id}
                allMessages={messages}
              />
            ))
          )}

          {isAwaitingFirstChunk && streamingComponents.length === 0 && (
            <div className='flex w-full gap-3'>
              <LoadingIndicator />
            </div>
          )}

          {streamingChatMessage && !mentionNavigationLock && (
            <div className='group/msg animate-in fade-in-0 duration-300' id={`message-${streamingChatMessage.id}`}>
              <MessageProvider isStreaming={true} isLastAiMessage={true}>
                <div className="grid w-full gap-x-2 md:gap-x-3 gap-y-1 grid-cols-[auto_1fr]">
                  <MessageAvatar message={streamingChatMessage as any} currentConversation={currentConversation} />
                  <div className="flex justify-start min-w-0">
                    <ChatMessageBubble message={streamingChatMessage} isStreaming={true} />
                  </div>
                </div>
              </MessageProvider>
            </div>
          )}
        </div>
      </ChatConversationContent>
      <MentionMessageJump />
      <ChatScrollButton />
    </ChatConversation>
  );
}
