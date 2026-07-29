import type { AgentWhatsAppIntegration } from '../types';
import { AUTH_STORAGE_KEYS, API_CONFIG, API_ENDPOINTS } from '@/lib/api/config';

export type WhatsAppIntegrationStatusHandler = (integration: AgentWhatsAppIntegration) => void;
export type WhatsAppIntegrationSseUnsubscribe = () => void;

const MAX_RETRY_ATTEMPTS = 6;
const RETRY_BASE_DELAY_MS = 1000;
const RETRY_MAX_DELAY_MS = 30000;

interface SseConfig {
  baseURL: string;
  getAccessToken: () => string | null;
}

const defaultConfig: SseConfig = {
  baseURL: API_CONFIG.baseURL,
  getAccessToken: () => {
    try {
      return window.localStorage.getItem(AUTH_STORAGE_KEYS.accessToken);
    } catch {
      return null;
    }
  },
};

interface WhatsAppIntegrationSseEnvelope {
  type: 'status' | 'heartbeat';
  agentId: string;
  data: AgentWhatsAppIntegration | { timestamp: number };
}

/**
 * SSE client for live agent WhatsApp integration status.
 * Uses fetch + ReadableStream so JWT can be sent in Authorization.
 */
export function subscribeToWhatsAppIntegrationEvents(
  agentId: string,
  onStatus: WhatsAppIntegrationStatusHandler,
  config: SseConfig = defaultConfig,
): WhatsAppIntegrationSseUnsubscribe {
  const controller = new AbortController();
  const url = `${config.baseURL}${API_ENDPOINTS.agents.whatsappEvents(agentId)}`;
  let isStopped = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryAttempts = 0;

  const buildHeaders = (): Record<string, string> => {
    const token = config.getAccessToken();
    const headers: Record<string, string> = { Accept: 'text/event-stream' };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  };

  const scheduleReconnect = (): boolean => {
    if (isStopped || controller.signal.aborted) return false;
    if (retryAttempts >= MAX_RETRY_ATTEMPTS) return false;
    if (retryTimer) clearTimeout(retryTimer);
    retryAttempts += 1;
    const delay = Math.min(
      RETRY_BASE_DELAY_MS * 2 ** (retryAttempts - 1),
      RETRY_MAX_DELAY_MS,
    );
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void connect();
    }, delay);
    return true;
  };

  const connect = async (): Promise<void> => {
    if (isStopped || controller.signal.aborted) return;
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: buildHeaders(),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        if (res.status < 500 && res.status !== 408 && res.status !== 429) return;
        scheduleReconnect();
        return;
      }
      retryAttempts = 0;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let eventName = '';
      let dataLines: string[] = [];

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const raw of lines) {
          const line = raw.replace(/\r$/, '');
          if (line === '') {
            if (dataLines.length === 0 && !eventName) continue;
            const data = dataLines.join('\n');
            if (data) {
              try {
                const envelope = JSON.parse(data) as WhatsAppIntegrationSseEnvelope;
                if (envelope.type === 'status' && envelope.agentId === agentId) {
                  const integration = envelope.data as AgentWhatsAppIntegration;
                  console.log('[WhatsApp integration SSE] status', {
                    agentId,
                    status: integration.status,
                    integration,
                  });
                  onStatus(integration);
                }
              } catch {
                // ignore malformed frames
              }
            }
            eventName = '';
            dataLines = [];
            continue;
          }
          if (line.startsWith('event:')) {
            eventName = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trimStart());
          }
        }
      }
      if (!isStopped) scheduleReconnect();
    } catch {
      if (!isStopped && !controller.signal.aborted) scheduleReconnect();
    }
  };

  void connect();

  return () => {
    isStopped = true;
    if (retryTimer) clearTimeout(retryTimer);
    controller.abort();
  };
}
