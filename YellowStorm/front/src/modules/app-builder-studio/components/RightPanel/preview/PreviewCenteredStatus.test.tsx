import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PreviewCenteredStatus } from './PreviewCenteredStatus';
import { resolvePreviewPhase } from './previewStateModel';

describe('PreviewCenteredStatus', () => {
  it('announces the current phase politely without stealing focus', () => {
    render(<PreviewCenteredStatus phase={resolvePreviewPhase('hydrating')} onRetry={vi.fn()} />);

    const live = screen.getByRole('status');
    expect(live).toHaveAttribute('aria-live', 'polite');
  });

  it('does not offer a retry while the runtime is still working', () => {
    render(<PreviewCenteredStatus phase={resolvePreviewPhase('installing')} onRetry={vi.fn()} />);

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('offers a retry and surfaces the sanitised detail on error', () => {
    const onRetry = vi.fn();
    render(
      <PreviewCenteredStatus
        phase={resolvePreviewPhase('error')}
        errorDetail='The runtime stopped responding.'
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText('The runtime stopped responding.')).toBeTruthy();
    expect(screen.getByRole('button')).toBeTruthy();
  });

  it('opts every motion layer out when the user prefers reduced motion', () => {
    const { container } = render(
      <PreviewCenteredStatus phase={resolvePreviewPhase('starting')} onRetry={vi.fn()} />,
    );

    // The reduced-motion escape hatch is a class contract: the global
    // prefers-reduced-motion block collapses durations, and these classes stop
    // the decorative orb from animating at all.
    const animated = Array.from(container.querySelectorAll('.animate-orb-orbit, .animate-orb-breathe'));
    expect(animated.length).toBeGreaterThan(0);
    for (const node of animated) {
      // Either the layer is frozen or removed entirely; both are valid opt-outs.
      expect(node.className).toMatch(/motion-reduce:(animate-none|hidden)/);
    }
  });

  it('renders a static treatment (no orb motion) for the error phase', () => {
    const { container } = render(
      <PreviewCenteredStatus phase={resolvePreviewPhase('error')} onRetry={vi.fn()} />,
    );

    expect(container.querySelectorAll('.animate-orb-orbit').length).toBe(0);
  });
});
