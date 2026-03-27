import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TimingIndicator } from './TimingIndicator';

describe('TimingIndicator', () => {
  it('renders nothing when no timing data exists', () => {
    const { container } = render(<TimingIndicator />);
    expect(container.firstChild).toBeNull();
  });

  it('renders formatted timing summary', () => {
    render(<TimingIndicator timeToFirstChunk={250} timeToFirstToken={300} durationMs={1000} inputTokens={10} outputTokens={20} />);
    expect(screen.getByText('250ms')).toBeInTheDocument();
  });
});
