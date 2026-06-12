import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PlaybookIntentGhostNode } from './PlaybookIntentGhostNode';

describe('PlaybookIntentGhostNode', () => {
  it('renders the intent analysis status copy', () => {
    render(<PlaybookIntentGhostNode />);

    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('status')).toHaveTextContent('canvas.intentAnalyzing');
    expect(screen.getByText('canvas.intentAnalyzingHint')).toBeInTheDocument();
  });

  it('keeps the overlay non-interactive', () => {
    render(<PlaybookIntentGhostNode />);

    expect(screen.getByTestId('intent-ghost-overlay')).toHaveClass('pointer-events-none');
  });

  it('marks decorative stream effects as hidden from assistive tech', () => {
    render(<PlaybookIntentGhostNode />);

    expect(screen.getByTestId('intent-ghost-overlay').querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});
