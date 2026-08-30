import { useMemo, memo, useEffect, useRef, useLayoutEffect, useCallback, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ChatConversation, ChatConversationContent, ChatMessageBubble, ChatScrollButton, ChatConversationEmptyState } from '@/components/ai-elements/chat-conversation';
import { MessageProvider } from '@/components/ai-elements/message-context';
import { useConversationStore, useDisplayMessages, useIsAwaitingFirstChunk, useAwaitingConversationId, useMessagesHasMore, useMessagesLoadingOlder, useBranchCache, useActiveBranches, useEditingMessageId } from '../store';
import { messageToChat } from '../utils';
import { buildChoiceInteractionIndex } from '../choice-interactions';
import { MessageActions } from './MessageActions';
import { UserMessageActions } from './UserMessageActions';
import { EditableUserMessage } from './EditableUserMessage';
import { BranchNavigation } from './BranchNavigation';
import { ConversationAssistantBubble } from './activity/ConversationAssistantBubble';
import { MessageAttachments } from './MessageAttachments';
import { MessageReliabilityCard } from './MessageReliabilityCard';
import { getAnswerComponents, getAnswerEvaluation, getDefaultAnswerVersion } from '../utils/answer-version';
import { useModuleTranslation } from '@/modules/localization';
import type { ChoiceInteractionMetadata, DisplayedAnswerVersion, Message } from '../types';
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

const MemoizedMessageBubble = memo(function MemoizedMessageBubble({ message, isLastAiMessage, isLastUserMessage, conversationId, choiceInteractions }: { message: Message; isLastAiMessage: boolean; isLastUserMessage: boolean; conversationId: string; choiceInteractions: Map<string, ChoiceInteractionMetadata> }) {
  const { t } = useModuleTranslation('conversation');
  const policyDefaultVersion = getDefaultAnswerVersion(message);
  const [displayedVersion, setDisplayedVersion] = useState<DisplayedAnswerVersion>(() => policyDefaultVersion);
  useEffect(() => {
    if (message.correctionWorkflow?.status === 'corrected' || message.correctionWorkflow?.status === 'abstained') {
      setDisplayedVersion(policyDefaultVersion);
    }
  }, [message.correctionWorkflow?.status, policyDefaultVersion]);
  const activeComponents = useMemo(() => getAnswerComponents(message, displayedVersion, t('correction.abstention')), [message, displayedVersion, t]);
  const displayedMessage = useMemo(() => ({ ...message, components: activeComponents }), [message, activeComponents]);
  const chatMessage = useMemo(() => messageToChat(displayedMessage), [displayedMessage]);
  const sendMessage = useConversationStore((s) => s.sendMessage);
  const regenerateMessage = useConversationStore((s) => s.regenerateMessage);
  const branchCache = useBranchCache();
  const activeBranches = useActiveBranches();
  const editingMessageId = useEditingMessageId();
  const isStreaming = useConversationStore((s) => s.isStreaming);

  const isEditing = editingMessageId === message.id;
  const isUser = message.conversationType === 'user';
  const handleComponentAction = useCallback(async (action: ChoiceComponentAction) => {
    await sendMessage(conversationId, { content: action.submitText, interaction: { ...action.interaction, sourceMessageId: message.id } });
  }, [conversationId, message.id, sendMessage]);
  const handleSubmitQuestions = useCallback(async (actions: ChoiceComponentAction[]) => {
    await sendMessage(conversationId, {
      content: actions.map((action) => action.submitText).join(' '),
      interactions: actions.map((action) => ({ ...action.interaction, sourceMessageId: message.id })),
    });
  }, [conversationId, message.id, sendMessage]);
  const handleRetry = useCallback(() => {
    void regenerateMessage(conversationId, message.id);
  }, [conversationId, message.id, regenerateMessage]);
  chatMessage.onComponentAction = handleComponentAction;
  chatMessage.onSubmitQuestions = handleSubmitQuestions;
  chatMessage.choiceInteractions = choiceInteractions;

  // Branch nav for AI messages
  const branches = message.questionMessageId ? branchCache.get(message.questionMessageId) : undefined;
  const activeBranchId = message.questionMessageId ? activeBranches.get(message.questionMessageId) : undefined;
  const showBranchNav = !isStreaming && message.conversationType === 'ai' && message.questionMessageId && branches && branches.length > 1 && activeBranchId;
  const hasPersistedContent = (message.components?.length || 0) > 0;
  const hasToolCall = message.components?.some((component) => component.type === 'toolActivity') ?? false;
  const hasRerunnableAnswer = message.isComplete === true
    && message.isStreaming !== true
    && (message.components?.some((component) => component.type === 'text'
      && typeof component.data.content === 'string' && component.data.content.trim()) ?? false);

  if (!isUser && !hasPersistedContent) return null;

  return (
    <div className='group/msg'>
      {isUser && message.attachedFiles && message.attachedFiles.length > 0 && <MessageAttachments files={message.attachedFiles} />}
      <MessageProvider isLastAiMessage={isLastAiMessage} isStreaming={false}>
        {isUser && isEditing
          ? <EditableUserMessage message={message} conversationId={conversationId} />
          : isUser
            ? <ChatMessageBubble message={chatMessage} isStreaming={isStreaming} />
            : <ConversationAssistantBubble conversationId={conversationId} messageId={message.id} components={message.components || []} answerComponents={activeComponents} isStreaming={false} inputTokens={displayedMessage.inputTokens} outputTokens={displayedMessage.outputTokens} choiceInteractions={choiceInteractions} onComponentAction={handleComponentAction} onSubmitQuestions={handleSubmitQuestions} onRetry={handleRetry} />}
      </MessageProvider>
      {!isUser && (hasToolCall || hasRerunnableAnswer) && <MessageReliabilityCard conversationId={conversationId} messageId={message.id} evaluation={getAnswerEvaluation(message, displayedVersion)} originalEvaluation={message.reliabilityEvaluation} correctionWorkflow={message.correctionWorkflow} displayedVersion={displayedVersion} onVersionChange={setDisplayedVersion} />}
      {isUser && !isEditing && <UserMessageActions message={message} isLastUserMessage={isLastUserMessage} />}
      {showBranchNav && <BranchNavigation userMessageId={message.questionMessageId!} branches={branches!} activeBranchId={activeBranchId!} />}
      {message.conversationType === 'ai' && <MessageActions message={displayedMessage} isLastAiMessage={isLastAiMessage} conversationId={conversationId} displayedVersion={displayedVersion} />}
    </div>
  );
});

