# Workspace: group indexed web sources under their start URL — Design

**Status:** Approved (brainstorming complete) — ready for implementation planning.

## Problem

When a user browses a site in `AddLinkDialog`, selects multiple pages, and clicks **Indexer (N)**, each page is added to the workspace as an independent, top-level document. Indexing five links produces five loose rows at the workspace root, overcrowding the file list. The organization the user saw while browsing (everything descending from the site they started on) is discarded at index time.

## Goal

Indexed web pages that came from the same browse session appear together under a single collapsible group headed by the **start URL** the user began from, keeping the workspace tidy — while the existing manual "classifier" folders continue to work unchanged.

## Locked Decisions (from brainstorming)

1. **Root identity = the browse session's start URL** (the URL the user began the session with), not derived from each page's own URL. Persisted per document.
2. **Single level only.** The start URL is the group header; the indexed pages sit flat directly beneath it. No multi-level URL-path tree in the workspace (unlike the browse sidebar's `buildTrie`).
3. **Grouping renders only when 2+ root-level url-documents share the same normalized start URL.** A lone url-document renders flat at root (no header). If more pages from the same start URL are indexed later, the previously-flat one joins the newly-formed group (grouping is derived from the shared key, not frozen at index time).
4. **Inline expand/collapse groups at the workspace root, separate from manual folders.** Manual folders (`WorkspaceFolder` + `file.folderId`) are untouched and keep their navigate-into behavior. Grouping applies only to root-level documents (`folderId === null`); a url-document moved into a manual folder leaves its group.
5. **Header is display-only.** It shows a cleaned start-URL label (host + path, no scheme), a page count, an expand/collapse chevron, and a rolled-up indexing status. All real actions (view, reindex, move, delete) remain per-document, exactly as today. No group-level bulk operations in this iteration.

## Approach

**Persist the start URL on each document; derive the grouping in the frontend at render time.** This mirrors the existing sidebar pattern (`buildTrie` derives structure from data), keeping the two grouping logics consistent in spirit and the backend a thin persistence layer.

Alternatives considered and rejected:
- **Backend returns a pre-grouped tree** — changes the file-list API shape, more backend work, less flexible. Rejected.
- **Auto-create a manual `WorkspaceFolder` per start URL** — wrong UX (navigate-into instead of inline expand) and pollutes the classifier-folder space. Rejected in brainstorming.

## Architecture & Data Flow

1. **Capture the root (frontend).** Add `rootUrl` to `useBrowserSession` state. It is set once in `start(url)` and is **never** overwritten by `navigated` events (unlike `currentUrl`, which tracks the current page). This is the authoritative session root.

2. **Send it (frontend).** `AddLinkDialog.handleIndex` passes `session.rootUrl` as `sourceRootUrl` alongside the chosen URLs → `useWorkspaceStore.addPageLinks` → `workspaceApi.addLinks` request body gains `sourceRootUrl`.

3. **Persist it (backend).** `AddLinksDto` gains an optional, validated `sourceRootUrl` (URL with protocol). `WorkspaceDocumentService.addLinks` stores it on each created document's `metadata`:
   - `metadata.sourceRootUrl` — raw start URL, used to derive the display label.
   - `metadata.normalizedSourceRootUrl` — via the existing `normalizeWorkspaceUrl`, used as the grouping key.

4. **Surface it (backend → frontend).** The document → `WorkspaceFile` mapping in the file-list response includes `sourceRootUrl` and `normalizedSourceRootUrl`. The `WorkspaceFile` type gains those two optional fields.

5. **Group at render (frontend).** `WorkspacePage` runs a pure `groupBySourceRoot(visibleFiles)` helper that partitions root-level (`folderId === null`) url-documents by `normalizedSourceRootUrl`: keys with ≥2 documents become groups; everything else (loose singles, non-url docs, folder-assigned docs) stays flat. First-seen ordering is preserved.

## Components

- **`groupBySourceRoot`** — pure, unit-tested helper.
  - Input: `WorkspaceFile[]` (the current `visibleFiles`).
  - Output: `{ groups: SourceGroup[]; loose: WorkspaceFile[] }` where `SourceGroup = { key: string; label: string; rootUrl: string; files: WorkspaceFile[]; status: AggregateStatus }`.
  - Rules: only `folderId === null` && `type === 'url'` && has `normalizedSourceRootUrl` are eligible; a key forms a group iff it has ≥2 eligible files; all other files pass through to `loose`.
  - `label` = cleaned start URL (host + path, no scheme); `rootUrl` (raw) retained for the header `title` tooltip.

- **`SourceGroupRow`** — new inline collapsible section, following the existing `TrieRows` collapse-state pattern.
  - Header: label, page count, chevron, aggregate `IndexingStatusDot`.
  - Children: rendered with the **existing `FileRow`** component — per-document actions and rendering unchanged.

- **`WorkspacePage`** render order within the current view: manual folders (as now) → source groups → loose files → any remaining sections. Grouping applies only at the workspace root; inside a manual folder, files render flat (no url-grouping).

## Data Shapes

- `WorkspaceFile` (frontend type) gains: `sourceRootUrl?: string; normalizedSourceRootUrl?: string;`.
- `AddLinksDto` (backend) gains: `sourceRootUrl?: string` (optional, `@IsUrl({ require_protocol: true })`).
- Document `metadata` gains: `sourceRootUrl`, `normalizedSourceRootUrl` (string values, consistent with existing string-valued metadata such as `normalizedSourceUrl`).

## Edge Cases

- **Legacy / single-link docs without `sourceRootUrl`** → render loose/flat. Backward compatible; no migration required.
- **A url-doc moved into a manual folder** (`folderId` set) → drops out of its root group automatically, since grouping is root-only.
- **Mixed indexing states within a group** → header shows an aggregate summary (e.g. "2 ready · 1 processing").
- **Two start URLs that normalize to the same key** → one group, by design.
- **Search/filter active** → grouping is computed over the already-filtered `visibleFiles`, so a group only shows the matching children; a group falling below 2 matches collapses to flat rows.

## Testing

**Backend:**
- `AddLinksDto` accepts and validates `sourceRootUrl` (rejects non-URL / missing protocol; allows omission).
- `addLinks` writes `metadata.sourceRootUrl` and `metadata.normalizedSourceRootUrl` on each created document.
- The file-list mapping surfaces both fields onto the returned `WorkspaceFile`.

**Frontend:**
- `groupBySourceRoot` unit tests: ≥2 grouping rule; loose singles; exclusion of folder-assigned and non-url docs; first-seen ordering; aggregate-status computation.
- `SourceGroupRow` render + collapse test (header label/count/status; children are `FileRow`s; toggle shows/hides children).
- `useBrowserSession` retains `rootUrl` across `navigated` events (does not drift to the current page).

## Out of Scope (this iteration)

- Group-level bulk actions (select-all / delete-group / reindex-group).
- Multi-level URL-path nesting inside a group.
- Grouping inside manual folders.
- Retroactively backfilling `sourceRootUrl` for previously-indexed documents.
- The single-link `POST /documents/link` (`addLink`) path is unchanged. Start-URL grouping targets the multi-select browse-and-index flow (`POST /documents/links` / `addLinks`); single links added outside a browse session simply carry no `sourceRootUrl` and render flat.

## Global Constraints

- TDD: failing test first, minimal implementation, then commit.
- Conventional commits: `<type>(<scope>): <subject>`. **No `Co-Authored-By` trailer.**
- Colocated tests (`X.spec.ts` backend, `X.test.ts(x)` frontend).
- Grouping is derived at render time from persisted per-document data; first-seen ordering preserved (consistent with the existing first-wins dedup in the browse sidebar).
- Manual-folder behavior and the client/backend viewport contract are untouched.
