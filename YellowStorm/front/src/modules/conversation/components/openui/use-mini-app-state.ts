import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchOpenUiAppState, saveOpenUiAppState } from '../../api';
import { miniAppStateSignature, validateMiniAppSnapshot, validateMiniAppState } from './mini-app-state';
import type { MiniAppStateIdentity } from './mini-app-state';

export type MiniAppSaveStatus = 'loading' | 'saved' | 'unsaved' | 'saving' | 'error' | 'conflict' | 'readonly';
interface Options {
  identity: MiniAppStateIdentity;
  enabled: boolean;
  fallbackState?: Record<string, unknown>;
}

function httpStatus(error: unknown): number | undefined {
  const typed = error as { statusCode?: number; response?: { status?: number } };
  return typed?.statusCode ?? typed?.response?.status;
}

/** One private answer draft. No browser storage, inference, or automatic conflict overwrite. */
export function useMiniAppState({ identity, enabled, fallbackState = {} }: Options) {
  const key = JSON.stringify([identity.userId, identity.conversationId, identity.messageId, identity.componentId, identity.programDigest, enabled]);
  const [view, setView] = useState<{ key: string; ready: boolean; initialState: Record<string, unknown>; status: MiniAppSaveStatus; error: unknown; mountRevision: number }>({
    key, ready: !enabled, initialState: fallbackState, status: enabled ? 'loading' : 'saved', error: null, mountRevision: 0,
  });
  const session = useRef<{ key: string; active: boolean; revision: number; saved: string; draft?: Record<string, unknown>; busy: boolean; blocked: boolean; timer?: ReturnType<typeof setTimeout> }>({ key: '', active: false, revision: 0, saved: '', busy: false, blocked: true });
  const [reloadCount, setReloadCount] = useState(0);
  const reapplyDraft = useRef<{ key: string; state: Record<string, unknown> } | undefined>(undefined);
  const fallback = useRef(fallbackState); fallback.current = fallbackState;

  useEffect(() => {
    const controller = new AbortController();
    const current = { key, active: true, revision: 0, saved: '', busy: false, blocked: true } as typeof session.current;
    session.current = current;
    if (!enabled) {
      setView(previous => ({ key, ready: true, initialState: fallback.current, status: 'saved', error: null, mountRevision: previous.mountRevision + 1 }));
      return () => { current.active = false; };
    }
    setView(previous => ({ ...previous, key, ready: false, status: 'loading', error: null }));
    void fetchOpenUiAppState(identity, controller.signal).then(raw => {
      if (!current.active) return;
      const snapshot = validateMiniAppSnapshot(raw, identity.programDigest);
      current.revision = snapshot.stateRevision;
      current.saved = miniAppStateSignature(snapshot.state);
      current.blocked = snapshot.canWrite === false;
      // Revision zero has no persisted draft; retain accepted submission hydration.
      const retained = reapplyDraft.current?.key === key ? reapplyDraft.current.state : undefined;
      const initial = retained ?? (snapshot.stateRevision === 0 ? fallback.current : snapshot.state);
      current.draft = retained;
      reapplyDraft.current = undefined;
      setView(previous => ({ key, ready: true, initialState: initial, status: current.blocked ? 'readonly' : current.draft ? 'unsaved' : 'saved', error: null, mountRevision: previous.mountRevision + 1 }));
      if (current.draft && !current.blocked) current.timer = setTimeout(() => void save(current), 500);
    }).catch(error => {
      if (!current.active) return;
      setView(previous => ({ ...previous, key, ready: httpStatus(error) === 403, initialState: fallback.current,
        status: httpStatus(error) === 403 ? 'readonly' : 'error', error }));
    });
    async function save(active: typeof current): Promise<void> {
      if (!active.active || active.busy || active.blocked || !active.draft) return;
      const draft = active.draft;
      if (miniAppStateSignature(draft) === active.saved) {
        setView(previous => ({ ...previous, status: 'saved', error: null })); return;
      }
      active.busy = true;
      setView(previous => ({ ...previous, status: 'saving', error: null }));
      try {
        const snapshot = validateMiniAppSnapshot(await saveOpenUiAppState(identity, { schemaVersion: 1, libraryVersion: 'yellowstorm-miniapp-v1', programDigest: identity.programDigest,
          expectedRevision: active.revision, state: draft }, controller.signal), identity.programDigest);
        if (!active.active) return;
        if (snapshot.stateRevision !== active.revision + 1 || miniAppStateSignature(snapshot.state) !== miniAppStateSignature(draft)) {
          throw new Error('Invalid mini-app save acknowledgement');
        }
        active.revision = snapshot.stateRevision;
        active.saved = miniAppStateSignature(draft);
        if (active.blocked) return;
        setView(previous => ({ ...previous, status: miniAppStateSignature(active.draft) === active.saved ? 'saved' : 'unsaved', error: null }));
      } catch (error) {
        if (!active.active) return;
        active.blocked = true;
        setView(previous => ({ ...previous, status: httpStatus(error) === 409 ? 'conflict' : httpStatus(error) === 403 ? 'readonly' : 'error', error }));
      } finally {
        active.busy = false;
        if (active.active && !active.blocked && miniAppStateSignature(active.draft) !== active.saved) active.timer = setTimeout(() => void save(active), 500);
      }
    }
    saveRef.current = () => save(current);
    return () => { current.active = false; controller.abort(); clearTimeout(current.timer); };
    // The scalar key contains every scope field; fallback changes must not reset an edited draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reloadCount]);
  const saveRef = useRef<() => Promise<void>>(async () => {});
  const handleStateUpdate = useCallback((state: Record<string, unknown>) => {
    const current = session.current;
    if (!enabled || !current.active || current.key !== key) return;
    try {
      current.draft = validateMiniAppState(state);
      if (current.blocked) return;
      clearTimeout(current.timer);
      setView(previous => ({ ...previous, status: current.busy ? 'saving' : 'unsaved', error: null }));
      current.timer = setTimeout(() => void saveRef.current(), 500);
    } catch (error) {
      current.blocked = true;
      setView(previous => ({ ...previous, status: 'error', error }));
    }
  }, [enabled, key]);
  const reload = useCallback(() => { reapplyDraft.current = undefined; setReloadCount(value => value + 1); }, []);
  const reapply = useCallback(() => {
    const current = session.current;
    reapplyDraft.current = current.draft ? { key: current.key, state: current.draft } : undefined;
    setReloadCount(value => value + 1);
  }, []);
  const retry = useCallback(() => {
    const current = session.current;
    if (view.status !== 'error') return;
    if (!view.ready) { setReloadCount(value => value + 1); return; }
    current.blocked = false;
    void saveRef.current();
  }, [view.ready, view.status]);
  return { ...view, ready: view.key === key && view.ready, handleStateUpdate, reload, reapply, retry };
}
