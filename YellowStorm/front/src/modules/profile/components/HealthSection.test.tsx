import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { HealthSection } from './HealthSection';
import * as profileApi from '../api';

const fetchHealthMock = vi.fn();
const fetchHistoryMock = vi.fn();
const fetchStatsMock = vi.fn();

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/lib/use-api-action', () => ({
  useApiAction: (fn: unknown, options: { onSuccess?: (data: any) => void }) => {
    if (fn === profileApi.getHealthStatus) {
      return {
        execute: () => {
          options.onSuccess?.({ status: 'healthy', version: '1.0', uptime: 100, checks: { memory: { status: 'up', responseTime: 10 } } });
          fetchHealthMock();
        },
        isLoading: false,
      };
    }
    if (fn === profileApi.getHealthHistory) {
      return {
        execute: () => {
          options.onSuccess?.({ records: [] });
          fetchHistoryMock();
        },
        isLoading: false,
      };
    }
    if (fn === profileApi.getHealthStats) {
      return {
        execute: () => {
          options.onSuccess?.({ uptimePercentage: 100, period: { minutes: 60 }, totalRecords: 0, avgResponseTimes: {} });
          fetchStatsMock();
        },
        isLoading: false,
      };
    }
    return { execute: vi.fn(), isLoading: false };
  },
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, ...rest }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick} {...rest}>{children}</button>
  ),
}));

vi.mock('@/components/ui/separator', () => ({ Separator: () => <div>sep</div> }));
vi.mock('@/components/ui/card', () => ({
  Card: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/badge', () => ({ Badge: ({ children }: { children: ReactNode }) => <span>{children}</span> }));
vi.mock('@/components/ui/skeleton', () => ({ Skeleton: () => <div>sk</div> }));
vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Tooltip: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TooltipContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/chart', () => ({
  ChartContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ChartTooltip: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ChartTooltipContent: () => <div />,
}));

vi.mock('recharts', () => ({
  AreaChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Area: () => <div />,
}));

describe('HealthSection', () => {
  it('renders health overview and refresh action', async () => {
    render(<HealthSection />);

    await waitFor(() => {
      expect(screen.getByText('health.overall.title')).toBeInTheDocument();
      expect(screen.getByText('health.serviceChecks.title')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('health.actions.refresh'));

    expect(fetchHealthMock).toHaveBeenCalled();
    expect(fetchHistoryMock).toHaveBeenCalled();
    expect(fetchStatsMock).toHaveBeenCalled();
  });
});
