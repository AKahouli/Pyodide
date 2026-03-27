/**
 * useModalCloseEffect
 * Hook to reset component state when the parent modal closes.
 * Prevents portal cleanup issues with nested dialogs.
 */

import { useEffect } from 'react';
import { useWorkspaceStore } from '../store';

/**
 * Executes a reset function when the modal closes.
 * Use this in components that have dialogs/state that should be reset when the parent modal closes.
 */
export function useModalCloseEffect(resetFn: () => void) {
  const isModalOpen = useWorkspaceStore((state) => state.isModalOpen);

  useEffect(() => {
    if (!isModalOpen) {
      resetFn();
    }
  }, [isModalOpen, resetFn]);
}
