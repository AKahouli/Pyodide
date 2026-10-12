import { beforeEach, expect, it } from 'vitest';
import { initialRootWorkState, useRootWorkStore } from './rootWorkStore';
import type { RootWorkSnapshot } from './types';
const snapshot: RootWorkSnapshot = { epoch: 2, watermark: '0', stopRequestId: 'stop', jobs: [{ executionId: 'job', parentExecutionId: 'root', role: 'followup', status: 'completed', publicationMessageId: 'message', createdAt: '', deadline: '' }] };
beforeEach(() => { useRootWorkStore.setState(initialRootWorkState); localStorage.clear(); });
it('persists individual reading scoped by account and conversation', () => {
  const state = useRootWorkStore.getState(); state.bindUser('a'); state.update('conversation', snapshot);
  expect(useRootWorkStore.getState().unreadPublicationIds.conversation).toEqual(['message']);
  state.markResultRead('conversation', 'message'); state.update('conversation', snapshot);
  expect(useRootWorkStore.getState().unreadPublicationIds.conversation).toEqual([]);
  state.bindUser('b'); state.update('conversation', snapshot);
  expect(useRootWorkStore.getState().unreadPublicationIds.conversation).toEqual(['message']);
  state.bindUser('a'); state.update('conversation', snapshot);
  expect(useRootWorkStore.getState().unreadPublicationIds.conversation).toEqual([]);
});
it('ignores older epochs and clears private state on logout', () => {
  const state = useRootWorkStore.getState(); state.bindUser('a'); state.update('conversation', snapshot);
  state.update('conversation', { ...snapshot, epoch: 1, jobs: [] });
  expect(useRootWorkStore.getState().snapshots.conversation.epoch).toBe(2);
  state.bindUser(null); expect(useRootWorkStore.getState().snapshots).toEqual({});
});
it('retains unread publications through cancellation epoch changes and reload', () => {
  const state = useRootWorkStore.getState(); state.bindUser('a'); state.update('conversation', snapshot);
  state.update('conversation', { ...snapshot, epoch: 3, jobs: [] });
  expect(useRootWorkStore.getState().unreadPublicationIds.conversation).toEqual(['message']);
  useRootWorkStore.setState(initialRootWorkState); state.bindUser('a'); state.update('conversation', { ...snapshot, epoch: 3, jobs: [] });
  expect(useRootWorkStore.getState().unreadPublicationIds.conversation).toEqual(['message']);
  state.registerPublication('conversation', 'older-message');
  expect(useRootWorkStore.getState().unreadPublicationIds.conversation).toEqual(['message', 'older-message']);
  state.markResultRead('conversation', 'message'); state.update('conversation', { ...snapshot, epoch: 4, jobs: [] });
  expect(useRootWorkStore.getState().unreadPublicationIds.conversation).toEqual(['older-message']);
});
