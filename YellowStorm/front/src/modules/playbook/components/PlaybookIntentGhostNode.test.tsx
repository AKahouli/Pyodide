import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PlaybookIntentGhostNode } from './PlaybookIntentGhostNode';

describe('PlaybookIntentGhostNode', () => {
  it('renders the intent analysis status copy', () => {
    render(<PlaybookIntentGhostNode progress="Adding the next task" />);

    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('status')).toHaveTextContent('canvas.intentAnalyzing');
    expect(screen.getByText('Adding the next task')).toBeInTheDocument();
  });

  it('falls back to the intent analysis hint without progress copy', () => {
    render(<PlaybookIntentGhostNode />);

    expect(screen.getByText('canvas.intentAnalyzingHint')).toBeInTheDocument();
  });

  it('keeps the overlay non-interactive', () => {
    render(<PlaybookIntentGhostNode />);

    expect(screen.getByTestId('intent-ghost-overlay')).toHaveClass('pointer-events-none');
  });

  it('marks decorative progress effects as hidden from assistive tech', () => {
    render(<PlaybookIntentGhostNode />);

    expect(screen.getByTestId('intent-ghost-overlay').querySelectorAll('[aria-hidden="true"]')).toHaveLength(2);
  });

  it('renders forward and reverse progress sweeps', () => {
    render(<PlaybookIntentGhostNode />);

    expect(screen.getByTestId('intent-progress-sweep-forward')).toHaveStyle({ animation: 'intent-progress-sweep 1.8s linear infinite' });
    expect(screen.getByTestId('intent-progress-sweep-reverse')).toHaveStyle({ animation: 'intent-progress-sweep-reverse 1.8s linear 0.9s infinite' });
    expect(screen.getByTestId('intent-progress-sweep-forward')).toHaveClass('intent-progress-animated');
  });
});
