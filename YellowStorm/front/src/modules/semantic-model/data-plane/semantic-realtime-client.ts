// One feature-scoped Realtime wrapper (P2.SB20). Private model topics only;
// no public channels, no raw client in components. Delivery is a hint:
// every signal resolves to a snapshot refetch by the caller.
import { RealtimeClient, type RealtimeChannel } from '@supabase/realtime-js';
import type { SemanticBroadcastEvent, SemanticBroadcastPayload } from './semantic-api.types';
import { parseSignal } from './event-map';

export type SignalHandler = (event: SemanticBroadcastEvent, payload: SemanticBroadcastPayload) => void;
export type StatusHandler = (connected: boolean) => void;

const KNOWN_EVENTS: SemanticBroadcastEvent[] = [
  'data-revision-changed',
  'datasource-status-changed',
  'review-items-changed',
  'population-status-changed',
  'model-read-state-changed',
];

export interface RealtimeHandle {
  close(): void;
  isConnected(): boolean;
}

function socketEndpoint(realtimeUrl: string): string {
  return realtimeUrl.endsWith('/socket') ? realtimeUrl : `${realtimeUrl.replace(/\/$/, '')}/socket`;
}

/**
 * Subscribe to a private model topic. Reports connection via subscribe status;
 * the hook additionally polls isConnected() for fallback switching.
 */
export function subscribeModelTopic(options: {
  realtimeUrl: string;
  modelId: string;
  topic: string;
  token: string;
  /** Fresh token supplier for reconnects/resubscribes (backend TTL is ~60s). */
  refreshToken: () => Promise<string>;
  onSignal: SignalHandler;
  onStatus: StatusHandler;
}): RealtimeHandle {
  const socket = new RealtimeClient(socketEndpoint(options.realtimeUrl), {
    params: { apikey: options.token },
    // Source of truth across resubscribes: join payloads always carry a fresh token.
    accessToken: () => options.refreshToken(),
  });
  let closed = false;
  const channel: RealtimeChannel = socket.channel(options.topic, {
    config: { broadcast: { ack: true, self: false }, private: true },
  });
  channel.on('broadcast', { event: '*' }, (frame) => {
    const payload = parseSignal(frame);
    if (!payload) return;
    const event = (frame as { event?: string }).event;
    if (typeof event === 'string' && (KNOWN_EVENTS as string[]).includes(event)) {
      options.onSignal(event as SemanticBroadcastEvent, payload);
    }
  });
  // Connection failures surface through the subscribe callback below.
  socket.connect();
  channel.subscribe((status) => {
    if (closed) return;
    options.onStatus(status === 'SUBSCRIBED');
  });
  return {
    close() {
      closed = true;
      options.onStatus(false);
      void channel.unsubscribe().then(
        () => socket.disconnect(),
        () => socket.disconnect(),
      );
    },
    isConnected() {
      return socket.isConnected();
    },
  };
}
