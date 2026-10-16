# Conversation Module

### Typed OpenUI interactions

`OpenUiAnswer` sends bounded `openUiSubmission` JSON with exact form values and
action parameters, source message/component and form name. Accepted submissions
reuse the existing message interaction field, hydrate the SDK renderer after
reload and keep a readable action label in the user bubble. Named forms retain
SDK validation, show submission progress/errors and allow changed values to be
submitted again. Failed retries retain their request ID; unchanged accepted or
pending submissions do not create another turn. Draft values remain local.
Server source/JSON checks do not turn user-entered values into trusted tool input.

### Saved image version history

`ImageVersionHistory` lazily loads the saved image's authorized family through
`getGeneratedImageHistory`. Each newly edited document stores its exact parent in
existing metadata; legacy images without lineage stay separate. The dialog lists
saved versions and uses the selected source for preview, download, edit and reuse.
Closing or changing scope aborts requests and revokes preview blobs. Reload loads
persisted lineage, without a frontend history store. The endpoint validates the
saved-answer anchor and conversation ownership before workspace enumeration;
foreign or unrelated selectors are rejected. Families above the bounded 1,000
image scan fail explicitly. See `ImageVersionHistory.test.tsx` and the backend
`conversation-image-history.spec.ts`.

Stream recovery checkpoints partial content with the existing lease heartbeat every
30 seconds. Interrupted answers retain the last checkpoint and show an incomplete
status after reload; retry creates a new answer. The last uncheckpointed tail may be
lost on a hard crash. See the backend stream and PostgreSQL cancellation regressions.

The conversation module provides the complete AI chat experience, handling real-time streaming responses, message management, branch navigation, agent mentioning, workspace linking, conversation sharing, and user interactions.

OpenUI generated-file buttons use `{type: "download_artifact", params: {filename: "exact-returned-filename.docx"}}`.
Only a unique ready artifact persisted on that answer can be downloaded; each click requests a fresh scoped URL
and uses the same blob transfer as attachment cards. Legacy artifact-relative links remain supported as selectors.
Keep original/edit captions paired with exact image reuse receipts and their `generated` flag, including PDF pages.

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

### OpenUI slides

Answer and conversation DOCX, HTML and print/PDF exports project the saved OpenUI
program with the installed parser, independently of mounted or collapsed views.
The shared projection preserves image/caption order, text, native tables and chart
data as editable tables. Images are embedded through existing answer-scoped
generated-image, citation and guarded web-image resolvers. Missing assets and
unsupported dynamic programs fail explicitly instead of producing partial files.
Regenerated answers are selected before resolving their assets.
HTML/PDF image labels are visible captions beneath each image as well as alt text;
print pagination keeps the image paragraph with its following caption where possible.

The answer Export menu also offers agent-generated DOCX and editable PPTX. These
send a structured content manifest and citation/page mapping through the existing
conversation agent; image selectors are prepared with `reuseImage` before the
configured MCP interpreter is used. This is an asynchronous agent request. A file
is available only after successful publication, not merely after sandbox creation.
The slide preview's existing image-based PPTX export remains a distinct format.
Coverage: `document-export.test.ts`, `openui-export-assets.test.ts`,
`docx-export.test.ts`, `MessageActions.test.tsx` and `ConversationHeader.test.tsx`.

Generative UI agents can answer a request for slides with a short `root = Card(...)` program followed
by a separate `root = Presentation({title: "Deck title"}, [s1, s2])` program. Each item is
`Slide("unique-id", content)` using the installed OpenUI presentation library. Title, photo, metric,
comparison, text and chart layouts are included in the generated agent prompt. Image URLs and numerical
data must come from tool results; optional images are omitted when unavailable.

The View chip opens the existing report panel, now labelled Preview, with stock slide thumbnails,
navigation and fullscreen controls where the browser supports fullscreen. Presentations and reports
are parsed separately from chat, including during streaming. Saved presentation-only answers retain
their renderer if the agent's Generative UI checkbox is later disabled. Panel ownership and cleanup
remain scoped to the answer; switching conversations or opening the document viewer closes the preview.
Slide source markers are retained in text and exposed as clickable chips below the artifact.
This reuses the existing artifact store and installed presentation library.

The preview header's Export menu downloads PDF or PowerPoint files with one 1920×1080 image per
slide; text and charts in PowerPoint are flattened. Export uses the standalone OpenUI print renderer,
adapting the saved Presentation root to SlideShow. `html-to-image`, `pdf-lib` and `pptxgenjs` are
loaded on demand. Public images are fetched directly when browser CORS permits; requests omit credentials
and referrers. If CORS blocks an HTTPS image, the authenticated message `slides/image` route in the
existing ConversationArtifactService accepts only exact URLs referenced by that saved AI answer.
It reuses GuardedUrlDownloaderService with connection-time public DNS validation on each redirect,
proxy bypass disabled, a 15-second deadline and
a 20 MiB streamed cap; only PNG/JPEG/WebP/GIF responses are returned as data URLs. Failed images
stop export with a translated message. Wikimedia thumbnail discovery URLs use the canonical upload
host with tracking-only parameters removed during export; saved answer URLs remain unchanged.
Exports allow 1–50 slides,
20 MiB per image, and a 60-second deadline; closing the preview cancels export and removes its stage.
No new service or schema is introduced.

