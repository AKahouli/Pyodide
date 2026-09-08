import { beforeEach, describe, expect, it } from 'vitest';

import { initialConversationUiState, useConversationUiStore } from './uiStore';

describe('conversation uiStore (outline)', () => {
  beforeEach(() => {
    useConversationUiStore.setState(initialConversationUiState);
  });

  it('stores and clears headings per message id', () => {
    const headings = [{ id: 'outline-0-h2-0', level: 2 as const, text: 'Revenue' }];
    useConversationUiStore.getState().setOutlineHeadings('m1', headings);
    expect(useConversationUiStore.getState().outlineHeadingsByMessageId.m1).toEqual(headings);

    useConversationUiStore.getState().clearOutlineHeadings('m1');
    expect(useConversationUiStore.getState().outlineHeadingsByMessageId.m1).toBeUndefined();
  });

  it('skips store updates when headings are unchanged', () => {
    const headings = [
      { id: 'outline-0-h1-0', level: 1 as const, text: 'A' },
      { id: 'outline-0-h2-1', level: 2 as const, text: 'B' },
    ];
    const setOutlineHeadings = useConversationUiStore.getState().setOutlineHeadings;
    setOutlineHeadings('m1', headings);
    const before = useConversationUiStore.getState().outlineHeadingsByMessageId;
    setOutlineHeadings('m1', [...headings]);
    expect(useConversationUiStore.getState().outlineHeadingsByMessageId).toBe(before);
  });

  it('clear is a no-op for unknown message ids', () => {
    const before = useConversationUiStore.getState().outlineHeadingsByMessageId;
    useConversationUiStore.getState().clearOutlineHeadings('unknown');
    expect(useConversationUiStore.getState().outlineHeadingsByMessageId).toBe(before);
  });

  it('scroll requests carry a nonce so repeats re-trigger, and are consumed once', () => {
    const store = useConversationUiStore.getState();
    store.requestOutlineScroll('outline-0-h2-0');
    const first = useConversationUiStore.getState().outlineScrollRequest;
    expect(first?.anchorId).toBe('outline-0-h2-0');

    store.requestOutlineScroll('outline-0-h2-0');
    const second = useConversationUiStore.getState().outlineScrollRequest;
    expect(second?.nonce).toBe((first?.nonce ?? 0) + 1);

    useConversationUiStore.getState().consumeOutlineScroll();
    expect(useConversationUiStore.getState().outlineScrollRequest).toBeNull();
    expect(useConversationUiStore.getState().consumeOutlineScroll()).toBeUndefined();
  });

  it('tracks active anchor and collapsed state', () => {
    useConversationUiStore.getState().setActiveOutlineAnchor('a1');
    expect(useConversationUiStore.getState().activeOutlineAnchorId).toBe('a1');
    useConversationUiStore.getState().setActiveOutlineAnchor('a1');
    useConversationUiStore.getState().setActiveOutlineAnchor(null);
    expect(useConversationUiStore.getState().activeOutlineAnchorId).toBeNull();

    useConversationUiStore.getState().setOutlineCollapsed(true);
    expect(useConversationUiStore.getState().outlineCollapsed).toBe(true);
  });
});
