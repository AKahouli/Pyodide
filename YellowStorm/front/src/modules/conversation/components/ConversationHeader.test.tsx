import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockNavigate } from '@/test/setup';
import { ConversationHeader } from './ConversationHeader';

const authActor = vi.hoisted(() => ({ id: 'owner-1' }));
vi.mock('@/modules/auth', () => ({ useAuth: () => ({ user: { id: authActor.id } }) }));

vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('./RenameDialog', () => ({ RenameDialog: ({ open }: { open: boolean }) => <div>{open ? 'rename-open' : 'rename-closed'}</div> }));
vi.mock('./DeleteConversationDialog', () => ({ DeleteConversationDialog: ({ open, isShared }: { open: boolean; isShared?: boolean }) => <div>{open ? `delete-open${isShared ? '-shared' : ''}` : 'delete-closed'}</div> }));
vi.mock('./ShareDialog', () => ({ ShareDialog: ({ open }: { open: boolean }) => <div>{open ? 'share-open' : 'share-closed'}</div> }));
vi.mock('./CreateGroupConversationDialog', () => ({ CreateGroupConversationDialog: () => null }));
vi.mock('./PdfExportPortal', () => ({ PdfExportPortal: () => <div>conversation-pdf-export</div> }));

const currentConversation = vi.hoisted(() => ({
  value: { id: 'conv-1', title: 'Conversation title', workspaces: [] } as Record<string, unknown>,
}));

const fetchMessagesMock = vi.hoisted(() => vi.fn());
const exportBlocksToDocxMock = vi.hoisted(() => vi.fn().mockResolvedValue(new Blob(['docx'])));
const downloadBlobMock = vi.hoisted(() => vi.fn());
const showSuccessMock = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({ fetchMessages: fetchMessagesMock }));
vi.mock('../utils/docx-export', () => ({
  exportBlocksToDocx: exportBlocksToDocxMock,
  downloadBlob: downloadBlobMock,
}));
vi.mock('@/lib/notifications', () => ({
  showSuccess: showSuccessMock,
  showError: vi.fn(),
  showInfo: vi.fn(),
}));

vi.mock('../hooks/useTypewriter', () => ({
  useTypewriter: () => '',
}));

const updateConversationMock = vi.fn();
const deleteConversationMock = vi.fn();
const clearTypewriterMock = vi.fn();

vi.mock('../store', () => ({
  useCurrentConversation: () => currentConversation.value,
  useConversationStore: Object.assign((selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      updateConversation: updateConversationMock,
      deleteConversation: deleteConversationMock,
      typewriterConversationId: null,
      typewriterName: '',
      clearTypewriter: clearTypewriterMock,
    }), { getState: () => ({ activeBranches: new Map() }) }),
}));

