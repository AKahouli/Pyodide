import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '../store';
import { useModalCloseEffect } from './useModalCloseEffect';

describe('useModalCloseEffect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  });

  it('calls reset when modal transitions from open to closed', () => {
    const resetFn = vi.fn();
    useWorkspaceStore.setState({ isModalOpen: true });

    renderHook(() => useModalCloseEffect(resetFn));
    expect(resetFn).not.toHaveBeenCalled();

    act(() => {
      useWorkspaceStore.setState({ isModalOpen: false });
    });

    expect(resetFn).toHaveBeenCalledTimes(1);
  });
});
