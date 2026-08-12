import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InlineCitationCard, InlineCitationCardTrigger } from './inline-citation';

describe('InlineCitationCardTrigger', () => {
  it('renders a compact source button with the complete accessible label', () => {
    render(
      <InlineCitationCard>
        <InlineCitationCardTrigger sources={['1']} />
      </InlineCitationCard>,
    );

    const trigger = screen.getByRole('button', { name: '1' });
    expect(trigger).toHaveClass('min-h-11', 'min-w-11', 'max-w-36', 'text-[11px]');
    expect(trigger.firstChild).toHaveClass('h-6', 'min-w-6', 'max-w-32');
    expect(trigger).toHaveAttribute('title', '1');
  });

  it('keeps long source names accessible while constraining their visible width', () => {
    const source = 'annual-financial-report-with-a-very-long-name.pdf';
    render(
      <InlineCitationCard>
        <InlineCitationCardTrigger sources={[source]} />
      </InlineCitationCard>,
    );

    expect(screen.getByRole('button', { name: source }).firstChild).toHaveClass('max-w-32');
  });
});
