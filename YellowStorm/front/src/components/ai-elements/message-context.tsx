'use client';

import { createContext, useContext, type ReactNode } from 'react';

/**
 * Context providing message-level information to child components.
 * This avoids prop drilling through multiple component layers.
 */
export interface MessageContextValue {
  /** Whether this is the last AI message in the conversation (selected branch) */
  isLastAiMessage: boolean;
  /** Whether this message is currently streaming */
  isStreaming: boolean;
  /** Display mode for file viewer: 'sidebar' (conversation) or 'floating' (playbook) */
  fileViewerDisplayMode?: 'sidebar' | 'floating';
}

const MessageContext = createContext<MessageContextValue | null>(null);

export interface MessageProviderProps {
  children: ReactNode;
  isLastAiMessage?: boolean;
  isStreaming?: boolean;
  fileViewerDisplayMode?: 'sidebar' | 'floating';
}

/**
 * Provider for message-level context.
 * Wrap message content with this to provide context to child components.
 */
export const MessageProvider = ({ children, isLastAiMessage = false, isStreaming = false, fileViewerDisplayMode }: MessageProviderProps) => {
  return <MessageContext.Provider value={{ isLastAiMessage, isStreaming, fileViewerDisplayMode }}>{children}</MessageContext.Provider>;
};

/**
 * Hook to access message context.
 * Returns null if used outside of a MessageProvider (safe fallback).
 */
export const useMessageContext = (): MessageContextValue | null => {
  return useContext(MessageContext);
};

/**
 * Hook to check if web preview should auto-open.
 * Auto-opens during streaming or for the last AI message.
 */
export const useShouldAutoOpenPreview = (): boolean => {
  const context = useContext(MessageContext);
  if (!context) return false;
  return context.isStreaming || context.isLastAiMessage;
};

/**
 * Hook to get the file viewer display mode from context.
 * Returns 'sidebar' by default (conversation behavior).
 */
export const useFileViewerDisplayMode = (): 'sidebar' | 'floating' => {
  const context = useContext(MessageContext);
  return context?.fileViewerDisplayMode ?? 'sidebar';
};
