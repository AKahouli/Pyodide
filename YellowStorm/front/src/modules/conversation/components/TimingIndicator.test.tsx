import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TimingIndicator } from './TimingIndicator';

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
});
