import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReviewQueueItem } from '../../types';
import { ReviewFocusBar } from './ReviewFocusBar';

const item = (key: string, kind: string, action: ReviewQueueItem['action']): ReviewQueueItem => ({ key, group: 'data', priority: 2, kind, params: {}, action });
const broken = item('mapping:m1', 'source_broken', { kind: 'repair_mapping', mappingId: 'm1' });
const choice = item('review:1', 'ambiguous_link', { kind: 'choose_match', reviewItemId: 'r', select: 'target', options: [] });
const missing = item('gap:c1:city', 'missing_values', { kind: 'fix_values', conceptId: 'c1', attribute: 'city' });

describe('ReviewFocusBar', () => {
  it('names the item, its place in the list, and moves to the next one', () => {
    const onOpen = vi.fn(); const onBack = vi.fn();
    render(<ReviewFocusBar item={broken} items={[broken, choice, missing]} onOpen={onOpen} onBack={onBack} onClose={vi.fn()} />);
    expect(screen.getByText('reviewFocus.fixing')).toBeInTheDocument();
    expect(screen.getByText('reviewQueue.kind.source_broken')).toBeInTheDocument();
    // A choice between matches is made in the list, so "next" skips it.
    fireEvent.click(screen.getByRole('button', { name: /reviewFocus\.next/ }));
    expect(onOpen).toHaveBeenCalledWith(missing);
    expect(screen.queryByRole('button', { name: 'reviewFocus.previous' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'reviewFocus.back' }));
    expect(onBack).toHaveBeenCalled();
  });

  it('says when the item is fixed and offers what is left', () => {
    const onOpen = vi.fn();
    render(<ReviewFocusBar item={broken} items={[missing]} onOpen={onOpen} onBack={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('reviewFocus.fixed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /reviewFocus\.next/ }));
    expect(onOpen).toHaveBeenCalledWith(missing);
  });
});