describe('ConversationHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authActor.id = 'owner-1';
    currentConversation.value = { id: 'conv-1', title: 'Conversation title', createdBy: 'owner-1', workspaces: [] };
    fetchMessagesMock.mockResolvedValue({
      items: [
        { id: 'u1', conversationType: 'user', content: 'Question?', createdAt: '2026-01-01T10:00:00Z' },
        { id: 'a1', conversationType: 'ai', components: [{ type: 'text', data: { content: 'Answer' } }], createdAt: '2026-01-01T10:00:05Z' },
      ],
      hasMore: false,
      nextCursor: null,
    });
  });

  it('navigates back and opens the share dialog without a header workspace selector', async () => {
    render(<ConversationHeader />);

    expect(screen.getByText('Conversation title')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'header.actions.back' }));
    expect(mockNavigate).toHaveBeenCalledWith('/');

    expect(screen.queryByRole('button', { name: 'header.tooltips.workspaces' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'header.tooltips.share' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'header.tooltips.share' }));
    expect(screen.getByText('share-open')).toBeInTheDocument();
  });

  it('offers governed sharing to its owner but not to a recipient', async () => {
    currentConversation.value = { ...currentConversation.value, runtimeMode: 'governed' };
    const { rerender } = render(<ConversationHeader />);
    await userEvent.click(screen.getByRole('button', { name: 'header.tooltips.share' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'header.tooltips.share' }));
    expect(screen.getByText('share-open')).toBeInTheDocument();
    currentConversation.value = { ...currentConversation.value, createdBy: 'someone-else' };
    rerender(<ConversationHeader />);
    await userEvent.click(screen.getByRole('button', { name: 'header.tooltips.share' }));
    expect(screen.queryByRole('menuitem', { name: 'header.tooltips.share' })).not.toBeInTheDocument();
  });

  it('places rename beside the title and exposes delete as a direct action', async () => {
    render(<ConversationHeader />);

    const title = screen.getByRole('heading', { name: 'Conversation title' });
    const rename = screen.getByRole('button', { name: 'header.actions.rename' });
    expect(title.parentElement).toContainElement(rename);

    await userEvent.click(rename);
    expect(screen.getByText('rename-open')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'header.actions.delete' }));
    expect(screen.getByText('delete-open')).toBeInTheDocument();
  });

  it('exports the whole conversation to DOCX, PDF, and HTML from the merged share menu', async () => {
    render(<ConversationHeader />);

    await userEvent.click(screen.getByRole('button', { name: 'header.tooltips.share' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /messageActions.exportDocx/ }));

    await waitFor(() => {
      expect(exportBlocksToDocxMock).toHaveBeenCalledWith(
        [
          expect.objectContaining({ role: 'user', label: 'export.userLabel', markdown: 'Question?' }),
          expect.objectContaining({ role: 'ai', label: 'export.assistantLabel' }),
        ],
        'Conversation title',
      );
      expect(downloadBlobMock).toHaveBeenCalledWith(expect.any(Blob), expect.stringMatching(/\.docx$/));
      expect(showSuccessMock).toHaveBeenCalledWith('toasts.export.docxSuccess');
    });

    await userEvent.click(screen.getByRole('button', { name: 'header.tooltips.share' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /messageActions.exportPdf/ }));
    await waitFor(() => expect(screen.getByText('conversation-pdf-export')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'header.tooltips.share' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /messageActions.exportHtml/ }));
    await waitFor(() => {
      expect(downloadBlobMock).toHaveBeenCalledWith(expect.any(Blob), expect.stringMatching(/\.html$/));
      expect(showSuccessMock).toHaveBeenCalledWith('toasts.export.htmlSuccess');
    });
  });

  it.each(['actor change', 'unmount'])('does not download a whole-conversation DOCX after %s during construction', async transition => {
    let finish!: (blob: Blob) => void;
    exportBlocksToDocxMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const mounted = render(<ConversationHeader />);
    await userEvent.click(screen.getByRole('button', { name: 'header.tooltips.share' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /messageActions.exportDocx/ }));
    await waitFor(() => expect(exportBlocksToDocxMock).toHaveBeenCalled());
    if (transition === 'unmount') mounted.unmount();
    else { authActor.id = 'other'; mounted.rerender(<ConversationHeader />); }
    await act(async () => finish(new Blob(['private docx'])));
    expect(downloadBlobMock).not.toHaveBeenCalled();
    expect(showSuccessMock).not.toHaveBeenCalled();
  });
  it('closes a private conversation PDF on actor change and does not restore it on return', async () => {
    const mounted = render(<ConversationHeader />);
    await userEvent.click(screen.getByRole('button', { name: 'header.tooltips.share' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /messageActions.exportPdf/ }));
    expect(await screen.findByText('conversation-pdf-export')).toBeInTheDocument();
    authActor.id = 'other'; mounted.rerender(<ConversationHeader />);
    expect(screen.queryByText('conversation-pdf-export')).toBeNull();
    authActor.id = 'owner-1'; mounted.rerender(<ConversationHeader />);
    expect(screen.queryByText('conversation-pdf-export')).toBeNull();
  });
  it('shows the shared badge and passes shared state to the delete dialog', async () => {
    currentConversation.value = {
      id: 'conv-1',
      title: 'Conversation title',
      workspaces: [],
      isShared: true,
    };

    render(<ConversationHeader />);

    expect(screen.getByLabelText('shared.badge')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'header.actions.delete' }));
    expect(screen.getByText('delete-open-shared')).toBeInTheDocument();
  });
});
