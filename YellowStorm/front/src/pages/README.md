# Pages Module

The pages module provides the main application pages including maintenance mode handling, 404 not found page, and public conversation sharing view.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Directory Structure](#directory-structure)
- [Components](#components)
- [State Management](#state-management)
- [API Integration](#api-integration)
- [Key Features](#key-features)
- [Error Handling](#error-handling)
- [Testing](#testing)

---

## Overview

The pages module handles:

- **Maintenance Mode**: Displays maintenance page with countdown timer and auto-refresh when the application is under maintenance
- **404 Not Found**: User-friendly 404 page for invalid routes
- **Public Conversation Sharing**: Read-only view of shared conversations with view count and metadata

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         PAGES MODULE                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐ │
│  │  Maintenance  │    │   NoMatch    │    │  SharedConv  │ │
│  │     Page      │    │     Page      │    │     Page     │ │
│  └──────┬───────┘    └──────────────┘    └──────┬───────┘ │
│         │                                       │             │
│         │                                       │             │
│         ▼                                       ▼             │
│  ┌──────────────────────────────────────────────┐               │
│  │  Router/Navigation (React Router)        │               │
│  └──────────────────────────────────────────────┘               │
│                                                                │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Technology            | Purpose                                     |
| --------------------- | ------------------------------------------- |
| **React 18**         | Page components with hooks-based architecture |
| **React Router**      | Client-side routing and navigation          |
| **Vitest**           | Unit testing framework                     |
| **Testing Library**   | React component testing utilities           |
| **User Event**       | User interaction simulation               |
| **TypeScript**        | Type safety across module                   |
| **Intl API**          | Internationalized number/date formatting   |

---

## Directory Structure

```
pages/
├── MaintenancePage.tsx          # Maintenance mode page with countdown
├── MaintenancePage.test.tsx     # Unit tests for MaintenancePage
├── NoMatch.tsx                  # 404 not found page
├── SharedConversationPage.tsx     # Public shared conversation viewer
├── SharedConversationPage.test.tsx # Unit tests for SharedConversationPage
└── README.md                    # This file
```

---

## Components

### MaintenancePage

The maintenance page displayed when the application is under maintenance.

**Features:**
- Displays maintenance message from backend
- Countdown timer to estimated end time
- Auto-refresh every 30 seconds to check maintenance status
- "Back to login" button that logs out and clears maintenance state
- Responsive layout centered on screen

**State:**
```typescript
interface MaintenancePageState {
  maintenance: MaintenanceInfo | null;
  checking: boolean;
  countdown: string | null;
}

interface MaintenanceInfo {
  enabled: boolean;
  message: string;
  estimatedEndAt?: string;
}
```

**Countdown Formatting:**
- `> 1 hour`: `{{hours}}h {{minutes}}m {{seconds}}s`
- `< 1 hour, > 0 minutes`: `{{minutes}}m {{seconds}}s`
- `< 1 minute`: `{{seconds}}s`
- Time passed: `Any moment now`

**Auto-Refresh:**
- Polls `/system/maintenance` endpoint every 30 seconds
- When maintenance ends, clears maintenance info and redirects to `/`

### NoMatch

The 404 not found page displayed for invalid routes.

**Features:**
- Large "404" heading
- Translated title and description
- Button to return to home page
- Centered layout with spacing

**Render:**
```tsx
<h2>404</h2>
<h1>Page not found</h1>
<p>The page you're looking for doesn't exist.</p>
<Link to="/">Go back home</Link>
```

### SharedConversationPage

Public read-only view for shared conversations.

**Features:**
- Loads shared conversation data via access token
- Displays conversation title and view count
- Renders all messages with user/assistant roles
- Formatted dates and numbers based on language locale
- "Open app" button to navigate to full application
- Loading and error states
- Filters out null messages from the response

**URL Pattern:**
```
/share/:accessToken
```

**Data Loading:**
```typescript
async function loadShare() {
  const data = await viewPublicShare(accessToken);
  setShare(data);
}
```

**Sub-Components:**

#### ShareMessageBubble

Renders individual messages in the shared conversation view.

**Features:**
- Maps conversation type to role (`user` | `assistant`)
- Uses `components` array for AI messages, falls back to `content` string
- Wrapped in `MessageProvider` for consistent styling
- Filters null messages

**Role Mapping:**
```typescript
const isUser = message.conversationType === 'user';
return {
  id: `share-msg-${index}`,
  role: isUser ? 'user' : 'assistant',
  content,
  timestamp: message.createdAt ? new Date(message.createdAt) : undefined,
};
```

---

## State Management

### MaintenancePage State

Uses `useState` hooks:

```typescript
const [maintenance, setMaintenance] = useState<MaintenanceInfo | null>(null);
const [checking, setChecking] = useState(false);
const [countdown, setCountdown] = useState<string | null>(null);
```

### SharedConversationPage State

Uses `useState` hooks:

```typescript
const [share, setShare] = useState<PublicShareViewResponse | null>(null);
const [error, setError] = useState<string | null>(null);
const [isLoading, setIsLoading] = useState(true);
```

---

## API Integration

### MaintenancePage

**Storage Functions** (`@/lib/api/client`):
```typescript
getMaintenanceInfo(): MaintenanceInfo | null;
  // Reads from sessionStorage
clearMaintenanceInfo(): void;
  // Removes from sessionStorage
```

**API Call:**
```
GET /system/maintenance
Response: { data: { enabled: boolean; message?: string; estimatedEndAt?: string } }
```

### SharedConversationPage

**API Function** (`@/modules/conversation/api`):
```typescript
viewPublicShare(accessToken: string): Promise<PublicShareViewResponse>
```

**URL:** `GET /conversations/public/{accessToken}`

**Response:**
```typescript
interface PublicShareViewResponse {
  id: string;
  title: string;
  sharedBy: string;
  messages: PublicShareMessage[];
  viewCount: number;
  createdAt: string;
}

interface PublicShareMessage {
  conversationType: 'user' | 'ai';
  content?: string;
  components?: MessageComponent[];
  modelId?: string;
  createdAt: string;
}
```

---

## Key Features

### MaintenancePage Features

1. **Countdown Timer**
   - Updates every second using `setInterval`
   - Automatically formats based on remaining time
   - Shows "Any moment now" when time has passed

2. **Auto-Refresh**
   - Polls maintenance endpoint every 30 seconds
   - Clears interval on unmount
   - Redirects to home when maintenance is over

3. **Storage Persistence**
   - Reads maintenance info from `sessionStorage` on mount
   - Clears on logout or when maintenance ends

4. **Graceful Handling**
   - Shows loading state during status check
   - Handles network errors without crashing
   - Translated UI text

### SharedConversationPage Features

1. **Loading States**
   - Shows spinner while fetching share data
   - Displays 404-like page on error
   - Filters null messages from array

2. **Message Rendering**
   - Maps user and AI messages to appropriate roles
   - Uses `components` for AI rich content
   - Falls back to `content` string for simple messages
   - Timestamps displayed as dates

3. **Internationalization**
   - Formats view count using `Intl.NumberFormat`
   - Formats date using `Intl.DateTimeFormat`
   - All text translated via `useModuleTranslation`

4. **Navigation**
   - "Open app" button links to `/`
   - Uses `Link` component from React Router

---

## Error Handling

### MaintenancePage

| Scenario                  | Handling                           |
| ------------------------- | ---------------------------------- |
| No maintenance info       | Page renders normally (no redirect) |
| Maintenance active        | Shows countdown, auto-refresh active |
| Maintenance ended         | Clears storage, redirects to home     |
| Network error on check    | Silently fails, keeps existing state |

### SharedConversationPage

| Scenario                    | Handling                           |
| --------------------------- | ---------------------------------- |
| Loading                    | Shows spinner                      |
| Share loaded successfully   | Renders conversation and messages     |
| Share not found (null)     | Shows 404-like page               |
| Network error              | Shows 404-like page with error     |
| Invalid/expired token      | Shows 404-like page               |

---

## Testing

### MaintenancePage Tests

Located in `MaintenancePage.test.tsx`

**Test Coverage:**
- ✅ Renders maintenance message when info is present
- ✅ Formats countdown with hours when > 1 hour remains
- ✅ Formats countdown with minutes when < 1 hour remains
- ✅ Shows "any moment now" when time has passed
- ✅ Does not show countdown when `estimatedEndAt` is missing
- ✅ Calls logout and clears maintenance info on back button click
- ✅ Polls maintenance status every 30 seconds
- ✅ Redirects to home when maintenance is over
- ✅ Shows translated text using `useModuleTranslation`
- ✅ Cleans up intervals on unmount

**Mocking:**
```typescript
// Hooks
vi.mock('react-router-dom');
vi.mock('@/modules/auth');
vi.mock('@/modules/localization');
vi.mock('@/lib/api/client');

// Timers
vi.useFakeTimers();
```

### SharedConversationPage Tests

Located in `SharedConversationPage.test.tsx`

**Test Coverage:**
- ✅ Shows loading state while fetching share data
- ✅ Renders conversation when share data loads successfully
- ✅ Displays error message when share loading fails
- ✅ Displays error message when share not found
- ✅ Formats view count based on language locale
- ✅ Formats date based on language locale
- ✅ Renders messages with correct role mapping (user/assistant)
- ✅ Calls `viewPublicShare` with access token from URL
- ✅ Does not call API when token is missing
- ✅ Filters out null messages
- ✅ Uses message content directly for user messages
- ✅ Uses components for AI messages with fallback to content
- ✅ Falls back to content string when components array is empty
- ✅ Renders header with title and view count
- ✅ Renders footer with creation date
- ✅ Has link to open app in header
- ✅ Handles missing view count gracefully

**Mocking:**
```typescript
// API
vi.mock('@/modules/conversation/api');

// Utilities
vi.mock('@/modules/conversation/utils');

// Components
vi.mock('@/components/ai-elements/chat-conversation');
vi.mock('@/components/ai-elements/message-context');
vi.mock('@/components/ui/button');

// Localization
vi.mock('@/modules/localization');
```

### Running Tests

From the `front/` directory:

```bash
# Run all page tests
npm test -- src/pages

# Run specific test file
npm test -- src/pages/MaintenancePage.test.tsx
npm test -- src/pages/SharedConversationPage.test.tsx

# Run with coverage
npm test -- src/pages --coverage
```

---

## Usage Example

### Maintenance Mode

The maintenance page is automatically shown when:
1. Backend returns `503` with `MAINTENANCE_MODE` error code
2. Maintenance info is stored in `sessionStorage`
3. User navigates to any route

**Storage Key:** `maintenance_info`

**Storage Format:**
```json
{
  "enabled": true,
  "message": "Scheduled maintenance in progress",
  "estimatedEndAt": "2024-01-01T15:00:00Z"
}
```

### Shared Conversation

Users can access shared conversations via:

```
/share/:accessToken
```

**Example URL:**
```
https://app.example.com/share/abc123-def456-ghi789
```

The page:
1. Extracts `accessToken` from URL params
2. Calls `viewPublicShare(accessToken)`
3. Renders the conversation read-only
4. Shows all messages in chronological order

---

## Accessibility

### MaintenancePage

- Semantic HTML with `<h1>` for title
- ARIA labels for icon buttons
- Proper focus management for "Back to login" button
- Screen reader friendly countdown text

### NoMatch

- Semantic HTML structure
- Clear heading hierarchy (`h2` for 404, `h1` for title)
- Accessible navigation button

### SharedConversationPage

- Proper heading hierarchy
- Semantic list structure for messages
- Accessible link to open app
- Screen reader friendly timestamps

---

## Performance Considerations

### MaintenancePage

- **Timer cleanup:** Intervals cleared on unmount to prevent memory leaks
- **Debounced updates:** Countdown updates once per second, not more frequently
- **Efficient polling:** 30-second interval minimizes server load

### SharedConversationPage

- **Memoized mapping:** Message transformation memoized to avoid unnecessary recalculations
- **Filtered rendering:** Null messages filtered before render to avoid empty components
- **Lazy loading:** Only fetches share data when component mounts with valid token

---

## Future Enhancements

- [ ] Add visual progress bar to maintenance countdown
- [ ] Support custom maintenance themes/branding
- [ ] Add contact support link on shared conversation page
- [ ] Implement share expiration display
- [ ] Add message copying for shared conversations
- [ ] Support dark mode toggle on shared page
- [ ] Add analytics tracking for shared link views
