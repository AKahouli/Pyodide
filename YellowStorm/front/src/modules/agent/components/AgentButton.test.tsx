import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AgentButton } from './AgentButton';

const dialogSpy = vi.fn();

vi.mock('./AgentDialog', () => ({
  AgentDialog: (props: { open: boolean }) => {
    dialogSpy(props.open);
    return props.open ? <div>dialog-open</div> : null;
  },
}));

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/components/ui/sidebar', () => ({
  SidebarMenuItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarMenuButton: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  SidebarMenuAction: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

describe('AgentButton', () => {
  it('opens dialog when clicking manage agents button', () => {
    render(<AgentButton />);

    fireEvent.click(screen.getByText('button.agents'));

    expect(screen.getByText('dialog-open')).toBeInTheDocument();
    expect(dialogSpy).toHaveBeenLastCalledWith(true);
  });
});
