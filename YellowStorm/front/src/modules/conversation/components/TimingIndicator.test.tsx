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
  const conversationUsage = {
    tokens: {
      input: 93_210,
      output: 31_505,
      cachedInput: 4_019,
      reasoning: 0,
      total: 128_734,
    },
    cost: { usd: 0.287, complete: true },
    carbon: { gramsCo2e: 6.2, estimated: true as const, complete: true },
  };
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
    render(<TimingIndicator timeToFirstChunk={640} timeToFirstToken={700} durationMs={4000} latencyMetrics={fullMetrics} />);
    expect(screen.getByRole('button', { name: 'latency.openDetails' })).toBeInTheDocument();
  });

  it('shows cumulative usage and impact in the existing details popover', async () => {
    render(<TimingIndicator conversationUsage={conversationUsage} />);
    await userEvent.click(screen.getByRole('button', { name: 'latency.openDetails' }));
    expect(screen.getByText('128,734')).toBeInTheDocument();
    expect(screen.getByText('$0.287')).toBeInTheDocument();
    expect(screen.getByText('≈ 6.2 gCO₂e')).toBeInTheDocument();
  });

  it('does not present unavailable estimates as zero', async () => {
    render(
      <TimingIndicator
        conversationUsage={{
          ...conversationUsage,
          cost: { usd: null, complete: false },
          carbon: {
            ...conversationUsage.carbon,
            gramsCo2e: null,
            complete: false,
          },
        }}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'latency.openDetails' }));
    expect(screen.getByText('usage.costUnavailable')).toBeInTheDocument();
    expect(screen.getByText('usage.carbonUnavailable')).toBeInTheDocument();
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
        latencyMetrics={{
          schemaVersion: 1,
          backendPreAdkMs: 0,
          quality: 'clock-skew',
        }}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'latency.openDetails' }));
    expect(screen.getByText('latency.clockSkew')).toBeInTheDocument();
  });

  it('renders the full ADK pre-provider breakdown under its parent row', async () => {
    const user = userEvent.setup();
    render(
      <TimingIndicator
        latencyMetrics={{
          ...fullMetrics,
          adkPreProviderBreakdown: {
            protobufToDictMs: 14,
            requestLoggingMs: 412,
            requestConversionMs: 36,
            workflowDispatchMs: 8,
            sessionLockWaitMs: 0,
            orchestrationSetupMs: 31,
            agentToolPreparationMs: 814,
            sessionRunnerSetupMs: 207,
            adkRuntimePreModelMs: 848,
          },
        }}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'latency.openDetails' }));
    expect(screen.getByText('latency.adkBreakdown.protobufToDict')).toBeInTheDocument();
    expect(screen.getByText('latency.adkBreakdown.requestLogging')).toBeInTheDocument();
    expect(screen.getByText('latency.adkBreakdown.requestConversion')).toBeInTheDocument();
    expect(screen.getByText('latency.adkBreakdown.workflowDispatch')).toBeInTheDocument();
    expect(screen.getByText('latency.adkBreakdown.sessionLockWait')).toBeInTheDocument();
    expect(screen.getByText('latency.adkBreakdown.orchestrationSetup')).toBeInTheDocument();
    expect(screen.getByText('latency.adkBreakdown.agentToolPreparation')).toBeInTheDocument();
    expect(screen.getByText('latency.adkBreakdown.sessionRunnerSetup')).toBeInTheDocument();
    expect(screen.getByText('latency.adkBreakdown.adkRuntimePreModel')).toBeInTheDocument();
    expect(screen.getByText('412 ms')).toBeInTheDocument();
    expect(screen.getByText('848 ms')).toBeInTheDocument();
  });

  it('keeps the six-row historical layout when no breakdown exists', async () => {
    const user = userEvent.setup();
    render(<TimingIndicator latencyMetrics={fullMetrics} />);
    await user.click(screen.getByRole('button', { name: 'latency.openDetails' }));
    expect(screen.queryByText('latency.adkBreakdown.requestLogging')).not.toBeInTheDocument();
  });

  it('renders em-dash for missing breakdown children in a partial breakdown', async () => {
    const user = userEvent.setup();
    render(
      <TimingIndicator
        latencyMetrics={{
          ...fullMetrics,
          adkPreProviderBreakdown: { requestLoggingMs: 412 },
        }}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'latency.openDetails' }));
    expect(screen.getByText('412 ms')).toBeInTheDocument();
    // fullMetrics defines all six primary rows, so only the 8 missing
    // breakdown children render an em-dash.
    expect(screen.getAllByText('—').length).toBe(8);
  });

  it('renders the backend pre-ADK breakdown under its parent row', async () => {
    const user = userEvent.setup();
    render(
      <TimingIndicator
        latencyMetrics={{
          ...fullMetrics,
          backendPreAdkBreakdown: {
            controllerValidationRoutingMs: 42,
            userMessagePersistenceMs: 12,
            grpcTransitToAdkMs: 3,
          },
        }}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'latency.openDetails' }));
    expect(screen.getByText('latency.backendBreakdown.controllerValidationRouting')).toBeInTheDocument();
    expect(screen.getByText('latency.backendBreakdown.grpcTransitToAdk')).toBeInTheDocument();
    expect(screen.getByText('42 ms')).toBeInTheDocument();
    expect(screen.getByText('3 ms')).toBeInTheDocument();
  });

  it('renders session/runner children nested under the session runner setup child', async () => {
    const user = userEvent.setup();
    render(
      <TimingIndicator
        latencyMetrics={{
          ...fullMetrics,
          adkPreProviderBreakdown: {
            sessionRunnerSetupMs: 1380,
            sessionRunnerSetupBreakdown: {
              sessionLookupMs: 120,
              runnerHandoffMs: 4,
            },
          },
        }}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'latency.openDetails' }));
    expect(screen.getByText('latency.adkBreakdown.sessionRunnerSetup')).toBeInTheDocument();
    expect(screen.getByText('latency.sessionRunnerBreakdown.sessionLookup')).toBeInTheDocument();
    expect(screen.getByText('latency.sessionRunnerBreakdown.runnerHandoff')).toBeInTheDocument();
    expect(screen.getAllByText('120 ms').length).toBeGreaterThan(0);
    expect(screen.getByText('1.38 s')).toBeInTheDocument();
  });

  it('shows a clipboard button in the latency popover', async () => {
    const user = userEvent.setup();
    render(<TimingIndicator latencyMetrics={fullMetrics} />);
    await user.click(screen.getByRole('button', { name: 'latency.openDetails' }));
    expect(screen.getByRole('button', { name: 'latency.copyDetails' })).toBeInTheDocument();
  });

  it('hides the latency UI and legacy timing when the admin toggle is off but keeps token usage', () => {
    render(<TimingIndicator timeToFirstChunk={250} durationMs={1000} inputTokens={120} outputTokens={30} latencyMetrics={fullMetrics} latencyInstrumentationEnabled={false} />);
    expect(screen.queryByRole('button', { name: 'latency.openDetails' })).not.toBeInTheDocument();
    expect(screen.queryByText('250ms')).not.toBeInTheDocument();
    expect(screen.getByText('timing.compactTokens: 120/30')).toBeInTheDocument();
  });
  it('shows breakdown children alongside the clock-skew warning', async () => {
    const user = userEvent.setup();
    render(
      <TimingIndicator
        latencyMetrics={{
          schemaVersion: 1,
          backendPreAdkMs: -3,
          adkPreProviderMs: 60,
          quality: 'clock-skew',
          adkPreProviderBreakdown: { adkRuntimePreModelMs: 30 },
        }}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'latency.openDetails' }));
    expect(screen.getByText('latency.clockSkew')).toBeInTheDocument();
    expect(screen.getByText('latency.adkBreakdown.adkRuntimePreModel')).toBeInTheDocument();
    expect(screen.getByText('30 ms')).toBeInTheDocument();
  });
});
