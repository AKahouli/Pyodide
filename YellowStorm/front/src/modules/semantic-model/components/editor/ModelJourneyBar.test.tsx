import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ModelJourneyBar, type JourneyState } from './ModelJourneyBar';

const empty: JourneyState = { concepts: 0, sources: 0, score: undefined, findings: 0, blockingFindings: 0, published: false };

describe('ModelJourneyBar', () => {
  it('points at the first unfinished step', () => {
    render(<ModelJourneyBar state={{ ...empty, concepts: 3 }} onStep={vi.fn()} />);

    expect(screen.getByRole('button', { name: /journey\.describe/ })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: /journey\.connect/ })).toHaveAttribute('aria-current', 'step');
  });

  it('keeps the check step unfinished while findings remain', () => {
    render(<ModelJourneyBar state={{ concepts: 3, sources: 8, score: 100, findings: 2, blockingFindings: 0, published: false }} onStep={vi.fn()} />);

    const verify = screen.getByRole('button', { name: /journey\.verify/ });
    expect(verify).toHaveAttribute('aria-current', 'step');
    expect(verify).toHaveTextContent('journey.toFix');
  });

  it('reports a published model as finished', () => {
    render(<ModelJourneyBar state={{ concepts: 3, sources: 8, score: 100, findings: 0, blockingFindings: 0, published: true }} onStep={vi.fn()} />);

    expect(screen.getByRole('button', { name: /journey\.publish/ })).toHaveTextContent('journey.published');
  });

  it('reports which step was asked for', () => {
    const onStep = vi.fn();
    render(<ModelJourneyBar state={empty} onStep={onStep} />);

    fireEvent.click(screen.getByRole('button', { name: /journey\.verify/ }));

    expect(onStep).toHaveBeenCalledWith('verify');
  });
});
