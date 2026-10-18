/**
 * NotificationsService - SSE-based real-time notifications
 * Handles connection management, reconnection with exponential backoff,
 * and event distribution
 */

import { API_CONFIG, getAccessToken } from "@/lib/api";
import type { Notification, SSEEvent, SSEEventType } from "./types";
import { toast } from "sonner";
import { i18nInstance } from '@/modules/localization/i18nInstance';

export function tNotification(key: string, fallback: string) {
  if (i18nInstance.isInitialized) {
    const result = i18nInstance.t(key, { ns: 'notifications', defaultValue: fallback });
    return result;
  }
  return fallback;
}

type NotificationListener = (event: SSEEvent) => void;

/**
 * Service class for managing SSE connection to notifications endpoint
 */
export class NotificationsService {
  private eventSource: EventSource | null = null;
  private listeners: Set<NotificationListener> = new Set();
  private reconnectAttempts = 0;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private isConnected = false;
  private connectionId: string | null = null;
  private isEvicted = false; // Prevents reconnection when evicted due to connection limit

  // Configuration
  private readonly maxReconnectAttempts = 10;
  private readonly baseReconnectDelay = 1000; // 1 second
  private readonly maxReconnectDelay = 60000; // 1 minute
  private readonly heartbeatTimeout = 30000; // 30 seconds (heartbeat every 15s + buffer)
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private connectedToastTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Connect to SSE stream
   */
  connect(): void {
    if (document.visibilityState === 'hidden') {
      this.pause();
      return;
    }
    // Don't reconnect if evicted due to connection limit
    if (this.isEvicted) {
      return;
    }

    const token = getAccessToken();
    toast.loading(tNotification("service.toasts.connecting", "Connecting to real time notification services"), { id: "sse-connection" });
    if (!token) {
      console.warn(
        "[NotificationsService] No token available, skipping connection"
      );
      this.emit({ type: "error", data: { connectionId: "no-token" } });
      return;
    }

    if (this.eventSource) {
      this.disconnect();
    }

    const url = `${
      API_CONFIG.baseURL
    }${"/notifications/stream"}?token=${encodeURIComponent(token)}`;
    try {
      this.eventSource = new EventSource(url);
      this.setupEventHandlers();
    } catch (error) {
      toast.error(tNotification("service.toasts.connectionFailed", "Failed to connect to real time services"), {
        id: "sse-connection",
      });
      console.error(
        "[NotificationsService] Failed to create EventSource:",
        error
      );
      this.scheduleReconnect();
    }
  }

  /**
   * Disconnect from SSE stream
   */
  disconnect(): void {
    this.clearTimers();

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    this.isConnected = false;
    this.connectionId = null;
    this.reconnectAttempts = 0;

    this.emit({ type: "disconnected" });
  }

  /** Release only this passive pipe; active agent streams have separate owners. */
  pause(): void {
    this.disconnect();
    toast.dismiss('sse-connection');
  }

  /**
   * Subscribe to notification events
   * @returns Unsubscribe function
   */
  subscribe(listener: NotificationListener): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Check if connected
   */
  getIsConnected(): boolean {
    return this.isConnected;
  }

  /**
   * Get current connection ID
   */
  getConnectionId(): string | null {
    return this.connectionId;
  }

  /**
   * Reconnect with new token (after token refresh)
   */
  reconnectWithNewToken(): void {
    this.reconnectAttempts = 0; // Reset attempts on manual reconnect
    this.isEvicted = false; // Allow reconnection on manual request
    this.connect();
  }

  // ==================== Private Methods ====================

