import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceButton } from './WorkspaceButton';

const openCreateModalMock = vi.fn();
const openCreateTemplateModalMock = vi.fn();
const navigateMock = vi.fn();

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({
    t: (key: string) => key,
    ready: true,
    language: 'en',
  }),
}));

vi.mock('../hooks/useWorkspaceStoreTranslator', () => ({
  useWorkspaceStoreTranslator: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}));

vi.mock('../store', () => ({
  useWorkspaceStore: (selector: (state: { openCreateModal: () => void; openCreateTemplateModal: () => void }) => unknown) =>
    selector({
      openCreateModal: openCreateModalMock,
      openCreateTemplateModal: openCreateTemplateModalMock,
    }),
}));

vi.mock('@/components/ui/sidebar', () => ({
  SidebarMenuItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarMenuButton: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type='button' onClick={onClick}>
      {children}
    </button>
  ),
  SidebarMenuAction: ({ children, showOnHover: _showOnHover, ...props }: { children: ReactNode; showOnHover?: boolean; 'aria-label'?: string }) => <button type='button' {...props}>{children}</button>,
}));

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type='button' onClick={onClick}>
      {children}
    </button>
  ),
}));

describe('WorkspaceButton', () => {
  it('navigates to workspace and calls create actions from menu items', async () => {
    render(<WorkspaceButton />);

    await userEvent.click(screen.getByRole('button', { name: 'button.label' }));
    await userEvent.click(screen.getByRole('button', { name: 'button.menu.createWorkspace' }));
    await userEvent.click(screen.getByRole('button', { name: 'button.menu.createTemplate' }));

    expect(navigateMock).toHaveBeenCalledWith('/workspace');
    expect(openCreateModalMock).toHaveBeenCalledTimes(1);
    expect(openCreateTemplateModalMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'sidebar.moreActions' })).toBeInTheDocument();
  });
});
