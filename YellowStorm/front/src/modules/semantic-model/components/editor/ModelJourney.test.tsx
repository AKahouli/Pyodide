import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SemanticReadiness } from '../../types';
import { ModelJourney, journeyState } from './ModelJourney';

const readiness = (complete: Partial<Record<SemanticReadiness['areas'][number]['key'], boolean>>, targets: Record<string, string> = {}): SemanticReadiness => ({
  status: 'needs_review', score: 0, completeAreas: 0, totalAreas: 5,
  areas: (['structure', 'sources', 'identity', 'relationships', 'quality'] as const).map((key) => ({
    key, complete: Boolean(complete[key]), issues: [], ...(targets[key] ? { targetId: targets[key] } : {}),
  })),
});

describe('journeyState', () => {
  it('starts with describing the model', () => {
    const state = journeyState({ readiness: { ...readiness({}), status: 'not_configured' }, conceptCount: 0, hasRecords: false, published: false });
    expect(state).toMatchObject({ current: 'describe', action: { kind: 'addConcept' } });
  });

  it('walks through sources, identity and links, pointing at the item to fix', () => {
    const base = { conceptCount: 2, hasRecords: false, published: false };
    expect(journeyState({ ...base, readiness: readiness({ structure: true }) }).action).toEqual({ kind: 'connectSource' });
    expect(journeyState({ ...base, readiness: readiness({ structure: true, sources: true }, { identity: 'customer' }) }).action)
      .toEqual({ kind: 'openItem', id: 'customer', label: 'identity' });
    expect(journeyState({ ...base, readiness: readiness({ structure: true, sources: true, identity: true }, { relationships: 'belongs' }) }).action)
      .toEqual({ kind: 'openItem', id: 'belongs', label: 'link' });
  });

  it('asks to prepare records, then review, then publish', () => {
    const ready = readiness({ structure: true, sources: true, identity: true, relationships: true });
    expect(journeyState({ readiness: ready, conceptCount: 2, hasRecords: false, published: false })).toMatchObject({ current: 'verify', action: { kind: 'prepare' } });
    expect(journeyState({ readiness: ready, conceptCount: 2, hasRecords: true, published: false })).toMatchObject({ current: 'verify', action: { kind: 'review' } });
    const clean = readiness({ structure: true, sources: true, identity: true, relationships: true, quality: true });
    expect(journeyState({ readiness: clean, conceptCount: 2, hasRecords: true, published: false })).toMatchObject({ current: 'publish', action: { kind: 'publish' } });
    expect(journeyState({ readiness: clean, conceptCount: 2, hasRecords: true, published: true })).toMatchObject({ current: null, message: 'journey.publishDone' });
  });
});

describe('ModelJourney', () => {
  it('highlights the current step and runs its single action', () => {
    const onAction = vi.fn();
    const state = journeyState({ readiness: readiness({ structure: true }), conceptCount: 1, hasRecords: false, published: false });
    render(<ModelJourney state={state} canEdit onAction={onAction} />);
    expect(screen.getByText('journey.connect').closest('li')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('journey.connectSources')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'journey.actionConnect' }));
    expect(onAction).toHaveBeenCalledWith({ kind: 'connectSource' });
  });

  it('shows no action to viewers', () => {
    const state = journeyState({ readiness: readiness({}), conceptCount: 0, hasRecords: false, published: false });
    render(<ModelJourney state={state} canEdit={false} onAction={vi.fn()} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
