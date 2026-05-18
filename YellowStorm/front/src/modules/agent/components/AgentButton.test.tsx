import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AgentButton } from './AgentButton';

const navigateSpy = vi.fn();

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateSpy,
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
  it('navigates to /agents when clicking the button', () => {
    render(<AgentButton />);

    fireEvent.click(screen.getByText('button.agents'));

    expect(navigateSpy).toHaveBeenCalledWith('/agents');
  });
});
