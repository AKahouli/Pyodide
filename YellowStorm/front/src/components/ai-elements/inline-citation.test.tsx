import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InlineCitationCard, InlineCitationCardBody, InlineCitationCardTrigger } from './inline-citation';

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

  it('opens the preview on the first touch and invokes the citation on the second touch', async () => {
    const onClick = vi.fn();
    render(
      <InlineCitationCard>
        <InlineCitationCardTrigger sources={['2']} onClick={onClick} />
        <InlineCitationCardBody>Source preview</InlineCitationCardBody>
      </InlineCitationCard>,
    );
    const trigger = screen.getByRole('button', { name: '2' });

    fireEvent.pointerDown(trigger, { pointerType: 'touch' });
    fireEvent.click(trigger);

    expect(await screen.findByText('Source preview')).toBeInTheDocument();
    expect(onClick).not.toHaveBeenCalled();

    fireEvent.pointerDown(trigger, { pointerType: 'touch' });
    fireEvent.click(trigger);

    expect(onClick).toHaveBeenCalledOnce();
  });
});
