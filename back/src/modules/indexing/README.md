# Indexing Module

This module handles document indexing for workspace documents. Each uploaded document is automatically queued for indexing by a 3rd party API (vectorstore).

## Overview

- Documents are usable immediately after upload (non-blocking indexing)
- Indexing status is informational and doesn't block document access
- Documents stuck in processing are automatically timed out after 1 hour
- Failed or pending documents can be re-indexed manually by the user
- Document indexes are automatically cleaned up when documents are deleted

## Architecture

### Indexing Flow

```
Upload Complete
      │
      ▼
┌─────────────────────────────────────────┐
│  Document Status: COMPLETED             │
│  Indexing Status: PENDING               │◄──── Manual Re-index
└─────────────────────────────────────────┘
      │
      │ Auto-trigger or Cron pickup
      ▼
┌─────────────────────────────────────────┐
│  Indexing Status: PROCESSING            │
│  Call IndexingClient.indexDocument()    │
└─────────────────────────────────────────┘
      │
      ├─── Success ───►  indexingStatus: READY
      │                  lastIndexedAt: now()
      │
      ├─── Failure ───►  indexingStatus: FAILED
      │                  indexingError: "error message"
      │
      └─── Stuck >1h ──► indexingStatus: FAILED  (via cron timeout)
                         indexingError: "Indexing timed out..."
```

### Delete Flow

```
Document Delete Request
      │
      ▼
┌─────────────────────────────────────────┐
│  Delete document from storage           │
│  Delete document from database          │
└─────────────────────────────────────────┘
      │
      │ Non-blocking (async)
      ▼
┌─────────────────────────────────────────┐
│  IndexingService.deleteDocumentIndex()  │
│  Call IndexingClient.deleteIndex()      │
└─────────────────────────────────────────┘
      │
      ├─── Success ───►  Index removed from vectorstore
      │
      └─── Failure ───►  Logged (doesn't block deletion)
```

## Indexing Status

| Status | Description |
|--------|-------------|
| `pending` | Document queued for indexing |
| `processing` | Currently being indexed |
| `ready` | Successfully indexed |
| `failed` | Indexing failed (see `indexingError`) — user can re-index manually |

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `INDEXING_API_URL` | `http://localhost:4000` | 3rd party indexing API URL |
| `INDEXING_API_KEY` | `''` | API key for webhook authentication |
| `INDEXING_BATCH_SIZE` | `10` | Documents to process per batch |
| `INDEXING_INTERVAL_MS` | `30000` | Cron interval in milliseconds |
| `INDEXING_TIMEOUT_MS` | `3600000` | Time before a processing document is marked as timed out (default: 1 hour) |
| `INDEXING_ENABLED` | `true` | Enable/disable indexing |

## Services

### IndexingService

Main service for managing document indexing.

**Methods:**

| Method | Description |
|--------|-------------|
| `queueDocument(documentId)` | Add document to indexing queue (called after upload) |
| `processDocument(documentId)` | Process a single document immediately |
| `reindexDocument(workspaceId, documentId)` | Trigger manual re-index |
| `getDocumentIndexStatus(workspaceId, documentId)` | Get current indexing status |
| `deleteDocumentIndex(documentId, workspaceId)` | Remove document index from vectorstore |
| `handleWebhook(documentId, status, error?)` | Process webhook from 3rd party API |
| `sendIndexingStatusNotification(document)` | Send real-time notification to user |

**Cron Jobs:**

| Job | Schedule | Description |
|-----|----------|-------------|
| `processPendingDocuments()` | Every 30 seconds | Process pending documents in batches |
| `timeoutStaleIndexing()` | Every 10 minutes | Mark documents stuck in PROCESSING for over 1 hour as FAILED |

### IndexingClientService

Mock implementation of the 3rd party indexing API client. Implements the `IndexingClient` interface.

**Methods:**

| Method | Description |
|--------|-------------|
| `indexDocument(request)` | Send document for indexing |
| `getIndexStatus(externalId)` | Get indexing status from API |
| `deleteIndex(request)` | Delete index entry from vectorstore |

**Request/Response Interfaces:**

```typescript
interface IndexDocumentRequest {
  documentId: string;
  workspaceId: string;
  filename: string;
  mimeType: string;
  path: string;
  size: number;
}

interface DeleteIndexRequest {
  documentId: string;
  workspaceId: string;
}
```

## API Endpoints

### POST `/workspaces/:workspaceId/documents/:docId/reindex`

Trigger re-indexing of a document (requires workspace owner and JWT authentication).

**Response:**
```json
{
  "id": "document-id",
  "indexingStatus": "pending",
  "message": "Re-indexing triggered"
}
```

