import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';

import { AUTH_STORAGE_KEYS, getSocketBaseUrl } from '@/lib/api/config';

export interface WorkyWhatsAppPairingEventPayload {
  streamId: string;
  sessionId: string;
  qrCode?: string;
  pairingCode?: string;
  phoneNumber?: string;
  displayName?: string;
  errorMessage?: string;
}

export interface UseWorkyWhatsAppPairingSocketHandlers {
  onQrGenerated?: (payload: WorkyWhatsAppPairingEventPayload) => void;
  onConnected?: (payload: WorkyWhatsAppPairingEventPayload) => void;
  onDisconnected?: (payload: WorkyWhatsAppPairingEventPayload) => void;
  onSessionFailed?: (payload: WorkyWhatsAppPairingEventPayload) => void;
}

interface UseWorkyWhatsAppPairingSocketParams extends UseWorkyWhatsAppPairingSocketHandlers {
  streamId: string | null;
  sessionId: string | null;
  enabled: boolean;
}

export function useWorkyWhatsAppPairingSocket({
  streamId,
  sessionId,
  enabled,
  onQrGenerated,
  onConnected,
  onDisconnected,
  onSessionFailed,
}: UseWorkyWhatsAppPairingSocketParams): void {
  const handlersRef = useRef({
    onQrGenerated,
    onConnected,
    onDisconnected,
    onSessionFailed,
  });
  handlersRef.current = {
    onQrGenerated,
    onConnected,
    onDisconnected,
    onSessionFailed,
  };

  useEffect(() => {
    if (!enabled || !streamId || !sessionId) {
      return;
    }

    const token = localStorage.getItem(AUTH_STORAGE_KEYS.accessToken);
    if (!token) {
      return;
    }

    const socket: Socket = io(`${getSocketBaseUrl()}/whatsapp`, {
      auth: { token },
      transports: ['websocket', 'polling'],
    });

    const matchesSession = (payload: WorkyWhatsAppPairingEventPayload) =>
      payload.streamId === streamId && payload.sessionId === sessionId;

    const handleConnect = () => {
      socket.emit('join', { streamId, sessionId });
    };

    socket.on('connect', handleConnect);
    socket.on('whatsapp.qr.generated', (payload: WorkyWhatsAppPairingEventPayload) => {
      if (matchesSession(payload)) {
        handlersRef.current.onQrGenerated?.(payload);
      }
    });
    socket.on('whatsapp.connected', (payload: WorkyWhatsAppPairingEventPayload) => {
      if (matchesSession(payload)) {
        handlersRef.current.onConnected?.(payload);
      }
    });
    socket.on('whatsapp.disconnected', (payload: WorkyWhatsAppPairingEventPayload) => {
      if (matchesSession(payload)) {
        handlersRef.current.onDisconnected?.(payload);
      }
    });
    socket.on('whatsapp.session.failed', (payload: WorkyWhatsAppPairingEventPayload) => {
      if (matchesSession(payload)) {
        handlersRef.current.onSessionFailed?.(payload);
      }
    });

    return () => {
      socket.off('connect', handleConnect);
      socket.disconnect();
    };
  }, [streamId, sessionId, enabled]);
}
