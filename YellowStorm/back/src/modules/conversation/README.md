# Conversation Module (Backend)

The conversation module handles AI chat functionality including real-time streaming responses via gRPC/SSE, message management, conversation sharing, and content reporting.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Directory Structure](#directory-structure)
- [Module Configuration](#module-configuration)
- [Controllers](#controllers)
- [Services](#services)
- [Schemas](#schemas)
- [gRPC Integration](#grpc-integration)
- [SSE Streaming](#sse-streaming)
- [Guards & Decorators](#guards--decorators)
- [DTOs](#dtos)
- [Interfaces](#interfaces)
- [Error Codes](#error-codes)
- [API Endpoints](#api-endpoints)
- [Data Flow](#data-flow)
- [Timing Metrics](#timing-metrics)
- [Agent Integration](#agent-integration)
- [Sticky Agent Routing](#sticky-agent-routing)
- [Reply Threading](#reply-threading)
- [Group Member Tagging](#group-member-tagging)
- [Tagged Agents for Group Conversations](#tagged-agents-for-group-conversations)
- [Mention Notifications](#mention-notifications)

---

## Overview

The conversation module provides:

- **Conversation Management**: CRUD operations for chat conversations
- **Message Handling**: Send messages, receive AI responses, manage feedback
- **Real-time Streaming**: gRPC connection to AI service, SSE delivery to clients
- **Branch Navigation**: Support for regenerating responses (multiple AI answers per question)
- **Group Conversations**: Create and manage group chats with invited participants via email
- **Conversation Sharing**: Public links and private sharing with message snapshots
- **Content Reporting**: Report problematic AI responses with admin review workflow
- **Timing Metrics**: Track time to first chunk, first token, and total duration
- **Agent Integration**: Dynamic agent building with mono / single / multi+manager resolution for gRPC requests
- **Sticky Agent Routing**: Conversation-level `taggedAgentIds` reuse last `@mention` agents on subsequent turns without tags
- **Mono-Agent gRPC**: `RunSingleAgent` / `RunSingleAgentRequest` for single-agent flows (e.g. WhatsApp inbound replies — no manager, no SSE)
- **Email Invitations**: Automatic email notifications for participants invited to group conversations
- **Group @mentions**: Persisted mention records per member, `mention_created` SSE to mentioned users, and PATCH to mark mentions seen

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        CONVERSATION MODULE (NestJS)                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐       │
│  │   Controllers    │◄──►│    Services      │◄──►│    Schemas       │       │
│  │  (REST + SSE)    │    │  (Business Logic)│    │   (MongoDB)      │       │
│  └────────┬─────────┘    └────────┬─────────┘    └──────────────────┘       │
│           │                       │                                         │
│           ▼                       ▼                                         │
│  ┌──────────────────┐    ┌──────────────────┐                               │
│  │   StreamGateway  │    │   StreamService  │                               │
│  │   (SSE Manager)  │    │   (gRPC Client)  │                               │
│  └────────┬─────────┘    └────────┬─────────┘                               │
│           │                       │                                         │
│           ▼                       ▼                                         │
│  ┌──────────────────────────────────────────────────────────────────┐       │
│  │                         External Services                        │       │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐               │       │
│  │  │   MongoDB   │  │ AI Service  │  │   Azure     │               │       │
│  │  │  (Mongoose) │  │   (gRPC)    │  │    Blob     │               │       │
│  │  └─────────────┘  └─────────────┘  └─────────────┘               │       │
│  └──────────────────────────────────────────────────────────────────┘       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Technology | Purpose |
|------------|---------|
| **NestJS 10** | Backend framework with dependency injection |
| **MongoDB/Mongoose** | Database with schema validation |
| **gRPC** | High-performance streaming to AI service |
| **Server-Sent Events (SSE)** | Real-time streaming to browser clients |
| **RxJS** | Reactive stream handling for SSE |
| **JWT** | Authentication for both REST and SSE endpoints |
| **Protocol Buffers** | Type-safe gRPC message definitions |
| **class-validator** | DTO validation |
| **Swagger/OpenAPI** | API documentation |

---

## Directory Structure

```
conversation/
├── conversation.module.ts          # Module definition
├── index.ts                        # Public exports
├── controllers/
│   ├── conversation.controller.ts  # Conversation CRUD
│   ├── conversation-file.controller.ts # File upload/delete for conversations
│   ├── message.controller.ts       # Messages + streaming
│   ├── stream.controller.ts        # SSE endpoint
│   ├── share.controller.ts         # Sharing endpoints
│   └── report.controller.ts        # Reporting endpoints
├── services/
│   ├── conversation.service.ts     # Conversation business logic
│   ├── message.service.ts          # Message CRUD + completion
│   ├── stream.service.ts           # gRPC client + stream management
│   ├── stream-gateway.service.ts   # SSE connection management
│   ├── share.service.ts            # Sharing logic
│   └── report.service.ts           # Report management
├── schemas/
│   ├── conversation.schema.ts      # Conversation model
│   ├── message.schema.ts           # Message model
│   ├── report.schema.ts            # Report model
│   └── shared-conversation.schema.ts # Shared conversation model
├── interfaces/
│   ├── conversation.interface.ts   # Conversation types
│   ├── message.interface.ts        # Message types
│   ├── stream.interface.ts         # SSE event types
│   ├── share.interface.ts          # Share types
│   ├── report.interface.ts         # Report types
│   └── index.ts                    # Interface exports
├── dto/
│   ├── create-conversation.dto.ts
│   ├── update-conversation.dto.ts
│   ├── conversation-query.dto.ts
│   ├── send-message.dto.ts
│   ├── update-message.dto.ts
│   ├── message-query.dto.ts
│   ├── message-feedback.dto.ts
│   ├── conversation-file.dto.ts    # DTOs for file upload/confirm
│   ├── create-share.dto.ts
│   ├── create-report.dto.ts
│   └── report-query.dto.ts
├── guards/
│   ├── conversation-owner.guard.ts # Ownership verification
│   └── stream-auth.guard.ts        # SSE JWT authentication
├── decorators/
│   └── stream-auth.decorator.ts    # SSE auth decorator
└── proto/
    └── chatbot.proto               # gRPC service definition
```

---

## Module Configuration

The module is configured in `conversation.module.ts`:

```typescript
@Module({
  imports: [
    ConfigModule.forFeature(conversationConfig),
    MongooseModule.forFeature([
      { name: Conversation.name, schema: ConversationSchema },
      { name: Message.name, schema: MessageSchema },
      { name: Report.name, schema: ReportSchema },
      { name: SharedConversation.name, schema: SharedConversationSchema },
      { name: User.name, schema: UserSchema },
    ]),
    JwtModule.register({}),
    forwardRef(() => AuthModule),
    forwardRef(() => AuthorizationModule),
    forwardRef(() => WorkspaceModule),
    ModelsModule,
    LoggerModule,
    UsageModule,
    AgentModule,
  ],
  controllers: [
    StreamController,  // Must be before ConversationController (route priority)
    ConversationController,
    ConversationFileController,
    MessageController,
    ShareController,
    ReportController,
  ],
  providers: [...],
  exports: [
    ConversationService,
    MessageService,
    StreamService,
    StreamGatewayService,
  ],
})
```

### Configuration Options

```typescript
// config/conversation.config.ts
export default {
  grpcUrl: 'localhost:50051',
  grpcTimeoutMs: 120000,
  maxConcurrentStreams: 5,
  maxSseConnections: 5,
  sseHeartbeatMs: 15000,
  maxMessageLength: 50000,
  maxFilesPerMessage: 5,
  staleStreamCleanupMinutes: 30,
  shareExpiryDays: 30,
  systemWorkspaceStorageBytes: 52428800, // 50MB
  orphanedConversationThresholdHours: 24, // Hours before abandoned conversations are cleaned up
};
```

---

## Controllers

### ConversationController

Handles conversation CRUD operations.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/conversations` | POST | Create new conversation (supports `participantEmails` parameter) |
| `/conversations` | GET | List user's conversations (only members/owners) |
| `/conversations/:id` | GET | Get single conversation (with owner/member names) |
| `/conversations/:id/join` | POST | Join a group conversation (atomic move from invited to members) |
| `/conversations/:id/members/:memberId` | DELETE | Remove a member from a group conversation (owner only) |
| `/conversations/:id/members/:memberId/job` | PATCH | Update a member's role/job in a group conversation (owner only) |
| `/conversations/:id` | PATCH | Update conversation (title, archive, and add participants via `participantEmails`) |
| `/conversations/:id` | DELETE | Delete conversation |
| `/conversations/artifact-url` | POST | Get presigned URL for artifact download |
| `/conversations/:id/mentions/:messageId/seen` | PATCH | Mark a group mention as seen for the current user (`ConversationOwnerGuard`) |

### MessageController

Handles messages and AI streaming.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/conversations/:id/messages` | POST | Send message (triggers AI stream) |
| `/conversations/:id/messages` | GET | List messages (paginated) |
| `/conversations/:id/messages/:msgId` | GET | Get single message |
| `/conversations/:id/messages/:msgId` | PATCH | Update user message (content, `agentIds`, `memberIds`) |
| `/conversations/:id/messages/:msgId/feedback` | PATCH | Like/dislike message |
| `/conversations/:id/messages/:msgId/branches` | GET | Get AI response branches |
| `/conversations/:id/messages/:msgId/stop` | POST | Stop active stream |
| `/conversations/:id/messages/:msgId/regenerate` | POST | Regenerate AI response |

### StreamController

SSE endpoint for real-time streaming.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/conversations/stream` | GET (SSE) | Establish SSE connection |

### ShareController

Conversation sharing functionality.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/conversations/:id/shares` | POST | Create share link |
| `/conversations/:id/shares` | GET | List shares for conversation |
| `/conversations/shares/:token` | GET | View public share (no auth) |
| `/conversations/shares/:id/revoke` | POST | Revoke share |

### ReportController

Content reporting for admins.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/conversations/:id/messages/:msgId/report` | POST | Report message |
| `/reports` | GET | List all reports (admin) |
| `/reports/:id` | GET | Get report details (admin) |
| `/reports/:id/status` | PATCH | Update report status (admin) |

### ConversationFileController

File upload and management for conversation attachments. Files are stored in a per-conversation system workspace on Azure Blob Storage. Files are **not indexed** — indexing only applies to workspace document uploads.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/conversations/:id/files/upload-url` | POST | Get presigned upload URL for a file |
| `/conversations/:id/files/upload` | POST | Direct upload for small files (multipart) |
| `/conversations/:id/files/confirm` | POST | Confirm presigned URL upload completed |
| `/conversations/:id/files/:docId` | DELETE | Delete an attached file |

**Upload flow:**

1. Client calls `POST /upload-url` with `{ filename, mimeType, size }`
2. Backend creates a system workspace for the conversation (if not exists), generates a PENDING document record, and returns `{ documentId, uploadUrl, expiresAt }`
3. Client uploads directly to Azure using the presigned URL (XHR with progress tracking)
4. Client calls `POST /confirm` with `{ documentId }` to finalize
5. The `documentId` is included in the message's `attachedFileIds` when sending

**Blob path format:** `/{userId}/{conversationId}/{documentId}/{filename}`

**Race condition handling:** When multiple files are attached simultaneously, concurrent calls to `ensureSystemWorkspace` may race to create the same workspace. This is handled by catching MongoDB duplicate key errors (E11000) and retrying the lookup.

---

## Services

### ConversationService

Manages conversation lifecycle.

```typescript
class ConversationService {
  create(userId: string, data: CreateConversationData): Promise<ConversationResponse>
  findById(conversationId: string): Promise<ConversationResponse>  // Conditionally populates owner and member details for group chats
  joinGroup(conversationId: string, userId: string, email: string): Promise<ConversationResponse>  // Atomic join operation
  findAllByUser(userId: string, params: ConversationQueryParams): Promise<PaginatedConversations>  // Filters for membership
  update(conversationId: string, userId: string, data: UpdateConversationData): Promise<ConversationResponse> // Supports adding new participants
  delete(conversationId: string, userId: string): Promise<void>  // Cascade: messages, system workspace, documents, blobs
  ensureSystemWorkspace(userId: string, conversationId: string): Promise<string>  // Race-condition safe
  updateLastMessageAt(conversationId: string): Promise<void>
  addMessageRef(conversationId: string, messageId: string): Promise<void>

  // Cron
  @Cron(CronExpression.EVERY_HOUR)
  cleanupOrphanedConversations(): Promise<void>  // Removes abandoned conversations
}
```

### MessageService

Handles message operations and AI response completion.

```typescript
class MessageService {
  createUserMessage(data: CreateUserMessageData): Promise<MessageResponse>
  createAIPlaceholder(data: CreateAIPlaceholderData): Promise<MessageResponse>
  completeAIMessage(data: CompleteAIMessageData): Promise<MessageResponse>
  findByConversation(conversationId: string, params: MessageQueryParams): Promise<PaginatedMessages>
  findById(messageId: string): Promise<MessageResponse>
  updateFeedback(messageId: string, feedback: FeedbackType): Promise<MessageResponse>
  updateUserMessage(messageId: string, content: string, agentIds?: string[], memberIds?: string[]): Promise<MessageResponse>
  findBranchesByQuestion(questionMessageId: string): Promise<MessageResponse[]>
  deleteByConversation(conversationId: string): Promise<number>  // Bulk delete all messages for a conversation
  markStreamFailed(messageId: string): Promise<void>
  cleanupStaleStreams(olderThanMinutes: number): Promise<number>
}
```

### StreamService

gRPC client and stream orchestration.

```typescript
class StreamService implements OnModuleInit, OnModuleDestroy {
  // Lifecycle
  onModuleInit(): void    // Initialize gRPC client
  onModuleDestroy(): void // Cleanup connections

  // Stream management
  isAvailable(): boolean
  startStream(userId: string, conversationId: string, messageId: string, request: StreamRequest, requestId?: string): Promise<void>
  stopStream(userId: string, conversationId: string, messageId: string): Promise<void>

  // Mono-agent gRPC (no SSE gateway — used by WhatsApp module)
  runSingleAgentStream(params: {
    userId: string
    username: string
    conversationId: string
    messageId: string
    linkedAgentId: string
    query: string
    requestId?: string
  }): Promise<{ durationMs: number; componentCount: number; chunkCount: number }>

  // Name generation
  generateConversationNameAsync(userId: string, conversationId: string, query: string, modelId?: string): void

  // Health
  getHealthStatus(): GrpcHealthStatus

  // Cron jobs
  @Cron(CronExpression.EVERY_MINUTE)
  checkGrpcHealth(): Promise<void>

  @Cron(CronExpression.EVERY_10_MINUTES)
  cleanupStaleStreams(): Promise<void>
}
```

### StreamGatewayService

Manages SSE connections and event broadcasting.

```typescript
class StreamGatewayService implements OnModuleDestroy {
  registerConnection(userId: string, connectionId: string, disconnect$: Subject<void>): Observable<MessageEvent> | null
  removeConnection(userId: string, connectionId: string): void
  sendToUser(userId: string, event: StreamEvent): boolean
  isUserConnected(userId: string): boolean
  getUserConnectionCount(userId: string): number
}
```

### ShareService

Conversation sharing with snapshots and forking.

```typescript
class ShareService {
  createShare(userId: string, data: CreateShareData): Promise<ShareResponse>
  getSharesForConversation(conversationId: string): Promise<ShareResponse[]>
  revokeShare(shareId: string, userId: string): Promise<void>
  viewPublicShare(accessToken: string): Promise<PublicShareViewResponse>
}
```

### ReportService

Content reporting management.

```typescript
class ReportService {
  createReport(data: CreateReportData): Promise<ReportResponse>
  findAll(params: ReportQueryParams): Promise<PaginatedReports>
  findById(reportId: string): Promise<ReportDetailResponse>
  updateStatus(reportId: string, status: ReportStatus, adminNotes?: string): Promise<ReportResponse>
}
```

---

## Schemas

### Conversation Schema

```typescript
class Conversation {
  title: string;                    // Max 200 chars
  createdBy: ObjectId;              // User reference
  messages: ObjectId[];             // Message references
  workspaces: ObjectId[];           // Associated workspaces
  selectedSkills: ObjectId[];       // Sticky skill selection for the conversation
  taggedAgentIds: ObjectId[];       // Sticky routing agents (last @mention set)
  systemWorkspaceId?: ObjectId;     // Auto-created for file attachments
  lastMessageAt?: Date;             // For sorting
  messageCount: number;             // Counter
  isArchived: boolean;
  isShared: boolean;
  sharedFrom?: ObjectId;            // If forked from shared
  isFirstMessage: boolean;          // For name generation trigger
  createdAt: Date;
  updatedAt: Date;
  groupMeta?: {
    isGroup: boolean;
    members: { userId: ObjectId; joinedAt: Date; status: string; job?: string }[];
    invitedUsers: { email: string; status: string; invitedAt: Date }[];
    taggedAgents?: ObjectId[];      // Group shared toolbox ($addToSet; not sticky routing)
  };
}

// Indexes
{ createdBy: 1, lastMessageAt: -1 }
{ createdBy: 1, isArchived: 1, lastMessageAt: -1 }
{ createdBy: 1, createdAt: -1 }
```

### Message Schema

```typescript
class Message {
  conversationId: ObjectId;
  conversationType: 'user' | 'ai';

  // User messages
  content?: string;                 // Max 50000 chars

  // AI messages
  components?: MessageComponent[];  // Structured response parts

  // Attachments
  attachedFileIds?: ObjectId[];     // References to WorkspaceDocument

  // Mentioned agent IDs (preserved for regenerate)
  agentIds?: ObjectId[];            // References to Agent

  // Mentioned member IDs
  memberIds?: ObjectId[];           // References to User

  // Reply threading
  parentMessageId?: ObjectId;       // Reference to the parent message being replied to

  // Sender tracking
  senderId?: ObjectId;              // User who sent this message (for group chats)

  // AI metadata
  modelId?: string;
  webSearchEnabled: boolean;

  // Bidirectional linking (for branches)
  questionMessageId?: ObjectId;     // AI → User (which question this answers)
  answerMessageId?: ObjectId;       // User → AI (first answer)

  // Feedback
  feedback?: 'like' | 'dislike';
  feedbackAt?: Date;

  // Edit tracking
  isEdited: boolean;
  editedAt?: Date;

  // Streaming state
  isStreaming: boolean;
  isComplete: boolean;

  // Token usage
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;

  // Timing metrics
  timeToFirstChunk?: number;        // ms until first gRPC chunk
  timeToFirstToken?: number;        // ms until first text/reasoning content

  // Request tracking
  requestId?: string;

  createdAt: Date;
  updatedAt: Date;
}

// Indexes
{ conversationId: 1, createdAt: 1 }
{ conversationId: 1, conversationType: 1 }
{ questionMessageId: 1 }
{ isStreaming: 1, updatedAt: 1 }
{ requestId: 1 }
```

### MessageComponent Types

```typescript
type ComponentType =
  | 'text'        // Markdown text
  | 'code'        // Code with language
  | 'reasoning'   // AI thought process
  | 'plan'        // Execution plan with steps
  | 'queue'       // Task queue
  | 'checkpoint'  // Progress marker
  | 'chart'       // Data visualization
  | 'task'        // Task list
  | 'error'       // Error message
  | 'sources'     // Web search results
  | 'sandbox'     // Python code execution
  | 'webPreview'  // HTML/CSS/JS preview
  | 'artifact'    // Generated file
  | 'citation';   // Document citation reference
```

---

## gRPC Integration

### Proto Definition

Located at `proto/chatbot.proto`:

```protobuf
service ChatbotService {
    rpc RunAgentTeam(RunAgentTeamRequest) returns (stream StreamChunk);
    rpc RunSingleAgent(RunSingleAgentRequest) returns (stream StreamChunk);
    rpc GenerateConversationName(GenerateConversationNameRequest) returns (GenerateConversationNameResponse);
}

message Agent {
    string id = 1;
    string name = 2;
    string description = 3;
    string prompt = 4;
    repeated Tool tools = 5;
    repeated WorkspaceContext brain_context = 6;
    Chatbot chatbot = 7;           // Contains { model: string }
    AgentParams agent_params = 8;
    string agent_type = 9;         // e.g., "manager", "researcher"
    bool save_memory = 10;
}

message RunAgentTeamRequest {
    UserContext user_context = 1;
    string conversation_id = 2;
    string query = 3;
    repeated Agent agents = 6;
    repeated WorkspaceContext workspace_context = 8;
    string agent_mode = 9;                              // "manual"
    repeated AttachedFile attached_files = 10;           // Files attached in this turn
    repeated Document previous_attached_files = 11;      // Already-indexed files from previous turns
}

// Mono-agent: one specialized agent runs directly (no manager / no agent_mode).
// ADK sets agent_mode=mono internally. Used by WhatsApp inbound replies.
message RunSingleAgentRequest {
    UserContext user_context = 1;
    string conversation_id = 2;
    string query = 3;
    Agent agent = 4;                                     // Single agent to run
    repeated WorkspaceContext workspace_context = 5;
    repeated AttachedFile attached_files = 6;
    repeated Document previous_attached_files = 7;
    ConnectorRepo connector_repo = 8;
    repeated Skill skills = 9;
}

message AttachedFile {
    string type = 1;                     // "image" or "document"
    oneof data {
        ImageData image = 2;
        DocumentData document = 3;
    }
}

message ImageData {
    string filepath = 1;
}

message DocumentData {
    string filepath = 1;
    string filename = 2;
    string external_id = 3;
    string workspace_id = 4;
    string source = 5;
    string brain_type = 7;               // "doc" or "graph"
    string lang_code = 8;                // ISO 639-1
    int32 chunk_size = 9;
    int32 chunk_overlap = 10;
    bool enable_smart_chunk = 11;
    bool enable_extract_images = 12;
    string sheet_name = 13;
    bool in_memory = 14;
}

message Document {
    string _id = 1;
    string filename = 2;
    string filepath = 3;
    bool in_memory = 4;
    string language = 5;
    int32 indexing_token = 6;
    string workspace_id = 7;
}

message StreamChunk {
    string action = 1;           // "add", "update", or "delete"
    Component component = 2;     // The component data
    Metadata metadata = 3;       // Message/agent IDs
    Usage usage = 4;             // Token usage
}

message Metadata {
    string message_id = 1;       // Message/session ID
    string agent_id = 2;         // Agent that produced this chunk
}

message Component {
    string id = 1;
    oneof data {
        TextComponent text = 2;
        CodeComponent code = 3;
        ReasoningComponent reasoning = 4;
        PlanComponent plan = 5;
        QueueComponent queue = 6;
        CheckpointComponent checkpoint = 7;
        ChartComponent chart = 8;
        TaskComponent task = 9;
        ErrorComponent error = 10;
        SourcesComponent sources = 11;
        SandboxComponent sandbox = 12;
        WebPreviewComponent web_preview = 13;
        ArtifactComponent artifact = 14;
        CitationComponent citation = 15;
    }
}

message PlanStep {
    string task = 1;             // Task description
    string agent = 2;            // Agent assigned to this task
    TaskStatus status = 3;       // PENDING, IN_PROGRESS, COMPLETED, ERROR
}
```

### gRPC Client Initialization

```typescript
// StreamService.initGrpcClient()
const protoPath = path.resolve(process.cwd(), 'src/modules/conversation/proto/chatbot.proto');
const packageDefinition = protoLoader.loadSync(protoPath, { ... });
const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
this.chatbotClient = new chatbotPackage.ChatbotService(grpcUrl, grpc.credentials.createInsecure());
```

### Stream Execution (`RunAgentTeam`)

```typescript
// StreamService.executeGrpcStream()
1. Create gRPC call: chatbotClient.RunAgentTeam(request)
2. Start idle timeout (120s default)
3. On 'data':
   - Reset idle timeout
   - Capture timeToFirstChunk (first chunk)
   - Capture timeToFirstToken (first text/reasoning)
   - Buffer component updates
   - Throttle delivery to frontend (~60fps)
   - Track token usage
4. On 'end':
   - Persist components to MongoDB
   - Record usage
   - Send stream_complete via SSE
5. On 'error':
   - Persist partial buffer
   - Record partial usage
   - Send stream_error via SSE
```

### Mono-Agent Stream Execution (`RunSingleAgent`)

Used when a **single linked agent** must run without manager orchestration and without SSE delivery (WhatsApp module today).

```typescript
// StreamService.runSingleAgentStream() → executeSingleAgentGrpcStream()
1. Build one IGrpcAgent via AgentService.buildGrpcAgentsForPlaybook([linkedAgentId])
2. Resolve brain contexts + workspace context + previous_attached_files
3. Assemble RunSingleAgentRequest:
   {
     user_context, conversation_id, query,
     agent,              // single agent (not agents[])
     workspace_context,
     attached_files: [],
     previous_attached_files
   }
4. chatbotClient.RunSingleAgent(request, { metadata: { user: username } })
5. Buffer StreamChunk components server-side (add/update/delete)
6. On 'end': MessageService.completeAIMessage() — no SSE, no usage gateway events
7. On error/timeout: MessageService.markStreamFailed()
```

| Aspect | `RunAgentTeam` | `RunSingleAgent` |
|--------|----------------|------------------|
| Agents | `repeated Agent` + manager | Single `Agent` |
| `agent_mode` | Yes (`manual`, etc.) | Omitted (ADK uses `mono`) |
| SSE delivery | Yes (`StreamGatewayService`) | No |
| Typical caller | Web chat `startStream()` | `WhatsAppStreamService` |
| Idle timeout | `conversation.grpcTimeoutMs` (120s) | `conversation.grpcTimeoutMs` (120s) |

**Proto requirement:** `chatbot.proto` must include `RunSingleAgent` in `ChatbotService`. If the RPC is missing from the loaded proto, the gRPC client will not expose `RunSingleAgent` at runtime (`is not a function`). Restart the backend after proto changes.

---

## SSE Streaming

### Connection Flow

```
1. Client connects: GET /conversations/stream?token=JWT
2. SseAuthGuard validates JWT from query param
3. StreamController.stream() called
4. StreamGatewayService.registerConnection() creates Subject
5. Merge event stream with heartbeat interval (15s)
6. Return Observable<MessageEvent>
7. On client disconnect: cleanup connection
```

### Event Types

```typescript
type StreamEvent =
  | { type: 'connected'; data: { connectionId: string } }
  | { type: 'heartbeat'; data: { timestamp: number } }
  | { type: 'stream_start'; data: { conversationId, messageId } }
  | { type: 'stream_chunk'; data: { conversationId, action, component } }
  | { type: 'stream_complete'; data: { conversationId, messageId, usage } }
  | { type: 'stream_error'; data: { conversationId, errorCode, message } }
  | { type: 'conversation_name_generated'; data: { conversationId, name } }
  | { type: 'message_created'; data: { conversationId, message } }
  | { type: 'message_updated'; data: { conversationId, messageId, message } };
```

### Broadcasting

For group conversations, events are broadcast to all connected members using `StreamGatewayService.broadcastToConversation()`. This ensures a synchronized experience across all participants without requiring page reloads:
- **AI Streaming**: Every chunk of the AI response is sent to all group members simultaneously.
- **User Messages**: Instant notification when any member sends a new message.
- **Updates**: Real-time feedback for message edits and reactions/feedback.

### Connection Limits

- Max 5 SSE connections per user
- Max 5 concurrent streams per user
- Heartbeat every 15 seconds
- Idle timeout: 120 seconds (no data)

---

## Guards & Decorators

### ConversationOwnerGuard

Verifies the current user owns the conversation.

```typescript
@UseGuards(ConversationOwnerGuard)
@Get(':id')
async findOne(@Param('id') id: string) { ... }
```

### SseAuthGuard + @StreamAuth()

Authenticates SSE connections via JWT in query parameter.

```typescript
@Sse()
@Public()
@StreamAuth()
stream(@Req() req: RequestWithSseUser): Observable<MessageEvent> { ... }
```

### UsageLimitGuard + @CheckUsage()

Checks user's usage limits before allowing message send.

```typescript
@Post()
@UseGuards(UsageLimitGuard)
@CheckUsage()
async sendMessage(...) { ... }
```

---

## DTOs

### SendMessageDto

```typescript
class SendMessageDto {
  @IsString()
  @MaxLength(50000)
  content: string;

  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  attachedFileIds?: string[];

  @IsOptional()
  @IsBoolean()
  webSearchEnabled?: boolean;

  @IsOptional()
  @IsString()
  modelId?: string;

  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  agentIds?: string[];            // Mentioned agent IDs (for agent selection)

  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  memberIds?: string[];           // Mentioned member IDs

  @IsOptional()
  @IsMongoId()
  parentMessageId?: string;       // ID of the message being replied to
}
```

### UpdateMessageDto

```typescript
class UpdateMessageDto {
  @IsString()
  @MaxLength(50000)
  content: string;

  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  agentIds?: string[];            // Agent IDs mentioned in the message

  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  memberIds?: string[];           // Member IDs mentioned in the message
}
```

### MessageFeedbackDto

```typescript
class MessageFeedbackDto {
  @IsIn(['like', 'dislike', null])
  feedback: 'like' | 'dislike' | null;
}

---

## AI Response Suppression

The backend implements logic to skip AI responses under certain conditions:

- **Member Tagging**: In the `MessageController.sendMessage` and `MessageService.createUserMessage` flows, if any `memberIds` (representing tagged group members) are present in the message, the AI response stream is skipped.
- **Why**: This prevents AI agents from interrupting human-to-human interactions when group members are specifically mentioned.
- **Message Editing**: Similarly, when a user message is edited to include member tags, AI regeneration is not triggered.

---

## Tagged Agents for Group Conversations

In group conversations (`isGroup: true`), agents tagged by users in their messages are automatically persisted to the conversation's metadata (`groupMeta.taggedAgents`). This allows all members of the conversation to see and use the same agents, creating a **shared toolbox**.

> **Not the same as sticky routing.** `groupMeta.taggedAgents` is append-only (`$addToSet`) and expands the agent pool available in group streams. Sticky routing (`taggedAgentIds`) selects which agents run on untagged follow-ups — see [Sticky Agent Routing](#sticky-agent-routing).

### Persistence Workflow

1.  **Tag Detection**: When a user sends or updates a message with `agentIds`, the `MessageService` detects these mentions.
2.  **Metadata Update**: The `ConversationService.updateTaggedAgents` method is called to add these new agent IDs to the `groupMeta.taggedAgents` array using a MongoDB `$addToSet` operation.
3.  **Global Availability**: Once persisted, these agents are considered "shared" within the conversation.

### API Access

A dedicated endpoint allows the frontend to retrieve all agents that have been tagged in a conversation:

*   **Endpoint**: `GET /api/v1/conversations/:id/tagged-agents`
*   **Security**: Protected by `ConversationOwnerGuard` (ensures only members or owners can access).
*   **Response**: Returns an array of populated `Agent` objects.

### Streaming Integration

When any member triggers an AI response in a group conversation, the `StreamService` automatically includes all previously tagged agents:

1.  The `StreamService.startStream` method fetches the conversation document and extracts `groupMeta.taggedAgents`.
2.  These IDs are passed to `AgentService.buildAgentsForStream` as `sharedAgentIds` (roster expansion).
3.  The **selection** of which agents run still comes from the turn’s `agentIds` (mentions). Empty selection → mono-agent fallback. Sticky `taggedAgentIds` is **not** applied in groups.

---

### CreateReportDto

```typescript
class CreateReportDto {
  @IsIn(['inaccurate', 'wrong_information', 'offensive', 'out_of_context', 'hallucination', 'other'])
  reason: ReportReason;

  @IsString()
  @MaxLength(2000)
  description: string;
}
```

---

## Interfaces

### CompleteAIMessageData

```typescript
interface CompleteAIMessageData {
  messageId: string;
  components: MessageComponent[];
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  timeToFirstChunk?: number;
  timeToFirstToken?: number;
}
```

### CreateUserMessageData

```typescript
interface CreateUserMessageData {
  conversationId: string;
  content: string;
  attachedFileIds?: string[];
  webSearchEnabled?: boolean;
  modelId?: string;
  agentIds?: string[];            // Mentioned agent IDs
  requestId?: string;
}
```

### MessageResponse

```typescript
interface MessageResponse {
  id: string;
  conversationId: string;
  conversationType: 'user' | 'ai';
  content?: string;
  components?: MessageComponent[];
  attachedFileIds?: string[];
  attachedFiles?: AttachedFileResponse[];  // Enriched file data with download URLs
  agentIds?: string[];                     // Mentioned agent IDs (user messages)
  modelId?: string;
  webSearchEnabled: boolean;
  questionMessageId?: string;
  answerMessageId?: string;
  feedback?: 'like' | 'dislike';
  feedbackAt?: string;
  isEdited?: boolean;
  editedAt?: string;
  isStreaming: boolean;
  isComplete: boolean;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  timeToFirstChunk?: number;
  timeToFirstToken?: number;
  requestId?: string;
  createdAt: string;
  updatedAt: string;
}

interface AttachedFileResponse {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  downloadUrl: string;  // Presigned read SAS URL
}
```

---

## Error Codes

| Code | Constant | Description |
|------|----------|-------------|
| ERR_1400 | CHAT_NOT_FOUND | Conversation not found |
| ERR_1401 | CHAT_FORBIDDEN | No access to conversation |
| ERR_1402 | CHAT_MESSAGE_NOT_FOUND | Message not found |
| ERR_1403 | CHAT_MESSAGE_TOO_LONG | Message exceeds 50000 chars |
| ERR_1404 | CHAT_INVALID_FEEDBACK | Invalid feedback operation |
| ERR_1405 | CHAT_STREAM_LIMIT | Max concurrent streams reached |
| ERR_1406 | CHAT_STREAM_FAILED | Stream failed unexpectedly |
| ERR_1407 | CHAT_STREAM_TIMEOUT | Stream idle timeout |
| ERR_1408 | CHAT_FILE_UPLOAD_LIMIT | Max files per message exceeded |
| ERR_1409 | CHAT_ALREADY_STREAMING | Conversation already streaming |
| ERR_1410 | CHAT_SHARE_NOT_FOUND | Share not found |
| ERR_1411 | CHAT_SHARE_FORBIDDEN | No access to share |
| ERR_1412 | CHAT_SHARE_REVOKED | Share has been revoked |
| ERR_1413 | CHAT_SHARE_EXPIRED | Share link expired |
| ERR_1414 | CHAT_REPORT_DUPLICATE | Already reported this message |
| ERR_1415 | CHAT_REPORT_NOT_FOUND | Report not found |
| ERR_1417 | CHAT_GRPC_UNAVAILABLE | AI service unavailable |

---

## API Endpoints

### Conversations

```
POST   /api/v1/conversations                    Create conversation
GET    /api/v1/conversations                    List conversations
GET    /api/v1/conversations/:id                Get conversation
PATCH  /api/v1/conversations/:id                Update conversation
DELETE /api/v1/conversations/:id                Delete conversation
POST   /api/v1/conversations/artifact-url       Get artifact download URL
```

### Messages

```
POST   /api/v1/conversations/:id/messages                    Send message
GET    /api/v1/conversations/:id/messages                    List messages
GET    /api/v1/conversations/:id/messages/:msgId             Get message
PATCH  /api/v1/conversations/:id/messages/:msgId             Update user message
PATCH  /api/v1/conversations/:id/messages/:msgId/feedback    Update feedback
GET    /api/v1/conversations/:id/messages/:msgId/branches    Get branches
POST   /api/v1/conversations/:id/messages/:msgId/stop        Stop stream
POST   /api/v1/conversations/:id/messages/:msgId/regenerate  Regenerate response
POST   /api/v1/conversations/:id/messages/:msgId/report      Report message
```

### File Attachments

```
POST   /api/v1/conversations/:id/files/upload-url   Get presigned upload URL
POST   /api/v1/conversations/:id/files/upload        Direct upload (small files)
POST   /api/v1/conversations/:id/files/confirm       Confirm presigned upload
DELETE /api/v1/conversations/:id/files/:docId         Delete attached file
```

### Streaming

```
GET    /api/v1/conversations/stream?token=JWT   SSE connection
```

### Shares

```
POST   /api/v1/conversations/:id/shares         Create share
GET    /api/v1/conversations/:id/shares         List shares
GET    /api/v1/conversations/shares/:token      View public share
POST   /api/v1/conversations/shares/:id/revoke  Revoke share
```

### Reports (Admin)

```
GET    /api/v1/reports                          List reports
GET    /api/v1/reports/:id                      Get report detail
PATCH  /api/v1/reports/:id/status               Update report status
```

---

## Data Flow

### Send Message Flow

```
1. POST /conversations/:id/messages
   Body: { content, attachedFileIds?, webSearchEnabled?, modelId?, agentIds?, teamIds?, memberIds? }
2. MessageController.sendMessage()
   ├── Validate model is active (ModelsService)
   ├── Check AI service available (StreamService.isAvailable())
   ├── Check if first message (for name generation)
   ├── Create system workspace if files attached
   ├── resolveAgentIds(dto.agentIds, dto.teamIds) → mentionedAgentIds
   ├── resolveStickyAgentRouting
   │   ├── mention → replaceTaggedAgentIds (full $set on conversation.taggedAgentIds)
   │   ├── sticky  → reuse conversation.taggedAgentIds
   │   └── none    → undefined (mono-agent later in buildAgentsForStream)
   └── effectiveAgentIds passed to message + stream
3. MessageService.createUserMessage()
   ├── Validate content length (50000 max)
   ├── Validate file count (5 max)
   ├── Create message document (stores effective agentIds for regenerate)
   ├── updateTaggedAgents (group roster $addToSet only if isGroup)
   └── Update conversation refs
4. MessageService.createAIPlaceholder()
   ├── Create AI message (isStreaming: true)
   └── Link to question message
5. StreamService.startStream() [non-blocking]
   ├── Register active stream
   ├── Create component buffer
   ├── Send stream_start via SSE
   ├── Fetch conversation document (for workspace IDs + systemWorkspaceId)
   ├── In parallel:
   │   ├── Build workspace contexts from linked workspaces
   │   └── Build agents via AgentService.buildAgentsForStream(request.agentIds, sharedAgentIds)
   ├── In parallel:
   │   ├── Resolve agent brain contexts (knowledge bases)
   │   ├── Build attached_files (current turn: images + documents with indexing config)
   │   └── Build previous_attached_files (prior turns from system workspace)
   └── Execute gRPC stream with agents, attached_files, previous_attached_files
6. StreamService.generateConversationNameAsync() [fire-and-forget]
7. Return { userMessage } immediately
```

### gRPC Stream Processing (`RunAgentTeam`)

```
1. chatbotClient.RunAgentTeam(request)
   Request includes: user_context, conversation_id, query, agents[], workspace_context[], agent_mode, attached_files[], previous_attached_files[]
2. On each chunk:
   ├── Reset idle timeout
   ├── Track timing metrics
   │   ├── timeToFirstChunk (chunk #1)
   │   └── timeToFirstToken (first text/reasoning)
   ├── Read metadata.agent_id (tracks which agent produced the chunk)
   ├── Apply to component buffer
   ├── Send to frontend immediately via SSE (no backend buffering)
   └── Accumulate token usage
3. On stream end:
   ├── MessageService.completeAIMessage()
   │   └── Persist components + timing + usage
   ├── UsageService.recordUsage()
   ├── Send stream_complete via SSE
   └── Cleanup stream state
```

### WhatsApp Mono-Agent Flow (`RunSingleAgent`)

```
1. WhatsAppMessageService routes inbound DM
2. MessageService.createUserMessage + createAIPlaceholder
3. WhatsAppStreamService.runStream()
4. StreamService.runSingleAgentStream()
   ├── buildGrpcAgentsForPlaybook([linkedAgentId])
   ├── Build RunSingleAgentRequest
   └── chatbotClient.RunSingleAgent(request)
5. Buffer chunks → MessageService.completeAIMessage()
6. WhatsApp extracts reply text → Baileys sendMessage
```

See [WhatsApp Module](../whatsapp/README.md) for pairing, bindings, and outbound delivery.

### Regenerate Flow

When regenerating an AI response, the original user message's `agentIds` are reused so the same agent configuration is applied:

```
1. POST /conversations/:id/messages/:msgId/regenerate
2. MessageController.regenerate()
   ├── Fetch original AI message → get questionMessageId
   ├── Fetch original user message → extract agentIds
   ├── Create new AI placeholder
   └── Start stream with original message data (content, attachedFileIds, agentIds)
3. StreamService.startStream() uses the extracted agentIds
   └── Same agent building + gRPC flow as normal send
```

### Chunk Delivery (No Backend Buffering)

Chunks are sent immediately to the frontend via SSE as they arrive from gRPC — there is no backend-side throttling. The frontend handles frame-rate alignment using `requestAnimationFrame` to batch chunks into ~60fps renders, ensuring smooth word-by-word streaming without artificial delays on the server.

```typescript
// Each gRPC chunk is sent directly to the user
this.streamGateway.sendToUser(userId, {
  type: 'stream_chunk',
  data: { conversationId, action, component: { id, type, data } },
});
```

---

## Timing Metrics

The module captures three timing metrics for each AI response:

### Time to First Chunk (timeToFirstChunk)

Time from stream start until the first gRPC chunk arrives.

```typescript
// Captured in executeGrpcStream()
if (chunkCount === 1) {
  timeToFirstChunk = Date.now() - startTime;
}
```

### Time to First Token (timeToFirstToken)

Time until the first meaningful content (text or reasoning) appears.

```typescript
// Captured when processing components
if (timeToFirstToken === null) {
  if ((type === 'text' || type === 'reasoning') && data?.content) {
    timeToFirstToken = Date.now() - startTime;
  }
}
```

### Total Duration (durationMs)

Total time from stream start to completion.

```typescript
// Captured on stream end
const durationMs = Date.now() - startTime;
```

### Persistence

All timing metrics are persisted to the message document and returned in API responses:

```typescript
await this.messageService.completeAIMessage({
  messageId,
  components,
  inputTokens,
  outputTokens,
  durationMs,
  timeToFirstChunk: timeToFirstChunk ?? undefined,
  timeToFirstToken: timeToFirstToken ?? undefined,
});
```

---

## Cron Jobs

### gRPC Health Check

```typescript
@Cron(CronExpression.EVERY_MINUTE)
async checkGrpcHealth() {
  // Tests gRPC connection, updates isGrpcAvailable flag
}
```

### Stale Stream Cleanup

```typescript
@Cron(CronExpression.EVERY_10_MINUTES)
async cleanupStaleStreams() {
  // Marks streams stuck in isStreaming=true as failed
  // Default: streams older than 30 minutes
}
```

### Orphaned Conversation Cleanup

```typescript
@Cron(CronExpression.EVERY_HOUR)
async cleanupOrphanedConversations() {
  // Deletes conversations that were created but never used (no messages sent)
  // Criteria: messageCount=0, isFirstMessage=true, isShared=false, older than threshold
  // Also cleans up: messages (safety), system workspace, documents, Azure blobs
  // Default threshold: 24 hours (CONVERSATION_ORPHANED_THRESHOLD_HOURS)
  // Batch limit: 50 per run
}
```

---

## Agent Integration

The conversation module depends on the `AgentModule` to dynamically build and resolve agents before every gRPC stream request. Agents are the AI personas that handle the user's query.

### How Agents Are Passed

When the client sends a message, it can optionally include `agentIds` / `teamIds` (from `@` mentions). Before streaming, `MessageController.sendMessage`:

1. Expands teams into agent IDs and merges with direct agent mentions
2. Applies **sticky routing** via `resolveStickyAgentRouting` (see [Sticky Agent Routing](#sticky-agent-routing))
3. Persists the **effective** agent IDs on the user message (`Message.agentIds`) for regenerate
4. Passes those IDs to `StreamService.startStream()` → `AgentService.buildAgentsForStream()`

### Building Agents for Stream

`AgentService.buildAgentsForStream(userId, fallbackModelId?, agentIds?, sharedAgentIds?)` is called inside `StreamService.startStream()` and performs the following:

```
1. Fetch agents available to the user
   ├── Personal agents (created by the user)
   ├── Admin default agents
   └── Shared group agents (sharedAgentIds from groupMeta.taggedAgents, if any)

2. Filter to pinged agents from agentIds (effective IDs for this turn)
   ├── If agentIds provided → filter to those agents present in the roster
   └── If no agentIds → pingedAgents = []

3. Resolve roster by ping count
   ├── 0 tagged  → mono-agent only (resolveDefaultMonoAgent; type slug "mono-agent")
   ├── 1 tagged  → that agent only (RunSingleAgent; no manager)
   └── 2+ tagged → those agents + one manager (RunAgentTeam)

4. Batch-resolve resources (prompts, tools, models)

5. Assemble IGrpcAgent[] for gRPC
```

### Manager Resolution

A manager is included **only** when 2+ agents are tagged. Resolution priority:

| Priority | Description |
|----------|-------------|
| 1 | **Pinged manager** — a manager explicitly mentioned via `agentIds` |
| 2 | **Personal default-for-type** — user's own manager marked as `isDefaultForType: true` |
| 3 | **First personal manager** — any manager created by the user |
| 4 | **Admin default-for-type** — admin manager marked as `isDefaultForType: true` |
| 5 | **First admin manager** — any admin-created default manager |

```typescript
private resolveManager(
  allAgents: IAgentForStream[],
  pingedAgents: IAgentForStream[],
): IAgentForStream | undefined {
  const isManager = (a: IAgentForStream) => a.agentTypeSlug === 'manager';

  const pingedManager = pingedAgents.find(isManager);
  if (pingedManager) return pingedManager;

  const personalManagers = allAgents.filter((a) => isManager(a) && !a.isDefault);
  const adminManagers = allAgents.filter((a) => isManager(a) && a.isDefault);

  return personalManagers.find((a) => a.isDefaultForType)
    || personalManagers[0]
    || adminManagers.find((a) => a.isDefaultForType)
    || adminManagers[0];
}
```

---

## Sticky Agent Routing

Sticky routing keeps the last `@mention` agent set on the conversation so follow-up messages without tags continue with the same agent(s), instead of falling back to the mono-agent.

### Field

| Field | Location | Semantics |
|-------|----------|-----------|
| `taggedAgentIds` | Top-level on `Conversation` | Sticky routing set — **full replace** on new mentions; **reuse** when the turn has no mentions |
| `groupMeta.taggedAgents` | Group meta only | Shared toolbox — `$addToSet` (append-only); unrelated to sticky routing |

### Decision helper

`utils/sticky-agent-routing.ts` → `resolveStickyAgentRouting`:

| Input | Result |
|-------|--------|
| Mentions present | `effectiveAgentIds = mentioned`; `shouldReplaceSticky = true` |
| No mentions + sticky non-empty + AI turn | `effectiveAgentIds = sticky`; no replace |
| No mentions + sticky empty | `effectiveAgentIds = undefined` → mono-agent in `buildAgentsForStream` |
| Member-only turn (`memberIds` set) | Sticky is **not** reused |

### Persistence

`ConversationService.replaceTaggedAgentIds(conversationId, agentIds)` performs `$set: { taggedAgentIds }` (replace entire array). Called when the turn has new mentions.

### Examples

```
Request 1: "@agent3 Bonjour"
  → mentioned = [3], replace sticky → taggedAgentIds = [3], route to agent3

Request 2: "Peux-tu continuer ?" (no tag)
  → mentioned = [], reuse sticky → effective = [3], route to agent3

Request 3: "@agent1 @agent2 Aidez-moi"
  → mentioned = [1, 2], replace sticky → taggedAgentIds = [1, 2] (3 removed)
```

### Agent Interfaces

```typescript
// Internal representation used during agent resolution
interface IAgentForStream {
  id: string;
  name: string;
  agentTypeName: string;
  agentTypeSlug: string;          // "manager", "researcher", etc.
  agentTypeId: string;
  role: string;
  description: string;
  temperature: number;
  model?: string;                 // Model override (falls back to request modelId)
  instruction: string;            // Custom user instruction
  ignorePrePrompt: boolean;       // Skip agent type pre-prompt
  knowledgeBases: string[];
  toolIds: string[];
  isDefault: boolean;             // Admin-created default agent
  isDefaultForType: boolean;      // Default agent for its type
}

// Final gRPC-ready representation sent to AI service
interface IGrpcAgent {
  id: string;
  name: string;
  description: string;
  prompt: string;                 // Pre-prompt + instruction combined
  agent_type: string;             // Lowercase type name (e.g., "manager")
  save_memory: boolean;
  tools: Record<string, unknown>[];
  chatbot: { model: string };     // Resolved LiteLLM model (e.g., "azure/gpt-4.1")
}
```

### Prompt Assembly

Each agent's final prompt is assembled from two parts:

1. **Pre-prompt** — resolved from the agent's type via `AgentTypeService.resolvePromptsInBatch()`, model-specific
2. **Instruction** — the agent's custom instruction (user-defined or admin-defined)

If `ignorePrePrompt` is `true`, only the instruction is used. Otherwise both are concatenated with `\n\n`.

### Agent Data in gRPC Request

The assembled agents array is sent as part of `RunAgentTeamRequest`:

```typescript
const grpcRequest = {
  user_context: { user_id: userId, username: '' },
  conversation_id: conversationId,
  query: request.content,
  agents,                          // IGrpcAgent[] — built by AgentService
  workspace_context: [...],
  agent_mode: 'manual',
  attached_files: [...],           // AttachedFile[] — current turn (images + documents)
  previous_attached_files: [...],  // Document[] — from prior turns in system workspace
};
```

**`attached_files`** — built by `StreamService.buildAttachedFiles()`:
- Fetches document metadata from DB by `attachedFileIds`
- Images (`mimeType.startsWith('image/')`) → `{ type: 'image', image: { filepath } }`
- Documents → `{ type: 'document', document: { filepath, filename, external_id, workspace_id, source, ...indexing config } }`
- Indexing config is currently hardcoded: `brain_type: 'doc'`, `lang_code: 'fr'`, `chunk_size: 4000`, `chunk_overlap: 100`, `enable_smart_chunk: true`, `enable_extract_images: true`, `in_memory: false`, `sheet_name: ''`

**`previous_attached_files`** — built by `StreamService.buildPreviousAttachedFiles()`:
- Reads the conversation's `systemWorkspaceId`
- Fetches all completed documents from the system workspace
- Excludes current turn's file IDs
- Maps to proto `Document` format (`_id`, `filename`, `filepath`, `in_memory`, `language`, `indexing_token`, `workspace_id`)

### Plan Components and Agents

The AI service can return `PlanComponent` in the stream, which includes agent assignments per step:

```protobuf
message PlanStep {
    string task = 1;             // Task description
    string agent = 2;            // Agent name assigned to this step
    TaskStatus status = 3;       // PENDING, IN_PROGRESS, COMPLETED, ERROR
}
```

Each `StreamChunk.metadata.agent_id` also tracks which agent produced a given chunk, enabling the frontend to attribute responses to specific agents.

---

## Group Invitations

When a group conversation is created with `participantEmails`, the service automatically sends email invitations.

### Workflow
1. **Creation/Update**: `ConversationService.create()` or `update()` is called with `participantEmails`.
2. **Metadata**: `buildGroupMetadata()` (on create) or `handleGroupInvitations()` (on update) determines which emails need new invites.
3. **Filtering**: Participants already in the group or already invited are automatically filtered out.
4. **Email Trigger**: `sendGroupInvitations()` is called asynchronously for new participants.
5. **Delivery**: Invitations are sent via `EmailService.sendBulk()` using the configured provider.

### Email Template
The invitation includes:
- **Inviter Name**: Extracted from the creator's profile or email.
- **Conversation Title**: For context.
- **Join Link**: Direct deep-link to `/conversation/:id` (configured via `app.frontendUrl` in the configuration service).
- **Branding**: Styled HTML template matching YellowStorm aesthetics.

### Landing Page Experience
When following a Join Link, the frontend presents an intermediate **Invitation Landing Page**. This page fetches conversation details and allows the user to preview the group members and title before officially "entering" the chat stream.

---

## Mention Notifications

Group conversations persist **per-member mention records** on the conversation document and notify mentioned users in real time over the **conversation SSE** channel (same connection as streaming). This is separate from any app-wide notification center APIs elsewhere in the platform.

### Data model

- **Schema** (`schemas/conversation.schema.ts`): Under `groupMeta.members[]`, each member may have `mentions[]` with:
  - `messageId` (ref to `Message`)
  - `seenAt` (optional `Date`)
- **Types** (`interfaces/conversation.interface.ts`): `GroupMember.mentions` is `{ messageId: string; seenAt?: string }[]` in API responses.

### Persistence (`ConversationService`)

- **`addMention(conversationId, userId, messageId)`** — `$push` a new `{ messageId }` onto the target member’s `mentions` array (dedupe by application flow before insert).
- **`markMentionSeen(conversationId, userId, messageId)`** — `$set` `seenAt` on the matching array element using array filters on `member.userId` and `mention.messageId`.

### HTTP API (`ConversationController`)

- **`PATCH /conversations/:id/mentions/:messageId/seen`** — Authenticated; marks the mention for the **current user** as seen. Delegates to `ConversationService.markMentionSeen`.

### Detection & delivery (`MessageService`)

Private method **`extractAndNotifyMentions(message, conversationId)`** runs after relevant user/AI messages are persisted (see call sites in the service for create/update flows). It only runs when the conversation is a **group** (`groupMeta.isGroup`).

1. **Who is mentioned**
   - Explicit **`memberIds`** on the message (Mongo ids) are always included.
   - Otherwise, **text scan**: for each group member, if the message body contains `@<name>` (case-insensitive) where `name` is the member’s display name or email local-part, that member is mentioned.
   - For **AI messages**, text is taken from text-type **components**; for **user** messages, from `content`.
2. **Per mentioned user**
   - **`addMention`** saves the record in MongoDB.
   - **`broadcastMention`** sends an SSE payload to that user only via `StreamGatewayService.sendToUser` (not a broadcast to the whole conversation room).

### SSE event (`interfaces/stream.interface.ts`)

| Field | Value |
|--------|--------|
| `type` | `'mention_created'` |
| `data` | `{ conversationId: string; messageId: string; userId: string }` |

`userId` is the **mentioned** user; the client uses it to merge into that member’s `mentions` in local state.

### Email

The service builds HTML/text payloads for optional bulk email (`sendBulk` is currently commented in code; mention processing still logs and sends SSE). When enabled, emails include the conversation title and a link to the conversation URL.

### Frontend integration (summary)

Clients should listen on **`GET /conversations/stream`** for `mention_created`, update local `groupMeta.members[].mentions`, and call **`PATCH .../mentions/:messageId/seen`** when the user has actually viewed the message (see frontend conversation module README).
