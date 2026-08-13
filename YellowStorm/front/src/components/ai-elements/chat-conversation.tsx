'use client';

import { cn } from '@/lib/utils';
import { Bot, ArrowDownIcon } from 'lucide-react';
import type { ComponentProps, HTMLAttributes, ReactNode } from 'react';
import { StickToBottom, useStickToBottomContext } from 'use-stick-to-bottom';
import { Button } from '@/components/ui/button';
import { useCallback, useMemo } from 'react';
import { CodeArtifact, parseMessageContent } from '@/components/ai-elements/code-artifact';
import { AIMessageContent, type MessageContentPart } from '@/components/ai-elements/ai-message-content';
import type { ChoiceComponentAction } from '@/components/ai-elements/choice/ChoicePartRenderer';
import type { ChoiceInteractionMetadata } from '@/modules/conversation/types';
import type { BundledLanguage } from 'shiki';
import { useModuleTranslation } from '@/modules/localization';

// Types - Re-export for external use
export type { MessageContentPart } from '@/components/ai-elements/ai-message-content';

/**
 * Formats a timestamp for display.
 * - Today: shows time only (e.g., "14:30")
 * - Older than 1 day: shows date and time (e.g., "Jan 27, 14:30")
 */
function formatMessageTimestamp(date: Date, locale: string): string {
  const now = new Date();
  const isToday = date.getDate() === now.getDate() && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();

  const timeStr = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

  if (isToday) {
    return timeStr;
  }

  const dateStr = date.toLocaleDateString(locale, { month: 'short', day: 'numeric' });

  return `${dateStr}, ${timeStr}`;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  /** Content can be a simple string or structured MessageContentPart[] */
  content: string | MessageContentPart[];
  timestamp?: Date;
  isEdited?: boolean;
  onComponentAction?: (action: ChoiceComponentAction) => Promise<void>;
  choiceInteractions?: Map<string, ChoiceInteractionMetadata>;
}

export type ChatConversationProps = ComponentProps<typeof StickToBottom>;

/**
 * ChatConversation - Main container for chat messages
 * Handles auto-scrolling to bottom when new messages arrive
 */
export const ChatConversation = ({ className, ...props }: ChatConversationProps) => <StickToBottom className={cn('relative flex-1 min-h-0 overflow-hidden', className)} initial='instant' resize='instant' role='log' {...props} />;

export type ChatConversationContentProps = ComponentProps<typeof StickToBottom.Content>;

/**
 * ChatConversationContent - Wrapper for the message list
 */
export const ChatConversationContent = ({ className, ...props }: ChatConversationContentProps) => <StickToBottom.Content className={cn('flex flex-col gap-4 px-2 py-4 md:px-4', className)} {...props} />;

export type ChatMessageBubbleProps = HTMLAttributes<HTMLDivElement> & {
  message: ChatMessage;
  showAvatar?: boolean;
  userAvatar?: ReactNode;
  assistantAvatar?: ReactNode;
  /** Whether this message is currently streaming. Affects default open state of collapsible components. */
  isStreaming?: boolean;
  showTaskDiagnostics?: boolean;
  /**
   * Visual density. `comfortable` (default) is the full main-app chat sizing.
   * `compact` shrinks padding, type, and max-width so the same bubble fits a
   * narrow side rail (e.g. the worky stream chat).
   */
  density?: 'comfortable' | 'compact';
};

/**
 * ChatMessageBubble - Individual message bubble
 * User messages appear on the right, AI messages on the left
 * AI messages support structured content with reasoning, queues, plans, etc.
 */
