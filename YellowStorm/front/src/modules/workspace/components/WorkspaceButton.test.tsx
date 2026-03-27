import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceButton } from './WorkspaceButton';

const openModalMock = vi.fn();
const openCreateModalMock = vi.fn();
const openCreateTemplateModalMock = vi.fn();

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

vi.mock('../store', () => ({
  useWorkspaceStore: (selector: (state: { openModal: () => void; openCreateModal: () => void; openCreateTemplateModal: () => void }) => unknown) =>
    selector({
      openModal: openModalMock,
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
  SidebarMenuAction: ({ children }: { children: ReactNode }) => <button type='button'>{children}</button>,
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
  it('calls workspace actions from button and menu items', async () => {
    render(<WorkspaceButton />);

    await userEvent.click(screen.getByRole('button', { name: 'button.label' }));
    await userEvent.click(screen.getByRole('button', { name: 'button.menu.createWorkspace' }));
    await userEvent.click(screen.getByRole('button', { name: 'button.menu.createTemplate' }));

    expect(openModalMock).toHaveBeenCalledTimes(1);
    expect(openCreateModalMock).toHaveBeenCalledTimes(1);
    expect(openCreateTemplateModalMock).toHaveBeenCalledTimes(1);
  });
});
