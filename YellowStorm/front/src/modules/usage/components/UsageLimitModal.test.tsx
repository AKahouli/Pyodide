import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { makeUsageStatus } from '../test-utils';
import { UsageLimitModal } from './UsageLimitModal';

const usageState = vi.hoisted(() => ({
  status: null as ReturnType<typeof makeUsageStatus> | null,
}));

vi.mock('../UsageContext', () => ({
  useUsage: () => usageState,
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: ReactNode; open: boolean }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

describe('UsageLimitModal', () => {
  it('returns null when usage status is missing', () => {
    usageState.status = null;
    const { container } = render(
      <MemoryRouter>
        <UsageLimitModal />
      </MemoryRouter>,
    );
    expect(container.firstChild).toBeNull();
  });

  it('opens on limit exceeded, supports dismiss and upgrade', async () => {
    usageState.status = makeUsageStatus({ isLimitExceeded: true });
    render(
      <MemoryRouter>
        <UsageLimitModal />
      </MemoryRouter>,
    );

    expect(screen.getByText('Usage Limit Reached')).toBeInTheDocument();
    expect(screen.getByText('Upgrade Plan')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Maybe Later' }));
    expect(screen.queryByText('Usage Limit Reached')).not.toBeInTheDocument();

    render(
      <MemoryRouter>
        <UsageLimitModal />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Upgrade Plan' }));
    expect(screen.queryByText('Usage Limit Reached')).not.toBeInTheDocument();
  });
});
