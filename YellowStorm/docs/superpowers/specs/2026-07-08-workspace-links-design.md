# Workspace Links (Website Indexing) — Design

**Date:** 2026-07-08
**Branch:** feature/index_web_sources
**Status:** Approved, pending implementation plan

## Goal

Let users add **website links** as workspace knowledge items alongside documents.
A link is added by clicking the upload button ("Add a link") or by dragging text
that is detected as a URL. The backend converts the website to a PDF via a
third-party API, stores the PDF like any other document, and indexes it through
the existing pipeline. In the workspace list the item shows a web icon, but under
the hood it is a normal PDF (openable in the file viewer, has an indexing status).

## Non-Goals

- No new top-level collection. Links are `WorkspaceDoc` rows.
- No re-indexing changes. The existing indexing pipeline is reused verbatim.
- The stored/openable artifact is the generated PDF, **not** the live web page.

## Background / Current Architecture

- `back/src/modules/document/` is **pure S3/Ceph blob storage** (`DocumentService`):
  `upload(buffer, name, mime, opts)`, `getBlobUrl(path)`. No schema, no HTTP.
- The domain document entity is **`WorkspaceDoc`**
  (`back/src/modules/workspace/schemas/workspace-document.schema.ts`,
  collection `workspace_documents`). It has `status` (`DocumentStatus`:
  pending/uploading/processing/completed/failed), `indexingStatus`
  (`IndexingStatus`: none/pending/processing/ready/failed), `path`, `mimeType`,
  `originalName`, `metadata`, folder support (`isFolder`, `parentId`), etc.
  There is **no** `type`/`kind` field today.
- Existing precedent: `WorkspaceDocumentService.ingestFromUrl` +
  `workspace-ingest.controller.ts` download a remote URL's bytes and call
  `uploadSmallFile`. The link flow mirrors this but inserts a website→PDF step.
- Indexing is **document-id driven** (`IndexingService.queueDocument(docId)` →
  `processDocument` → external indexing API → webhook sets READY/FAILED). It
  consumes the stored blob by `document.path` and passes `mimeType`. Any real PDF
  blob with `status=COMPLETED` indexes with **zero indexing-module changes**.
- External-API convention: a dedicated axios client service (see
  `indexing-client.service.ts`) with config via `registerAs` in
  `back/src/config/indexing.config.ts`. No `@nestjs/axios`, no message broker;
  async work is fire-and-forget promises + `@nestjs/schedule` crons.
- Frontend: React + TS + Vite, Zustand store, react-hook-form + zod, axios
  (`front/src/lib/api/client.ts`). Upload UI: `WorkspaceUploadDropZone.tsx`.
  File list + `getFileIcon` + `FileRow`: `WorkspacePage.tsx`. `Link2` already
  imported; `Globe` available in `lucide-react`.

## Design Decisions (resolved during brainstorming)

1. **Reachability** validated by a **backend endpoint** (browsers block
   client-side fetch to arbitrary sites via CORS).
2. Convert-url-pdf is a **separate third-party service** with its own base URL +
   API key (new env vars, new client service).
3. Link **filename is auto-derived** from the URL (single URL field in the modal).
4. Conversion is **async**: create the doc immediately in a `processing` state,
   respond fast, convert → upload → index in the background.
5. **Dragged URL text opens the prefilled modal** (not a silent add), so
   reachability still runs and the user confirms.
6. **Web icon** = `Globe` (fallback `Link2`).

## Data Model Changes

`back/src/modules/workspace/schemas/workspace-document.schema.ts`:

- New enum `DocumentType { DOC = 'doc', URL = 'url' }`.
- New prop `type: DocumentType` — default `DOC` (all existing docs are `doc`,
  backward compatible).
- New prop `sourceUrl?: string` — the original website link (provenance only).

A link item is a `WorkspaceDoc` with:
`type = 'url'`, `mimeType = 'application/pdf'`, `sourceUrl = <url>`,
`originalName = <derived>.pdf` (deduped by existing `resolveUniqueOriginalName`),
`isFolder = false`.

