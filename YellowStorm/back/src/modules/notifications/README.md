# Notifications Module

Real-time notifications system using Server-Sent Events (SSE) for push notifications from backend to frontend.

## Overview

This module provides:
- SSE connection for real-time push notifications
- Heartbeat every 15 seconds to keep connections alive
- MongoDB storage for notification persistence and auditing
- Multi-tab support (max 10 connections per user, new connections refused after limit)
- Broadcast notifications to all connected users

## Architecture

```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│  Other Modules  │────▶│ NotificationsService │────▶│ NotificationsGateway │
│  (Auth, Usage)  │     │   (Business Logic)   │     │  (SSE Connections)   │
└─────────────────┘     └──────────────────────┘     └─────────────────┘
                                   │                          │
                                   ▼                          ▼
                        ┌──────────────────┐         ┌─────────────────┐
                        │     MongoDB      │         │  Frontend SSE   │
                        │  (Persistence)   │         │   Connections   │
                        └──────────────────┘         └─────────────────┘
```

## API Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/notifications/stream?token=JWT` | SSE stream | Token in query |
| GET | `/notifications` | List notifications (paginated) | JWT |
| GET | `/notifications/unread/count` | Get unread count | JWT |
| PATCH | `/notifications/read` | Mark notifications as read | JWT |
| POST | `/notifications/read-all` | Mark all as read | JWT |
| DELETE | `/notifications/:id` | Delete notification | JWT |
| GET | `/notifications/stats` | Connection statistics | JWT |

## SSE Events

The SSE stream emits events as JSON objects with `type` and `data` fields:

```typescript
// Connection established
{ type: 'connected', data: { connectionId: string, timestamp: string } }

// Heartbeat (every 15 seconds)
{ type: 'heartbeat', data: { timestamp: string } }

// New notification
{ type: 'notification', data: Notification }
```

### Frontend Implementation Note

The SSE events are delivered as generic `message` events with the event structure JSON-encoded in the `data` field. Frontend code should use the `onmessage` handler to parse and route events:

```typescript
eventSource.onmessage = (event) => {
  const parsed = JSON.parse(event.data);
  const eventType = parsed.type;
  const eventData = typeof parsed.data === 'string'
    ? JSON.parse(parsed.data)
    : parsed.data;

  switch (eventType) {
    case 'connected':
      // Handle connection
      break;
    case 'notification':
      // Handle notification
      break;
    // ...
  }
};
```

## Usage

### Sending Notifications from Other Modules

```typescript
import { NotificationsService } from '../notifications';
import { NotificationType, NotificationPriority } from '../notifications/schemas/notification.schema';

@Injectable()
export class YourService {
  constructor(
    private readonly notificationsService: NotificationsService,
  ) {}

  async someMethod(userId: string) {
    // Send to specific user
    await this.notificationsService.sendToUser(userId, {
      type: NotificationType.INFO,
      title: 'Welcome!',
      message: 'Your account has been created successfully.',
      data: { customKey: 'customValue' }, // Optional payload
      actions: [
        { label: 'View Profile', url: '/profile', action: 'navigate' },
      ],
      metadata: {
        sourceModule: 'auth',
        priority: NotificationPriority.NORMAL,
      },
    });

    // Broadcast to all connected users
    await this.notificationsService.broadcast({
      type: NotificationType.SYSTEM,
      title: 'Scheduled Maintenance',
      message: 'System will be down for maintenance in 30 minutes.',
      metadata: {
        sourceModule: 'system',
        priority: NotificationPriority.URGENT,
      },
    });
  }
}
```

### Notification Types

```typescript
enum NotificationType {
  INFO = 'info',       // General information
  WARNING = 'warning', // Warning messages
  ERROR = 'error',     // Error notifications
  SUCCESS = 'success', // Success confirmations
  SYSTEM = 'system',   // System announcements
}
```

### Notification Priorities

```typescript
enum NotificationPriority {
  LOW = 'low',
  NORMAL = 'normal',
  HIGH = 'high',
  URGENT = 'urgent',
}
```

### Check if User is Connected

```typescript
const isOnline = this.notificationsService.isUserConnected(userId);
```

### Get Connection Statistics

```typescript
const stats = this.notificationsService.getConnectionStats();
// { total: 42, byUser: 35 }
```

## Notification Schema

```typescript
{
  userId?: ObjectId;           // Target user (null for broadcast)
  type: NotificationType;      // info, warning, error, success, system
  title: string;               // Max 200 chars
  message: string;             // Max 2000 chars
  data?: object;               // Custom payload for frontend
  actions?: [{                 // Action buttons
    label?: string;
    url?: string;
    action?: string;
  }];
  destination: string;         // userId, 'broadcast', or 'role:admin'
  status: NotificationStatus;  // pending, sent, failed, read
  metadata: {
    sourceModule: string;      // Module that sent the notification
    priority: NotificationPriority;
    expiresAt?: Date;          // TTL for auto-cleanup
    extra?: object;
  };
  createdAt: Date;
  updatedAt: Date;
  sentAt?: Date;
  readAt?: Date;
}
```

## Configuration

Environment variables:

```env
NOTIFICATION_TTL_DAYS=30                      # Auto-delete after N days
NOTIFICATION_MAX_CONNECTIONS_PER_USER=10      # Max SSE connections per user (new connections refused after limit)
NOTIFICATION_HEARTBEAT_INTERVAL_MS=15000      # Heartbeat interval
NOTIFICATION_MAX_PAYLOAD_SIZE_BYTES=10240     # Max data payload size
```

## Security

1. **SSE Authentication**: JWT validated from query parameter (EventSource limitation)
2. **Session Validation**: Checks session is still valid before accepting connection
3. **Connection Limits**: Max 10 concurrent connections per user (new connections refused after limit)
4. **Content Sanitization**: HTML/script stripped from notification content
5. **Payload Size Limit**: Max 10KB per notification data payload

## Error Codes

| Code | Name | Description |
|------|------|-------------|
| ERR_1800 | NOTIFICATION_NOT_FOUND | Notification not found |
| ERR_1801 | NOTIFICATION_FORBIDDEN | No access to notification |
| ERR_1802 | NOTIFICATION_INVALID_DESTINATION | Invalid destination |
| ERR_1803 | NOTIFICATION_PAYLOAD_TOO_LARGE | Data exceeds max size |
| ERR_1804 | NOTIFICATION_SSE_CONNECTION_LIMIT | Max connections reached |
| ERR_1805 | NOTIFICATION_SSE_CONNECTION_FAILED | Connection failed |
| ERR_1806 | NOTIFICATION_RATE_LIMITED | Rate limit exceeded |

## Database Indexes

```typescript
{ userId: 1, status: 1, createdAt: -1 }  // User notifications query
{ destination: 1, status: 1 }             // Broadcast queries
{ 'metadata.expiresAt': 1 }               // TTL auto-cleanup
{ createdAt: -1 }                         // Recent notifications
{ status: 1, retryCount: 1 }              // Failed notification retry
```

## Frontend Integration

The frontend connects to the SSE stream on authentication:

```typescript
// Connect
const url = `${API_URL}/notifications/stream?token=${accessToken}`;
const eventSource = new EventSource(url);

// Handle events
eventSource.addEventListener('notification', (event) => {
  const notification = JSON.parse(event.data);
  // Display notification
});

eventSource.addEventListener('heartbeat', () => {
  // Connection is alive
});
```

## Module Exports

```typescript
import {
  NotificationsModule,
  NotificationsService,
  NotificationsGateway,
  NotificationType,
  NotificationStatus,
  NotificationPriority,
} from './modules/notifications';
```
