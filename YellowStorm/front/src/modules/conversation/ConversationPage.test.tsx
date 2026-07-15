import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationPage } from './ConversationPage';

const closeViewerMock = vi.hoisted(() => vi.fn());
const fetchMessagesMock = vi.hoisted(() => vi.fn());
const clearMessagesMock = vi.hoisted(() => vi.fn());
const setCurrentConversationMock = vi.hoisted(() => vi.fn());

vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: 'conversation-1' }),
}));

vi.mock('./store', () => ({
  useConversationStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      setCurrentConversation: setCurrentConversationMock,
      fetchMessages: fetchMessagesMock,
      clearMessages: clearMessagesMock,
      currentConversationId: 'conversation-1',
    }),
  useCurrentConversation: () => ({ id: 'conversation-1' }),
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
  });

  it('keeps the viewer open while mounted and closes it when leaving', () => {
    const { rerender, unmount } = render(<ConversationPage />);

    rerender(<ConversationPage />);
    expect(closeViewerMock).not.toHaveBeenCalled();

    unmount();
    expect(closeViewerMock).toHaveBeenCalledOnce();
  });
});
