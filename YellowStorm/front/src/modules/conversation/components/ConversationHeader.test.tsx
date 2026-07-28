import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { mockNavigate } from '@/test/setup';
import { ConversationHeader } from './ConversationHeader';

vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('./RenameDialog', () => ({ RenameDialog: ({ open }: { open: boolean }) => <div>{open ? 'rename-open' : 'rename-closed'}</div> }));
vi.mock('./DeleteConversationDialog', () => ({ DeleteConversationDialog: ({ open }: { open: boolean }) => <div>{open ? 'delete-open' : 'delete-closed'}</div> }));
vi.mock('./ShareDialog', () => ({ ShareDialog: ({ open }: { open: boolean }) => <div>{open ? 'share-open' : 'share-closed'}</div> }));
vi.mock('./WorkspaceManagerSheet', () => ({ WorkspaceManagerSheet: ({ open }: { open: boolean }) => <div>{open ? 'workspace-open' : 'workspace-closed'}</div> }));
vi.mock('./CreateGroupConversationDialog', () => ({ CreateGroupConversationDialog: () => null }));

vi.mock('../hooks/useTypewriter', () => ({
  useTypewriter: () => '',
}));

const updateConversationMock = vi.fn();
const deleteConversationMock = vi.fn();
const clearTypewriterMock = vi.fn();

vi.mock('../store', () => ({
  useCurrentConversation: () => ({
    id: 'conv-1',
    title: 'Conversation title',
    workspaces: [],
  }),
  useConversationStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      updateConversation: updateConversationMock,
      deleteConversation: deleteConversationMock,
      typewriterConversationId: null,
      typewriterName: '',
      clearTypewriter: clearTypewriterMock,
    }),
}));

describe('ConversationHeader', () => {
  it('navigates back and opens share/workspace dialogs', async () => {
    render(<ConversationHeader />);

    expect(screen.getByText('Conversation title')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'header.actions.back' }));
    expect(mockNavigate).toHaveBeenCalledWith('/');

    await userEvent.click(screen.getByRole('button', { name: 'header.tooltips.workspaces' }));
    expect(screen.getByText('workspace-open')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'header.tooltips.share' }));
    expect(screen.getByText('share-open')).toBeInTheDocument();
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
});
