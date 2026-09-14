# Conversation Module

The conversation module provides the complete AI chat experience, handling real-time streaming responses, message management, branch navigation, agent mentioning, workspace linking, conversation sharing, and user interactions.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Directory Structure](#directory-structure)
- [State Management](#state-management)
- [Streaming System](#streaming-system)
- [Components](#components)
- [Hooks](#hooks)
- [API Layer](#api-layer)
- [Types](#types)
- [Key Features](#key-features)
- [Data Flow](#data-flow)
- [Sticky Agent Routing](#sticky-agent-routing)
- [Performance Optimizations](#performance-optimizations)
- [Reply to a Message](#reply-to-a-message)
- [Mention notifications & tracking](#mention-notifications--tracking)

---

## Overview

The conversation module is a self-contained feature module that handles:

- **AI Chat Conversations**: Create, view, update, and delete conversations
- **Real-time Streaming**: SSE-based streaming for AI responses with chunk-by-chunk rendering
- **Message Management**: Send messages, receive AI responses, provide feedback
- **File Attachments**: Upload files to conversations with progress tracking, previews, and file viewer integration
- **Agent & Member Mentioning**: Tag agents or group members with `@` mentions to route messages or notify specific participants; group **member** mentions emit SSE `mention_created`, sidebar badges, and jump-to-mention UI (see [Mention notifications & tracking](#mention-notifications--tracking))
- **Sticky Agent Routing**: After an `@agent` mention, the backend keeps those agents on the conversation (`taggedAgentIds`) and reuses them on later turns without tags
- **Shared Agents**: In group conversations, agents tagged by any member are shared and accessible to all participants in the conversation
- **Branch Navigation**: Support for regenerating responses and navigating between response branches
- **Message Management**: Send messages, receiving AI responses, and provide feedback. Support for **Message Editing** with automatic AI response regeneration.
- **Workspace Linking**: Associate conversations with workspaces and access workspace documents
- **Conversation Sharing**: Public and private sharing with configurable expiration
- **Timing Metrics**: Display response timing (time to first chunk, time to first token, total duration)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CONVERSATION MODULE                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                   │
│  │  Components  │◄──►│    Store     │◄──►│    API       │                   │
│  │  (React UI)  │    │   (Zustand)  │    │   (Axios)    │                   │
│  └──────┬───────┘    └──────┬───────┘    └──────────────┘                   │
│         │                   │                                                │
│         │                   ▼                                                │
│         │            ┌──────────────┐    ┌──────────────┐                   │
│         │            │   Stream     │    │ Agent Module │                   │
│         │            │  Service     │    │ (useAgents)  │                   │
│         │            │    (SSE)     │    └──────────────┘                   │
│         │            └──────┬───────┘                                        │
│         │                   │                                                │
│         ▼                   ▼                                                │
│  ┌──────────────────────────────────────────────────────┐                   │
│  │                    Backend (NestJS)                   │                   │
│  │  - REST API for CRUD operations                       │                   │
│  │  - SSE endpoint for real-time streaming               │                   │
│  │  - gRPC connection to AI service                      │                   │
│  │  - Agent resolution per message                       │                   │
│  └──────────────────────────────────────────────────────┘                   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Technology            | Purpose                                     |
| --------------------- | ------------------------------------------- |
| **React 18**          | UI components with hooks-based architecture |
| **Zustand**           | State management with devtools middleware   |
| **EventSource (SSE)** | Real-time server-sent events for streaming  |
| **Axios**             | HTTP client for REST API calls              |
| **TypeScript**        | Type safety across the module               |
| **Radix UI**          | Accessible UI primitives (via Shadcn/ui)    |
| **Lucide React**      | Icons                                       |
| **Sonner**            | Toast notifications                         |

---

## Directory Structure

```
conversation/
├── index.ts                    # Module exports
├── api.ts                      # API functions (Axios calls)
├── store.ts                    # Zustand store with all state and actions
├── stream.ts                   # SSE streaming service (ConversationStreamService)
├── types.ts                    # TypeScript interfaces
├── utils.ts                    # Helper functions (mappers, formatters)
├── ConversationPage.tsx        # Main entry/dispatcher page (decides between simple vs group)
├── GroupConversationPage.tsx     # Specialized UI for group chat interactions
├── NewConversationPage.tsx       # New conversation landing page (supports agent selection)
├── components/
│   ├── ConversationHeader.tsx  # Header with title, rename, delete, share, workspaces
│   ├── ConversationContent.tsx # Message list for 1v1 chats (simple layout)
│   ├── GroupConversationContent.tsx # Message list for group chats (grid layout + avatars)
│   ├── ConversationInput.tsx   # Message input with file attachments, agent mentions
│   ├── MessageAttachments.tsx  # File attachment display in sent messages
│   ├── MessageActions.tsx      # AI message actions (like, dislike, copy, regenerate)
│   ├── UserMessageActions.tsx  # User message actions (edit)
│   ├── TimingIndicator.tsx     # Response timing display with tooltip
│   ├── BranchNavigation.tsx    # Navigate between response branches
│   ├── EditableUserMessage.tsx # Inline message editing
│   ├── StreamErrorDialog.tsx   # Critical error modal with retry
│   ├── DeleteConversationDialog.tsx
│   ├── RenameDialog.tsx
│   ├── ReportDialog.tsx
│   ├── JoinConversationLanding.tsx # Landing page for invited users
│   ├── LoadingIndicator.tsx    # Loading dots animation
│   ├── ParentMessagePreview.tsx # Preview of the message being replied to
│   ├── MentionMessageJump.tsx # Floating “jump to mention” control (group chats)
│   ├── NotFound.tsx            # 404 state
│   └── SketchBoard/
│       ├── index.ts               # Barrel export
│       ├── useDrawingCanvas.ts    # Canvas 2D drawing hook
│       ├── SketchBoardDialog.tsx  # Drawing dialog modal
│       ├── SketchBoardDialog.test.tsx  # Dialog actions (cancel/export)
│       ├── SketchBoardToolbar.tsx # Toolbar (tools, colors, size, bg)
│       └── SketchBoardToolbar.test.tsx # Toolbar interactions
├── hooks/
│   ├── useConversationStream.ts  # SSE connection hook
│   ├── useConversationFileUpload.ts # File upload orchestration hook
│   └── useTypewriter.ts          # Typewriter animation hook
├── effects/
│   └── stars-background.tsx      # Background visual effect
└── types/
    └── index.ts                  # Additional type exports
```

**Shared input components** (in `src/components/ai-elements/`):

| Component                | Description                                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `input.tsx`              | Core textarea with `@` mention detection, mention tracking, file upload callbacks, and agent creation                                                   |
| `mention-popup.tsx`      | Searchable agent picker popup grouped by "My Agents" / "Default Agents"                                                                                 |
| `input-context-menu.tsx` | Right-click context menu with "Mention agent" and "Create agent" options                                                                                |
| `prompt-input.tsx`       | Prompt input wrapper with file attachment support (drag/drop, paste, file dialog), upload status overlays, and `onFilesAdded`/`onFileRemoved` callbacks |
| `model-selector.tsx`     | Model selection dropdown                                                                                                                                |

---

## State Management

The module uses **Zustand** for state management with the following structure:

### Store Structure (`store.ts`)

```typescript
interface ConversationState {
  // Conversation list
  conversations: Conversation[];
  conversationsTotal: number;
  conversationsHasMore: boolean;
  conversationsLoading: boolean;
  historyPanelOpen: boolean;

  // Current conversation
  currentConversationId: string | null;
  currentConversation: Conversation | null;
  conversationLoading: boolean;

  // Messages
  messages: Message[];
  messagesTotal: number;
  messagesLoading: boolean;
  messagesLoadingOlder: boolean;
  messagesHasMore: boolean;

  // Streaming state
  streamingConversationId: string | null;
  streamingMessageId: string | null;
  streamingQuestionMessageId: string | null;
  streamingComponents: StreamingComponent[];
  isStreaming: boolean;

  // Send state
  isAwaitingFirstChunk: boolean;
  optimisticMessages: Message[];

  // SSE connection
  sseStatus: SSEConnectionStatus;
  sseError: string | null;

  // Branch navigation
  branchCache: Map<string, Message[]>;
  activeBranches: Map<string, string>;
  editingMessageId: string | null;
  replyingToMessage: Message | null;

  // Error handling
  criticalError: { code: string; message: string } | null;
  inputDisabled: boolean;

  // Model selection
  selectedModelId: string | null;

  // Actions
  onMentionCreated: (event: { conversationId: string; messageId: string; userId: string }) => void;
  markMentionSeen: (conversationId: string, messageId: string) => Promise<void>;
  // ...
}
```

### Selector Hooks

The store exports optimized selector hooks to prevent unnecessary re-renders:

```typescript
// Examples
useConversations(); // Get conversation list
useMessages(); // Get current messages
useDisplayMessages(); // Get messages filtered by active branch
useIsAwaitingFirstChunk(); // Check if waiting for first chunk
useCriticalError(); // Get critical error state
useSSEStatus(); // Get SSE connection status
useBranchCache(); // Get branch cache map
useActiveBranches(); // Get active branch selections
```

### Streaming Buffer

The store includes a `StreamingBuffer` class that batches incoming SSE chunks using `requestAnimationFrame` for frame-aligned rendering:

```typescript
class StreamingBuffer {
  private rafId: number | null = null;

  addChunk(action: 'add' | 'update' | 'delete', component: StreamingComponent) {
    // Queue chunk and schedule flush on next animation frame
    if (!this.rafId) {
      this.rafId = requestAnimationFrame(() => this.flush());
    }
  }

  flush() {
    // Apply all queued chunks to state in a single Zustand set()
  }
}
```

This aligns state updates with the browser's paint cycle (~60fps), producing smooth word-by-word streaming. Chunks arriving between frames are naturally batched (typically 1-3 per frame at LLM speeds).

---

## Streaming System

### ConversationStreamService (`stream.ts`)

A singleton service that manages SSE connections:

```typescript
class ConversationStreamService {
  // Connection management
  connect(): void;
  disconnect(): void;
  reconnectWithNewToken(): void;

  // Event subscription
  subscribe(listener: StreamListener): () => void;

  // State
  getIsConnected(): boolean;
}
```

**Features:**

- Automatic reconnection with exponential backoff
- Heartbeat monitoring (30s timeout)
- Unlimited reconnection attempts (backoff capped at 60s) — backend restarts recover without user action
- Token-based authentication via query parameter

### SSE Event Types

```typescript
type StreamSSEEvent =
  | { type: 'connected'; data: { connectionId: string } }
  | { type: 'heartbeat'; data: { timestamp: number } }
  | { type: 'stream_start'; data: StreamStartEvent }
  | { type: 'stream_chunk'; data: StreamChunkEvent }
  | { type: 'stream_complete'; data: StreamCompleteEvent }
  | { type: 'stream_error'; data: StreamErrorEvent }
  | { type: 'conversation_name_generated'; data: ConversationNameGeneratedEvent }
  | { type: 'message_created'; data: MessageCreatedEvent }
  | { type: 'message_updated'; data: MessageUpdatedEvent }
  | { type: 'connection_failed'; data: { reason: string } }
  | { type: 'error'; data: { code?: string; message?: string } };
```

### Streaming Data Flow

```
Backend gRPC Stream
        │
        ▼
┌───────────────────┐
│  SSE Endpoint     │
│  (NestJS)         │
└────────┬──────────┘
         │ Server-Sent Events
         ▼
┌───────────────────┐
│ ConversationStream│
│ Service (Browser) │
└────────┬──────────┘
         │ Event distribution
         ▼
┌───────────────────┐
│ useConversation   │
│ Stream Hook       │
└────────┬──────────┘
         │ Store actions
         ▼
┌───────────────────┐
│  Zustand Store    │
│  StreamingBuffer  │
└────────┬──────────┘
         │ rAF-aligned updates (~60fps)
         ▼
┌───────────────────┐
│  React Components │
│  (UI rendering)   │
└───────────────────┘
```

---

## Components

### Page Components

| Component             | Description                                                           |
| --------------------- | --------------------------------------------------------------------- |
| `ConversationPage`    | Main entry/dispatcher page (decides between simple vs group UI)       |
| `GroupConversationPage`| Specialized UI for group chats (includes join landing logic)          |
| `NewConversationPage` | Landing page for starting new conversations (supports agent mentions) |

### Content Components

| Component             | Description                                                                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ConversationHeader`  | Title display, rename, delete, share button, workspace manager button                                                                                 |
| `ConversationContent` | Message list with infinite scroll, branch handling, file attachment display                                                                           |
| `ConversationInput`   | Message input with file upload orchestration, model selection, agent mentions                                                                         |
| `MessageAttachments`  | Renders file attachment thumbnails above user messages (images show preview, others show icon + name). Opens viewable files in the file-viewer module |

### Message Components

| Component             | Description                                                 |
| --------------------- | ----------------------------------------------------------- |
| `MessageActions`      | AI message actions: like, dislike, copy, timing, regenerate, **reply** (group chat) |
| `UserMessageActions`  | User message actions: edit, **reply** (group chat)                                  |
| `TimingIndicator`     | Displays time to first chunk with tooltip for all metrics                           |
| `BranchNavigation`    | Navigate between response branches (prev/next)                                      |
| `EditableUserMessage` | Inline editing for user messages                                                    |
| `ParentMessagePreview`| Preview snippet of the message being replied to (with click-to-scroll)              |
| `MessageAvatar`       | Displays user initials or AI icon, aligned perfectly with the message bubble        |

### Dialog & Sheet Components

| Component                  | Description                                                                         |
| -------------------------- | ----------------------------------------------------------------------------------- |
| `StreamErrorDialog`        | Critical error modal with retry/dismiss                                             |
| `DeleteConversationDialog` | Confirm conversation deletion                                                       |
| `RenameDialog`             | Rename conversation title                                                           |
| `ReportDialog`             | Report problematic AI responses                                                     |
| `ShareDialog`              | Share conversations publicly (with expiration) or privately (with email recipients) |
| `WorkspaceManagerSheet`    | Link/unlink conversations to workspaces, browse workspace documents                 |
| `JoinConversationLanding`  | Immersive landing page for invited guests to join a group chat                      |

### Utility Components

| Component          | Description                         |
| ------------------ | ----------------------------------- |
| `LoadingIndicator` | Animated dots while waiting for AI  |
| `NotFound`         | 404 state for missing conversations |

---

## Agent Mentioning

Users can tag AI agents in messages using `@` mentions. This routes the message to specific agents on the backend. Mentions also seed **sticky routing**: the backend stores the resolved agent IDs on the conversation (`taggedAgentIds`) and reuses them on later messages that have no `@` tags (see [Sticky Agent Routing](#sticky-agent-routing)).

### How It Works

1. User types "@" in the input textarea
2. MentionPopup opens with searchable list (Members shown first in group chats, then Agents)
3. Selection behavior:
   - **Agents**: Mentioning an agent routes the message to them. Multiple agents can be tagged.
   - **Members**: Mentioning a member tags them in the message.
4. On submit, IDs are extracted:
   - `agentIds[]` / `teamIds[]` sent **only when** the user mentioned agents/teams on this turn.
   - `memberIds[]` sent to tag participants. **Note**: If any member is tagged, AI response is skipped.
5. Backend resolves mentions, applies sticky reuse when there are no agent tags, and routes or suppresses AI responses accordingly.

### Mention Detection

- Triggered on `@` at the start of input or after whitespace
- Real-time filtering as the user types after `@`
- Popup closes on space, newline, Escape, or click-outside
- Mentions tracked via a `Map<agentName, agentId>` in the input component

### Context Menu

Right-clicking in the input textarea provides:

- **Mention agent** — inserts `@` to trigger the mention popup
- **Create agent** — opens a dialog to create a new personal agent on-the-fly

### Cross-Module Integration

The input component imports from the **Agent module**:

- `useAgents()` — fetches the list of available agents (personal + default)
- `useAgentStore` — access to `createAgent()` and `fetchAgents()` actions

---

## Conversation Sharing

Conversations can be shared publicly or privately via the `ShareDialog`.

### Public Sharing

- Generates a public link with an access token
- Configurable expiration (1-365 days, default 30)
- Anyone with the link can view the conversation (read-only)
- View count tracked

### Private Sharing

- Share with specific users by email
- Recipients get access to a forked copy of the conversation

### Share Types

```typescript
interface CreateSharePayload {
  shareType: 'public' | 'private';
  title?: string;
  recipientEmails?: string[]; // For private shares
  expiresInDays?: number; // For public shares
}
```

---

## Workspace Integration

The `WorkspaceManagerSheet` allows users to link conversations to workspaces, providing context from workspace documents during AI interactions.

### Features

- Multi-select workspace picker
- View documents from linked workspaces with pagination
- Link/unlink workspaces from the conversation header

### Conversation Fields

```typescript
interface Conversation {
  // ...existing fields
  workspaces?: string[]; // Linked workspace IDs
  selectedSkills?: string[]; // Skills selected for this conversation
  taggedAgentIds?: string[]; // Sticky routing agents (last @mention set; server-owned)
  systemWorkspaceId?: string; // System workspace for the conversation
}
```

---

## Hooks

### useConversationStream

Connects the SSE service to the Zustand store:

```typescript
function useConversationStream() {
  // Called on conversation pages
  // - Connects SSE on mount
  // - Subscribes to events
  // - Routes events to store actions
  // - Disconnects on unmount
}
```

### useConversationFileUpload

Orchestrates the file upload lifecycle for conversation attachments:

```typescript
function useConversationFileUpload(options: {
  conversationId: string | null;
  createConversation?: () => Promise<{ id: string }>;
}) => {
  files: FileUploadItem[];         // Current upload state per file
  addFiles: (rawFiles: File[], localIds: string[]) => void;
  removeFile: (localId: string) => void;
  completedFileIds: string[];      // Document IDs of completed uploads
  isUploading: boolean;            // True if any file is still uploading
  clearAll: () => void;            // Reset after send
  conversationId: string | null;   // May differ from input (eager creation)
}
```

**Key behaviors:**

- **Upload pipeline:** `requestUploadUrl` → XHR PUT to Azure (with progress tracking) → `confirmFileUpload`
- **Eager conversation creation:** On `NewConversationPage`, creates the conversation on first file attach (not on send). Uses a `useRef<Promise>` mutex to prevent duplicate creation from concurrent file additions.
- **Abort support:** Each file has its own `AbortController`. Removing a file aborts its in-progress upload.
- **Cleanup:** Completed files' backend records are deleted on remove (fire-and-forget). In-progress uploads are aborted on unmount.

### useTypewriter

Animates text character by character:

```typescript
function useTypewriter(text: string, speed?: number): string;
```

---

## API Layer

### API Functions (`api.ts`)

| Function                              | Method | Description                                                     |
| ------------------------------------- | ------ | --------------------------------------------------------------- |
| `fetchConversations`                  | GET    | List conversations with pagination                              |
| `createConversation`                  | POST   | Create new conversation (supports `participantEmails` for groups) |
| `joinConversation`                   | POST   | Join a group conversation (Guest → Member)                      |
| `removeConversationMember`           | DELETE | Remove a member from a group conversation (Owner only)          |
| `updateConversationMemberJob`        | PATCH  | Update a member's role/job in a group conversation (Owner only) |
| `fetchTaggedAgents`                  | GET    | Get all agents that have been tagged in a conversation          |
| `fetchConversation`                   | GET    | Get single conversation                                         |
| `updateConversation`                  | PATCH  | Update title/archive status, or add new participants via `participantEmails` |
| `deleteConversation`                  | DELETE | Delete conversation                                             |
| `fetchMessages`                       | GET    | List messages with pagination                                   |
| `sendMessage`                         | POST   | Send user message with optional `agentIds` (triggers AI stream) |
| `fetchMessage`                        | GET    | Get single message                                              |
| `updateFeedback`                      | PATCH  | Like/dislike AI message                                         |
| `stopStream`                          | POST   | Cancel active stream                                            |
| `regenerateMessage`                   | POST   | Regenerate AI response                                          |
| `updateMessage`                       | PATCH  | Edit user message                                               |
| `fetchBranches`                       | GET    | Get AI response branches                                        |
| `reportMessage`                       | POST   | Report problematic message                                      |
| `requestFileUploadUrl`                | POST   | Get presigned upload URL for a conversation file                |
| `confirmFileUpload`                   | POST   | Confirm presigned URL upload completed                          |
| `deleteConversationFile`              | DELETE | Delete an attached conversation file                            |
| `getArtifactDownloadUrl`              | POST   | Get presigned URL for artifacts                                 |
| `fetchConversationWorkspaceDocuments` | GET    | List documents from linked workspaces                           |
| `createShare`                         | POST   | Create public or private share                                  |
| `getShares`                           | GET    | List shares for a conversation                                  |
| `revokeShare`                         | DELETE | Revoke a share                                                  |
| `viewPublicShare`                     | GET    | View a public shared conversation                               |

---

## Types

### Core Types (`types.ts`)

```typescript
interface Conversation {
  id: string;
  title: string;
  messageCount: number;
  lastMessageAt: string;
  isArchived: boolean;
  isShared: boolean;
  workspaces?: string[];
  systemWorkspaceId?: string;
  createdAt: string;
  updatedAt: string;
  groupMeta?: GroupConversationMeta;
}

interface GroupConversationMeta {
  isGroup: true;
  members: { userId: string; joinedAt: string; status: 'owner' | 'member'; name?: string; email?: string }[];
  invitedUsers: { email: string; status: 'Confirmed' | 'Guest'; invitedAt: string }[];
}

interface Message {
  id: string;
  conversationId: string;
  senderId?: string; // ID of the user who sent the message
  conversationType: 'user' | 'ai';
  content?: string;
  components?: MessageComponent[];
  attachedFileIds?: string[];
  attachedFiles?: AttachedFile[]; // Enriched file data with download URLs
  modelId?: string;
  webSearchEnabled?: boolean;
  questionMessageId?: string;
  answerMessageId?: string;
  feedback?: 'like' | 'dislike';
  isEdited?: boolean;
  editedAt?: string;
  isStreaming?: boolean;
  isComplete?: boolean;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  timeToFirstChunk?: number;
  timeToFirstToken?: number;
  parentMessageId?: string; // Reference to the message being replied to
  agentIds?: string[];
  memberIds?: string[];
  createdAt: string;
}

interface AttachedFile {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  downloadUrl: string; // Presigned read URL from backend
}

interface MessageComponent {
  type: 'text' | 'code' | 'reasoning' | 'plan' | 'queue' | 'checkpoint' | 'chart' | 'task' | 'error' | 'sources' | 'sandbox' | 'webPreview' | 'artifact' | 'citation';
  data: Record<string, unknown>;
}

interface SendMessagePayload {
  content: string;
  attachedFileIds?: string[];
  attachedFiles?: AttachedFile[]; // Frontend-only, for optimistic UI (not sent to API)
  webSearchEnabled?: boolean;
  modelId?: string;
  agentIds?: string[];
  memberIds?: string[];
  parentMessageId?: string;
}
```

### Share Types

```typescript
type ShareType = 'public' | 'private';

interface CreateSharePayload {
  shareType: ShareType;
  title?: string;
  recipientEmails?: string[];
  expiresInDays?: number;
}

interface ShareResponse {
  id: string;
  originalConversationId: string;
  sharedBy: string;
  shareType: ShareType;
  title: string;
  accessToken?: string;
  recipientEmails?: string[];
  forkedConversationIds?: string[];
  expiresAt?: string;
  viewCount: number;
  isRevoked: boolean;
  createdAt: string;
  updatedAt: string;
}

interface PublicShareViewResponse {
  id: string;
  title: string;
  sharedBy: string;
  messages: PublicShareMessage[];
  viewCount: number;
  createdAt: string;
}
```

---

## Key Features

### 1. Real-time AI Streaming

- SSE-based connection for low latency
- Chunk-by-chunk rendering with cursor animation
- Automatic reconnection on disconnect
- Graceful error handling with retry

### 2. File Attachments

Upload files directly in the conversation input:

- **Drag & drop, paste, or file dialog** — attach up to 5 files per message
- **Immediate upload** — files upload to Azure Blob Storage as soon as they are attached (not on send)
- **Progress tracking** — each file shows upload progress with spinner overlay
- **Submit disabled while uploading** — the submit button is disabled until all files finish uploading, but the textarea remains editable so users can type while waiting
- **Remove with cleanup** — removing a file aborts its upload (if in progress) or deletes it from storage (if completed)
- **Image previews** — attached images show thumbnails in sent messages
- **File viewer integration** — clicking an attachment in a sent message opens it in the built-in file viewer (for supported types) or in a new tab (for unsupported types)
- **Eager conversation creation** — on the new conversation page, attaching a file creates the conversation silently in the background
- **No indexing** — conversation file attachments are not indexed for RAG. Indexing only applies to workspace document uploads

### 3. Sketch Board

Draw freehand sketches and attach them to messages:

- **Draw a sketch** option in the "+" menu opens a full-screen drawing dialog
- **Tools**: Pen and eraser with configurable brush size (1-20px)
- **Colors**: 8 preset color swatches + custom color picker
- **Background image**: Upload an image as a background layer to draw on top of
- **Undo/Redo**: Stroke-level history (up to 50 steps) with Ctrl+Z / Ctrl+Shift+Z keyboard shortcuts
- **Clear**: Wipe all strokes (background image preserved)
- **Export**: On "Done", canvas is exported as a PNG file and fed into the same `addFiles` upload pipeline as regular file attachments
- **Integration**: The `onSketchDone` callback on the `Input` component receives the exported `File` object; `ConversationInput` and `NewConversationPage` wire it into `useConversationFileUpload`

### 4. Agent Mentioning

- `@` mention syntax to tag specific AI agents in messages
- Searchable popup grouped by personal and default agents
- Multiple agents can be mentioned per message
- Right-click context menu for quick mention or agent creation
- Agent IDs extracted from text and sent with the message payload **only when present**
- Backend sticky `taggedAgentIds` reuses the last mention set on subsequent untagged turns

### 5. Branch Navigation

Users can regenerate AI responses, creating branches:

```
User Message
    │
    ├── AI Response #1 (original)
    ├── AI Response #2 (regenerated)
    └── AI Response #3 (regenerated again)
```

Navigate between branches using prev/next buttons.

### 6. Conversation Sharing

- **Public shares**: Generate a link with configurable expiration (1-365 days)
- **Private shares**: Share with specific users by email
- View count tracking for public shares
- Revokable at any time

### 7. Workspace Linking

- Associate conversations with workspaces from the header
- Browse workspace documents within the conversation context
- Documents provide additional context for AI responses

### 8. Optimistic Updates

- User messages appear immediately before API confirmation (including file attachments)
- Feedback updates apply instantly with rollback on error
- Conversation deletions remove items immediately

### 9. Infinite Scroll

- Load older messages on scroll to top
- Preserves scroll position when prepending messages
- IntersectionObserver-based trigger

### 10. Message Editing

- Inline editing for user messages
- Edit history tracking (`isEdited`, `editedAt`)
- **Regeneration Logic**: Saving an edited user message automatically triggers a regeneration of the associated AI response (using `regenerateMessage`).
- **Member Tag Suppression**: If a message edit adds a member tag, the regeneration is skipped, as AI responses are disabled when members are mentioned.

### 11. Timing Metrics

Display response timing information:

- **Time to First Chunk**: Time until first gRPC chunk arrives
- **Time to First Token**: Time until first text/reasoning content
- **Total Duration**: Complete response time

Shown as a clock icon with hover tooltip.

### 12. Group Chat Invitation & Joining Flow

Seamless process for onboarding invited users:
- **Invitation Link**: Clicking "Join the Conversation" in the email takes users to a dynamic URL `/#/conversation/:id`.
- **Landing Page**: If the user is invited but not yet a member, they see `JoinConversationLanding.tsx`. This page displays the group title, the owner's actual name (e.g., "Invited by Jane Doe"), and an immersive "Enter Conversation" button.
- **Privacy First**: Group chats **do not** appear in the user's sidebar history until they have officially clicked the join button.
- **Atomic Joining**: The join action is handled atomically by the backend, ensuring a millisecond-fast transition from "Invited Guest" to "Active Member".
- **Instant History**: Upon joining, the conversation is immediately prepended to the user's history list with a `Users` group icon.
- **Member Management**: The "Manage Group" dialog provides a complete overview of active and invited members.
    - **Role-Based UI**: Owners see the full management interface with invite capabilities. Non-owners see a simplified "Current members" view.
    - **Human-Readable**: Shows real names and emails instead of raw database IDs.
    - **Status Indicators**: Tracks members as **Owner**, **Member**, or **Pending** (En attente).
    - **Role/Job Assignment**: Owners can click the inline pencil icon next to any active member's name to assign them a custom role (e.g., "Product Manager" or "Dev"). Roles are displayed as small badges to clarify responsibilities within the group.
    - **Member Removal**: Owners can remove existing members from the group conversation via a dedicated "Trash" button in the management dialog.
    - **Conflict Prevention**: The UI automatically prevents sending duplicate invitations to people who are already in the group or have already been invited. It also blocks adding the same email twice in the invitation list and prevents users from inviting themselves.

### 13. Member Mentions & Shared Agents
- Within group chats, typing `@` opens the `MentionPopup`.
- The popup displays available group members before agents.
- **Shared Agents Section**: In group conversations, agents that have been tagged by any member are listed under a "Shared Agents" heading. This allows all participants to reuse agents already present in the conversation.
- When a member is mentioned, their name is inserted into the text, but their ID is *not* sent as an `agentId` to the backend, preventing unintended AI agent invocations.
- **Dynamic Fetching**: `ConversationInput` and `EditableUserMessage` automatically fetch shared agents via the `fetchTaggedAgents` API when a group conversation is active.

### 14. Shared Agents Persistence
- The system automatically tracks which agents are used in a group conversation (`groupMeta.taggedAgents`, append-only toolbox).
- Once an agent is tagged in a message, it is persisted for the group mention picker / shared roster.
- This is **distinct** from sticky routing (`Conversation.taggedAgentIds`), which selects which agents run on untagged follow-ups.
- The `CreateGroupConversationDialog` (in manage mode) provides a dedicated "Shared Agents" section to view all agents currently part of the group's toolbox.

---

## Data Flow

### Sending a Message

```
1. User types message (optionally @mentioning agents, attaching files) → ConversationInput
2. Files upload immediately on attach via useConversationFileUpload hook
   - requestUploadUrl → XHR PUT to Azure (with progress) → confirmFileUpload
3. Submit → store.sendMessage() (submit disabled while uploads in progress)
4. Agent/team IDs extracted from @mentions in text (omitted from payload when none)
5. Optimistic message added to state (includes attachedFiles for instant display)
6. API call: POST /conversations/:id/messages { content, attachedFileIds, agentIds?, teamIds?, modelId }
7. Backend applies sticky routing (mention → replace taggedAgentIds; no mention → reuse)
   - In group chats, new agentIds may still $addToSet into groupMeta.taggedAgents (shared toolbox)
8. SSE: stream_start event → store.onStreamStart()
9. SSE: stream_chunk events → store.onStreamChunk()
10. Chunks buffered → StreamingBuffer.flush() at 60fps
11. UI renders streaming components
12. SSE: stream_complete → store.onStreamComplete()
13. Fetch completed message from API
14. Replace streaming state with persisted message
15. Store may patch currentConversation.taggedAgentIds from userMessage.agentIds when the set changed
```

### Mentioning an Agent or Member

```
1. User types "@" in input
2. MentionPopup opens → fetches agents via useAgents(), active group members, and shared conversation agents
3. User filters by typing, selects agent or member
4. "@Name" inserted into textarea, tracked in mentionMap with type ('agent' or 'member')
5. On submit, mentionMap scanned → agent IDs → agentIds[]; teams → teamIds[]
6. agentIds/teamIds sent only when present; member mentions remain as text + memberIds
7. Backend selects agents (mention or sticky reuse) and updates group shared agents if in a group
```

### Regenerating a Response

```
1. Click Regenerate → store.regenerateMessage()
2. API call: POST /conversations/:id/messages/:id/regenerate
3. Backend creates new AI placeholder, starts stream
   - In group chats, previously tagged agents are automatically included in the gRPC request
4. SSE events flow as above
5. New AI message added to branch cache
6. Branch navigation updates to show new response
```

---

## Data Flow

### Sending a Message

```
1. User types message (optionally @mentioning agents, attaching files) → ConversationInput
2. Files upload immediately on attach via useConversationFileUpload hook
   - requestUploadUrl → XHR PUT to Azure (with progress) → confirmFileUpload
3. Submit → store.sendMessage() (submit disabled while uploads in progress)
4. Agent/team IDs extracted from @mentions in text (omitted from payload when none)
5. Optimistic message added to state (includes attachedFiles for instant display)
6. API call: POST /conversations/:id/messages { content, attachedFileIds, agentIds?, teamIds?, modelId }
7. Backend applies sticky routing (mention → replace taggedAgentIds; no mention → reuse)
   - In group chats, new agentIds may still $addToSet into groupMeta.taggedAgents (shared toolbox)
8. SSE: stream_start event → store.onStreamStart()
9. SSE: stream_chunk events → store.onStreamChunk()
10. Chunks buffered → StreamingBuffer.flush() at 60fps
11. UI renders streaming components
12. SSE: stream_complete → store.onStreamComplete()
13. Fetch completed message from API
14. Replace streaming state with persisted message
15. Store may patch currentConversation.taggedAgentIds from userMessage.agentIds when the set changed
```

### Mentioning an Agent or Member

```
1. User types "@" in input
2. MentionPopup opens → fetches agents via useAgents() and active group members
3. User filters by typing, selects agent or member
4. "@Name" inserted into textarea, tracked in mentionMap with type ('agent' or 'member')
5. On submit, mentionMap scanned → agent IDs → agentIds[]; teams → teamIds[]
6. agentIds/teamIds sent only when present; member mentions remain as text + memberIds
7. Backend selects agents (mention or sticky reuse)
```

### Regenerating a Response

```
1. Click Regenerate → store.regenerateMessage()
2. API call: POST /conversations/:id/messages/:id/regenerate
3. Backend creates new AI placeholder, starts stream
4. SSE events flow as above
5. New AI message added to branch cache
6. Branch navigation updates to show new response
```

### Group Conversation Flow

```
1. Invitation: User clicks "Join" in email link (/#/conversation/:id)
2. Discovery: App fetches conversation via api.fetchConversation(id)
3. Guard logic: 
   - If already a member → navigate to ConversationPage
   - If invited guest → render JoinConversationLanding
4. Action: User clicks "Enter Conversation"
   - Calls api.joinConversation(id)
   - Backend performs atomic move (Guest → Member)
5. Success:
   - Navigate to ConversationPage
   - Optimistically prepend to store.conversations with 'Users' icon
   - Fetch initial messages
```

### Sharing a Conversation

```
1. Click Share button in ConversationHeader
2. ShareDialog opens with Public/Private tabs
3. Configure share options (expiration, recipients)
4. API call: POST /conversations/:id/shares
5. Share link generated and displayed for copying
```

---

## Sticky Agent Routing

Sticky routing is **owned by the backend**. The frontend must not inject previous agent IDs into the send payload when the user did not `@mention` anyone on the current turn.

### Contract

| Side | Responsibility |
|------|----------------|
| **Front** | Send `agentIds` / `teamIds` only when the composer extracted mentions; omit them otherwise |
| **Back** | On mention → `$set` conversation `taggedAgentIds`; on no mention (AI turn) → reuse `taggedAgentIds` |
| **Front store** | After a successful send, optionally patch `currentConversation.taggedAgentIds` from `userMessage.agentIds` **only when the set changed** |
| **ConversationPage** | `fetchMessages` depends on conversation **id**, not the whole conversation object — so sticky field updates do not soft-reload the message list |

### UX notes

- Follow-up messages without `@` continue with the last mentioned agent(s) automatically.
- Tagging new agents on a later message **replaces** the sticky set entirely (no merge).
- Group “Shared Agents” (`GET .../tagged-agents` / `groupMeta.taggedAgents`) remains a separate shared toolbox for the mention picker — not sticky routing.

### Related types

```typescript
interface Conversation {
  taggedAgentIds?: string[]; // last sticky routing set from the API
}

interface Message {
  agentIds?: string[]; // agents used for that turn (mention or sticky reuse)
}
```

---

## Performance Optimizations

### 1. Streaming Buffer

Chunks are batched using `requestAnimationFrame` to align with the browser's paint cycle (~60fps), preventing excessive React re-renders while ensuring smooth word-by-word streaming.

### 2. Memoized Components

Message bubbles are memoized to prevent re-renders:

```typescript
const MemoizedMessageBubble = memo(function MemoizedMessageBubble({...})
```

### 3. Selector Hooks with Shallow Compare

Use `useShallow` for complex selections:

```typescript
export const useDisplayMessages = () =>
  useConversationStore(useShallow((s) => { ... }));
```

### 4. Empty Array Constants

Prevent unnecessary re-renders from new array references:

```typescript
const EMPTY_MESSAGES: Message[] = [];
export const useMessages = () => useConversationStore((s) => (s.messages.length === 0 ? EMPTY_MESSAGES : s.messages));
```

### 5. Lazy Branch Fetching

Branch data is fetched only when messages are visible, not upfront.

### 6. Scroll Position Preservation

When loading older messages, scroll position is preserved using refs and `useLayoutEffect`.

---

## Testing

- Conversation tests are colocated as `*.test.ts` / `*.test.tsx` next to module files.
- Sketch board behavior is covered by:
  - `src/modules/conversation/components/SketchBoard/SketchBoardDialog.test.tsx`
  - `src/modules/conversation/components/SketchBoard/SketchBoardToolbar.test.tsx`
- Run conversation module tests from `front/`:

```bash
npm test -- src/modules/conversation
```

---

## Usage Example

```tsx
import { ConversationPage, useConversationStore } from '@/modules/conversation';

// In your routes
<Route path='/c/:id' element={<ConversationPage />} />;

// Accessing store from anywhere
const { createConversation, sendMessage } = useConversationStore.getState();

// Creating a conversation
const conversation = await createConversation('My Chat');

// Sending a message with agent mentions
await sendMessage(conversation.id, {
  content: 'Hello, AI!',
  webSearchEnabled: true,
  agentIds: ['agent-id-1'], // Optional: route to specific agents
});
```

---

## Error Handling

### Critical Errors

Displayed via `StreamErrorDialog`:

- AI service unavailable
- Stream failed
- Response timeout

User can retry or dismiss.

### Non-Critical Errors

Displayed via toast notifications:

- Concurrent limit reached
- Already streaming
- File upload limit

### Error Codes

Mapped in `utils.ts`:

```typescript
const STREAM_ERROR_MAP = {
  ERR_1417: { title: 'AI Service Unavailable', ... },
  ERR_1406: { title: 'Stream Failed', ... },
  ERR_1407: { title: 'Response Timed Out', ... },
  ERR_1405: { title: 'Concurrent Limit Reached', ... },
  ERR_1409: { title: 'Already Streaming', ... },
  ERR_1410: { title: 'File Upload Limit', ... },
};
```

---

## Reply to a Message

Users can reply to specific messages within a conversation.

### Features
- **Contextual Replies**: Replies include a reference to the parent message.
- **Parent Preview**: A snippet of the parent message is displayed above the reply.
- **Perfect Alignment**: Utilizes CSS Grid to ensure the parent message preview perfectly aligns with the message bubble, while the `MessageAvatar` stays correctly anchored to the new reply.
- **Quick Navigation**: Clicking the parent preview smoothly scrolls the conversation to the original message and highlights it.
- **Multi-turn Context**: The backend preserves the `parentMessageId` for each turn.

### Components
- `ParentMessagePreview`: Displays the sender's name and a text snippet of the parent message.
- `ConversationInput`: Handles the `replyTo` state and displays the message being replied to.
- `MessageActions`: Provides the "Reply" action for both user and AI messages.

### Data Model
- `Message.parentMessageId`: The UUID of the parent message.
- `SendMessagePayload.parentMessageId`: Sent to the API when creating a reply.

| `TimingIndicator`     | Displays time to first chunk with tooltip for all metrics   |
| `BranchNavigation`    | Navigate between AI response branches (prev/next)           |
| `EditableUserMessage` | Inline editing for user messages                            |
| `ParentMessagePreview` | Preview snippet of the message being replied to (with click-to-scroll) |

### Dialog & Sheet Components

| Component                  | Description                                                                         |
| -------------------------- | ----------------------------------------------------------------------------------- |
| `StreamErrorDialog`        | Critical error modal with retry/dismiss                                             |
| `DeleteConversationDialog` | Confirm conversation deletion                                                       |
| `RenameDialog`             | Rename conversation title                                                           |
| `ReportDialog`             | Report problematic AI responses                                                     |
| `ShareDialog`              | Share conversations publicly (with expiration) or privately (with email recipients) |
| `WorkspaceManagerSheet`    | Link/unlink conversations to workspaces, browse workspace documents                 |
| `JoinConversationLanding`  | Immersive landing page for invited guests to join a group chat                      |

### Utility Components

| Component          | Description                         |
| ------------------ | ----------------------------------- |
| `LoadingIndicator` | Animated dots while waiting for AI  |
| `NotFound`         | 404 state for missing conversations |

---

## Agent Mentioning

Users can tag AI agents in messages using `@` mentions. This routes the message to specific agents on the backend. Mentions also seed **sticky routing**: the backend stores the resolved agent IDs on the conversation (`taggedAgentIds`) and reuses them on later messages that have no `@` tags (see [Sticky Agent Routing](#sticky-agent-routing)).

### How It Works

1. User types "@" in the input textarea
2. MentionPopup opens with searchable list (Members shown first in group chats, then Agents)
3. Selection behavior:
   - **Agents**: Mentioning an agent routes the message to them. Multiple agents can be tagged.
   - **Members**: Mentioning a member tags them in the message.
4. On submit, IDs are extracted:
   - `agentIds[]` / `teamIds[]` sent **only when** the user mentioned agents/teams on this turn.
   - `memberIds[]` sent to tag participants. **Note**: If any member is tagged, AI response is skipped.
5. Backend resolves mentions, applies sticky reuse when there are no agent tags, and routes or suppresses AI responses accordingly.

### Mention Detection

- Triggered on `@` at the start of input or after whitespace
- Real-time filtering as the user types after `@`
- Popup closes on space, newline, Escape, or click-outside
- Mentions tracked via a `Map<agentName, agentId>` in the input component

### Context Menu

Right-clicking in the input textarea provides:

- **Mention agent** — inserts `@` to trigger the mention popup
- **Create agent** — opens a dialog to create a new personal agent on-the-fly

### Cross-Module Integration

The input component imports from the **Agent module**:

- `useAgents()` — fetches the list of available agents (personal + default)
- `useAgentStore` — access to `createAgent()` and `fetchAgents()` actions

---

## Conversation Sharing

Conversations can be shared publicly or privately via the `ShareDialog`.

### Public Sharing

- Generates a public link with an access token
- Configurable expiration (1-365 days, default 30)
- Anyone with the link can view the conversation (read-only)
- View count tracked

### Private Sharing

- Share with specific users by email
- Recipients get access to a forked copy of the conversation

### Share Types

```typescript
interface CreateSharePayload {
  shareType: 'public' | 'private';
  title?: string;
  recipientEmails?: string[]; // For private shares
  expiresInDays?: number; // For public shares
}
```

---

## Workspace Integration

The `WorkspaceManagerSheet` allows users to link conversations to workspaces, providing context from workspace documents during AI interactions.

### Features

- Multi-select workspace picker
- View documents from linked workspaces with pagination
- Link/unlink workspaces from the conversation header

### Conversation Fields

```typescript
interface Conversation {
  // ...existing fields
  workspaces?: string[]; // Linked workspace IDs
  selectedSkills?: string[]; // Skills selected for this conversation
  taggedAgentIds?: string[]; // Sticky routing agents (last @mention set; server-owned)
  systemWorkspaceId?: string; // System workspace for the conversation
}
```

---

## Hooks

### useConversationStream

Connects the SSE service to the Zustand store:

```typescript
function useConversationStream() {
  // Called on conversation pages
  // - Connects SSE on mount
  // - Subscribes to events
  // - Routes events to store actions
  // - Disconnects on unmount
}
```

### useConversationFileUpload

Orchestrates the file upload lifecycle for conversation attachments:

```typescript
function useConversationFileUpload(options: {
  conversationId: string | null;
  createConversation?: () => Promise<{ id: string }>;
}) => {
  files: FileUploadItem[];         // Current upload state per file
  addFiles: (rawFiles: File[], localIds: string[]) => void;
  removeFile: (localId: string) => void;
  completedFileIds: string[];      // Document IDs of completed uploads
  isUploading: boolean;            // True if any file is still uploading
  clearAll: () => void;            // Reset after send
  conversationId: string | null;   // May differ from input (eager creation)
}
```

**Key behaviors:**

- **Upload pipeline:** `requestUploadUrl` → XHR PUT to Azure (with progress tracking) → `confirmFileUpload`
- **Eager conversation creation:** On `NewConversationPage`, creates the conversation on first file attach (not on send). Uses a `useRef<Promise>` mutex to prevent duplicate creation from concurrent file additions.
- **Abort support:** Each file has its own `AbortController`. Removing a file aborts its in-progress upload.
- **Cleanup:** Completed files' backend records are deleted on remove (fire-and-forget). In-progress uploads are aborted on unmount.

### useTypewriter

Animates text character by character:

```typescript
function useTypewriter(text: string, speed?: number): string;
```

---

## API Layer

### API Functions (`api.ts`)

| Function                              | Method | Description                                                     |
| ------------------------------------- | ------ | --------------------------------------------------------------- |
| `fetchConversations`                  | GET    | List conversations with pagination                              |
| `createConversation`                  | POST   | Create new conversation (supports `participantEmails` for groups) |
| `joinConversation`                   | POST   | Join a group conversation (Guest → Member)                      |
| `removeConversationMember`           | DELETE | Remove a member from a group conversation (Owner only)          |
| `updateConversationMemberJob`        | PATCH  | Update a member's role/job in a group conversation (Owner only) |
| `fetchTaggedAgents`                  | GET    | Get all agents that have been tagged in a conversation          |
| `fetchConversation`                   | GET    | Get single conversation                                         |
| `updateConversation`                  | PATCH  | Update title/archive status, or add new participants via `participantEmails` |
| `deleteConversation`                  | DELETE | Delete conversation                                             |
| `fetchMessages`                       | GET    | List messages with pagination                                   |
| `sendMessage`                         | POST   | Send user message with optional `agentIds` (triggers AI stream) |
| `fetchMessage`                        | GET    | Get single message                                              |
| `updateFeedback`                      | PATCH  | Like/dislike AI message                                         |
| `stopStream`                          | POST   | Cancel active stream                                            |
| `regenerateMessage`                   | POST   | Regenerate AI response                                          |
| `updateMessage`                       | PATCH  | Edit user message                                               |
| `fetchBranches`                       | GET    | Get AI response branches                                        |
| `reportMessage`                       | POST   | Report problematic message                                      |
| `requestFileUploadUrl`                | POST   | Get presigned upload URL for a conversation file                |
| `confirmFileUpload`                   | POST   | Confirm presigned URL upload completed                          |
| `deleteConversationFile`              | DELETE | Delete an attached conversation file                            |
| `getArtifactDownloadUrl`              | POST   | Get presigned URL for artifacts                                 |
| `fetchConversationWorkspaceDocuments` | GET    | List documents from linked workspaces                           |
| `createShare`                         | POST   | Create public or private share                                  |
| `getShares`                           | GET    | List shares for a conversation                                  |
| `revokeShare`                         | DELETE | Revoke a share                                                  |
| `viewPublicShare`                     | GET    | View a public shared conversation                               |

---

## Types

### Core Types (`types.ts`)

```typescript
interface Conversation {
  id: string;
  title: string;
  messageCount: number;
  lastMessageAt: string;
  isArchived: boolean;
  isShared: boolean;
  workspaces?: string[];
  systemWorkspaceId?: string;
  createdAt: string;
  updatedAt: string;
  groupMeta?: GroupConversationMeta;
}

interface GroupConversationMeta {
  isGroup: true;
  members: { userId: string; joinedAt: string; status: 'owner' | 'member'; name?: string; email?: string }[];
  invitedUsers: { email: string; status: 'Confirmed' | 'Guest'; invitedAt: string }[];
}

interface Message {
  id: string;
  conversationId: string;
  senderId?: string; // ID of the user who sent the message
  conversationType: 'user' | 'ai';
  content?: string;
  components?: MessageComponent[];
  attachedFileIds?: string[];
  attachedFiles?: AttachedFile[]; // Enriched file data with download URLs
  modelId?: string;
  webSearchEnabled?: boolean;
  questionMessageId?: string;
  answerMessageId?: string;
  feedback?: 'like' | 'dislike';
  isEdited?: boolean;
  editedAt?: string;
  isStreaming?: boolean;
  isComplete?: boolean;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  timeToFirstChunk?: number;
  timeToFirstToken?: number;
  parentMessageId?: string; // Reference to the message being replied to
  agentIds?: string[];
  memberIds?: string[];
  createdAt: string;
}

interface AttachedFile {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  downloadUrl: string; // Presigned read URL from backend
}

interface MessageComponent {
  type: 'text' | 'code' | 'reasoning' | 'plan' | 'queue' | 'checkpoint' | 'chart' | 'task' | 'error' | 'sources' | 'sandbox' | 'webPreview' | 'artifact' | 'citation';
  data: Record<string, unknown>;
}

interface SendMessagePayload {
  content: string;
  attachedFileIds?: string[];
  attachedFiles?: AttachedFile[]; // Frontend-only, for optimistic UI (not sent to API)
  webSearchEnabled?: boolean;
  modelId?: string;
  agentIds?: string[];
  memberIds?: string[];
  parentMessageId?: string;
}
```

### Share Types

```typescript
type ShareType = 'public' | 'private';

interface CreateSharePayload {
  shareType: ShareType;
  title?: string;
  recipientEmails?: string[];
  expiresInDays?: number;
}

interface ShareResponse {
  id: string;
  originalConversationId: string;
  sharedBy: string;
  shareType: ShareType;
  title: string;
  accessToken?: string;
  recipientEmails?: string[];
  forkedConversationIds?: string[];
  expiresAt?: string;
  viewCount: number;
  isRevoked: boolean;
  createdAt: string;
  updatedAt: string;
}

interface PublicShareViewResponse {
  id: string;
  title: string;
  sharedBy: string;
  messages: PublicShareMessage[];
  viewCount: number;
  createdAt: string;
}
```

---

## Key Features

### 1. Real-time AI Streaming

- SSE-based connection for low latency
- Chunk-by-chunk rendering with cursor animation
- Automatic reconnection on disconnect
- Graceful error handling with retry

### 2. File Attachments

Upload files directly in the conversation input:

- **Drag & drop, paste, or file dialog** — attach up to 5 files per message
- **Immediate upload** — files upload to Azure Blob Storage as soon as they are attached (not on send)
- **Progress tracking** — each file shows upload progress with spinner overlay
- **Submit disabled while uploading** — the submit button is disabled until all files finish uploading, but the textarea remains editable so users can type while waiting
- **Remove with cleanup** — removing a file aborts its upload (if in progress) or deletes it from storage (if completed)
- **Image previews** — attached images show thumbnails in sent messages
- **File viewer integration** — clicking an attachment in a sent message opens it in the built-in file viewer (for supported types) or in a new tab (for unsupported types)
- **Eager conversation creation** — on the new conversation page, attaching a file creates the conversation silently in the background
- **No indexing** — conversation file attachments are not indexed for RAG. Indexing only applies to workspace document uploads

### 3. Sketch Board

Draw freehand sketches and attach them to messages:

- **Draw a sketch** option in the "+" menu opens a full-screen drawing dialog
- **Tools**: Pen and eraser with configurable brush size (1-20px)
- **Colors**: 8 preset color swatches + custom color picker
- **Background image**: Upload an image as a background layer to draw on top of
- **Undo/Redo**: Stroke-level history (up to 50 steps) with Ctrl+Z / Ctrl+Shift+Z keyboard shortcuts
- **Clear**: Wipe all strokes (background image preserved)
- **Export**: On "Done", canvas is exported as a PNG file and fed into the same `addFiles` upload pipeline as regular file attachments
- **Integration**: The `onSketchDone` callback on the `Input` component receives the exported `File` object; `ConversationInput` and `NewConversationPage` wire it into `useConversationFileUpload`

### 4. Agent Mentioning

- `@` mention syntax to tag specific AI agents in messages
- Searchable popup grouped by personal and default agents
- Multiple agents can be mentioned per message
- Right-click context menu for quick mention or agent creation
- Agent IDs extracted from text and sent with the message payload **only when present**
- Backend sticky `taggedAgentIds` reuses the last mention set on subsequent untagged turns

### 5. Branch Navigation

Users can regenerate AI responses, creating branches:

```
User Message
    │
    ├── AI Response #1 (original)
    ├── AI Response #2 (regenerated)
    └── AI Response #3 (regenerated again)
```

Navigate between branches using prev/next buttons.

### 6. Conversation Sharing

- **Public shares**: Generate a link with configurable expiration (1-365 days)
- **Private shares**: Share with specific users by email
- View count tracking for public shares
- Revokable at any time

### 7. Workspace Linking

- Associate conversations with workspaces from the header
- Browse workspace documents within the conversation context
- Documents provide additional context for AI responses

### 8. Optimistic Updates

- User messages appear immediately before API confirmation (including file attachments)
- Feedback updates apply instantly with rollback on error
- Conversation deletions remove items immediately

### 9. Infinite Scroll

- Load older messages on scroll to top
- Preserves scroll position when prepending messages
- IntersectionObserver-based trigger

### 10. Message Editing

- Inline editing for user messages
- Edit history tracking (`isEdited`, `editedAt`)
- **Regeneration Logic**: Saving an edited user message automatically triggers a regeneration of the associated AI response (using `regenerateMessage`).
- **Member Tag Suppression**: If a message edit adds a member tag, the regeneration is skipped, as AI responses are disabled when members are mentioned.

### 11. Timing Metrics

Display response timing information:

- **Time to First Chunk**: Time until first gRPC chunk arrives
- **Time to First Token**: Time until first text/reasoning content
- **Total Duration**: Complete response time

Shown as a clock icon with hover tooltip.

### 12. Group Chat Invitation & Joining Flow

Seamless process for onboarding invited users:
- **Invitation Link**: Clicking "Join the Conversation" in the email takes users to a dynamic URL `/#/conversation/:id`.
- **Landing Page**: If the user is invited but not yet a member, they see `JoinConversationLanding.tsx`. This page displays the group title, the owner's actual name (e.g., "Invited by Jane Doe"), and an immersive "Enter Conversation" button.
- **Privacy First**: Group chats **do not** appear in the user's sidebar history until they have officially clicked the join button.
- **Atomic Joining**: The join action is handled atomically by the backend, ensuring a millisecond-fast transition from "Invited Guest" to "Active Member".
- **Instant History**: Upon joining, the conversation is immediately prepended to the user's history list with a `Users` group icon.
- **Member Management**: The "Manage Group" dialog provides a complete overview of active and invited members.
    - **Role-Based UI**: Owners see the full management interface with invite capabilities. Non-owners see a simplified "Current members" view.
    - **Human-Readable**: Shows real names and emails instead of raw database IDs.
    - **Status Indicators**: Tracks members as **Owner**, **Member**, or **Pending** (En attente).
    - **Role/Job Assignment**: Owners can click the inline pencil icon next to any active member's name to assign them a custom role (e.g., "Product Manager" or "Dev"). Roles are displayed as small badges to clarify responsibilities within the group.
    - **Member Removal**: Owners can remove existing members from the group conversation via a dedicated "Trash" button in the management dialog.
    - **Conflict Prevention**: The UI automatically prevents sending duplicate invitations to people who are already in the group or have already been invited. It also blocks adding the same email twice in the invitation list and prevents users from inviting themselves.

### 13. Member Mentions & Shared Agents
- Within group chats, typing `@` opens the `MentionPopup`.
- The popup displays available group members before agents.
- **Shared Agents Section**: In group conversations, agents that have been tagged by any member are listed under a "Shared Agents" heading. This allows all participants to reuse agents already present in the conversation.
- When a member is mentioned, their name is inserted into the text, but their ID is *not* sent as an `agentId` to the backend, preventing unintended AI agent invocations.
- **Dynamic Fetching**: `ConversationInput` and `EditableUserMessage` automatically fetch shared agents via the `fetchTaggedAgents` API when a group conversation is active.

### 14. Shared Agents Persistence
- The system automatically tracks which agents are used in a group conversation (`groupMeta.taggedAgents`, append-only toolbox).
- Once an agent is tagged in a message, it is persisted for the group mention picker / shared roster.
- This is **distinct** from sticky routing (`Conversation.taggedAgentIds`), which selects which agents run on untagged follow-ups.
- The `CreateGroupConversationDialog` (in manage mode) provides a dedicated "Shared Agents" section to view all agents currently part of the group's toolbox.

---

## Data Flow

### Sending a Message

```
1. User types message (optionally @mentioning agents, attaching files) → ConversationInput
2. Files upload immediately on attach via useConversationFileUpload hook
   - requestUploadUrl → XHR PUT to Azure (with progress) → confirmFileUpload
3. Submit → store.sendMessage() (submit disabled while uploads in progress)
4. Agent/team IDs extracted from @mentions in text (omitted from payload when none)
5. Optimistic message added to state (includes attachedFiles for instant display)
6. API call: POST /conversations/:id/messages { content, attachedFileIds, agentIds?, teamIds?, modelId }
7. Backend applies sticky routing (mention → replace taggedAgentIds; no mention → reuse)
   - In group chats, new agentIds may still $addToSet into groupMeta.taggedAgents (shared toolbox)
8. SSE: stream_start event → store.onStreamStart()
9. SSE: stream_chunk events → store.onStreamChunk()
10. Chunks buffered → StreamingBuffer.flush() at 60fps
11. UI renders streaming components
12. SSE: stream_complete → store.onStreamComplete()
13. Fetch completed message from API
14. Replace streaming state with persisted message
15. Store may patch currentConversation.taggedAgentIds from userMessage.agentIds when the set changed
```

### Mentioning an Agent or Member

```
1. User types "@" in input
2. MentionPopup opens → fetches agents via useAgents(), active group members, and shared conversation agents
3. User filters by typing, selects agent or member
4. "@Name" inserted into textarea, tracked in mentionMap with type ('agent' or 'member')
5. On submit, mentionMap scanned → agent IDs → agentIds[]; teams → teamIds[]
6. agentIds/teamIds sent only when present; member mentions remain as text + memberIds
7. Backend selects agents (mention or sticky reuse) and updates group shared agents if in a group
```

### Regenerating a Response

```
1. Click Regenerate → store.regenerateMessage()
2. API call: POST /conversations/:id/messages/:id/regenerate
3. Backend creates new AI placeholder, starts stream
   - In group chats, previously tagged agents are automatically included in the gRPC request
4. SSE events flow as above
5. New AI message added to branch cache
6. Branch navigation updates to show new response
```

---

## Data Flow

### Sending a Message

```
1. User types message (optionally @mentioning agents, attaching files) → ConversationInput
2. Files upload immediately on attach via useConversationFileUpload hook
   - requestUploadUrl → XHR PUT to Azure (with progress) → confirmFileUpload
3. Submit → store.sendMessage() (submit disabled while uploads in progress)
4. Agent/team IDs extracted from @mentions in text (omitted from payload when none)
5. Optimistic message added to state (includes attachedFiles for instant display)
6. API call: POST /conversations/:id/messages { content, attachedFileIds, agentIds?, teamIds?, modelId }
7. Backend applies sticky routing (mention → replace taggedAgentIds; no mention → reuse)
   - In group chats, new agentIds may still $addToSet into groupMeta.taggedAgents (shared toolbox)
8. SSE: stream_start event → store.onStreamStart()
9. SSE: stream_chunk events → store.onStreamChunk()
10. Chunks buffered → StreamingBuffer.flush() at 60fps
11. UI renders streaming components
12. SSE: stream_complete → store.onStreamComplete()
13. Fetch completed message from API
14. Replace streaming state with persisted message
15. Store may patch currentConversation.taggedAgentIds from userMessage.agentIds when the set changed
```

### Mentioning an Agent or Member

```
1. User types "@" in input
2. MentionPopup opens → fetches agents via useAgents() and active group members
3. User filters by typing, selects agent or member
4. "@Name" inserted into textarea, tracked in mentionMap with type ('agent' or 'member')
5. On submit, mentionMap scanned → agent IDs → agentIds[]; teams → teamIds[]
6. agentIds/teamIds sent only when present; member mentions remain as text + memberIds
7. Backend selects agents (mention or sticky reuse)
```

### Regenerating a Response

```
1. Click Regenerate → store.regenerateMessage()
2. API call: POST /conversations/:id/messages/:id/regenerate
3. Backend creates new AI placeholder, starts stream
4. SSE events flow as above
5. New AI message added to branch cache
6. Branch navigation updates to show new response
```

### Group Conversation Flow

```
1. Invitation: User clicks "Join" in email link (/#/conversation/:id)
2. Discovery: App fetches conversation via api.fetchConversation(id)
3. Guard logic: 
   - If already a member → navigate to ConversationPage
   - If invited guest → render JoinConversationLanding
4. Action: User clicks "Enter Conversation"
   - Calls api.joinConversation(id)
   - Backend performs atomic move (Guest → Member)
5. Success:
   - Navigate to ConversationPage
   - Optimistically prepend to store.conversations with 'Users' icon
   - Fetch initial messages
```

### Sharing a Conversation

```
1. Click Share button in ConversationHeader
2. ShareDialog opens with Public/Private tabs
3. Configure share options (expiration, recipients)
4. API call: POST /conversations/:id/shares
5. Share link generated and displayed for copying
```

---

## Sticky Agent Routing

Sticky routing is **owned by the backend**. The frontend must not inject previous agent IDs into the send payload when the user did not `@mention` anyone on the current turn.

### Contract

| Side | Responsibility |
|------|----------------|
| **Front** | Send `agentIds` / `teamIds` only when the composer extracted mentions; omit them otherwise |
| **Back** | On mention → `$set` conversation `taggedAgentIds`; on no mention (AI turn) → reuse `taggedAgentIds` |
| **Front store** | After a successful send, optionally patch `currentConversation.taggedAgentIds` from `userMessage.agentIds` **only when the set changed** |
| **ConversationPage** | `fetchMessages` depends on conversation **id**, not the whole conversation object — so sticky field updates do not soft-reload the message list |

### UX notes

- Follow-up messages without `@` continue with the last mentioned agent(s) automatically.
- Tagging new agents on a later message **replaces** the sticky set entirely (no merge).
- Group “Shared Agents” (`GET .../tagged-agents` / `groupMeta.taggedAgents`) remains a separate shared toolbox for the mention picker — not sticky routing.

### Related types

```typescript
interface Conversation {
  taggedAgentIds?: string[]; // last sticky routing set from the API
}

interface Message {
  agentIds?: string[]; // agents used for that turn (mention or sticky reuse)
}
```

---

## Performance Optimizations

### 1. Streaming Buffer

Chunks are batched using `requestAnimationFrame` to align with the browser's paint cycle (~60fps), preventing excessive React re-renders while ensuring smooth word-by-word streaming.

### 2. Memoized Components

Message bubbles are memoized to prevent re-renders:

```typescript
const MemoizedMessageBubble = memo(function MemoizedMessageBubble({...})
```

### 3. Selector Hooks with Shallow Compare

Use `useShallow` for complex selections:

```typescript
export const useDisplayMessages = () =>
  useConversationStore(useShallow((s) => { ... }));
```

### 4. Empty Array Constants

Prevent unnecessary re-renders from new array references:

```typescript
const EMPTY_MESSAGES: Message[] = [];
export const useMessages = () => useConversationStore((s) => (s.messages.length === 0 ? EMPTY_MESSAGES : s.messages));
```

### 5. Lazy Branch Fetching

Branch data is fetched only when messages are visible, not upfront.

### 6. Scroll Position Preservation

When loading older messages, scroll position is preserved using refs and `useLayoutEffect`.

---

## Usage Example

```tsx
import { ConversationPage, useConversationStore } from '@/modules/conversation';

// In your routes
<Route path='/c/:id' element={<ConversationPage />} />;

// Accessing store from anywhere
const { createConversation, sendMessage } = useConversationStore.getState();

// Creating a conversation
const conversation = await createConversation('My Chat');

// Sending a message with agent mentions
await sendMessage(conversation.id, {
  content: 'Hello, AI!',
  webSearchEnabled: true,
  agentIds: ['agent-id-1'], // Optional: route to specific agents
});
```

---

## Error Handling

### Critical Errors

Displayed via `StreamErrorDialog`:

- AI service unavailable
- Stream failed
- Response timeout

User can retry or dismiss.

### Non-Critical Errors

Displayed via toast notifications:

- Concurrent limit reached
- Already streaming
- File upload limit

### Error Codes

Mapped in `utils.ts`:

```typescript
const STREAM_ERROR_MAP = {
  ERR_1417: { title: 'AI Service Unavailable', ... },
  ERR_1406: { title: 'Stream Failed', ... },
  ERR_1407: { title: 'Response Timed Out', ... },
  ERR_1405: { title: 'Concurrent Limit Reached', ... },
  ERR_1409: { title: 'Already Streaming', ... },
  ERR_1410: { title: 'File Upload Limit', ... },
};
```

---

## Reply to a Message

Users can reply to specific messages within a conversation.

### Features
- **Contextual Replies**: Replies include a reference to the parent message.
- **Parent Preview**: A snippet of the parent message is displayed above the reply.
- **Quick Navigation**: Clicking the parent preview smoothly scrolls the conversation to the original message and highlights it.
- **Multi-turn Context**: The backend preserves the `parentMessageId` for each turn.

### Components
- `ParentMessagePreview`: Displays the sender's name and a text snippet of the parent message.
- `ConversationInput`: Handles the `replyTo` state and displays the message being replied to.
- `MessageActions`: Provides the "Reply" action for both user and AI messages.

### Data Model
- `Message.parentMessageId`: The UUID of the parent message.
- `SendMessagePayload.parentMessageId`: Sent to the API when creating a reply.

---

## Mention notifications & tracking

Group chats surface **@member** mentions end-to-end: backend persists mentions on `groupMeta.members`, pushes **`mention_created`** over the **conversation SSE** (`/conversations/stream`), and the UI shows **unseen counts** and a **jump-to-mention** control. This is distinct from **app-level notification REST APIs** in `src/lib/api/config.ts` under `API_ENDPOINTS.notifications` (list/unread/mark-read, etc.), which are not part of the conversation module.

### Configuration & REST (`src/lib/api/config.ts`, `api.ts`)

- **SSE**: `API_ENDPOINTS.conversations.stream` → `'/conversations/stream'` (same EventSource as streaming).
- **Mark seen**: `API_ENDPOINTS.conversations.markMentionSeen(conversationId, messageId)` → `PATCH /conversations/:id/mentions/:messageId/seen`.
- **`markMentionSeen(conversationId, messageId)`** in `api.ts` calls that endpoint; on success the store updates local `groupMeta.members[].mentions[].seenAt`.

### Types (`types.ts`)

- **`GroupMember.mentions`**: `{ messageId: string; seenAt?: string }[]`.
- **`StreamSSEEvent`**: includes `{ type: 'mention_created'; data: { conversationId; messageId; userId } }` ( **`userId`** = mentioned user).

### SSE dispatch (`stream.ts`)

`ConversationStreamService` parses SSE JSON and forwards **`mention_created`** to subscribers like any other event type.

### Store (`store.ts`)

- **`onMentionCreated`**: If the event’s `conversationId` matches a conversation in memory, appends `{ messageId }` to that **member’s** `mentions` for `event.userId` (deduped). Updates both **`conversations[]`** and **`currentConversation`** when applicable.
- **`markMentionSeen`**: PATCH then optimistically sets `seenAt` on the matching mention for the current user across list + current conversation.
- **`mentionNavigationLock` / `setMentionNavigationLock`**: Temporary flag while jumping to a mention so UI that would fight scroll (e.g. live streaming bubble at the bottom) can be suppressed (see `GroupConversationContent`).

### Hook (`hooks/useConversationStream.ts`)

After `conversationStreamService.connect()`, the subscription dispatches **`mention_created`** to **`store.onMentionCreated`**. This runs on any authenticated session using the hook (typically layout or conversation routes).

### Sidebar (`AppSidebar.tsx`, `ConversationItem.tsx`)

- **`AppSidebar`**: For each conversation, `mentionCount` = number of **unseen** mentions for the logged-in user:  
  `groupMeta.members.find(m => m.userId === user?.id)?.mentions?.filter(m => !m.seenAt).length`.
- **`ConversationItem`**: For group rows, shows a small **badge** on the group icon when `mentionCount > 0` (capped display `9+`).

### Group thread UI (`components/GroupConversationContent.tsx`)

- **Seen detection**: `IntersectionObserver` with **`root`** = the scrollable chat container (`getScrollContainer`), **`threshold: 0.5`**, so “seen” reflects visibility **inside the chat panel**, not only the browser viewport.
- **`markMentionSeen`**: Called when an unseen mention for the current user intersects; disconnects after one fire.
- **Streaming block**: The live streaming message block at the bottom is **not rendered** while **`mentionNavigationLock`** is true, avoiding extra layout/scroll-to-bottom conflicts with `use-stick-to-bottom`.

### Jump control (`components/MentionMessageJump.tsx`)

- Renders only when the current user has **at least one unseen** mention in **`currentConversation.groupMeta.members`**.
- **Oldest unseen first** (array order from the server / store).
- Ensures **correct branch** for AI messages (`setActiveBranch`) and **loads older pages** (`loadMoreMessages`) if the DOM node is missing.
- Uses **`stopScroll()`** from **`useStickToBottomContext`** so the chat does not re-stick to the bottom during/after navigation.
- Scroll: smooth scroll toward centered target, then **`scrollend`** (with timeout fallback) to **re-measure** and apply an **instant** scroll for a precise final position; short **position lock** interval to absorb competing updates.

### Simple (1:1) layout (`ConversationContent.tsx`)

Also wires mention-seen observers for group-capable data shape; group-specific UX is centered on **`GroupConversationPage`** / **`GroupConversationContent`**.

### Group member tagging (input)

In group conversations, the input receives **members** (everyone except the current user) for `@` tagging. When replying to a specific member, **`autoMention`** can prefill a mention—see input and **`EditableUserMessage`** for details.
