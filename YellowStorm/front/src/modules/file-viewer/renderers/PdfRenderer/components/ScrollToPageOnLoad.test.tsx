import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ScrollToPageOnLoad } from './ScrollToPageOnLoad';

const scrollToPageMock = vi.hoisted(() => vi.fn());

vi.mock('@embedpdf/core/react', () => ({
  useCapability: () => ({
    provides: {
      forDocument: () => ({ scrollToPage: scrollToPageMock }),
      onLayoutReady: (cb: (event: { documentId: string; isInitial: boolean }) => void) => {
        cb({ documentId: 'doc-1', isInitial: true });
        return vi.fn();
      },
    },
  }),
}));

describe('ScrollToPageOnLoad', () => {
  it('scrolls to initial page when layout is ready', () => {
    render(<ScrollToPageOnLoad documentId='doc-1' initialPage={7} />);
    expect(scrollToPageMock).toHaveBeenCalledWith({ pageNumber: 7, behavior: 'instant' });
  });
});
