# Notifications Module (Frontend)

The notifications module provides real-time notification delivery via Server-Sent Events (SSE), with automatic reconnection, heartbeat monitoring, and a React Context for state management.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Directory Structure](#directory-structure)
- [Types](#types)
- [NotificationsService](#notificationsservice)
- [API Layer](#api-layer)
- [React Context](#react-context)
- [SSE Events](#sse-events)
- [Connection Management](#connection-management)
- [Usage Examples](#usage-examples)
- [Error Handling](#error-handling)

---

## Overview

The notifications module provides:

- **Real-time Delivery**: SSE-based push notifications from server to client
- **Automatic Reconnection**: Exponential backoff with max 10 attempts
- **Heartbeat Monitoring**: Detects stale connections (30s timeout)
- **Toast Integration**: Automatic toast display for incoming notifications
- **State Management**: React Context with notifications list and unread count
- **CRUD Operations**: Fetch, mark as read, delete notifications via API
- **Multi-Tab Handling**: Graceful handling of "too many tabs" scenarios

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      NOTIFICATIONS MODULE (Frontend)                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                         REACT COMPONENTS                              │   │
│  │                                                                       │   │
│  │   NotificationBell      NotificationList      NotificationItem       │   │
│  │          │                     │                     │                │   │
│  │          └─────────────────────┼─────────────────────┘                │   │
│  │                                │                                      │   │
│  │                                ▼                                      │   │
│  │                    ┌─────────────────────┐                           │   │
│  │                    │  useNotifications() │                           │   │
│  │                    └─────────────────────┘                           │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                   │                                          │
│                                   ▼                                          │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                    NOTIFICATIONS CONTEXT                              │   │
│  │                                                                       │   │
│  │  State:                           Actions:                            │   │
│  │  ├─ notifications: Notification[] ├─ markAsRead(ids)                 │   │
│  │  ├─ unreadCount: number           ├─ markAllAsRead()                 │   │
│  │  ├─ isConnected: boolean          ├─ deleteNotification(id)          │   │
│  │  ├─ isLoading: boolean            ├─ refreshNotifications()          │   │
│  │  └─ error: string | null          └─ clearError()                    │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                    │                              │                          │
│                    │                              │                          │
│                    ▼                              ▼                          │
│  ┌────────────────────────────┐    ┌────────────────────────────┐          │
│  │   NotificationsService     │    │        API Layer           │          │
│  │      (SSE Client)          │    │                            │          │
│  │                            │    │  getNotifications()        │          │
│  │  ├─ connect()              │    │  getUnreadCount()          │          │
│  │  ├─ disconnect()           │    │  markAsRead()              │          │
│  │  ├─ subscribe(listener)    │    │  markAllAsRead()           │          │
│  │  ├─ reconnectWithNewToken()│    │  deleteNotification()      │          │
│  │  └─ heartbeat monitoring   │    │                            │          │
│  └────────────┬───────────────┘    └────────────┬───────────────┘          │
│               │                                  │                          │
│               │     SSE Stream                   │     REST API             │
│               ▼                                  ▼                          │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                    BACKEND (/api/v1/notifications)                    │   │
│  │                                                                       │   │
│  │  GET  /stream          ← SSE connection (real-time)                  │   │
│  │  GET  /                ← List notifications (paginated)              │   │
│  │  GET  /unread-count    ← Get unread count                            │   │
│  │  PATCH /mark-read      ← Mark specific as read                       │   │
│  │  POST  /mark-all-read  ← Mark all as read                            │   │
│  │  DELETE /:id           ← Delete notification                         │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Technology | Purpose |
|------------|---------|
| **React 18** | UI framework with Context API |
| **EventSource** | Native SSE client for real-time events |
| **TypeScript** | Type-safe development |
| **Axios** | HTTP client for REST API calls |
| **Sonner** | Toast notifications |

---

## Directory Structure

```
notifications/
├── index.ts                  # Public exports
├── types.ts                  # TypeScript interfaces
├── api.ts                    # REST API functions
├── NotificationsService.ts   # SSE client singleton
├── NotificationsContext.tsx  # React Context provider
└── README.md                 # This documentation
```

---

## Types

### Core Types

```typescript
// Notification type categories
type NotificationType = 'info' | 'warning' | 'error' | 'success' | 'system';

// Notification delivery status
type NotificationStatus = 'pending' | 'sent' | 'failed' | 'read';

// Priority levels
type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';
```

### Notification Interface

```typescript
interface Notification {
  id: string;
  userId?: string;
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  actions?: NotificationAction[];
  destination: string;
  status: NotificationStatus;
  metadata: NotificationMetadata;
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
  readAt?: string;
}

interface NotificationAction {
  label?: string;
  url?: string;
  action?: string;
}

interface NotificationMetadata {
  sourceModule: string;
  priority: NotificationPriority;
  expiresAt?: string;
  extra?: Record<string, unknown>;
}
```

### SSE Event Types

```typescript
type SSEEventType =
  | 'notification'    // New notification received
  | 'connected'       // Successfully connected
  | 'heartbeat'       // Keep-alive signal
  | 'error'           // Connection error
  | 'reconnecting'    // Attempting reconnection
  | 'disconnected'    // Connection closed
  | 'evicted';        // Kicked due to too many tabs

interface SSEEvent {
  type: SSEEventType;
  data?:
    | Notification
    | {
        connectionId?: string;
        timestamp?: string;
        attempt?: number;
        maxAttempts?: number;
        reason?: string;
        message?: string;
      };
}
```

### Context Types

```typescript
interface NotificationsState {
  notifications: Notification[];
  unreadCount: number;
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
}

interface NotificationsContextType extends NotificationsState {
  markAsRead: (notificationIds: string[]) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  deleteNotification: (notificationId: string) => Promise<void>;
  refreshNotifications: () => Promise<void>;
  clearError: () => void;
}
```

---

## NotificationsService

A singleton service managing the SSE connection to the backend.

### Configuration

```typescript
class NotificationsService {
  // Connection limits
  private readonly maxReconnectAttempts = 10;
  private readonly baseReconnectDelay = 1000;   // 1 second
  private readonly maxReconnectDelay = 60000;   // 1 minute
  private readonly heartbeatTimeout = 30000;    // 30 seconds
}
```

### Public Methods

| Method | Description |
|--------|-------------|
| `connect()` | Establish SSE connection |
| `disconnect()` | Close connection and clear timers |
| `subscribe(listener)` | Subscribe to events, returns unsubscribe function |
| `getIsConnected()` | Check connection status |
| `getConnectionId()` | Get current connection ID |
| `reconnectWithNewToken()` | Reconnect after token refresh |

### Connection Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    CONNECTION LIFECYCLE                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  connect() called                                                │
│         │                                                        │
│         ▼                                                        │
│  ┌─────────────────┐                                            │
│  │ Check if evicted │──── YES ──► Return (don't reconnect)      │
│  └────────┬────────┘                                            │
│           │ NO                                                   │
│           ▼                                                      │
│  ┌─────────────────┐                                            │
│  │ Get access token │──── MISSING ──► Emit error, return        │
│  └────────┬────────┘                                            │
│           │ FOUND                                                │
│           ▼                                                      │
│  Create EventSource with token query param                       │
│         │                                                        │
│         ▼                                                        │
│  Setup event handlers (connected, heartbeat, notification, error)│
│         │                                                        │
│         ▼                                                        │
│  ┌─────────────────┐                                            │
│  │   onopen fires   │                                           │
│  │ Reset reconnect  │                                           │
│  │    attempts      │                                           │
│  └────────┬────────┘                                            │
│           │                                                      │
│           ▼                                                      │
│  Wait for 'connected' event from server                          │
│         │                                                        │
│         ▼                                                        │
│  ┌─────────────────┐                                            │
│  │  isConnected =  │                                            │
│  │      true       │                                            │
│  │ Start heartbeat │                                            │
│  │     timer       │                                            │
│  └─────────────────┘                                            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Reconnection Strategy

Exponential backoff with jitter:

```
Attempt 1: 1s delay
Attempt 2: 2s delay
Attempt 3: 4s delay
Attempt 4: 8s delay
Attempt 5: 16s delay
Attempt 6: 32s delay
Attempt 7+: 60s delay (max)
```

After 10 failed attempts, stops trying and emits error event.

### Heartbeat Monitoring

```
┌─────────────────────────────────────────────────────────────────┐
│                    HEARTBEAT MONITORING                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Server sends heartbeat every 15 seconds                         │
│                                                                  │
│  Client sets 30-second timeout after each heartbeat              │
│                                                                  │
│  If timeout fires before next heartbeat:                         │
│    1. Connection assumed stale                                   │
│    2. disconnect() called                                        │
│    3. scheduleReconnect() called                                 │
│                                                                  │
│  If heartbeat received:                                          │
│    1. Timer reset to 30 seconds                                  │
│    2. Connection confirmed healthy                               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## API Layer

### Functions

| Function | Method | Endpoint | Description |
|----------|--------|----------|-------------|
| `getNotifications(params?)` | GET | `/notifications` | Fetch paginated notifications |
| `getUnreadCount()` | GET | `/notifications/unread-count` | Get unread count |
| `markAsRead(ids)` | PATCH | `/notifications/mark-read` | Mark specific notifications as read |
| `markAllAsRead()` | POST | `/notifications/mark-all-read` | Mark all as read |
| `deleteNotification(id)` | DELETE | `/notifications/:id` | Delete a notification |

### Query Parameters

```typescript
interface NotificationQueryParams {
  page?: number;
  limit?: number;
  status?: NotificationStatus;
  type?: NotificationType;
  unreadOnly?: boolean;
}
```

### Response Types

```typescript
interface PaginatedNotifications {
  notifications: Notification[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

interface UnreadCountResponse {
  count: number;
}

interface MarkReadResponse {
  updated: number;
}
```

---

## React Context

### NotificationsProvider

Wraps the application to provide notification state and actions:

```tsx
import { NotificationsProvider } from '@/modules/notifications';

function App() {
  return (
    <NotificationsProvider showToasts={true}>
      <YourApp />
    </NotificationsProvider>
  );
}
```

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `ReactNode` | - | Child components |
| `showToasts` | `boolean` | `true` | Auto-show toast for new notifications |

### Provider Behavior

1. **On mount** (when authenticated):
   - Subscribe to NotificationsService events
   - Connect to SSE stream
   - Fetch initial notifications (limit: 50)
   - Fetch unread count

2. **On notification event**:
   - Add to notifications array (max 100)
   - Increment unread count
   - Show toast based on notification type and priority

3. **On unmount** (or logout):
   - Unsubscribe from events
   - Disconnect SSE stream
   - Reset state

### useNotifications Hook

```typescript
const {
  // State
  notifications,    // Notification[]
  unreadCount,      // number
  isConnected,      // boolean
  isLoading,        // boolean
  error,            // string | null

  // Actions
  markAsRead,       // (ids: string[]) => Promise<void>
  markAllAsRead,    // () => Promise<void>
  deleteNotification, // (id: string) => Promise<void>
  refreshNotifications, // () => Promise<void>
  clearError,       // () => void
} = useNotifications();
```

---

## SSE Events

### Event Handling

| Event | Action |
|-------|--------|
| `connected` | Set `isConnected: true`, clear error |
| `disconnected` | Set `isConnected: false` |
| `notification` | Add to list, increment count, show toast |
| `reconnecting` | Set `isConnected: false` |
| `error` | Set error state, `isConnected: false` |
| `evicted` | Set error "Too many tabs", stop reconnecting |

### Toast Mapping

Notifications display toasts based on type:

| Notification Type | Toast Function | Duration |
|-------------------|----------------|----------|
| `info` | `toast.info()` | 5s (10s if urgent) |
| `warning` | `toast.warning()` | 5s (10s if urgent) |
| `error` | `toast.error()` | 5s (10s if urgent) |
| `success` | `toast.success()` | 5s (10s if urgent) |
| `system` | `toast.info()` | 5s (10s if urgent) |

---

## Connection Management

### Multi-Tab Handling

When too many tabs are open (server limit exceeded):

```
┌─────────────────────────────────────────────────────────────────┐
│                    TOO MANY TABS FLOW                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  User opens new tab                                              │
│         │                                                        │
│         ▼                                                        │
│  connect() called                                                │
│         │                                                        │
│         ▼                                                        │
│  Server sends error event: { code: 'TOO_MANY_TABS' }            │
│         │                                                        │
│         ▼                                                        │
│  Client handles error:                                           │
│    1. Set isEvicted = true (prevents reconnection)              │
│    2. Set isConnected = false                                    │
│    3. Show warning toast                                         │
│    4. Emit 'error' event to listeners                           │
│         │                                                        │
│         ▼                                                        │
│  User closes other tabs and calls reconnectWithNewToken()        │
│         │                                                        │
│         ▼                                                        │
│  isEvicted reset to false, connection attempted                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Token Refresh

When access token is refreshed:

```typescript
// In auth module after token refresh
notificationsService.reconnectWithNewToken();
```

This resets reconnection attempts and the evicted flag.

---

## Usage Examples

### Basic Usage

```tsx
import { useNotifications } from '@/modules/notifications';

function NotificationBell() {
  const { unreadCount, isConnected } = useNotifications();

  return (
    <button className="relative">
      <BellIcon />
      {unreadCount > 0 && (
        <span className="badge">{unreadCount}</span>
      )}
      {!isConnected && (
        <span className="offline-indicator" />
      )}
    </button>
  );
}
```

### Notification List

```tsx
import { useNotifications } from '@/modules/notifications';

function NotificationList() {
  const {
    notifications,
    isLoading,
    markAsRead,
    deleteNotification,
  } = useNotifications();

  const handleClick = async (notification: Notification) => {
    if (notification.status !== 'read') {
      await markAsRead([notification.id]);
    }
    // Handle notification action
  };

  if (isLoading) {
    return <Spinner />;
  }

  return (
    <ul>
      {notifications.map((notification) => (
        <li
          key={notification.id}
          className={notification.status === 'read' ? 'read' : 'unread'}
          onClick={() => handleClick(notification)}
        >
          <h4>{notification.title}</h4>
          <p>{notification.message}</p>
          <button onClick={() => deleteNotification(notification.id)}>
            Delete
          </button>
        </li>
      ))}
    </ul>
  );
}
```

### Mark All as Read

```tsx
import { useNotifications } from '@/modules/notifications';

function NotificationHeader() {
  const { unreadCount, markAllAsRead } = useNotifications();

  return (
    <div className="header">
      <h3>Notifications</h3>
      {unreadCount > 0 && (
        <button onClick={markAllAsRead}>
          Mark all as read
        </button>
      )}
    </div>
  );
}
```

### Connection Status

```tsx
import { useNotifications } from '@/modules/notifications';

function ConnectionStatus() {
  const { isConnected, error, clearError } = useNotifications();

  if (error) {
    return (
      <div className="error">
        <span>{error}</span>
        <button onClick={clearError}>Dismiss</button>
      </div>
    );
  }

  return (
    <div className={isConnected ? 'connected' : 'disconnected'}>
      {isConnected ? 'Connected' : 'Disconnected'}
    </div>
  );
}
```

### Direct Service Access

```typescript
import { notificationsService } from '@/modules/notifications';

// Subscribe to raw events
const unsubscribe = notificationsService.subscribe((event) => {
  if (event.type === 'notification') {
    console.log('New notification:', event.data);
  }
});

// Check connection status
const isConnected = notificationsService.getIsConnected();

// Get connection ID
const connectionId = notificationsService.getConnectionId();

// Manual reconnect
notificationsService.reconnectWithNewToken();

// Cleanup
unsubscribe();
```

---

## Error Handling

### Error States

| Error | Cause | Recovery |
|-------|-------|----------|
| `"Connection error"` | SSE connection failed | Auto-reconnect up to 10 times |
| `"Too many tabs open"` | Server connection limit | Close tabs, call `reconnectWithNewToken()` |
| `"Failed to fetch notifications"` | API request failed | Call `refreshNotifications()` |
| `"Failed to mark notifications as read"` | API request failed | Toast shown, error thrown |
| `"Failed to delete notification"` | API request failed | Toast shown, error thrown |

### Error Recovery

```tsx
function NotificationsWithRecovery() {
  const { error, refreshNotifications, clearError } = useNotifications();

  if (error) {
    return (
      <div className="error-state">
        <p>{error}</p>
        <button onClick={refreshNotifications}>Retry</button>
        <button onClick={clearError}>Dismiss</button>
      </div>
    );
  }

  // Normal render...
}
```

### Logging

The NotificationsService logs connection events to console:

```
[NotificationsService] Connection opened
[NotificationsService] Connected: { connectionId: "..." }
[NotificationsService] Heartbeat: 2024-01-16T10:00:00Z
[NotificationsService] Notification received: { ... }
[NotificationsService] Connection error: ...
[NotificationsService] Reconnecting in 2000ms (attempt 2/10)
[NotificationsService] Connection evicted, not reconnecting
```

---

## Integration

### With Auth Module

The context connects/disconnects based on auth state:

```tsx
// Inside NotificationsProvider
const { isAuthenticated, user } = useAuth();

React.useEffect(() => {
  if (!isAuthenticated || !user) {
    notificationsService.disconnect();
    // Reset state...
    return;
  }

  // Connect and fetch...
}, [isAuthenticated, user]);
```

### Provider Placement

Place `NotificationsProvider` inside `AuthProvider`:

```tsx
function App() {
  return (
    <AuthProvider>
      <NotificationsProvider showToasts={true}>
        <Router>
          <Routes />
        </Router>
      </NotificationsProvider>
    </AuthProvider>
  );
}
```
