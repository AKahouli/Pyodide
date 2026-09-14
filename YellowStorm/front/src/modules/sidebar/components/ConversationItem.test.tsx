import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ConversationItem } from './ConversationItem';

const storeState = vi.hoisted(() => ({
  typewriterConversationId: null as string | null,
  typewriterName: '',
  clearTypewriter: vi.fn(),
  currentConversationId: 'c1',
}));

const typewriterText = vi.hoisted(() => ({ value: '' }));
const sidebarState = vi.hoisted(() => ({ isMobile: false, setOpenMobile: vi.fn() }));

vi.mock('@/components/ui/sidebar', () => ({
  SidebarMenuItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarMenuButton: ({ children, isActive }: { children: ReactNode; isActive?: boolean }) => (
    <div data-active={String(Boolean(isActive))}>{children}</div>
  ),
  SidebarMenuAction: ({ children, showOnHover: _showOnHover, draggable: _draggable, ...props }: { children: ReactNode; showOnHover?: boolean; draggable?: boolean; 'aria-label'?: string }) => <button type='button' {...props}>{children}</button>,
  useSidebar: () => sidebarState,
}));

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }: { children: ReactNode; onClick: () => void }) => (
    <button type='button' onClick={onClick}>{children}</button>
  ),
}));

vi.mock('@/modules/conversation/components/RenameDialog', () => ({
  RenameDialog: ({ open }: { open: boolean }) => (open ? <div>rename-open</div> : null),
}));

vi.mock('@/modules/conversation/components/DeleteConversationDialog', () => ({
  DeleteConversationDialog: ({ open }: { open: boolean }) => (open ? <div>delete-open</div> : null),
}));

vi.mock('@/modules/conversation/store', () => ({
  useConversationStore: (selector: (state: typeof storeState) => unknown) => selector(storeState),
}));

vi.mock('@/modules/conversation/hooks/useTypewriter', () => ({
  useTypewriter: () => typewriterText.value,
}));

describe('ConversationItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    typewriterText.value = '';
    storeState.typewriterConversationId = null;
    storeState.typewriterName = '';
    sidebarState.isMobile = false;
  });

  it('renders normal title and active state', () => {
    const { container } = render(
      <MemoryRouter>
        <ConversationItem id='c1' title='My convo' />
      </MemoryRouter>,
    );

    expect(screen.getByText('My convo')).toBeInTheDocument();
    expect(container.querySelector('[data-active="true"]')).toBeInTheDocument();
  });

  it('shows typewriter title and handles menu actions', async () => {
    storeState.typewriterConversationId = 'c2';
    typewriterText.value = 'Typing title';
    const onShare = vi.fn();

    render(
      <MemoryRouter>
        <ConversationItem
          id='c2'
          title='Old title'
          onShare={onShare}
          onRename={async () => undefined}
          onDelete={async () => undefined}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Typing title')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'conversations.actions' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'conversations.rename' }));
    expect(screen.getByText('rename-open')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'conversations.share' }));
    expect(onShare).toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'conversations.delete' }));
    expect(screen.getByText('delete-open')).toBeInTheDocument();
  });

  it('closes the mobile sidebar when navigating', async () => {
    sidebarState.isMobile = true;
    render(
      <MemoryRouter>
        <ConversationItem id='c1' title='My convo' />
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByText('My convo'));
    expect(sidebarState.setOpenMobile).toHaveBeenCalledWith(false);
  });

  it('renders the streaming spinner only when streaming', () => {
    const { container, rerender } = render(
      <MemoryRouter>
        <ConversationItem id='c1' title='My convo' />
      </MemoryRouter>,
    );
    expect(container.querySelector('[data-slot="conversation-streaming-spinner"]')).not.toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <ConversationItem id='c1' title='My convo' streaming />
      </MemoryRouter>,
    );
    expect(container.querySelector('[data-slot="conversation-streaming-spinner"]')).toBeInTheDocument();
  });
});