`mapToResponse` (service) and `DocumentResponse`
(`interfaces/workspace-document.interface.ts`) gain `type` + `sourceUrl` so they
reach the frontend. Frontend `WorkspaceDocument` / `WorkspaceFile` types gain the
same fields.

The existing unique index `{ workspaceId, originalName }` (partial:
`isFolder=false`) still applies; the derived-name dedup keeps it satisfied.

## Backend — Convert Client + Config

- Add to config (`back/src/config/indexing.config.ts` or a new namespace):
  `urlToPdfApiUrl: process.env.URL_TO_PDF_API_URL`,
  `urlToPdfApiKey: process.env.URL_TO_PDF_API_KEY`.
- New `UrlToPdfClientService` (axios instance, mirrors `IndexingClientService`):
  - `convert(url: string, filename: string): Promise<Buffer>`
  - `POST {base}/convert-url-pdf` body
    `{ url, filename, print_background: true, prefer_css_page_size: true }`,
    `responseType: 'arraybuffer'`, auth header from `urlToPdfApiKey`.
  - Returns the PDF bytes as a `Buffer`; axios error handling like the existing
    client (throws a descriptive `Error` on non-2xx / network failure).
- Register the provider in the module that owns the link flow (workspace module,
  or indexing module and injected — decided in the plan; workspace service is the
  caller).

## Backend — Endpoints

On `WorkspaceDocumentController`
(`@Controller('workspaces/:workspaceId/documents')`, `WorkspaceAccessGuard` +
`WritePermissionGuard` for mutations):

### `POST /validate-url`
Body `{ url: string }`. Backend performs a HEAD request (fallback GET) with a
short timeout (e.g. 5s) and returns:
`{ reachable: boolean, status?: number, error?: string }`.
Used by the link modal for the reachability pre-check. Read-only (no write guard
needed beyond workspace access).

### `POST /link`
Body: new `AddLinkDto { url: string }` (`@IsUrl`). **Async flow:**

1. Derive `filename` from the URL (hostname + sanitized path, `.pdf`), dedup.
2. Check storage quota (`workspaceService.checkStorageQuota`).
3. Create `WorkspaceDoc`: `type='url'`, `status=PROCESSING`,
   `indexingStatus=NONE`, `sourceUrl=url`, `mimeType='application/pdf'`,
   `createdBy`, `workspaceId`, `originalName=filename`.
4. **Respond immediately** with `mapToResponse(doc)`.
5. Fire-and-forget `convertAndStore(docId, url, filename)`:
   - `UrlToPdfClientService.convert(url, filename)` → PDF buffer.
   - `documentService.upload(buffer, filename, 'application/pdf', { folder })`.
   - Update doc: `path`, `url`, `size`, `contentHash`, `status=COMPLETED`.
   - `workspaceService.updateStorageUsage`.
   - `indexingService.queueDocument(docId)`.
   - On any failure → `status=FAILED`, `errorMessage`, emit status notification.

Note: because the PDF is internally generated, this path **bypasses the
user-facing extension allowlist** (`validateFile`) but still enforces quota.

**Optional (flagged in plan, not required for POC):** a small retry cron mirroring
`processPendingDocuments` that re-attempts `type='url'` docs stuck in
`status=PROCESSING` past a timeout.

## Indexing — Unchanged

Once `convertAndStore` sets `status=COMPLETED` and calls `queueDocument`, the
existing `processDocument → indexing API → webhook → READY/FAILED` pipeline runs
unchanged. The file viewer opens it because it is a real PDF blob.

## List Visibility & Status Propagation

- The default document list query filters `status=COMPLETED`. Extend it so
  `type='url'` docs in `PROCESSING`/`FAILED` are **also** returned, so a page
  reload still shows a converting/failed link (not just completed ones).
