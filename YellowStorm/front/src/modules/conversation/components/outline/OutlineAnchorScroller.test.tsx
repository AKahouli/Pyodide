import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OutlineAnchorScroller } from './OutlineAnchorScroller';
import { initialConversationUiState, useConversationUiStore } from '../../uiStore';

const scrollContext = vi.hoisted(() => ({
  scrollRef: { current: null as HTMLElement | null },
  stopScroll: vi.fn(),
}));

vi.mock('use-stick-to-bottom', () => ({
  useStickToBottomContext: () => scrollContext,
}));

vi.mock('../../store', () => ({
  useDisplayMessages: () => [],
  useConversationStore: (selector: (state: { isStreaming: boolean; streamingMessageId: string | null }) => unknown) => selector({ isStreaming: false, streamingMessageId: null }),
}));

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key, language: 'en' }),
}));

describe('OutlineAnchorScroller', () => {
  let container: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    const heading = document.createElement('h2');
    heading.id = 'outline-m1-h2-0';
    container.appendChild(heading);
    document.body.appendChild(container);
    scrollContext.scrollRef.current = container;
    scrollContext.stopScroll = vi.fn();
    container.scrollTo = vi.fn();
    useConversationUiStore.setState({ ...initialConversationUiState });
  });

  afterEach(() => {
    vi.useRealTimers();
    container.remove();
    vi.restoreAllMocks();
  });

  it('scrolls to the requested anchor, stops stick-to-bottom, and consumes the request', () => {
    useConversationUiStore.getState().requestOutlineScroll('outline-m1-h2-0');
    render(<OutlineAnchorScroller />);

    expect(container.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    expect(scrollContext.stopScroll).toHaveBeenCalled();
    expect(useConversationUiStore.getState().outlineScrollRequest).toBeNull();
  });

  it('re-asserts stopScroll via the fallback even after the request was consumed', () => {
    useConversationUiStore.getState().requestOutlineScroll('outline-m1-h2-0');
    render(<OutlineAnchorScroller />);
    const initialCalls = scrollContext.stopScroll.mock.calls.length;

    vi.advanceTimersByTime(1000);

    expect(scrollContext.stopScroll.mock.calls.length).toBeGreaterThan(initialCalls);
  });

  it('does nothing when the anchor id has no matching element', () => {
    useConversationUiStore.getState().requestOutlineScroll('missing-anchor');
    render(<OutlineAnchorScroller />);

    expect(container.scrollTo).not.toHaveBeenCalled();
    expect(useConversationUiStore.getState().outlineScrollRequest).toBeNull();
  });

  it('supersedes the previous settlement when a new request arrives quickly', () => {
    const heading2 = document.createElement('h3');
    heading2.id = 'outline-m1-h3-1';
    container.appendChild(heading2);

    useConversationUiStore.getState().requestOutlineScroll('outline-m1-h2-0');
    render(<OutlineAnchorScroller />);
    vi.advanceTimersByTime(300);

    useConversationUiStore.getState().requestOutlineScroll('outline-m1-h3-1');
    vi.advanceTimersByTime(100);
    container.dispatchEvent(new Event('scrollend'));
    const callsAfterSecondSettlement = scrollContext.stopScroll.mock.calls.length;

    // The first request's stale fallback must have been superseded: no further
    // stopScroll calls may fire after the second settlement completed.
    vi.advanceTimersByTime(1200);
    expect(scrollContext.stopScroll.mock.calls.length).toBe(callsAfterSecondSettlement);
  });
});
