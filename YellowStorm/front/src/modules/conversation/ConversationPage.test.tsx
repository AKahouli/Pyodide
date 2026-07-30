import { StrictMode } from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationPage } from './ConversationPage';

const closeViewerMock = vi.hoisted(() => vi.fn());
const fetchMessagesMock = vi.hoisted(() => vi.fn());
const clearMessagesMock = vi.hoisted(() => vi.fn());
const setCurrentConversationMock = vi.hoisted(() => vi.fn());
const conversationStateMock = vi.hoisted(() => ({
  value: {
    currentConversationId: 'conversation-1' as string | null,
    currentConversation: { id: 'conversation-1' } as { id: string } | null,
  },
}));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: 'conversation-1' }),
}));

vi.mock('./store', () => ({
  useConversationStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        setCurrentConversation: setCurrentConversationMock,
        fetchMessages: fetchMessagesMock,
        clearMessages: clearMessagesMock,
        currentConversationId: conversationStateMock.value.currentConversationId,
      }),
    { getState: () => conversationStateMock.value },
  ),
  useCurrentConversation: () => conversationStateMock.value.currentConversation,
  useConversationLoading: () => false,
}));

vi.mock('@/modules/file-viewer', () => ({
  FileViewerSidebar: () => <div>file-viewer-sidebar</div>,
  useFileViewerStore: {
    getState: () => ({ closeViewer: closeViewerMock }),
  },
}));

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('./components/ConversationHeader', () => ({ ConversationHeader: () => null }));
vi.mock('./components/ConversationContent', () => ({ ConversationContent: () => null }));
vi.mock('./components/ConversationInput', () => ({ ConversationInput: () => null }));
vi.mock('./components/StreamErrorDialog', () => ({ StreamErrorDialog: () => null }));
vi.mock('./components/NotFound', () => ({ NotFound: () => null }));
vi.mock('./GroupConversationPage', () => ({ GroupConversationPage: () => null }));

describe('ConversationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    conversationStateMock.value = {
      currentConversationId: 'conversation-1',
      currentConversation: { id: 'conversation-1' },
    };
  });

  it('does not rehydrate a newly claimed conversation', () => {
    render(<ConversationPage />);

    expect(setCurrentConversationMock).not.toHaveBeenCalled();
    expect(fetchMessagesMock).toHaveBeenCalledWith('conversation-1');
  });

  it('hydrates a conversation that has not been claimed', () => {
    conversationStateMock.value = {
      currentConversationId: null,
      currentConversation: null,
    };

    render(<ConversationPage />);

    expect(setCurrentConversationMock).toHaveBeenCalledWith('conversation-1');
  });

  afterEach(() => {
    act(() => vi.runOnlyPendingTimers());
    vi.useRealTimers();
  });

  it('keeps the viewer open while mounted and closes it when leaving', () => {
    const { rerender, unmount } = render(<ConversationPage />);

    rerender(<ConversationPage />);
    expect(closeViewerMock).not.toHaveBeenCalled();

    unmount();
    expect(closeViewerMock).toHaveBeenCalledOnce();
  });

  it('preserves message state during the StrictMode effect replay and cleans up on real unmount', () => {
    const { unmount } = render(<StrictMode><ConversationPage /></StrictMode>);

    act(() => vi.runOnlyPendingTimers());
    expect(clearMessagesMock).not.toHaveBeenCalled();

    unmount();
    expect(clearMessagesMock).not.toHaveBeenCalled();
    act(() => vi.runOnlyPendingTimers());
    expect(clearMessagesMock).toHaveBeenCalledOnce();
  });

  it('cancels pending message cleanup when the conversation page immediately remounts', () => {
    const firstMount = render(<ConversationPage />);
    firstMount.unmount();

    const secondMount = render(<ConversationPage />);
    act(() => vi.runOnlyPendingTimers());
    expect(clearMessagesMock).not.toHaveBeenCalled();

    secondMount.unmount();
    act(() => vi.runOnlyPendingTimers());
    expect(clearMessagesMock).toHaveBeenCalledOnce();
  });

  it('does not clear shared message state while another conversation page remains mounted', () => {
    const firstMount = render(<ConversationPage />);
    const secondMount = render(<ConversationPage />);

    firstMount.unmount();
    act(() => vi.runOnlyPendingTimers());
    expect(clearMessagesMock).not.toHaveBeenCalled();

    secondMount.unmount();
    act(() => vi.runOnlyPendingTimers());
    expect(clearMessagesMock).toHaveBeenCalledOnce();
  });
});
