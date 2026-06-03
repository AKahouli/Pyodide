import { useCallback, useEffect, useState } from 'react';
import { useConnectedApps, useConnectedAppStore } from '@/modules/connected-app';
import type { ConnectorOption } from '@/modules/agent/api';

export interface ConnectorConnectionStatus {
  /** True when the connector authenticates through a connected app (OAuth). */
  requiresAuth: boolean;
  connected: boolean;
  connecting: boolean;
}

/**
 * Bridges connectors to the connected-app store so the conversation UI can show
 * connect / connected state. A connector is considered connectable when it
 * declares a `connectedAppKey`; its status mirrors that app's connection.
 */
export function useConnectorConnections() {
  const apps = useConnectedApps();
  const fetchApps = useConnectedAppStore((s) => s.fetchApps);
  const connectApp = useConnectedAppStore((s) => s.connectApp);
  const isInitialized = useConnectedAppStore((s) => s.isInitialized);
  // Track the specific connector being connected so only its button spins —
  // several connectors can share one connectedAppKey, but the click is per-row.
  const [connectingId, setConnectingId] = useState<string | null>(null);

  useEffect(() => {
    if (!isInitialized) void fetchApps();
  }, [isInitialized, fetchApps]);

  const getStatus = useCallback(
    (connector: Pick<ConnectorOption, 'id' | 'connectedAppKey'>): ConnectorConnectionStatus => {
      const appKey = connector.connectedAppKey;
      if (!appKey) {
        return { requiresAuth: false, connected: true, connecting: false };
      }
      const app = apps.find((a) => a.appKey === appKey);
      return {
        requiresAuth: true,
        connected: Boolean(app?.connected),
        connecting: connectingId === connector.id,
      };
    },
    [apps, connectingId],
  );

  const connect = useCallback(
    async (connector: Pick<ConnectorOption, 'id' | 'connectedAppKey'>): Promise<boolean> => {
      if (!connector.connectedAppKey) return true;
      setConnectingId(connector.id);
      try {
        return await connectApp(connector.connectedAppKey);
      } finally {
        setConnectingId(null);
      }
    },
    [connectApp],
  );

  return { getStatus, connect };
}
