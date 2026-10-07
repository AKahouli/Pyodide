import { StrictMode } from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationPage } from './ConversationPage';

const closeViewerMock = vi.hoisted(() => vi.fn());
const fetchMessagesMock = vi.hoisted(() => vi.fn());
const clearMessagesMock = vi.hoisted(() => vi.fn());
const setCurrentConversationMock = vi.hoisted(() => vi.fn());
const paramsMock = vi.hoisted(() => ({ value: { id: 'conversation-1' } }));
const conversationLoadingMock = vi.hoisted(() => ({ value: false }));
const conversationStateMock = vi.hoisted(() => ({
  value: {
    currentConversationId: 'conversation-1' as string | null,
    currentConversation: { id: 'conversation-1' } as { id: string } | null,
  },
}));

vi.mock('react-router-dom', () => ({
  useParams: () => paramsMock.value,
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
  useConversationLoading: () => conversationLoadingMock.value,
  useDisplayMessages: () => [],
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
vi.mock('./components/RootInputPanel', () => ({ RootInputPanel: () => null }));
vi.mock('./components/RootWorkPanel', () => ({ RootWorkPanel: () => null }));
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
    paramsMock.value = { id: 'conversation-1' };
    conversationLoadingMock.value = false;
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

  it('reserves the conversation shell while conversation data loads', () => {
    conversationLoadingMock.value = true;
    const { container } = render(<ConversationPage />);

    expect(screen.getByRole('status', { name: 'page.loading' })).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelector('[data-loading-header]')).toHaveClass('h-[68px]', 'md:h-[60px]');
    expect(container.querySelector('[data-loading-composer]')).toHaveClass('h-28');
    expect(container.querySelector('[data-loading-spinner]')).toBeInTheDocument();
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
    act(() => vi.runOnlyPendingTimers());
    expect(closeViewerMock).toHaveBeenCalledOnce();
  });

  it('closes the viewer when navigating to another conversation', () => {
    const { rerender } = render(<ConversationPage />);

    paramsMock.value = { id: 'conversation-2' };
    conversationStateMock.value = {
      currentConversationId: 'conversation-2',
      currentConversation: { id: 'conversation-2' },
    };
    rerender(<ConversationPage />);

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
