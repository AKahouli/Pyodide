import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SearchControls } from './SearchControls';

const searchAllPagesMock = vi.hoisted(() => vi.fn());
const startSearchMock = vi.hoisted(() => vi.fn());
const stopSearchMock = vi.hoisted(() => vi.fn());
const previousResultMock = vi.hoisted(() => vi.fn());
const nextResultMock = vi.hoisted(() => vi.fn());

vi.mock('@embedpdf/plugin-search/react', () => ({
  useSearch: () => ({
    state: { query: '', total: 2, activeResultIndex: 0, loading: false, active: true },
    provides: {
      searchAllPages: searchAllPagesMock,
      startSearch: startSearchMock,
      stopSearch: stopSearchMock,
      previousResult: previousResultMock,
      nextResult: nextResultMock,
    },
  }),
}));

describe('SearchControls', () => {
  it('starts search and navigates matches', async () => {
    render(<SearchControls documentId='doc-1' />);

    const input = screen.getByPlaceholderText('search.placeholder');
    await userEvent.type(input, 'hello');

    await userEvent.click(screen.getByRole('button', { name: 'search.submit' }));
    expect(startSearchMock).toHaveBeenCalledTimes(1);
    expect(searchAllPagesMock).toHaveBeenCalledWith('hello');

    await userEvent.click(screen.getByRole('button', { name: 'tooltip.previousMatch' }));
    await userEvent.click(screen.getByRole('button', { name: 'tooltip.nextMatch' }));

    expect(previousResultMock).toHaveBeenCalledTimes(1);
    expect(nextResultMock).toHaveBeenCalledTimes(1);
  });

  it('clears search', async () => {
    render(<SearchControls documentId='doc-1' />);
    await userEvent.click(screen.getByRole('button', { name: 'search.clear' }));
    expect(stopSearchMock).toHaveBeenCalled();
  });
});