export const ChatMessageBubble = ({ message, className, showAvatar = true, userAvatar, assistantAvatar, isStreaming = false, showTaskDiagnostics = true, density = 'comfortable', ...props }: ChatMessageBubbleProps) => {
  const { t: tCommon, language } = useModuleTranslation('common');
  const isUser = message.role === 'user';
  const isStructuredContent = Array.isArray(message.content);
  const dense = density === 'compact';
  const bubbleText = dense ? 'text-xs' : 'text-sm';
  const assistantBubbleClass = cn('rounded-2xl shadow-xs rounded-tl-sm border border-border/70 bg-muted/45 text-foreground dark:bg-muted/30', bubbleText, dense ? 'px-3 py-2.5' : 'px-4 py-4');
  const userBubbleClass = cn('rounded-2xl shadow-xs rounded-tr-sm bg-primary text-primary-foreground', bubbleText, dense ? 'px-3 py-2' : 'px-4 py-3');

  // Parse message content for code blocks (only for plain string AI messages)
  const parsedContent = useMemo(() => {
    if (isUser || isStructuredContent) {
      return null;
    }
    return parseMessageContent(message.content as string);
  }, [message.content, isUser, isStructuredContent]);

  return (
    <div data-message-role={message.role} className={cn('flex w-full', dense ? 'gap-1.5' : 'gap-2 md:gap-3', isUser ? 'flex-row-reverse' : 'flex-row', className)} {...props}>
      <div className={cn('flex min-w-0 flex-col gap-1', isUser ? (dense ? 'max-w-[85%]' : 'max-w-[92%] md:max-w-[72%]') : 'w-full')}>
        {/* Logic to separate reasoning from other content for AI messages */}
        {isStructuredContent &&
          !isUser &&
          (() => {
            const contentParts = message.content as MessageContentPart[];
            const reasoningParts = contentParts.filter((p) => p.type === 'reasoning');
            const otherParts = contentParts.filter((p) => p.type !== 'reasoning');
            return (
              <>
                {reasoningParts.length > 0 && (
                  <div className='px-1'>
                    <AIMessageContent parts={reasoningParts} isStreaming={isStreaming} onComponentAction={message.onComponentAction} choiceInteractions={message.choiceInteractions} taskDisplay='activity' showTaskDiagnostics={showTaskDiagnostics} />
                  </div>
                )}

                {/* Only render bubble if there are other parts */}
                {otherParts.length > 0 && (
                  <div className={assistantBubbleClass}>
                    <AIMessageContent parts={otherParts} isStreaming={isStreaming} onComponentAction={message.onComponentAction} choiceInteractions={message.choiceInteractions} taskDisplay='activity' showTaskDiagnostics={showTaskDiagnostics} />
                    {message.timestamp && <time className='mt-2 block text-xs text-muted-foreground'>{formatMessageTimestamp(message.timestamp, language)}</time>}
                  </div>
                )}
              </>
            );
          })()}

        {/* Legacy handling for unstructured or user messages, or fallback */}
        {(!isStructuredContent || isUser) && (
          <div className={isUser ? userBubbleClass : assistantBubbleClass}>
            {/* Render content based on type */}
            {parsedContent ? (
              // Plain string AI message with code parsing
              <div className='space-y-3'>
                {parsedContent.map((part, index) => (
                  <div key={index}>{part.type === 'text' ? <p className='whitespace-pre-wrap break-words'>{part.content}</p> : <CodeArtifact code={part.content} language={part.language as BundledLanguage} filename={part.filename} className='my-2' />}</div>
                ))}
              </div>
            ) : (
              // Plain user message
              <p className='whitespace-pre-wrap break-words'>{message.content as string}</p>
            )}
          </div>
        )}
        <div className='flex flex-1 items-end justify-end gap-2 mt-2'>
          {isUser && message.timestamp && <time className='block text-xs text-muted-foreground'>{formatMessageTimestamp(message.timestamp, language)}</time>}
          {message.isEdited && <span className='text-xs text-muted-foreground text-[12px] opacity-70'>{tCommon('message.edited')}</span>}
        </div>
      </div>
    </div>
  );
};

export type ChatScrollButtonProps = ComponentProps<typeof Button>;

/**
 * ChatScrollButton - Button to scroll to bottom of conversation
 * Only appears when user has scrolled up
 */
export const ChatScrollButton = ({ className, ...props }: ChatScrollButtonProps) => {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  const handleScrollToBottom = useCallback(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  if (isAtBottom) return null;

  return (
    <Button className={cn('absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full shadow-lg', className)} onClick={handleScrollToBottom} size='icon' type='button' variant='outline' {...props}>
      <ArrowDownIcon className='h-4 w-4' />
    </Button>
  );
};

export type ChatConversationEmptyStateProps = HTMLAttributes<HTMLDivElement> & {
  title?: string;
  description?: string;
  icon?: ReactNode;
};

/**
 * ChatConversationEmptyState - Shown when there are no messages
 */
export const ChatConversationEmptyState = ({ className, title, description, icon, children, ...props }: ChatConversationEmptyStateProps) => {
  const { t: tCommon } = useModuleTranslation('common');
  const resolvedTitle = title ?? tCommon('message.empty.title');
  const resolvedDescription = description ?? tCommon('message.empty.description');

  return (
    <div className={cn('flex size-full flex-col items-center justify-center gap-3 p-8 text-center', className)} {...props}>
      {children ?? (
        <>
          {icon ?? (
            <div className='rounded-full bg-gradient-to-br from-rose-500/20 to-red-500/20 p-4'>
              <Bot className='h-8 w-8 text-rose-500' />
            </div>
          )}
          <div className='space-y-1'>
            <h3 className='font-medium text-base'>{resolvedTitle}</h3>
            {resolvedDescription && <p className='text-muted-foreground text-sm max-w-xs'>{resolvedDescription}</p>}
          </div>
        </>
      )}
    </div>
  );
};
