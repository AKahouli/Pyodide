import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useRequestInputState } from './useRequestInputState';
import { useRootInputUiStore, initialRootInputUiState } from '../rootInputUiStore';

vi.mock('@/modules/auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'owner' } }) }));
beforeEach(() => useRootInputUiStore.setState(initialRootInputUiState));
it('keeps waiting/sending/continuing local to the authorized originating request', () => {
  const key = 'execution:2:ask:1';
  useRootInputUiStore.setState({ scope: 'owner:conversation', roots: [{ executionId: 'execution', epoch: 2,
    originAssistantMessageId: 'message', inputs: [{ inputId: 'ask', kind: 'input' }] }] });
  const hook = renderHook(() => useRequestInputState('conversation', 'message'));
  expect(hook.result.current).toBe('waiting');
  act(() => useRootInputUiStore.setState({ submitting: [key] }));
  expect(hook.result.current).toBe('sending');
  act(() => useRootInputUiStore.setState({ submitting: [], submitted: [key] }));
  expect(hook.result.current).toBe('continuing');
  act(() => useRootInputUiStore.setState({ roots: [] }));
  expect(hook.result.current).toBeUndefined();
});
it('never attaches a question to an unrelated message or another owner scope', () => {
  useRootInputUiStore.setState({ scope: 'other:conversation', roots: [{ executionId: 'execution', epoch: 2,
    originAssistantMessageId: 'message', inputs: [{ inputId: 'ask', kind: 'input' }] }] });
  expect(renderHook(() => useRequestInputState('conversation', 'message')).result.current).toBeUndefined();
  useRootInputUiStore.setState({ scope: 'owner:conversation' });
  expect(renderHook(() => useRequestInputState('conversation', 'other-message')).result.current).toBeUndefined();
});
