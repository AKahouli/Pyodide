# Batch A — folder-aware indexing, move a group to a folder, clean-slate duplicates — Design

**Status:** Approved (brainstorming complete) — ready for implementation planning.

This is the first of two batches. Batch B (separate spec) will cover the double-click "continue" mode that pre-loads a site's already-indexed pages with their status into the navigator.

## Problems

1. **Indexing is not folder-aware.** Uploading a file inside a folder places it in that folder, but indexing links always drops them at the workspace root — `addPageLinks` never reads the current folder.
2. **A start-URL group can't be moved into a folder.** Individual `FileRow`s are draggable and move fine, but the `SourceGroupRow` group header (the "main link") has no move affordance, and the group is a synthetic aggregation with no id. Also, grouping renders only at the workspace root, so even if a group's pages were moved into a folder they would show flat.
3. **The manual "add a link" flow blocks duplicates.** Typing a URL and navigating should be a clean slate — but already-indexed URLs are greyed "Déjà indexée" and silently dropped from what gets indexed, so a user can't deliberately re-index (duplicate) a page.

## Goal

- Links indexed while viewing a folder land in that folder.
- A group can be moved into a folder as a unit, and stays grouped inside the folder.
- The manual add-link navigation is a clean slate: everything collected is treated as new; duplicates are allowed.

## Locked Decisions (from brainstorming)

1. **Two navigator modes** distinguished by entry point (Batch B realizes the second): manual "Ajouter un lien" = **clean slate** (this batch); double-click a group = **continue mode** (Batch B). No mode flag is introduced in this batch.
2. **Folder-aware add** mirrors the existing upload flow (assign to `pageCurrentFolderId` after creation) — no backend change.
3. **Move a group** via a **move button on the group header** that opens the existing folder-picker dialog and assigns **all** the group's pages to the chosen folder.
4. **Grouping renders inside folders too**, not only at the root (so a moved group stays grouped). Flat rendering remains only while a search is active.
5. **Clean-slate duplicates**: remove the already-indexed blocking and the "Déjà indexée" indication from the manual flow entirely.

## Architecture & Data Flow

### #1 — Folder-aware add (`store.ts`)
`addPageLinks` gains the same folder handling `uploadPageFiles` already uses. At call time it reads `const targetFolderId = get().pageCurrentFolderId;`, calls `workspaceApi.addLinks(...)` (which returns the created `WorkspaceDocument[]` with their ids), and when `targetFolderId` is set, assigns each returned doc to that folder via `pageApi.assignFileToFolder(workspaceId, doc.id, targetFolderId)` before `refreshPageData()`. Root (no current folder) is unchanged. No backend or DTO change — folder assignment is a separate classifier write, exactly as for uploads.

