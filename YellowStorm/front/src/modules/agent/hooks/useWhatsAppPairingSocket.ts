import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';

import { AUTH_STORAGE_KEYS, getSocketBaseUrl } from '@/lib/api/config';
import { getAccessToken } from '@/lib/api/token';

export interface WhatsAppPairingEventPayload {
  agentId: string;
  sessionId: string;
  qrCode?: string;
  pairingCode?: string;
  phoneNumber?: string;
  displayName?: string;
  errorMessage?: string;
}

export interface UseWhatsAppPairingSocketHandlers {
  onQrGenerated?: (payload: WhatsAppPairingEventPayload) => void;
  onConnected?: (payload: WhatsAppPairingEventPayload) => void;
  onDisconnected?: (payload: WhatsAppPairingEventPayload) => void;
  onSessionFailed?: (payload: WhatsAppPairingEventPayload) => void;
}

interface UseWhatsAppPairingSocketParams extends UseWhatsAppPairingSocketHandlers {
  agentId: string | null;
  sessionId: string | null;
  enabled: boolean;
}

export function useWhatsAppPairingSocket({
  agentId,
  sessionId,
  enabled,
  onQrGenerated,
  onConnected,
  onDisconnected,
  onSessionFailed,
}: UseWhatsAppPairingSocketParams): void {
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
    if (!enabled || !agentId || !sessionId) {
      return;
    }

    const token = getAccessToken();
    if (!token) {
      return;
    }

    const socket: Socket = io(`${getSocketBaseUrl()}/whatsapp`, {
      auth: { token },
      transports: ['websocket', 'polling'],
    });

    const matchesSession = (payload: WhatsAppPairingEventPayload) =>
      payload.agentId === agentId && payload.sessionId === sessionId;

    const handleConnect = () => {
      socket.emit('join', { agentId, sessionId });
    };

    socket.on('connect', handleConnect);
    socket.on('whatsapp.qr.generated', (payload: WhatsAppPairingEventPayload) => {
      if (matchesSession(payload)) {
        handlersRef.current.onQrGenerated?.(payload);
      }
    });
    socket.on('whatsapp.connected', (payload: WhatsAppPairingEventPayload) => {
      if (matchesSession(payload)) {
        handlersRef.current.onConnected?.(payload);
      }
    });
    socket.on('whatsapp.disconnected', (payload: WhatsAppPairingEventPayload) => {
      if (matchesSession(payload)) {
        handlersRef.current.onDisconnected?.(payload);
      }
    });
    socket.on('whatsapp.session.failed', (payload: WhatsAppPairingEventPayload) => {
      if (matchesSession(payload)) {
        handlersRef.current.onSessionFailed?.(payload);
      }
    });

    return () => {
      socket.off('connect', handleConnect);
      socket.disconnect();
    };
  }, [agentId, sessionId, enabled]);
}
