/**
 * Hook to listen for indexing status notifications and update the document store
 */

import { useEffect, useRef } from 'react';
import { useWorkspaceStore } from '../store';
import { notificationsService, type Notification, type SSEEvent } from '@/modules/notifications';

interface IndexingNotificationData {
  eventType: string;
  documentId: string;
  workspaceId: string;
  indexingStatus: string;
  indexingError?: string;
  lastIndexedAt?: string;
  originalName: string;
}

/**
 * Subscribes directly to SSE events and updates document indexing status in real-time
 */
export function useIndexingNotifications() {
  const updateDocumentIndexingStatus = useWorkspaceStore((state) => state.updateDocumentIndexingStatus);
  const updateRef = useRef(updateDocumentIndexingStatus);
  updateRef.current = updateDocumentIndexingStatus;

  useEffect(() => {
    const handleEvent = (event: SSEEvent) => {
      if (event.type !== 'notification') return;

      const notification = event.data as Notification;
      if (!notification?.metadata) return;
      if (notification.metadata.sourceModule !== 'indexing') return;

      const data = notification.data as IndexingNotificationData | undefined;
      if (!data?.eventType || data.eventType !== 'indexing_status_change') return;

      updateRef.current(data.documentId, data.indexingStatus, data.indexingError, data.lastIndexedAt);
    };

    const unsubscribe = notificationsService.subscribe(handleEvent);

    return () => {
      unsubscribe();
    };
  }, []);
}