Sources: `ReportBlock.tsx`, `report-program.ts`, `ReportPanelSidebar.tsx`, `render-mode.ts` and
`scripts/generate-openui-prompt.mjs`; focused coverage is in `ReportPanel.test.tsx` and `report-program.test.ts`.

### Generated images in OpenUI

The existing workspace storage quota also applies to generated/edited images.
If persistence returns `WORKSPACE_STORAGE_QUOTA_EXCEEDED` (`ERR_1930`, HTTP 403),
the ADK image tool reports a fixed storage-capacity message instead of suggesting
a provider retry. Other upstream failures remain sanitized; raw errors and signed
URLs are not exposed to the agent. The final exact-size upload check remains
authoritative. No quota is enlarged and no automatic generation retry occurs.

OpenUI images expose an action toolbar in chat, report and slide previews: edit,
compare saved images, reuse in DOCX/editable PPTX/OpenUI slides, and download.
Edit/reuse sends an explicit follow-up to the producing agent through the existing
conversation owner; opening or cancelling a dialog does not run a tool.
The edit dialog previews the selected authorized blob and its caption. Reuse opens
the same preview with an explicit format action before submission; cancellation
sends nothing. Pending submission points to execution progress in the conversation.
Edits read authorized source dimensions only on submission and pass the existing model's
landscape/portrait/square aspect class explicitly. Capability checks use the assigned
image tool and interpreter connector actions. Streaming,
governed mode and ambiguous producing-agent identity disable generation actions.
The saved text component identity is retained across report portals and reload.
Comparison resolves authorized saved sources lazily and releases temporary blob
URLs on close. Thumbnail/capture views omit interactive controls. PDF actions use
the cited PDF page (disclosed in the UI), rather than claiming to edit only its crop.
Coverage: `ImageActionToolbar.test.tsx`, `ConversationImageActions.test.tsx`,
`document-images.test.tsx`, `OpenUiRenderer.test.tsx` and `ReportPanel.test.tsx`.

In Admin → Tools, create the active native tool `generate_image` with a string `model`
attribute set to `gpt-image-2.5-flare`, then select it in the agent editor's Tools tab.
Generative UI controls presentation independently of this tool assignment. The model must
be active and classified `image_generation` in the catalog. The agent's chat model stays selected
for reasoning; the tool invokes the image model through the existing LiteLLM connection.
The internal generation route checks conversation membership and the accessible active agent's
tool/model configuration before spending. It generates one image, validates bounded raster bytes,
and stores it in the conversation system workspace without indexing. Governed conversations
are currently excluded. Cancellation aborts the provider request and prevents publication before upload.

The configured `generate_image` tool returns a persistent `generated-image:<24hex documentId>`
source. Its optional `sourceImage` argument edits an existing generated image in the same
conversation via LiteLLM `/v1/images/edits`. The backend loads bounded original bytes from
the conversation workspace and sends a multipart image; each edit creates a new file and
reference, preserving the original. Sources may also be public HTTPS raster image URLs or exact
image/PDF filenames in the conversation's system workspace or its currently accessible selected
workspaces. Ambiguous names, storage paths and inaccessible files fail closed. Web imports use the
existing DNS-pinned guarded downloader with MIME/magic checks and a 20 MiB/15-second bound.
PDF sources use `sourcePage` (1-based, default 1): the authenticated backend supplies bounded
authorized PDF bytes privately to the native ADK tool, which renders only that page with existing
PyMuPDF at at most 1400 pixels on its longest edge. A second internal request reauthorizes the
source and accepts only a bounded PNG; PDF bytes and prepared pixels never enter the model receipt.
Imported originals are saved without indexing as `generated-import-*` files. Their persistent
references retain the existing `generated-image:` format for compatibility but resolve with
`generated:false`; OpenUI shows preview/download without an AI-generated label. Edits are new
`generated:true` files and receipts also identify the preserved imported original.
Without `sourceImage`, generation is unchanged. OpenUI image
fields accept the returned source in images, galleries, cards and slide backgrounds.
For MCP document creation, the receipt also includes an authoritative `sandboxPath` under
`/mnt/workspace/generated-images/`. The backend stages a deterministic copy into the existing
conversation run folder, which MCP exposes at the sandbox workspace root; canonical image storage and OpenUI references remain
unchanged. The conversation runtime verifies current-turn image paths when creating a sandbox;
if a reused sandbox has stale mounts, the existing mount guard refreshes it once before execution.
Use `reuseImage` with an existing image reference to recover its sandbox path after
reload without calling the image model. It is mutually exclusive with `sourceImage`.
The code-interpreter skill consumes the returned path directly with `python-docx` or
`python-pptx`; PPTX text and shapes remain editable while the image is an embedded picture.
Write downloadable documents under the deployed MCP output contract,
`/mnt/yellowmind/run/outputs/`, then deliver those exact paths through the existing
`send_file_to_user` artifact flow. This output directory is separate from the authoritative
`/mnt/workspace/generated-images/` input paths; neither should be inferred from storage keys.
Artifact downloads resolve the authenticated message-scoped storage URL, then fetch it without
credentials or referrer and save a local blob using the artifact filename. This storage-transfer
exception avoids cross-origin link navigation; HTTP failures use the existing artifact error toast.
Resolution waits until answer completion, then calls the authenticated message-scoped
`POST /conversations/:conversationId/messages/:messageId/generated-images/:documentId/url`.
Only the returned authorized image URL is fetched, without credentials or referrer; a bounded
20 MiB raster response becomes a temporary browser blob URL. Reload resolves a fresh URL, and
unmount revokes the blob and cancels pending generated-image requests. Failed access has the
existing localized retry state. The image is labelled AI generated and keeps its proportions.
Ordinary Markdown answers also accept `![Description](generated-image:<documentId>)` after
stream completion. Generated images expose preview in a separate tab and a blob download link.
PDF/PPTX export resolves stable generated sources through the same authorized endpoint before
the standalone slide renderer runs; a failed image prevents exporting an incomplete deck.