  private setupEventHandlers(): void {
    if (!this.eventSource) return;
    const source = this.eventSource;
    const current = () => this.eventSource === source && document.visibilityState !== 'hidden';

    source.onopen = () => {
      if (!current() || this.isEvicted) return;
      this.connectedToastTimer = setTimeout(() => {
        if (!current()) return;
        toast.success(tNotification("service.toasts.connected", "Connected to real time notification services"), {
          id: "sse-connection", duration:700
        });
      }, 500);
      this.reconnectAttempts = 0;
    };

    source.onerror = (error) => {
      if (!current()) return;
      console.error("[NotificationsService] Connection error:", error);
      this.isConnected = false;

      if (this.isEvicted) {
        // Stop everything — native auto-retry must not proceed
        this.eventSource?.close();
        this.eventSource = null;
        return;
      }

      if (!this.eventSource) return;

      if (this.eventSource.readyState === EventSource.CONNECTING) {
        // Browser is auto-retrying — intercept and use our backoff logic instead
        this.eventSource.close();
        this.eventSource = null;
        this.scheduleReconnect();
      } else if (this.eventSource.readyState === EventSource.CLOSED) {
        this.eventSource = null;
        this.scheduleReconnect();
      }
    };

    // Handle all messages - NestJS SSE sends MessageEvent objects as JSON in the data field
    // instead of using the SSE event: field for named events
    source.onmessage = (event) => {
      if (!current()) return;
      try {
        const parsed = JSON.parse(event.data);

        // Check if this is a wrapped MessageEvent with type and data fields
        if (parsed.type && parsed.data !== undefined) {
          const eventType = parsed.type;
          const eventData = typeof parsed.data === 'string' ? JSON.parse(parsed.data) : parsed.data;

          switch (eventType) {
            case 'connected':
              this.connectionId = eventData.connectionId;
              this.isConnected = true;
              this.resetHeartbeatTimer();
              this.emit({ type: "connected", data: eventData });
              break;

            case 'heartbeat':
              this.resetHeartbeatTimer();
              break;

            case 'notification':
              this.emit({ type: "notification", data: eventData as Notification });
              break;

            case 'error':
              console.warn("[NotificationsService] Server error:", eventData);
              if (eventData.code === "TOO_MANY_TABS") {
                // Close EventSource immediately to prevent native auto-reconnect
                this.eventSource?.close();
                this.eventSource = null;
                this.isEvicted = true;
                this.isConnected = false;
                this.clearTimers();
                toast.dismiss("sse-connection");
                toast.warning(tNotification("service.toasts.tooManyTabs", "Too many tabs open"), {
                  description: eventData.message || tNotification("service.toasts.tooManyTabsDescription", "Please close some tabs and refresh this page."),
                  duration: 10000,
                });
                this.emit({ type: "evicted", data: eventData });
              }
              break;
          }
        }
      } catch (error) {
        console.error("[NotificationsService] Failed to parse SSE message:", error);
      }
    };
  }

  private resetHeartbeatTimer(): void {
    if (document.visibilityState === 'hidden') return;
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
    }

    this.heartbeatTimer = setTimeout(() => {
      this.disconnect();
      this.scheduleReconnect();
    }, this.heartbeatTimeout);
  }

  private scheduleReconnect(): void {
    if (document.visibilityState === 'hidden') return;
    if (this.isEvicted) {
      return;
    }

    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelay
    );

    // Retry indefinitely: a backend restart can outlast any finite attempt
    // budget. The counter only shapes the backoff curve and stops growing at
    // the cap, so a late recovery resets to fast retries via onopen.
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
    }

    this.emit({
      type: "reconnecting",
      data: {
        attempt: this.reconnectAttempts,
        maxAttempts: this.maxReconnectAttempts,
      },
    });

    this.reconnectTimeout = setTimeout(() => {
      this.connect();
    }, delay);
  }

  private clearTimers(): void {
    if (this.connectedToastTimer) {
      clearTimeout(this.connectedToastTimer);
      this.connectedToastTimer = null;
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private emit(event: SSEEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("[NotificationsService] Listener error:", error);
      }
    }
  }
}

// Singleton instance
export const notificationsService = new NotificationsService();
