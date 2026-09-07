import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConversationOutlineRail } from './ConversationOutlineRail';
import { initialConversationUiState, useConversationUiStore } from '../../uiStore';
import type { Message } from '../../types';

const displayMessages: Message[] = [
  { id: 'u1', conversationId: 'c1', conversationType: 'user', content: 'Analyze the S1 revenue trajectory in detail', createdAt: '2026-01-01T00:00:00Z' },
  { id: 'a1', conversationId: 'c1', conversationType: 'ai', createdAt: '2026-01-01T00:01:00Z' },
  { id: 'u2', conversationId: 'c1', conversationType: 'user', content: 'Second question', createdAt: '2026-01-01T00:02:00Z' },
  { id: 'a2', conversationId: 'c1', conversationType: 'ai', createdAt: '2026-01-01T00:03:00Z' },
];

const storeMock = vi.hoisted(() => ({ messages: [] as Message[], isStreaming: false }));

vi.mock('../../store', () => ({
  useDisplayMessages: () => storeMock.messages,
  useConversationStore: (selector: (state: { streamingMessageId: string | null; isStreaming: boolean }) => unknown) => selector({ streamingMessageId: null, isStreaming: storeMock.isStreaming }),
}));

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key, language: 'en' }),
}));

describe('ConversationOutlineRail', () => {
  beforeEach(() => {
    storeMock.messages = displayMessages;
    useConversationUiStore.setState({
      ...initialConversationUiState,
      outlineHeadingsByMessageId: {
        a1: [
          { id: 'outline-0-h2-0', level: 2, text: 'Revenue detail' },
          { id: 'outline-0-h3-1', level: 3, text: 'Quarterly split' },
          { id: 'outline-0-h4-2', level: 4, text: 'Too deep' },
        ],
        a2: [{ id: 'outline-0-h2-0-a2', level: 2, text: 'Cost detail' }],
      },
    });
  });

  it('lists questions and h1–h3 headings, excluding deeper levels', () => {
    render(<ConversationOutlineRail />);

    expect(screen.getByRole('navigation', { name: 'outline.title' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Analyze the S1 revenue trajectory in detail/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revenue detail' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quarterly split' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cost detail' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Too deep' })).not.toBeInTheDocument();
  });

  it('requests heading anchor scroll on click', async () => {
    const user = userEvent.setup();
    render(<ConversationOutlineRail />);

    await user.click(screen.getByRole('button', { name: 'Revenue detail' }));

    expect(useConversationUiStore.getState().outlineScrollRequest?.anchorId).toBe('outline-0-h2-0');
  });

  it('requests the message anchor for a question click', async () => {
    const user = userEvent.setup();
    render(<ConversationOutlineRail />);

    await user.click(screen.getByRole('button', { name: /Second question/ }));

    expect(useConversationUiStore.getState().outlineScrollRequest?.anchorId).toBe('message-u2');
  });

  it('highlights the active anchor', () => {
    useConversationUiStore.setState({ activeOutlineAnchorId: 'outline-0-h3-1' }, false);
    render(<ConversationOutlineRail />);

    expect(screen.getByRole('button', { name: 'Quarterly split' })).toHaveAttribute('data-active', 'true');
    expect(screen.getByRole('button', { name: 'Revenue detail' })).not.toHaveAttribute('data-active');
  });

  it('collapses to a slim strip and expands again', async () => {
    const user = userEvent.setup();
    render(<ConversationOutlineRail />);

    await user.click(screen.getByRole('button', { name: 'outline.collapse' }));
    expect(useConversationUiStore.getState().outlineCollapsed).toBe(true);
    expect(screen.getByRole('button', { name: 'outline.expand' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revenue detail' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'outline.expand' }));
    expect(useConversationUiStore.getState().outlineCollapsed).toBe(false);
    expect(screen.getByRole('button', { name: 'Revenue detail' })).toBeInTheDocument();
  });

  it('renders an empty-state hint when there are no headings and no questions', () => {
    useConversationUiStore.setState({ ...initialConversationUiState, outlineHeadingsByMessageId: {} });
    storeMock.messages = [];
    render(<ConversationOutlineRail />);

    expect(screen.getByRole('navigation', { name: 'outline.title' })).toBeInTheDocument();
    expect(screen.getByText('outline.empty')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revenue detail' })).not.toBeInTheDocument();
  });

  it('stays mounted with the collapse strip even when empty', () => {
    useConversationUiStore.setState({ ...initialConversationUiState, outlineCollapsed: true, outlineHeadingsByMessageId: {} });
    storeMock.messages = [];
    render(<ConversationOutlineRail />);

    expect(screen.getByRole('button', { name: 'outline.expand' })).toBeInTheDocument();
  });

  it('never hides itself behind a responsive breakpoint, in both collapse states', () => {
    const { container, rerender } = render(<ConversationOutlineRail />);

    expect(screen.getByRole('navigation', { name: 'outline.title' })).not.toHaveClass('hidden');

    act(() => {
      useConversationUiStore.setState({ outlineCollapsed: true }, false);
    });
    rerender(<ConversationOutlineRail />);

    const collapsedRail = container.querySelector("[data-outline-rail='collapsed']");
    expect(collapsedRail).not.toBeNull();
    expect(collapsedRail).not.toHaveClass('hidden');
  });
});
