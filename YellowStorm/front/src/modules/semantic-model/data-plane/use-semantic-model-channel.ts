// Feature subscription manager (P2.SB20/SB21): one subscription per mounted
// model view. Signal -> debounced TanStack invalidation -> authorized refetch.
// Reconnect/resume always refetches; Realtime failure falls back to bounded
// polling of the active view. No business writes ever originate here.
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { clearDataGrants, getDataGrant, SemanticDataApiDisabledError } from './data-access-token';
import { isNewerRevision, keysForEvent } from './event-map';
import type { SemanticBroadcastEvent, SemanticBroadcastPayload } from './semantic-api.types';
import { subscribeModelTopic, type RealtimeHandle } from './semantic-realtime-client';

// Coalesce progress storms; terminal states refetch promptly anyway.
const INVALIDATE_DEBOUNCE_MS = 300;
// Bounded fallback while the socket is down (active view only).
const FALLBACK_POLL_MS = 15_000;

export interface ChannelStatus {
  live: boolean;
  polling: boolean;
}

export function useSemanticModelChannel(
  modelId: string | undefined,
  authoritativeRevision?: number | null,
): ChannelStatus {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ChannelStatus>({ live: false, polling: false });
  const liveRef = useRef(false);
  const dataApiRef = useRef(false);
  const revisionRef = useRef<number | null>(null);
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!modelId) return;
    let handle: RealtimeHandle | null = null;
    let cancelled = false;
    liveRef.current = false;
    dataApiRef.current = false;
    revisionRef.current = null;
    setStatus({ live: false, polling: false });

    const setLive = (live: boolean) => {
      liveRef.current = live;
      if (!cancelled) setStatus({ live, polling: !live });
    };

    const invalidate = (event: SemanticBroadcastEvent, payload: SemanticBroadcastPayload) => {
      if (payload.modelId !== modelId) return;
      if (!isNewerRevision(revisionRef.current, payload.dataRevision)) return;
      if (typeof payload.dataRevision === 'number') revisionRef.current = payload.dataRevision;
      for (const key of keysForEvent(modelId, null, event)) {
        void queryClient.invalidateQueries({ queryKey: key as readonly unknown[] });
      }
      if (pendingRef.current) return;
      pendingRef.current = setTimeout(() => {
        pendingRef.current = null;
        if (!cancelled) {
          void queryClient.invalidateQueries({ queryKey: ['semantic-models', 'data-plane', modelId] });
        }
      }, INVALIDATE_DEBOUNCE_MS);
    };

    void getDataGrant(modelId)
      .then((grant) => {
        if (cancelled) return;
        dataApiRef.current = true;
        if (!grant.capabilities.realtime || !grant.realtimeUrl || !grant.topic || !grant.realtimeToken) {
          setLive(false);
          return;
        }
        handle = subscribeModelTopic({
          realtimeUrl: grant.realtimeUrl,
          modelId,
          topic: grant.topic,
          token: grant.realtimeToken,
          refreshToken: () => getDataGrant(modelId).then((fresh) => {
            if (!fresh.realtimeToken) throw new Error('semantic realtime is disabled');
            return fresh.realtimeToken;
          }),
          onSignal: (event, payload) => {
            invalidate(event, payload);
          },
          onStatus: (connected) => {
            // Reconnect/resume always reconciles from the authoritative snapshot.
            if (connected && !cancelled) {
              void queryClient.invalidateQueries({ queryKey: ['semantic-models', 'data-plane', modelId] });
            }
            setLive(connected);
          },
        });
      })
      .catch((error: unknown) => {
        if (error instanceof SemanticDataApiDisabledError) {
          dataApiRef.current = false;
          if (!cancelled) setStatus({ live: false, polling: false });
          return;
        }
        dataApiRef.current = true;
        setLive(false);
      });

    const timer = setInterval(() => {
      if (cancelled || liveRef.current || !dataApiRef.current) return;
      void queryClient.invalidateQueries({ queryKey: ['semantic-models', 'data-plane', modelId] });
    }, FALLBACK_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
      if (pendingRef.current) clearTimeout(pendingRef.current);
      handle?.close();
      clearDataGrants(modelId);
    };
  }, [modelId, queryClient]);

  useEffect(() => {
    if (typeof authoritativeRevision === 'number') {
      revisionRef.current = authoritativeRevision;
    }
  }, [authoritativeRevision]);

  return status;
}
