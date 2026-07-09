import { useEffect } from 'react';

import type { AgentWhatsAppIntegration } from '../types';
import { subscribeToWhatsAppIntegrationEvents } from '../stream/whatsapp-integration-sse';

interface UseWhatsAppIntegrationSseOptions {
  agentId: string | null;
  enabled?: boolean;
  onStatus: (integration: AgentWhatsAppIntegration) => void;
}

/**
 * Subscribes to live WhatsApp integration status for one agent.
 * Backend emits the current snapshot on connect and pushes updates on status changes.
 */
export function useWhatsAppIntegrationSse({
  agentId,
  enabled = true,
  onStatus,
}: UseWhatsAppIntegrationSseOptions): void {
  useEffect(() => {
    if (!agentId || !enabled) return;

    return subscribeToWhatsAppIntegrationEvents(agentId, onStatus);
  }, [agentId, enabled, onStatus]);
}
