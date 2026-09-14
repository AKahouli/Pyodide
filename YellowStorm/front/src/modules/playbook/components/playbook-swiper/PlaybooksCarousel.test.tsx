import { act, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PlaybooksCarousel } from './PlaybooksCarousel';

const store = vi.hoisted(() => {
  type State = {
    playbooks: unknown[];
    playbooksLoading: boolean;
    playbooksPagination: null | { page: number; totalPages: number };
    fetchPlaybooks: ReturnType<typeof vi.fn>;
    fetchMorePlaybooks: ReturnType<typeof vi.fn>;
  };
  let state: State;
  const listeners = new Set<() => void>();

  return {
    get state() {
      return state;
    },
    reset() {
      state = {
        playbooks: [],
        playbooksLoading: false,
        playbooksPagination: null,
        fetchPlaybooks: vi.fn(),
        fetchMorePlaybooks: vi.fn(),
      };
      listeners.forEach((listener) => listener());
    },
    set(patch: Partial<State>) {
      state = { ...state, ...patch };
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
});

vi.mock('@/modules/playbook/store', async () => {
  const React = await import('react');
  const select = <T,>(selector: (state: typeof store.state) => T) =>
    React.useSyncExternalStore(store.subscribe, () => selector(store.state));

  return {
    usePlaybookStore: select,
    usePlaybooks: () => select((state) => state.playbooks),
    usePlaybooksLoading: () => select((state) => state.playbooksLoading),
  };
});

vi.mock('embla-carousel-react', () => ({ default: () => [vi.fn(), null] }));
vi.mock('./Header', () => ({ Header: () => null }));
vi.mock('./PlaybookCard', () => ({ PlaybookCard: () => null }));
vi.mock('./VisibilityDots', () => ({ VisibilityDots: () => null }));

describe('PlaybooksCarousel fetching', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    store.reset();
  });

  it('waits one minute before retrying a failed initial request', async () => {
    store.state.fetchPlaybooks.mockImplementation(async () => {
      store.set({ playbooksLoading: true });
      await new Promise((resolve) => window.setTimeout(resolve, 1));
      store.set({ playbooksLoading: false });
    });

    render(<MemoryRouter><PlaybooksCarousel /></MemoryRouter>);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(store.state.fetchPlaybooks).toHaveBeenCalledOnce();
    await act(() => vi.advanceTimersByTimeAsync(1));

    await act(() => vi.advanceTimersByTimeAsync(59_999));
    expect(store.state.fetchPlaybooks).toHaveBeenCalledOnce();

    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(store.state.fetchPlaybooks).toHaveBeenCalledTimes(2);
  });

  it('does not poll after a successful empty response', async () => {
    store.state.fetchPlaybooks.mockImplementation(async () => {
      store.set({ playbooksLoading: true });
      await new Promise((resolve) => window.setTimeout(resolve, 1));
      store.set({
        playbooksLoading: false,
        playbooksPagination: { page: 1, totalPages: 0 },
      });
    });

    render(<MemoryRouter><PlaybooksCarousel /></MemoryRouter>);
    await act(() => vi.advanceTimersByTimeAsync(0));
    await act(() => vi.advanceTimersByTimeAsync(1));
    await act(() => vi.advanceTimersByTimeAsync(5 * 60_000));

    expect(store.state.fetchPlaybooks).toHaveBeenCalledOnce();
  });
});
