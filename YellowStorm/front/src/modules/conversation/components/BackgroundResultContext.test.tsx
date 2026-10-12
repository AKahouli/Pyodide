import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackgroundResultContext } from './BackgroundResultContext';
import { useRootWorkStore, initialRootWorkState } from '../rootWorkStore';
import { useConversationUiStore } from '../uiStore';
import type { Message } from '../types';

vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (key: string) => key }) }));
const message: Message = { id: 'result', conversationId: 'conversation', conversationType: 'ai', createdAt: '', components: [{ type: 'text', data: { content: 'Answer', backgroundWork: { task: 'Compare documents', originQuestionMessageId: 'request' } } }] };

describe('background result context', () => {
  let visibility: (entries: IntersectionObserverEntry[]) => void;
  beforeEach(() => {
    localStorage.clear();
    useConversationUiStore.setState({ contextPanel: null });
    useRootWorkStore.setState({ ...initialRootWorkState, userId: 'user', knownPublicationIds: { conversation: ['result', 'other-result'] }, unreadPublicationIds: { conversation: ['result', 'other-result'] } });
    vi.stubGlobal('IntersectionObserver', class { constructor(callback: typeof visibility) { visibility = callback; } observe() {} disconnect() {} });
  });
  it('links only a loaded, verified user request and opens work without reading every result', () => {
    const origin = { ...message, id: 'request', conversationType: 'user' as const };
    render(<BackgroundResultContext message={message} messages={[origin, message]} />);
    fireEvent.click(screen.getByText('backgroundResult.originalRequest'));
    expect(useConversationUiStore.getState().outlineScrollRequest?.anchorId).toBe('message-request');
    fireEvent.click(screen.getByText('backgroundResult.viewWork'));
    expect(useConversationUiStore.getState().contextPanel).toBe('work');
    expect(useRootWorkStore.getState().unreadPublicationIds.conversation).toHaveLength(2);
    act(() => visibility([{ isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry]));
    expect(useRootWorkStore.getState().unreadPublicationIds.conversation).toEqual(['result', 'other-result']);
    act(() => useConversationUiStore.getState().setContextPanel(null));
    act(() => visibility([{ isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry]));
    expect(useRootWorkStore.getState().unreadPublicationIds.conversation).toEqual(['other-result']);
  });
  it('registers persisted metadata after the current epoch no longer contains its job', () => {
    useRootWorkStore.setState({ knownPublicationIds: {}, unreadPublicationIds: {} });
    render(<BackgroundResultContext message={message} messages={[message]} />);
    expect(useRootWorkStore.getState().unreadPublicationIds.conversation).toEqual(['result']);
  });
  it('does not invent a link when the origin is unavailable', () => {
    render(<BackgroundResultContext message={message} messages={[message]} />);
    expect(screen.queryByText('backgroundResult.originalRequest')).not.toBeInTheDocument();
    expect(screen.getByText('Compare documents')).toBeInTheDocument();
  });
});