- The `POST /link` response returns the created doc for optimistic insertion.
- Reuse the existing indexing SSE notification
  (`sendIndexingStatusNotification`), extended to fire on conversion state
  changes (PROCESSING→COMPLETED/FAILED), so the row updates live.

## Frontend

### Upload button → dropdown (`WorkspaceUploadDropZone.tsx`)
Replace the single button with a `DropdownMenu`
(`@/components/ui/dropdown-menu`, already used in `WorkspacePage.tsx`):
- "Importer un document" → existing hidden file input.
- "Ajouter un lien" → opens the link modal.
File drag-and-drop of actual files stays exactly as-is.

### Drag text → link (`handleDrop` / `handleDragOver`)
Today handlers early-return unless `types.includes('Files')`. Add a branch: if the
drop has `text/uri-list` or `text/plain` whose value matches a URL, open the link
modal **prefilled** with that URL. (User still confirms; reachability still runs.)

### Link modal (new component, modeled on `CreateFolderDialog.tsx`)
- Single URL `Input`; optional prefill from a dragged URL.
- Format validation via zod `z.string().url()` (inline error, no request on bad
  format).
- On submit: call `validateUrl(url)` (reachability). If `reachable=false`, show
  the error and keep the modal open. If reachable, call `addLink(url)`,
  optimistically insert the returned doc, toast success, close.

### API + store
- `front/src/lib/api/config.ts`: add `validateUrl` + `link` endpoints under
  `workspaceDocuments`.
- `front/src/modules/workspace/api.ts`: add `validateUrl(workspaceId, url)` and
  `addLink(workspaceId, url)`.
- `front/src/modules/workspace/store.ts`: add an `addPageLink(url)` action
  (mirrors `uploadPageFiles`: calls api, inserts doc, refreshes, toasts).

### Icon + status (`WorkspacePage.tsx`)
- `getFileIcon`: return `Globe` (fallback `Link2`) when `file.type === 'url'`.
- `FileRow`: when `type==='url' && status==='processing'`, show a "Conversion…"
  indicator; otherwise the normal `IndexingStatusDot`.
- Add `type` / `sourceUrl` to `WorkspaceFile` / `WorkspaceDocument` in `types.ts`.

### i18n
Add French translation keys for the dropdown items, modal labels, and error
messages (matches existing French UI).

## Error Handling

| Case | Behavior |
|------|----------|
| Invalid URL format | Caught in modal (zod). No request. |
| Unreachable site | `validate-url` returns `reachable:false`; modal shows error; nothing saved. |
| Conversion API failure | Doc set to `FAILED` with `errorMessage`; row shows failed state; user can delete. |
| Indexing failure | Existing pipeline handling (FAILED via webhook/cron). |

## Testing

- **Backend unit:** `UrlToPdfClientService.convert` (mock axios, success +
  error), `convertAndStore` happy path and failure→FAILED, `validate-url`
  reachable/unreachable.
- **Frontend:** URL-detection util (drag text), link-modal validation flow
  (format + reachability), icon selection for `type='url'`.

## Files Touched (summary)

**Backend**
- `schemas/workspace-document.schema.ts` — `DocumentType`, `type`, `sourceUrl`.
- `dto/add-link.dto.ts` (new), `dto/index.ts`.
- `workspace-document.controller.ts` — `POST /validate-url`, `POST /link`.
- `workspace-document.service.ts` — `addLink`, `convertAndStore`, derive-name,
  `mapToResponse`, list filter.
- `services/url-to-pdf-client.service.ts` (new).
- `config/indexing.config.ts` — url-to-pdf env vars.
- `interfaces/workspace-document.interface.ts` — `type`, `sourceUrl`.
- `workspace.module.ts` — register new provider.

**Frontend**
- `components/WorkspaceUploadDropZone.tsx` — dropdown + drag-text detection.
- `components/AddLinkDialog.tsx` (new).
- `components/WorkspacePage.tsx` — icon + status branch.
- `types.ts`, `api.ts`, `store.ts`, `lib/api/config.ts`.
- i18n resource files.
