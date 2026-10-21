import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePinnedConversations } from './usePinnedConversations';
import type { HistoryRow } from '../components/chatGroups';

const auth = vi.hoisted(() => ({ user: { id: 'alice' } }));
const showError = vi.hoisted(() => vi.fn());
vi.mock('@/modules/auth', () => ({ useAuth: () => auth }));
vi.mock('@/lib/notifications', () => ({ showError }));
const row: HistoryRow = { kind: 'v1', id: 'c1', title: 'Pinned chat', sortTime: 123, to: '/conversation/c1', conv: { id: 'c1', title: 'Pinned chat' } };

describe('browser conversation pins', () => {
  beforeEach(() => { localStorage.clear(); auth.user.id = 'alice'; vi.restoreAllMocks(); showError.mockClear(); });

  it('persists navigation metadata, synchronizes consumers, survives remount, and isolates accounts', () => {
    const first = renderHook(usePinnedConversations);
    const second = renderHook(usePinnedConversations);
    act(() => first.result.current.togglePin(row));
    expect(second.result.current.pins).toEqual([{ kind: 'v1', id: 'c1', title: row.title, sortTime: 123, to: row.to }]);
    expect(localStorage.getItem('sidebar:pins:alice')).not.toContain('conv');
    first.unmount();
    const reloaded = renderHook(usePinnedConversations);
    expect(reloaded.result.current.pins).toHaveLength(1);
    auth.user.id = 'bob';
    reloaded.rerender();
    expect(reloaded.result.current.pins).toEqual([]);
    auth.user.id = 'alice';
    reloaded.rerender();
    act(() => reloaded.result.current.renamePin(row, 'Renamed'));
    expect(reloaded.result.current.pins[0].title).toBe('Renamed');
    act(() => reloaded.result.current.togglePin(row));
    expect(reloaded.result.current.pins).toEqual([]);
  });

  it('keeps classic and studio identities separate and removes deleted pins', () => {
    const { result } = renderHook(usePinnedConversations);
    act(() => result.current.togglePin(row));
    act(() => result.current.togglePin({ ...row, kind: 'v2', to: '/studio/c1' }));
    expect(result.current.pins).toHaveLength(2);
    act(() => result.current.unpin(row));
    expect(result.current.pins.map((pin) => pin.to)).toEqual(['/studio/c1']);
  });

  it('ignores corrupt data and reports storage write failures', () => {
    localStorage.setItem('sidebar:pins:alice', '{broken');
    const { result } = renderHook(usePinnedConversations);
    expect(result.current.pins).toEqual([]);
    // Spy on the prototype: jsdom's Storage is a proxy, so an own-property spy
    // on the instance never intercepts the write and the failure path is untested.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota'); });
    act(() => result.current.togglePin(row));
    expect(result.current.pins).toEqual([]);
    expect(showError).toHaveBeenCalledWith('conversations.pinError');
  });
});
