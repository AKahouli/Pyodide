# Workspace Module

The Workspace module provides document management capabilities, allowing users to create workspaces where they can upload, organize, and manage documents. It includes workspace settings (with template support), document upload with real-time progress tracking, and plan-based storage quotas.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Schemas](#schemas)
- [API Endpoints](#api-endpoints)
- [Upload Flows](#upload-flows)
- [URL Ingest (Internal)](#url-ingest-internal)
- [Document Indexing](#document-indexing)
- [Storage Allocation](#storage-allocation)
- [Configuration](#configuration)
- [Error Codes](#error-codes)
- [Usage Examples](#usage-examples)

---

## Overview

### Key Features

- **Workspace Management**: Create, update, delete workspaces with auto-generated URL-friendly aliases
- **Document Upload**: Support for small files (direct upload) and large files (presigned URLs)
- **URL Ingest (Internal)**: Agent/brain can ingest connector download URLs into a workspace behind an SSRF-hardened downloader
- **Bulk Upload**: Upload up to 50 files in parallel with progress tracking
- **Real-time Progress**: Upload progress notifications via existing SSE (NotificationsService)
- **Workspace Settings**: Configurable RAG settings with public template support
- **Plan-based Storage**: Storage quotas based on user's subscription plan
- **Isolated Error Handling**: One failing file in bulk upload doesn't affect others

### Module Structure

```
workspace/
├── workspace.module.ts
├── workspace.controller.ts
├── workspace.service.ts
├── workspace-setting.controller.ts
├── workspace-setting.service.ts
├── workspace-document.controller.ts
├── workspace-document.service.ts
├── workspace-ingest.controller.ts   # Internal ingest-from-URL (service token)
├── schemas/
│   ├── workspace.schema.ts
│   ├── workspace-document.schema.ts
│   ├── workspace-setting.schema.ts
│   └── upload-session.schema.ts
├── dto/
│   ├── create-workspace.dto.ts
│   ├── update-workspace.dto.ts
│   ├── workspace-query.dto.ts
│   ├── create-workspace-setting.dto.ts
│   ├── update-workspace-setting.dto.ts
│   ├── workspace-setting-query.dto.ts
│   ├── request-upload-url.dto.ts
│   ├── confirm-upload.dto.ts
│   ├── initiate-bulk-upload.dto.ts
│   ├── report-progress.dto.ts
│   ├── document-query.dto.ts
│   ├── bulk-delete-documents.dto.ts
│   └── ingest-url.dto.ts            # HTTPS-only download URL + auth header allowlist
├── services/
│   ├── url-safety.ts                # Shared SSRF guard (DNS + private IP reject)
│   ├── website-crawler.service.ts
│   ├── url-to-pdf-client.service.ts
│   └── …
├── interfaces/
│   ├── workspace.interface.ts
│   ├── workspace-document.interface.ts
│   ├── workspace-setting.interface.ts
│   └── upload-session.interface.ts
├── guards/
│   └── workspace-owner.guard.ts
└── index.ts
```

---

## Architecture

### Design Decisions

1. **Documents in Separate Collection**: Avoids MongoDB 16MB document limit, enables efficient pagination/search, and document updates don't touch workspace document.

2. **Presigned URLs for Large Files**: Files >10MB are uploaded directly to Azure Blob Storage using SAS URLs, reducing server load and enabling large file support (up to 500MB default).

3. **Existing SSE for Progress**: Uses `NotificationsService.sendToUser()` for upload progress notifications instead of creating a separate SSE endpoint.

4. **Plan-based Storage**: Each workspace has storage limits based on user's subscription plan, tracked in workspace's `allocatedStorage` and `usedStorage` fields.

5. **SSRF-hardened URL fetch**: Server-side downloads triggered by caller-supplied URLs (`ingestFromUrl`, link reachability, website crawl) go through `assertUrlIsSafe` (HTTPS/HTTP protocol check, DNS resolution, reject private/loopback/link-local/CGNAT/cloud-metadata). Redirects are followed manually with `maxRedirects: 0` so every hop is re-validated.

### Blob Storage Organization

```
# Regular workspace uploads
/{userId}/{workspaceId}/{documentId}/{filename}

# Conversation file attachments (system workspaces)
/{userId}/{conversationId}/{documentId}/{filename}
```

---

## Schemas

### Workspace

```typescript
{
  name: string;              // Required, unique per user, max 100 chars
  alias: string;             // URL-friendly, auto-generated from name
  description?: string;      // Max 500 chars
  createdBy: ObjectId;       // Reference to User
  settings?: ObjectId;       // Reference to WorkspaceSetting
  documentCount: number;     // Denormalized count for performance
  usedStorage: number;       // Bytes used by documents
  allocatedStorage: number;  // Bytes allowed (from user plan)
  isSystem: boolean;         // True for auto-created conversation file workspaces
  conversationId?: ObjectId; // Reference to conversation (system workspaces only)
  createdAt: Date;
  updatedAt: Date;
}

// Indexes:
// { createdBy: 1, name: 1 } unique
// { createdBy: 1, alias: 1 } unique
// { createdBy: 1, createdAt: -1 }
```

### WorkspaceDocument

```typescript
{
  filename: string;          // Stored filename (sanitized, with UUID)
  originalName: string;      // Original filename from client
  mimeType: string;          // MIME type
  size: number;              // Size in bytes
  path: string;              // Blob storage path
  url: string;               // Base URL (without SAS token)
  contentHash?: string;      // MD5 hash for reference
  workspaceId: ObjectId;     // Reference to Workspace
  createdBy: ObjectId;       // Reference to User
  status: DocumentStatus;    // pending | uploading | processing | completed | failed
  uploadedAt?: Date;
  errorMessage?: string;     // For failed uploads
  metadata?: object;         // Custom metadata
  indexingStatus: IndexingStatus;  // pending | processing | ready | failed
  indexingError?: string;    // Error message if indexing failed
  lastIndexedAt?: Date;      // Timestamp of last successful indexing
  createdAt: Date;
  updatedAt: Date;
}

// Indexes:
// { workspaceId: 1, createdAt: -1 }
// { workspaceId: 1, status: 1 }
// { status: 1, indexingStatus: 1 }  // For indexing cron jobs
// { path: 1 } unique
```

### WorkspaceSetting

```typescript
{
  name: string;              // Required, max 100 chars
  description?: string;      // Max 500 chars
  tag?: string;              // For categorization
  llmModel?: string;         // Model identifier (future use)
  isTemplate: boolean;       // If true, visible to all users
  createdBy: ObjectId;       // Reference to User
  instruction?: string;      // System prompt, max 10000 chars
  chunks: number;            // Default 5, range 1-100
  hybridSearch: boolean;     // Default false
  ragType: RagType;          // 'standard' | 'advancedRag' | 'smartRag'
  maxToken: number;          // Default 4096, range 100-128000
  topK: number;              // Default 10, range 1-100
  createdAt: Date;
  updatedAt: Date;
}

// Indexes:
// { createdBy: 1, createdAt: -1 }
// { isTemplate: 1, createdAt: -1 }
// { tag: 1, isTemplate: 1 }
```

### UploadSession

```typescript
{
  workspaceId: ObjectId;     // Reference to Workspace
  userId: ObjectId;          // Reference to User
  status: UploadSessionStatus; // pending | in_progress | completed | expired | failed
  files: UploadFileInfo[];   // Array of file info with progress
  totalFiles: number;
  totalSize: number;
  completedFiles: number;
  failedFiles: number;
  expiresAt: Date;           // TTL index for auto-cleanup
  createdAt: Date;
  updatedAt: Date;
}

// TTL Index: { expiresAt: 1 } with expireAfterSeconds: 0
```

---

## API Endpoints

### Workspace CRUD

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/workspaces` | Create workspace |
| `GET` | `/workspaces` | List user's workspaces (paginated) |
| `GET` | `/workspaces/:id` | Get workspace by ID |
| `GET` | `/workspaces/alias/:alias` | Get workspace by alias |
| `PATCH` | `/workspaces/:id` | Update workspace |
| `DELETE` | `/workspaces/:id` | Delete workspace + all documents |

### WorkspaceSetting CRUD

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/workspace-settings` | Create setting |
| `GET` | `/workspace-settings` | List user's settings (paginated) |
| `GET` | `/workspace-settings/templates` | List public templates |
| `GET` | `/workspace-settings/:id` | Get setting by ID |
| `PATCH` | `/workspace-settings/:id` | Update setting (owner only) |
| `DELETE` | `/workspace-settings/:id` | Delete setting (owner only) |

### Document Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/workspaces/:id/documents` | Upload small file (multipart) |
| `POST` | `/workspaces/:id/documents/upload-url` | Get presigned URL for large file |
| `POST` | `/workspaces/:id/documents/confirm` | Confirm upload completed |
| `POST` | `/workspaces/:id/documents/bulk` | Initiate bulk upload session |
| `POST` | `/workspaces/:id/documents/bulk/:sessionId/progress` | Report upload progress |
| `POST` | `/workspaces/:id/documents/bulk/:sessionId/complete` | Complete bulk upload |
| `GET` | `/workspaces/:id/documents/bulk/:sessionId` | Get session status |
| `GET` | `/workspaces/:id/documents` | List documents (paginated) |
| `GET` | `/workspaces/:id/documents/:docId` | Get document metadata |
| `GET` | `/workspaces/:id/documents/:docId/download-url` | Get download URL |
| `DELETE` | `/workspaces/:id/documents/:docId` | Delete document |
| `DELETE` | `/workspaces/:id/documents` | Bulk delete documents |

### Internal URL Ingest (service token)

Protected by `InternalServiceGuard` (shared internal bearer). Not a user JWT route.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/workspaces/:workspaceId/documents/ingest-url` | Download a remote file and store it in the workspace |

---

## Upload Flows

### Small File Upload (< 10MB)

Best for files under 10MB. Server receives file directly and uploads to Azure.

```
Client                          Server                         Azure
  |                               |                              |
  |-- POST /documents (file) ---->|                              |
  |                               |-- Validate & check quota     |
  |                               |-- Upload to blob ----------->|
  |                               |-- Create document record     |
  |                               |-- Update workspace storage   |
  |<-- Document response ---------|                              |
```

**Request:**
```bash
curl -X POST /workspaces/{id}/documents \
  -H "Authorization: Bearer {token}" \
  -F "file=@document.pdf"
```

### Large File Upload (> 10MB)

Recommended for files over 10MB. Client uploads directly to Azure using presigned URL.

```
Client                          Server                         Azure
  |                               |                              |
  |-- POST /upload-url ---------->|                              |
  |   { filename, mimeType, size }|                              |
  |                               |-- Validate & check quota     |
  |                               |-- Create pending document    |
  |                               |-- Generate SAS URL           |
  |<-- { documentId, uploadUrl }--|                              |
  |                               |                              |
  |-- PUT file directly -------------------------------->------->|
  |                               |                              |
  |-- POST /confirm ------------->|                              |
  |   { documentId }              |-- Verify blob exists ------->|
  |                               |-- Update document status     |
  |                               |-- Update workspace storage   |
  |                               |-- Send SSE notification      |
  |<-- Document response ---------|                              |
```

**Request Upload URL:**
```bash
curl -X POST /workspaces/{id}/documents/upload-url \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{"filename": "large-file.pdf", "mimeType": "application/pdf", "size": 52428800}'
```

**Upload to Azure (client-side):**
```javascript
const response = await fetch(uploadUrl, {
  method: 'PUT',
  headers: {
    'x-ms-blob-type': 'BlockBlob',
    'Content-Type': mimeType
  },
  body: file
});
```

**Confirm Upload:**
```bash
curl -X POST /workspaces/{id}/documents/confirm \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{"documentId": "..."}'
```

### Bulk Upload Flow

For uploading multiple files in parallel with progress tracking.

```
Phase 1: Initiation
─────────────────────────────────────────────────────────────────
Client                          Server
  |                               |
  |-- POST /bulk ---------------->|
  |   { files: [{...}, ...] }     |-- Validate all files
  |                               |-- Check total quota
  |                               |-- Create upload session
  |                               |-- Generate SAS URLs for each
  |<-- { sessionId, files: [...] }|

Phase 2: Parallel Uploads (client-side)
─────────────────────────────────────────────────────────────────
For each file:
  Client                        Azure                   Server
    |-- PUT to uploadUrl ------->|                        |
    |   (with progress tracking) |                        |
    |                            |                        |
    |-- POST /progress ---------------------------------->|
    |   { fileIndex, progress }  |                        |-- Send SSE notification
    |                            |                        |

Phase 3: Completion
─────────────────────────────────────────────────────────────────
Client                          Server                   Azure
  |                               |                        |
  |-- POST /complete ------------>|                        |
  |                               |-- Verify each blob --->|
  |                               |-- Update statuses      |
  |                               |-- Update storage       |
  |                               |-- Send final SSE       |
  |<-- { status, successful,     |                        |
  |      failed, duration }       |                        |
```

**Initiate Bulk Upload:**
```bash
curl -X POST /workspaces/{id}/documents/bulk \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "files": [
      {"filename": "doc1.pdf", "mimeType": "application/pdf", "size": 1048576},
      {"filename": "doc2.pdf", "mimeType": "application/pdf", "size": 2097152}
    ]
  }'
```

**Report Progress (optional, for UI feedback):**
```bash
curl -X POST /workspaces/{id}/documents/bulk/{sessionId}/progress \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{"fileIndex": 0, "progress": 50, "status": "uploading"}'
```

**Complete Bulk Upload:**
```bash
curl -X POST /workspaces/{id}/documents/bulk/{sessionId}/complete \
  -H "Authorization: Bearer {token}"
```

---

## URL Ingest (Internal)

Used by the agent/brain (and other internal callers) to pull a connector download URL (e.g. SharePoint) into a workspace. Entry point: `WorkspaceIngestController` → `WorkspaceDocumentService.ingestFromUrl()`.

### Auth & ownership

- Guard: `InternalServiceGuard` (`@Public()` for JWT, but requires the internal service token).
- Body must include `userId`; the controller rejects the call if that user does not own the target workspace (`ERR_1902`).

### Request body (`IngestUrlDto`)

| Field | Rules |
|-------|--------|
| `downloadUrl` | Required. **HTTPS only**, `require_tld: true` (no localhost-style hosts via DTO). |
| `filename` | Required, max 255. |
| `userId` | Required (trusted via service auth). |
| `mimeType` | Optional; otherwise taken from response `Content-Type`. |
| `authHeaders` | Optional. Transform keeps **only** `Authorization`; other header names are stripped. |
| `sourceMeta` | Optional string map stored on the document metadata. |

### SSRF / credential controls (`downloadUrlGuarded`)

Before and during download:

1. **`assertUrlIsSafe(url)`** on the initial URL and **every redirect hop** (`services/url-safety.ts`): DNS lookup; reject private, loopback, link-local, CGNAT, and cloud-metadata addresses (e.g. `169.254.169.254`).
2. **HTTPS only** at the ingest layer (even if the shared guard allows `http` for other callers).
3. **`maxRedirects: 0`** — axios does not auto-follow; hops are followed manually (max 5).
4. **Authorization** is the only forwarded header; it is **cleared on cross-origin redirects** so credentials are not leaked to a different origin.
5. Logs record `downloadHost` only (not the full URL, which may contain tokens).

Successful download then goes through the normal `uploadSmallFile` path (quota + storage).

### Example

```bash
curl -X POST /workspaces/{workspaceId}/documents/ingest-url \
  -H "Authorization: Bearer {INTERNAL_SERVICE_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "downloadUrl": "https://contoso.sharepoint.com/.../download",
    "filename": "quarterly-report.xlsx",
    "userId": "507f191e810c19729de860ea",
    "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "authHeaders": { "Authorization": "Bearer eyJ..." },
    "sourceMeta": { "source": "sharepoint", "itemId": "123" }
  }'
```

Download / validation failures surface as `ERR_1923` (`WORKSPACE_DOCUMENT_UPLOAD_FAILED`) or a generic bad-request from `assertUrlIsSafe`.

---

## Document Indexing

Documents are automatically indexed after upload completes for **regular workspaces only**. Files uploaded to **system workspaces** (conversation file attachments) are **not indexed** — they are stored for display/download purposes only. Indexing is non-blocking - documents are usable immediately, and indexing status is informational.

### Indexing Status Flow

```
Upload Complete
      │
      ▼
┌─────────────────────────────────────────┐
│  status: COMPLETED                      │
│  indexingStatus: PENDING                │
└─────────────────────────────────────────┘
      │
      │ Automatic processing
      ▼
┌─────────────────────────────────────────┐
│  indexingStatus: PROCESSING             │
└─────────────────────────────────────────┘
      │
      ├─── Success ───►  indexingStatus: READY
      │                  lastIndexedAt: now()
      │
      └─── Failure ───►  indexingStatus: FAILED
                         indexingError: "error message"
```

### Indexing API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/workspaces/:id/documents/:docId/reindex` | Trigger manual re-indexing |
| `GET` | `/workspaces/:id/documents/:docId/index-status` | Get indexing status |

### Real-Time Notifications

When indexing status changes, a notification is sent via SSE:

```typescript
{
  type: 'notification',
  data: {
    eventType: 'indexing_status_change',
    documentId: '...',
    workspaceId: '...',
    indexingStatus: 'ready',
    lastIndexedAt: '2024-01-15T10:30:00Z',
    originalName: 'document.pdf'
  },
  metadata: {
    sourceModule: 'indexing'
  }
}
```

See the [Indexing Module README](../indexing/README.md) for full documentation.

---

## Storage Allocation

Storage limits are defined per plan in the Usage module:

| Plan | Storage per Workspace | Max Workspaces |
|------|----------------------|----------------|
| Free | 100 MB | 3 |
| Basic | 2 GB | 10 |
| Enterprise | 10 GB | 50 |
| Unlimited | 100 GB | Unlimited (-1) |

These values are stored in the plan's `metadata` field:

```typescript
metadata: {
  workspaceStorageBytes: 104857600,  // 100MB in bytes
  maxWorkspaces: 3
}
```

When creating a workspace, the `allocatedStorage` is set based on the user's current plan.

---

## Configuration

Environment variables (with defaults):

```env
# File limits
WORKSPACE_MAX_FILE_SIZE_MB=500           # Single file max (500MB)
WORKSPACE_MAX_FILES_PER_BULK_UPLOAD=50   # Max files per bulk session
WORKSPACE_SMALL_FILE_THRESHOLD_MB=10     # Below this, use direct upload

# Session/URL expiry
WORKSPACE_UPLOAD_SESSION_TTL_MINUTES=60  # Bulk session expiry
WORKSPACE_SAS_URL_EXPIRY_MINUTES=60      # Presigned URL expiry

# Allowed file types (comma-separated)
WORKSPACE_ALLOWED_MIME_TYPES=application/pdf,application/msword,...
```

Default allowed MIME types:
- `application/pdf`
- `application/msword`
- `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
- `application/vnd.ms-excel`
- `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- `application/vnd.ms-powerpoint`
- `application/vnd.openxmlformats-officedocument.presentationml.presentation`
- `text/plain`
- `text/csv`
- `text/markdown`
- `application/json`

---

## Error Codes

| Code | Constant | Description |
|------|----------|-------------|
| ERR_1900 | `WORKSPACE_NOT_FOUND` | Workspace does not exist |
| ERR_1901 | `WORKSPACE_NAME_EXISTS` | Workspace name already taken |
| ERR_1902 | `WORKSPACE_FORBIDDEN` | No access to workspace |
| ERR_1903 | `WORKSPACE_ALIAS_EXISTS` | Workspace alias already taken |
| ERR_1904 | `WORKSPACE_MAX_LIMIT_REACHED` | Max workspaces for plan reached |
| ERR_1910 | `WORKSPACE_SETTING_NOT_FOUND` | Setting does not exist |
| ERR_1911 | `WORKSPACE_SETTING_FORBIDDEN` | No access to setting |
| ERR_1920 | `WORKSPACE_DOCUMENT_NOT_FOUND` | Document does not exist |
| ERR_1921 | `WORKSPACE_DOCUMENT_FORBIDDEN` | No access to document |
| ERR_1922 | `WORKSPACE_DOCUMENT_INVALID_TYPE` | File type not allowed |
| ERR_1923 | `WORKSPACE_DOCUMENT_UPLOAD_FAILED` | Upload or URL-ingest download failed (incl. blocked redirect / non-HTTPS) |
| ERR_1924 | `WORKSPACE_DOCUMENT_NOT_IN_BLOB` | Blob not found on confirm |
| ERR_1930 | `WORKSPACE_STORAGE_QUOTA_EXCEEDED` | Insufficient storage |
| ERR_1931 | `WORKSPACE_STORAGE_FILE_TOO_LARGE` | Single file too large |
| ERR_1940 | `WORKSPACE_UPLOAD_SESSION_NOT_FOUND` | Session does not exist |
| ERR_1941 | `WORKSPACE_UPLOAD_SESSION_EXPIRED` | Session has expired |
| ERR_1942 | `WORKSPACE_UPLOAD_TOO_MANY_FILES` | Too many files in bulk |

---

## Usage Examples

### Creating a Workspace

```typescript
// POST /workspaces
const workspace = await fetch('/workspaces', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: 'My Project',
    description: 'Project documentation'
  })
});

// Response:
{
  "id": "...",
  "name": "My Project",
  "alias": "my-project",
  "description": "Project documentation",
  "documentCount": 0,
  "usedStorage": 0,
  "allocatedStorage": 104857600,  // 100MB
  "createdAt": "2024-01-15T10:30:00Z",
  "updatedAt": "2024-01-15T10:30:00Z"
}
```

### Uploading with Progress (Client-side)

```typescript
async function uploadWithProgress(workspaceId: string, files: File[]) {
  // 1. Initiate bulk upload
  const initResponse = await fetch(`/workspaces/${workspaceId}/documents/bulk`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      files: files.map(f => ({
        filename: f.name,
        mimeType: f.type,
        size: f.size
      }))
    })
  });

  const { sessionId, files: uploadFiles } = await initResponse.json();

  // 2. Upload each file to Azure with progress
  const uploads = uploadFiles.map((fileInfo, index) => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.upload.onprogress = async (e) => {
        const progress = Math.round((e.loaded / e.total) * 100);
        // Report progress to server (optional, for SSE notifications)
        await fetch(`/workspaces/${workspaceId}/documents/bulk/${sessionId}/progress`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileIndex: index, progress, status: 'uploading' })
        });
      };

      xhr.onload = () => resolve(xhr.status);
      xhr.onerror = () => reject(new Error('Upload failed'));

      xhr.open('PUT', fileInfo.uploadUrl);
      xhr.setRequestHeader('x-ms-blob-type', 'BlockBlob');
      xhr.setRequestHeader('Content-Type', files[index].type);
      xhr.send(files[index]);
    });
  });

  await Promise.all(uploads);

  // 3. Complete the session
  const result = await fetch(`/workspaces/${workspaceId}/documents/bulk/${sessionId}/complete`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` }
  });

  return result.json();
}
```

### Listening to Progress Notifications (SSE)

```typescript
// Connect to existing notifications SSE
const eventSource = new EventSource(`/notifications/stream?token=${token}`);

eventSource.addEventListener('notification', (event) => {
  const notification = JSON.parse(event.data);

  if (notification.data?.eventType === 'upload_progress') {
    console.log(`File ${notification.data.filename}: ${notification.data.progress}%`);
  }

  if (notification.data?.eventType === 'upload_complete') {
    console.log('Upload complete:', notification.data.summary);
  }
});
```

---

## Security

1. **Ownership Guard**: `WorkspaceOwnerGuard` verifies user owns workspace before any operation
2. **File Validation**: MIME type whitelist, configurable size limits
3. **Path Scoping**: All blob paths scoped to `/{userId}/{workspaceId}/`
4. **Template Access**: `isTemplate=true` settings visible to all, but only creator can modify/delete
5. **SAS URLs**: Time-limited with minimal permissions (read or create+write only)

---

## Integration Points

### WorkspaceService
- `createSystemWorkspace()` - Create a system workspace for conversation file uploads
- `findSystemWorkspace()` - Find an existing system workspace by user and conversation ID
- `deleteSystemWorkspace()` - Delete a system workspace record without ownership check (for internal cleanup: cascade delete, orphan cleanup). Safety-guarded by `isSystem: true` filter.

### WorkspaceDocumentService (conversation file support)
- `requestUploadUrlWithPath()` - Generate a presigned upload URL with a custom blob path prefix (used by conversation file uploads)
- `uploadSmallFileWithPath()` - Direct upload with a custom blob path prefix
- `findByIds()` - Batch-fetch documents by IDs (used to enrich message responses with file metadata)
- `generateReadUrl()` - Generate a presigned read URL for a document

### DocumentService (existing)
- `upload()` - Upload buffer to Azure Blob
- `generateSasUrl()` - Create temporary access URLs
- `delete()` - Remove file from blob storage
- `exists()` - Verify blob exists

### IndexingService (new)
- `queueDocument()` - Queue document for indexing after upload
- `reindexDocument()` - Trigger manual re-indexing
- Automatic retry of failed documents via cron jobs
- See [Indexing Module](../indexing/README.md) for details

### NotificationsService (existing)
- `sendToUser()` - Push upload progress events via SSE
- Also used by IndexingService for indexing status notifications

### UsageService (existing)
- `ensureUserHasPlan()` - Get user's plan for storage allocation

### LoggerService (existing)
- All operations are logged for debugging
