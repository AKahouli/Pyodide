/**
 * Notifications API Functions
 */

import { apiClient, API_ENDPOINTS, ApiResponse } from '@/lib/api';
import type {
  PaginatedNotifications,
  NotificationQueryParams,
  UnreadCountResponse,
  MarkReadResponse,
} from './types';

/**
 * Get notifications for the current user
 */
export async function getNotifications(
  params?: NotificationQueryParams,
): Promise<PaginatedNotifications> {
  const response = await apiClient.get<ApiResponse<PaginatedNotifications>>(
    API_ENDPOINTS.notifications.list,
    { params },
  );
  return response.data.data;
}

/**
 * Get unread notification count
 */
export async function getUnreadCount(): Promise<UnreadCountResponse> {
  const response = await apiClient.get<ApiResponse<UnreadCountResponse>>(
    API_ENDPOINTS.notifications.unreadCount,
  );
  return response.data.data;
}

/**
 * Mark notifications as read
 */
export async function markAsRead(
  notificationIds: string[],
): Promise<MarkReadResponse> {
  const response = await apiClient.patch<ApiResponse<MarkReadResponse>>(
    API_ENDPOINTS.notifications.markRead,
    { notificationIds },
  );
  return response.data.data;
}

/**
 * Mark all notifications as read
 */
export async function markAllAsRead(): Promise<MarkReadResponse> {
  const response = await apiClient.post<ApiResponse<MarkReadResponse>>(
    API_ENDPOINTS.notifications.markAllRead,
  );
  return response.data.data;
}

/**
 * Delete a notification
 */
export async function deleteNotification(
  notificationId: string,
): Promise<void> {
  await apiClient.delete(`${API_ENDPOINTS.notifications.list}/${notificationId}`);
}
