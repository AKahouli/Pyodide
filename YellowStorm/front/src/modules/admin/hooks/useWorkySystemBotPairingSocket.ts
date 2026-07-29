import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';

import { AUTH_STORAGE_KEYS, getSocketBaseUrl } from '@/lib/api/config';

export interface WorkySystemBotPairingEventPayload {
  sessionId: string;
  systemBot?: boolean;
  qrCode?: string;
  pairingCode?: string;
  phoneNumber?: string;
  displayName?: string;
  errorMessage?: string;
}

export interface UseWorkySystemBotPairingSocketHandlers {
  onQrGenerated?: (payload: WorkySystemBotPairingEventPayload) => void;
  onConnected?: (payload: WorkySystemBotPairingEventPayload) => void;
  onDisconnected?: (payload: WorkySystemBotPairingEventPayload) => void;
  onSessionFailed?: (payload: WorkySystemBotPairingEventPayload) => void;
}

interface UseWorkySystemBotPairingSocketParams extends UseWorkySystemBotPairingSocketHandlers {
  sessionId: string | null;
  enabled: boolean;
}

export function useWorkySystemBotPairingSocket({
  sessionId,
  enabled,
  onQrGenerated,
  onConnected,
  onDisconnected,
  onSessionFailed,
}: UseWorkySystemBotPairingSocketParams): void {
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
    if (!enabled || !sessionId) {
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

    const matchesSession = (payload: WorkySystemBotPairingEventPayload) =>
      payload.sessionId === sessionId;

    const handleConnect = () => {
      socket.emit('join', { systemBot: true, sessionId });
    };

    socket.on('connect', handleConnect);
    socket.on('whatsapp.qr.generated', (payload: WorkySystemBotPairingEventPayload) => {
      if (matchesSession(payload)) {
        handlersRef.current.onQrGenerated?.(payload);
      }
    });
    socket.on('whatsapp.connected', (payload: WorkySystemBotPairingEventPayload) => {
      if (matchesSession(payload)) {
        handlersRef.current.onConnected?.(payload);
      }
    });
    socket.on('whatsapp.disconnected', (payload: WorkySystemBotPairingEventPayload) => {
      if (matchesSession(payload)) {
        handlersRef.current.onDisconnected?.(payload);
      }
    });
    socket.on('whatsapp.session.failed', (payload: WorkySystemBotPairingEventPayload) => {
      if (matchesSession(payload)) {
        handlersRef.current.onSessionFailed?.(payload);
      }
    });

    return () => {
      socket.off('connect', handleConnect);
      socket.disconnect();
    };
  }, [sessionId, enabled]);
}