### OpenUI document images

Agents with Generative UI enabled are instructed to obtain relevant images from their available tools
and use the stock OpenUI photo cards, grids, carousels and galleries. Web search and image-generation
results must provide an actual image URL; a web-page URL is insufficient. Generated illustrations
are labelled as generated. This does not add an image-search or generation tool to an agent:
its configured tools determine which images it can obtain. Without an image result the answer uses
text/icon cards, explaining missing pictures when requested. Document figures use the citation path below.
Travel and destination recommendations request photographs proactively, use a search tool's image-results
option when available, and reuse relevant returned URLs. The configured Linkup MCP connector supplies
web photographs directly to the model; stock OpenUI visual cards render those URLs with source chips in
their supported text. No document citation resolver or additional image proxy is involved for public photos.

When an agent's **Generative UI** checkbox and `VITE_OPENUI_RENDER_ENABLED` are enabled, its
OpenUI answer can use an attached document citation as an image source: `Image("Original figure", "[1]")`.
`ImageGallery` and the stock image cards, lists and image options accept the same references.
Only image source fields are resolved; citation markers in prose keep their usual source chips.

The renderer waits for answer completion, then resolves the citation through the existing
message citation URL endpoint or the owning root evidence endpoint. Private paths and signed
URLs are never placed in the stored OpenUI program. Image files are loaded into temporary blob
URLs; PDF figures are rasterized from the cited page and region with the installed EmbedPDF
engine. Without region metadata, the preview shows the cited page. Standalone figures retain
their proportions and have a source chip that opens the existing document viewer.

Reopening the answer resolves access again. Unknown references, non-document citations,
incomplete evidence identities and inaccessible files show a localized retryable error.
Temporary image URLs and PDF engines are released when their rendering work ends.
Standalone document figures keep their intrinsic width within a responsive 48rem container and
a 24rem height bound. Document galleries share the width bound and show complete figures without cropping.
The resolver introduces no new endpoint, persistence schema or service.

Sources: [`document-images.tsx`](components/openui/document-images.tsx),
[`pdf-image.ts`](components/openui/pdf-image.ts), [`library.tsx`](components/openui/library.tsx),
and [`generate-openui-prompt.mjs`](../../../scripts/generate-openui-prompt.mjs).
Focused regression coverage is in `document-images.test.tsx` and `pdf-image.test.ts` alongside the renderer.

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
useMessages(); // Get current messages
useDisplayMessages(); // Get messages filtered by active branch
useIsAwaitingFirstChunk(); // Check if waiting for first chunk
useCriticalError(); // Get critical error state
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
- **Clipboard images** — keyboard paste and the composer right-click Paste action upload image-only clipboard content. Plain text takes precedence over Office selection bitmaps; both paths retain attachment limits.
- **Attachment policy** — upload and message endpoints await refreshed settings before accepting files, avoiding false disabled errors after cache expiry while retaining disabled-policy enforcement.
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

### OpenUI image loading

`OpenUiRenderer` owns a bounded `createScopedImageCache` for each answer scope.
Repeated sources share pending/settled blobs; views own and revoke their object URLs.
The cache limits concurrency to four, caps entries at 128 and settled data at 32
images/64 MiB, and aborts on scope teardown. Failed references render individual
labeled retry actions; retrying one preserves successful URLs and other failures.
PDF loading/rendering observes cancellation. Coverage: `document-images.test.tsx`,
`document-images-cache.test.ts` and `pdf-image.test.ts`.
