import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PendingNavigationEffect } from './PendingNavigationEffect';

const scrollToPageMock = vi.hoisted(() => vi.fn());
const startSearchMock = vi.hoisted(() => vi.fn());
const searchAllPagesMock = vi.hoisted(() => vi.fn());

vi.mock('@embedpdf/core/react', () => ({
  useCapability: (name: string) => {
    if (name === 'scroll') {
      return {
        provides: {
          forDocument: () => ({ scrollToPage: scrollToPageMock }),
        },
      };
    }
    if (name === 'search') {
      return {
        provides: {
          startSearch: startSearchMock,
          searchAllPages: searchAllPagesMock,
        },
      };
    }
    return { provides: null };
  },
}));

describe('PendingNavigationEffect', () => {
  it('executes page scroll and search for active tab navigation', () => {
    render(
      <PendingNavigationEffect
        documentId='doc-1'
        tabId='tab-1'
        isActive
        pendingNavigation={{
          tabId: 'tab-1',
          page: 3,
          highlightText: '<page number=3>hello</page>',
        }}
      />,
    );

    expect(scrollToPageMock).toHaveBeenCalledWith({ pageNumber: 3, behavior: 'smooth' });
    expect(startSearchMock).toHaveBeenCalledWith('doc-1');
    expect(searchAllPagesMock).toHaveBeenCalledWith('hello', 'doc-1');
  });
});