### GET `/workspaces/:workspaceId/documents/:docId/index-status`

Get current indexing status of a document (requires workspace owner and JWT authentication).

**Response:**
```json
{
  "documentId": "document-id",
  "indexingStatus": "ready",
  "indexingError": null,
  "lastIndexedAt": "2024-01-15T10:30:00.000Z"
}
```

### POST `/indexing/webhook`

Webhook endpoint for 3rd party indexing API to report status updates.

**Authentication:** API key in `x-api-key` header (configured via `INDEXING_API_KEY`)

**Request Body:**
```json
{
  "documentId": "document-id",
  "status": "ready" | "failed",
  "error": "Error message (optional, for failed status)"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Webhook processed"
}
```

**Behavior:**
- Updates document's `indexingStatus` to `ready` or `failed`
- Sets `lastIndexedAt` timestamp on success
- Sets `indexingError` message on failure
- Sends real-time notification to document owner via SSE

## Error Codes

| Code | Constant | Description |
|------|----------|-------------|
| ERR_1950 | `INDEXING_FAILED` | Indexing operation failed |
| ERR_1951 | `INDEXING_IN_PROGRESS` | Document is already being indexed |
| ERR_1952 | `INDEXING_SERVICE_UNAVAILABLE` | Indexing service not available |

## Integration

The indexing module is automatically integrated with the workspace document service:

### On Document Upload
1. When a document upload completes, `queueDocument()` is called
2. The document is immediately processed (non-blocking)
3. If immediate processing fails, the cron job picks it up later
4. Users can manually trigger re-indexing via the API for failed or pending documents

### On Document Delete
1. When a document is deleted, `deleteDocumentIndex()` is called (non-blocking)
2. The index is removed from the vectorstore
3. Deletion failures are logged but don't block document deletion

### Stale Indexing Timeout
1. Every 10 minutes, a cron job checks for documents stuck in PROCESSING status
2. Documents that have been processing for longer than the configured timeout (default: 1 hour) are marked as FAILED
3. A notification is sent to the document owner
4. The user can manually re-index the document

## Real-Time Notifications

The indexing module sends real-time notifications to users via SSE when indexing status changes:

- **Processing started:** Info notification when indexing begins
- **Indexing complete:** Success notification when document is indexed
- **Indexing failed:** Error notification with failure reason
- **Indexing timed out:** Error notification when processing exceeds timeout

Notifications include:
```json
{
  "type": "success",
  "title": "Document Indexed",
  "message": "\"document.pdf\" has been indexed successfully.",
  "data": {
    "eventType": "indexing_status_change",
    "documentId": "...",
    "workspaceId": "...",
    "indexingStatus": "ready",
    "lastIndexedAt": "2024-01-15T10:30:00.000Z",
    "originalName": "document.pdf"
  },
  "metadata": {
    "sourceModule": "indexing"
  }
}
```

The frontend uses these notifications to update the document table in real-time without requiring a page refresh.

## Logging

The indexing module provides comprehensive logging for debugging and monitoring:

### Log Levels

| Level | Usage |
|-------|-------|
| `log` | Important operations: queue, process start/success, webhook received, cron batch stats |
| `debug` | Detailed info: API calls, skipped operations, notification sent |
| `warn` | Recoverable issues: processing failures, indexing timeouts |
| `error` | Failures: indexing errors, cron job failures, notification send failures |

### Logged Context

All logs include relevant context:
- `documentId` - Document being processed
- `workspaceId` - Workspace the document belongs to
- `durationMs` - Processing time for timed operations
- `error` - Error message on failures
- `timeoutMs` - Configured timeout threshold

### Example Log Output

```
[IndexingService] Document queued for indexing { documentId: '...', workspaceId: '...', filename: 'doc.pdf' }
[IndexingService] Starting document indexing { documentId: '...', mimeType: 'application/pdf', size: 1024 }
[IndexingClientService] Calling indexing API { endpoint: 'http://localhost:4000/index', documentId: '...' }
[IndexingService] Document indexed successfully { documentId: '...', durationMs: 1523 }
[IndexingService] Cron: finished processing { total: 5, success: 4, failed: 1, durationMs: 7840 }
[IndexingService] Document indexing timed out { documentId: '...', workspaceId: '...' }
```

## Replacing the Mock Client

To integrate with a real indexing API:

1. Update `IndexingClientService` implementation
2. Implement the `IndexingClient` interface methods
3. Add proper API authentication using the configured API key
4. Update error handling for API-specific errors
5. Consider implementing retry logic with exponential backoff
6. Add health check endpoint monitoring
