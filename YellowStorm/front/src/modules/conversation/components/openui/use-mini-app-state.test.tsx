import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchOpenUiAppState, saveOpenUiAppState } from '../../api';
import { useMiniAppState } from './use-mini-app-state';
import type { MiniAppStateIdentity, MiniAppStateSnapshot } from './mini-app-state';
import { validateMiniAppState } from './mini-app-state';

vi.mock('../../api', () => ({ fetchOpenUiAppState: vi.fn(), saveOpenUiAppState: vi.fn() }));
const identity: MiniAppStateIdentity = { userId: 'user-a', conversationId: 'conversation', messageId: 'answer', componentId: 'app', programDigest: 'digest' };
const snapshot = (state: Record<string, unknown> = {}, revision = 0): MiniAppStateSnapshot => ({ schemaVersion: 1, libraryVersion: 'yellowstorm-miniapp-v1', programDigest: identity.programDigest,
  stateRevision: revision, state, updatedAt: null });
const tick = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(500); }); };
const settle = async () => { await act(async () => { await Promise.resolve(); }); };

describe('private mini-app autosave', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.mocked(fetchOpenUiAppState).mockResolvedValue(snapshot()); vi.mocked(saveOpenUiAppState).mockImplementation(async (_, payload) => snapshot(payload.state, payload.expectedRevision + 1)); });
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

  it('flushes before an explicit task and rejects conflicts instead of executing against an unsaved revision', async () => {
    const { result } = renderHook(() => useMiniAppState({ identity, enabled: true })); await settle();
    act(() => result.current.handleStateUpdate({ document: 'doc', count: 0 }));
    let saved: unknown; await act(async () => { saved = await result.current.flush(); });
    expect(saved).toEqual({ programDigest: identity.programDigest, stateRevision: 1 });
    expect(saveOpenUiAppState).toHaveBeenCalledOnce();
    vi.mocked(saveOpenUiAppState).mockRejectedValueOnce({ statusCode: 409 });
    act(() => result.current.handleStateUpdate({ document: 'changed' }));
    await act(async () => { await expect(result.current.flush()).rejects.toThrow('Draft is not saved'); });
    expect(result.current.status).toBe('conflict');
  });

  it('waits for the in-flight write and saves a newer queued input before returning the task revision', async () => {
    let complete!: (value: MiniAppStateSnapshot) => void;
    vi.mocked(saveOpenUiAppState).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const { result } = renderHook(() => useMiniAppState({ identity, enabled: true })); await settle();
    act(() => result.current.handleStateUpdate({ value: 1 })); await tick();
    act(() => result.current.handleStateUpdate({ value: 2 }));
    let promise!: ReturnType<typeof result.current.flush>;
    act(() => { promise = result.current.flush(); });
    await act(async () => { complete(snapshot({ value: 1 }, 1)); await promise; });
    expect(await promise).toEqual({ programDigest: identity.programDigest, stateRevision: 2 });
    expect(vi.mocked(saveOpenUiAppState).mock.calls[1][1].state).toEqual({ value: 2 });
  });

  it('loads typed unsubmitted values and debounces a complete draft without an agent turn', async () => {
    const typed = { zero: 0, enabled: false, blank: '', absent: null, nested: { values: [0, false, null, ''] } };
    vi.mocked(fetchOpenUiAppState).mockResolvedValue(snapshot(typed, 3));
    const { result } = renderHook(() => useMiniAppState({ identity, enabled: true }));
    expect(result.current.ready).toBe(false);
    await settle();
    expect(result.current.initialState).toEqual(typed);
    expect(result.current.ready).toBe(true);
    expect(saveOpenUiAppState).not.toHaveBeenCalled();
    act(() => result.current.handleStateUpdate({ ...typed, zero: 1 }));
    act(() => result.current.handleStateUpdate({ ...typed, zero: 2 }));
    await tick();
    expect(saveOpenUiAppState).toHaveBeenCalledOnce();
    expect(vi.mocked(saveOpenUiAppState).mock.calls[0][1]).toMatchObject({ expectedRevision: 3, state: { ...typed, zero: 2 } });
    expect(result.current.status).toBe('saved');
  });

  it('serializes overlapping changes and saves the latest with the returned revision', async () => {
    let complete!: (value: MiniAppStateSnapshot) => void;
    vi.mocked(saveOpenUiAppState).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const { result } = renderHook(() => useMiniAppState({ identity, enabled: true })); await settle();
    act(() => result.current.handleStateUpdate({ query: 'Tokyo' })); await tick();
    act(() => result.current.handleStateUpdate({ query: 'Osaka' })); await tick();
    expect(saveOpenUiAppState).toHaveBeenCalledOnce();
    await act(async () => complete(snapshot({ query: 'Tokyo' }, 1)));
    await tick();
    expect(saveOpenUiAppState).toHaveBeenCalledTimes(2);
    expect(vi.mocked(saveOpenUiAppState).mock.calls[1][1]).toMatchObject({ expectedRevision: 1, state: { query: 'Osaka' } });
    expect(result.current.status).toBe('saved');
  });

  it('holds conflicts without retry and reapplies only after an explicit reload of the revision', async () => {
    vi.mocked(saveOpenUiAppState).mockRejectedValueOnce({ response: { status: 409 } });
    const { result } = renderHook(() => useMiniAppState({ identity, enabled: true })); await settle();
    act(() => result.current.handleStateUpdate({ price: 0, discount: false })); await tick();
    expect(result.current.status).toBe('conflict');
    await tick(); expect(saveOpenUiAppState).toHaveBeenCalledOnce();
    act(() => result.current.handleStateUpdate({ price: 5, discount: false }));
    vi.mocked(fetchOpenUiAppState).mockResolvedValueOnce(snapshot({ price: 10 }, 7));
    act(() => result.current.reapply()); await settle(); await tick();
    expect(vi.mocked(saveOpenUiAppState).mock.calls[1][1]).toMatchObject({ expectedRevision: 7, state: { price: 5, discount: false } });
    expect(result.current.status).toBe('saved');
  });

  it('discards the local conflict only on reload and blocks forbidden autosaves', async () => {
    vi.mocked(saveOpenUiAppState).mockRejectedValueOnce({ response: { status: 409 } });
    const { result } = renderHook(() => useMiniAppState({ identity, enabled: true })); await settle();
    act(() => result.current.handleStateUpdate({ source: 'private draft' })); await tick();
    vi.mocked(fetchOpenUiAppState).mockResolvedValueOnce(snapshot({ source: 'other tab' }, 2));
    act(() => result.current.reload()); await settle();
    expect(result.current.initialState).toEqual({ source: 'other tab' });
    vi.mocked(saveOpenUiAppState).mockRejectedValueOnce({ response: { status: 403 } });
    act(() => result.current.handleStateUpdate({ source: 'edited' })); await tick();
    expect(result.current.status).toBe('readonly');
    await tick(); expect(saveOpenUiAppState).toHaveBeenCalledTimes(2);
  });

  it('ignores late responses and queued writes across users, answer identities, and unmount', async () => {
    let complete!: (value: MiniAppStateSnapshot) => void;
    vi.mocked(fetchOpenUiAppState).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const { result, rerender, unmount } = renderHook(({ actor }) => useMiniAppState({ identity: { ...identity, userId: actor }, enabled: true }), { initialProps: { actor: 'user-a' } });
    rerender({ actor: 'user-b' }); await settle();
    await act(async () => complete(snapshot({ secret: 'a' }, 9)));
    expect(result.current.initialState).toEqual({});
    act(() => result.current.handleStateUpdate({ secret: 'b' }));
    unmount(); await tick(); expect(saveOpenUiAppState).not.toHaveBeenCalled();
  });

  it('allows retrying a failed load but rejects unsafe drafts before any PUT', async () => {
    vi.mocked(fetchOpenUiAppState).mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useMiniAppState({ identity, enabled: true })); await settle();
    expect(result.current.ready).toBe(false); expect(result.current.status).toBe('error');
    act(() => result.current.reload()); await settle();
    expect(result.current.ready).toBe(true);
    act(() => result.current.handleStateUpdate({ amount: Number.NaN })); await tick();
    expect(result.current.status).toBe('error'); expect(saveOpenUiAppState).not.toHaveBeenCalled();
  });

  it('validates persisted envelopes and does not load or save when disabled', async () => {
    const { result, rerender } = renderHook(({ enabled }) => useMiniAppState({ identity, enabled, fallbackState: { count: 0 } }), { initialProps: { enabled: false } });
    await settle(); expect(result.current.initialState).toEqual({ count: 0 }); expect(fetchOpenUiAppState).not.toHaveBeenCalled();
    vi.mocked(fetchOpenUiAppState).mockResolvedValueOnce({ ...snapshot(), programDigest: 'other-program' });
    rerender({ enabled: true }); await settle();
    expect(result.current.ready).toBe(false); expect(result.current.status).toBe('error');
  });

  it('retries a transport failure with the latest typed draft and the same revision', async () => {
    vi.mocked(saveOpenUiAppState).mockRejectedValueOnce({ statusCode: 503 });
    const { result } = renderHook(() => useMiniAppState({ identity, enabled: true })); await settle();
    act(() => result.current.handleStateUpdate({ count: 0, enabled: false })); await tick();
    expect(result.current.status).toBe('error');
    act(() => result.current.handleStateUpdate({ count: 1, enabled: false }));
    act(() => result.current.retry()); await settle();
    expect(vi.mocked(saveOpenUiAppState).mock.calls[1][1]).toMatchObject({ expectedRevision: 0, state: { count: 1, enabled: false } });
    expect(result.current.status).toBe('saved');
  });

  it('honors an explicit read-only snapshot and rejects inconsistent save acknowledgements', async () => {
    vi.mocked(fetchOpenUiAppState).mockResolvedValueOnce({ ...snapshot({ count: 5 }, 2), canWrite: false });
    const { result } = renderHook(() => useMiniAppState({ identity, enabled: true })); await settle();
    expect(result.current.ready).toBe(true); expect(result.current.status).toBe('readonly');
    act(() => result.current.handleStateUpdate({ count: 6 })); await tick();
    expect(saveOpenUiAppState).not.toHaveBeenCalled();
    act(() => result.current.reload()); await settle();
    vi.mocked(saveOpenUiAppState).mockResolvedValueOnce(snapshot({ count: 999 }, 1));
    act(() => result.current.handleStateUpdate({ count: 0 })); await tick();
    expect(result.current.status).toBe('error');
  });

  it('rejects JSONB-incompatible strings and keys while preserving valid Unicode pairs', () => {
    for (const invalid of ['\u0000', '\uD800', '\uDC00', 'prefix\uD800suffix']) {
      expect(() => validateMiniAppState({ nested: [invalid] })).toThrow('Invalid mini-app state string');
      expect(() => validateMiniAppState({ [invalid]: false })).toThrow('Invalid mini-app state string');
    }
    const unicode = { '\uD83D\uDE80': ['\uD83D\uDE00', 'François 日本語', 0, false, null, ''] };
    expect(validateMiniAppState(unicode)).toEqual(unicode);
  });

  it('keeps validation errors after an in-flight save completes and does not retry', async () => {
    let complete!: (value: MiniAppStateSnapshot) => void;
    vi.mocked(saveOpenUiAppState).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const { result } = renderHook(() => useMiniAppState({ identity, enabled: true })); await settle();
    act(() => result.current.handleStateUpdate({ source: 'valid' })); await tick();
    act(() => result.current.handleStateUpdate({ source: '\u0000' }));
    expect(result.current.status).toBe('error');
    await act(async () => complete(snapshot({ source: 'valid' }, 1)));
    await tick(); await tick();
    expect(result.current.status).toBe('error');
    expect(saveOpenUiAppState).toHaveBeenCalledOnce();
  });
});
