import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { TimingIndicator } from './TimingIndicator';
import type { ConversationLatencyMetricsV1 } from '../types';

const fullMetrics: ConversationLatencyMetricsV1 = {
  schemaVersion: 1,
  backendPreAdkMs: 120,
  adkPreProviderMs: 60,
  providerTtftMs: 500,
  adkForwardingMs: 10,
  backendForwardingMs: 15,
  frontendRenderMs: 80,
  quality: 'ok',
};

describe('TimingIndicator', () => {
  it('renders nothing when no timing data exists', () => {
    const { container } = render(<TimingIndicator />);
    expect(container.firstChild).toBeNull();
  });

  it('renders formatted timing summary', () => {
    render(<TimingIndicator timeToFirstChunk={250} timeToFirstToken={300} durationMs={1000} inputTokens={98_491} outputTokens={2_682} />);
    expect(screen.getByText('250ms')).toBeInTheDocument();
    expect(screen.getByText('timing.compactTokens: 98.5k/2.7k')).toBeInTheDocument();
  });

  it('uses millions for large response totals', () => {
    render(<TimingIndicator durationMs={1000} inputTokens={1_250_000} outputTokens={2_000_000} />);
    expect(screen.getByText('timing.compactTokens: 1.3M/2M')).toBeInTheDocument();
  });

  it('renders the latency trigger when latency metrics exist', () => {
    render(
      <TimingIndicator
        timeToFirstChunk={640}
        timeToFirstToken={700}
        durationMs={4000}
        latencyMetrics={fullMetrics}
      />,
    );
    expect(screen.getByRole('button', { name: 'latency.openDetails' })).toBeInTheDocument();
  });

  it('opens a popover showing all six latency stages', async () => {
    const user = userEvent.setup();
    render(<TimingIndicator latencyMetrics={fullMetrics} />);
    await user.click(screen.getByRole('button', { name: 'latency.openDetails' }));
    expect(screen.getByText('latency.title')).toBeInTheDocument();
    expect(screen.getByText('latency.backendPreAdk')).toBeInTheDocument();
    expect(screen.getByText('latency.adkPreProvider')).toBeInTheDocument();
    expect(screen.getByText('latency.providerTtft')).toBeInTheDocument();
    expect(screen.getByText('latency.adkForwarding')).toBeInTheDocument();
    expect(screen.getByText('latency.backendForwarding')).toBeInTheDocument();
    expect(screen.getByText('latency.frontendRender')).toBeInTheDocument();
    expect(screen.getAllByText('120 ms').length).toBeGreaterThan(0);
    expect(screen.getAllByText('500 ms').length).toBeGreaterThan(0);
  });

  it('formats sub-second and multi-second values and renders em-dash for missing stages', async () => {
    const user = userEvent.setup();
    render(
      <TimingIndicator
        latencyMetrics={{
          schemaVersion: 1,
          providerTtftMs: 1234.5,
          quality: 'partial',
        }}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'latency.openDetails' }));
    expect(screen.getByText('1.23 s')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBe(5);
    expect(screen.getByText('latency.partial')).toBeInTheDocument();
  });

  it('shows the clock synchronization warning for skew quality', async () => {
    const user = userEvent.setup();
    render(
      <TimingIndicator
        latencyMetrics={{ schemaVersion: 1, backendPreAdkMs: 0, quality: 'clock-skew' }}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'latency.openDetails' }));
    expect(screen.getByText('latency.clockSkew')).toBeInTheDocument();
  });
});
