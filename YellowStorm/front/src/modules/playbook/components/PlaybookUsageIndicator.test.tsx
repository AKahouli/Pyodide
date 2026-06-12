import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PlaybookUsageIndicator } from './PlaybookUsageIndicator';

const usageState = vi.hoisted(() => ({
  status: null as any,
}));

vi.mock('@/modules/usage/UsageContext', () => ({
  useUsage: () => usageState,
}));

vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

describe('PlaybookUsageIndicator', () => {
  it('renders nothing when usage status is unavailable', () => {
    usageState.status = null;
    const { container } = render(<PlaybookUsageIndicator />);
    expect(container.firstChild).toBeNull();
  });

  it('shows usage counts, reset hint, and exceeded message', () => {
    usageState.status = {
      resetsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      isLimitExceeded: true,
      tokens: {
        input: 1200,
        output: 800,
        total: 2000,
        limit: 3000,
        percentUsed: 66,
        isUnlimited: false,
      },
    };

    render(<PlaybookUsageIndicator />);
    expect(screen.getByText('2.0K / 3.0K')).toBeInTheDocument();
    expect(screen.getByText(/usage\.input/)).toBeInTheDocument();
    expect(screen.getByText(/usage\.output/)).toBeInTheDocument();
    expect(screen.getByText(/usage\.resetsIn/)).toBeInTheDocument();
    expect(screen.getByText('usage.limitExceeded')).toBeInTheDocument();
  });
});