export function ConversationContent() {
  const messages = useDisplayMessages();
  const isStreaming = useConversationStore((s) => s.isStreaming);
  const streamingComponents = useConversationStore((s) => s.streamingComponents);
  const streamingConversationId = useConversationStore((s) => s.streamingConversationId);
  const streamingMessageId = useConversationStore((s) => s.streamingMessageId);
  const isAwaitingFirstChunk = useIsAwaitingFirstChunk();
  const awaitingConversationId = useAwaitingConversationId();
  const hasMore = useMessagesHasMore();
  const loadingOlder = useMessagesLoadingOlder();
  const loadMoreMessages = useConversationStore((s) => s.loadMoreMessages);
  const messagesLoading = useConversationStore((s) => s.messagesLoading);
  const currentConversationId = useConversationStore((s) => s.currentConversationId);
  const fetchBranches = useConversationStore((s) => s.fetchBranches);
  const branchCache = useConversationStore((s) => s.branchCache);
  const sendMessage = useConversationStore((s) => s.sendMessage);
  const choiceInteractions = useMemo(() => buildChoiceInteractionIndex(messages), [messages]);
  const isActiveStream = isStreaming && streamingConversationId === currentConversationId;
  const showStreamingActivity = (isAwaitingFirstChunk && awaitingConversationId === currentConversationId) || isActiveStream;

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

  const handleStreamingAction = useCallback(async (action: ChoiceComponentAction) => {
    if (!currentConversationId) throw new Error('No active conversation');
    await sendMessage(currentConversationId, { content: action.submitText, interaction: { ...action.interaction, ...(streamingMessageId ? { sourceMessageId: streamingMessageId } : {}) } });
  }, [currentConversationId, sendMessage, streamingMessageId]);
  const handleStreamingQuestions = useCallback(async (actions: ChoiceComponentAction[]) => {
    if (!currentConversationId) throw new Error('No active conversation');
    await sendMessage(currentConversationId, { content: actions.map((action) => action.submitText).join(' '), interactions: actions.map((action) => ({ ...action.interaction, ...(streamingMessageId ? { sourceMessageId: streamingMessageId } : {}) })) });
  }, [currentConversationId, sendMessage, streamingMessageId]);

  return (
    <>
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

          {messages.length === 0 && !isAwaitingFirstChunk && !messagesLoading ? <ChatConversationEmptyState /> : messages.map((message) => <MemoizedMessageBubble key={message.id} message={message} isLastAiMessage={message.id === lastAiMessageId} isLastUserMessage={message.id === lastUserMessageId} conversationId={currentConversationId!} choiceInteractions={choiceInteractions} />)}

          {(showStreamingActivity || (isActiveStream && streamingComponents.length > 0)) && (
            <div className='group/msg animate-in fade-in-0 duration-300'>
              <MessageProvider isStreaming={true} isLastAiMessage={true}>
                <ConversationAssistantBubble conversationId={currentConversationId || ''} messageId={streamingMessageId || 'streaming'} components={streamingComponents} isStreaming showWorking={showStreamingActivity && streamingComponents.length === 0} choiceInteractions={choiceInteractions} onComponentAction={handleStreamingAction} onSubmitQuestions={handleStreamingQuestions} />
              </MessageProvider>
            </div>
          )}
          </div>
        </ChatConversationContent>
        <ChatScrollButton />
      </ChatConversation>
    </>
  );
}
