import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HighlightOnLoad } from './HighlightOnLoad';

const startSearchMock = vi.hoisted(() => vi.fn());
const searchAllPagesMock = vi.hoisted(() => vi.fn());

vi.mock('@embedpdf/core/react', () => ({
  useCapability: () => ({
    provides: {
      forDocument: () => ({ startSearch: startSearchMock, searchAllPages: searchAllPagesMock }),
    },
  }),
}));

describe('HighlightOnLoad', () => {
  it('starts search and re-runs when document changes', () => {
    const { rerender } = render(<HighlightOnLoad documentId='doc-1' text='needle' />);

    const initialCalls = startSearchMock.mock.calls.length;
    expect(initialCalls).toBeGreaterThan(0);
    expect(searchAllPagesMock).toHaveBeenCalledWith('needle');

    rerender(<HighlightOnLoad documentId='doc-2' text='needle' />);
    expect(startSearchMock.mock.calls.length).toBeGreaterThan(initialCalls);
  });
});
