import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PlaybookButton } from './PlaybookButton';

const navigateMock = vi.hoisted(() => vi.fn());

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock('@/components/ui/sidebar', () => ({
  SidebarMenuItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarMenuButton: ({ children, onClick }: { children: ReactNode; onClick: () => void }) => (
    <button type='button' onClick={onClick}>{children}</button>
  ),
}));

describe('PlaybookButton', () => {
  it('navigates to playbooks', async () => {
    render(<PlaybookButton />);
    expect(screen.getByText('sidebar.playbooks')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button'));
    expect(navigateMock).toHaveBeenCalledWith('/playbooks');
  });
});