### #2 — Move a group into a folder
- **Generalize the folder-picker dialog.** `MoveFileDialog` currently takes a single `file: WorkspaceFile | null`. Change it to move a **set**: props become `files: WorkspaceFile[]` and `title: string` (the picker UI, breadcrumbs, and destination display are unchanged). "Déplacer ici" loops `setFileFolderAssignment(f.id, pickerFolderId)` over all `files`. The "déjà ici" hint disables the confirm only when **every** file already sits in the picked folder.
- **Unified move target in `WorkspacePage`.** Replace the single `mapFile` state with `moveTarget: { files: WorkspaceFile[]; title: string } | null`. `FileRow`'s existing move action sets `{ files: [file], title: file.name }`; a new group move sets `{ files: group.files, title: group.label }`.
- **`SourceGroupRow` move button.** Add an optional `onMove?: () => void` prop and a small move-icon button in the header (alongside the count/status), stop-propagating its click so it doesn't toggle/open the navigator. `WorkspacePage` passes `onMove={() => setMoveTarget({ files: group.files, title: group.label })}`.
- **Group rendering inside folders.** Change the `WorkspacePage` files-section gate from "group only at the root" to "group unless searching": today it is `currentFolderId || search.trim() ? flat : grouped`; it becomes `search.trim() ? flat : grouped`. `groupBySourceRoot(visibleFiles)` then also runs inside a folder (where `visibleFiles` are that folder's files), so a moved group stays grouped.

### #3 — Clean-slate manual add (allow duplicates) (`AddLinkDialog.tsx`, `CollectionSidebar.tsx`)
- In `AddLinkDialog`, remove the already-indexed machinery: delete the `checkUrls` debounced effect, the `serverIndexedUrls` state, and the `indexedUrls` memo. `chosen` becomes `session.pages.map((p) => p.url).filter((u) => selected.has(u))` (drop the `!indexedUrls.has(...)` filter); `selectableUrls` returns all page URLs. Pass `indexedUrls={new Set()}` to `CollectionSidebar` (empty → nothing greyed).
- `CollectionSidebar` keeps its `indexedUrls` prop for now but, with an empty set, renders no "Déjà indexée" label and no disabled checkboxes — every collected page is freely selectable, and re-entering an already-indexed URL indexes it fresh (a duplicate document, which the backend already allows).
- The within-session `seenRef` dedup in `useBrowserSession` is unchanged (it only prevents literally identical rows within one sidebar — harmless and desirable).

## Components / Files

- `front/src/modules/workspace/store.ts` — `addPageLinks` assigns new links to `pageCurrentFolderId`.
- `front/src/modules/workspace/components/MoveFileDialog.tsx` — generalized to `files: WorkspaceFile[]` + `title`.
- `front/src/modules/workspace/components/SourceGroupRow.tsx` — `onMove?` prop + header move button.
- `front/src/modules/workspace/components/WorkspacePage.tsx` — unified `moveTarget` state; group render gate `search.trim() ? flat : grouped`; wire `onMove` on `SourceGroupRow`; pass `moveTarget` to the dialog.
- `front/src/modules/workspace/components/AddLinkDialog.tsx` — remove already-indexed blocking; clean-slate `chosen`.
- `front/src/modules/workspace/components/CollectionSidebar.tsx` — no code change required if it receives an empty `indexedUrls`; the plan may still simplify by keeping the prop.

## Edge Cases

- **Add at root** (no `pageCurrentFolderId`) → links stay unclassified, unchanged.
- **Move a group where files already sit in different folders** → all get reassigned to the picked folder; the "déjà ici" disable only triggers when all already match.
- **Move button vs header gestures** → the move button stops event propagation so single-click (expand) and double-click (open navigator) are unaffected.
- **Grouping while searching** → stays flat (the search bypass is preserved); grouping resumes when the search clears, at root or inside a folder.
- **Duplicate indexing** → creates a second document with the same `sourceUrl`; the backend already permits this (no uniqueness constraint on `sourceUrl`). The new doc converts/indexes independently.
- **Group of one after a move** → if a folder ends up with a single url-doc for a root, it renders flat (the ≥2 grouping rule is unchanged).

## Testing

**Store:**
- `addPageLinks` with `pageCurrentFolderId` set assigns each returned doc to that folder (mock `workspaceApi.addLinks` → returns docs; assert `assignFileToFolder` called per doc); with no current folder, it does not assign.

**MoveFileDialog:**
- "Déplacer ici" calls `setFileFolderAssignment` once per file in `files`; confirm disabled only when all files already sit in the picked folder.

**SourceGroupRow:**
- The move button calls `onMove` and does not toggle/open the navigator (propagation stopped).

**WorkspacePage (light):** covered by tsc + smoke — grouping now renders inside a folder; the move target routes both file and group moves.

**AddLinkDialog:**
- `chosen` includes an already-indexed URL (i.e. indexing is not filtered); `addPageLinks` is called with that URL.
- The sidebar shows no disabled/"Déjà indexée" rows (empty `indexedUrls`).

## Out of Scope (this batch → Batch B)

- Double-click "continue" mode: pre-loading a site's already-indexed pages into the sidebar with per-page indexed status.
- Any backend endpoint to list documents by source-root URL.
- Per-page indexing-status dots inside the collection sidebar.
- Removing the `checkUrls` backend endpoint (still used by Batch B).

## Global Constraints

- TDD: failing test first, minimal implementation, then commit.
- Conventional commits: `<type>(<scope>): <subject>`. **No `Co-Authored-By` trailer.**
- Colocated tests (`X.test.ts(x)` frontend).
- Reuse the existing folder-picker dialog and classifier assignment flow; no new backend endpoints.
- Existing single-file move, upload folder-assignment, and the grouping/search-bypass behavior remain working.
