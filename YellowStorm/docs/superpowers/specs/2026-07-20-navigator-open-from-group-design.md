# Double-click a start-URL group to reopen its site in the navigator — Design

**Status:** Approved (brainstorming complete) — ready for implementation planning.

## Problem

The workspace now shows indexed web pages grouped under their start URL as inline collapsible "collections" (`SourceGroupRow`). A user who wants to index *more* pages from a site they already have a group for must manually re-open the "Ajouter un lien" dialog and retype the URL. There is no direct path from an existing group back into the browse navigator for that site.

## Goal

Double-clicking a start-URL **group header** opens the navigator (the `AddLinkDialog` browse experience) already browsing that group's root URL, so the user can click around and index additional pages without retyping anything.

## Locked Decisions (from brainstorming)

1. **Trigger scope: group headers only.** Only the `SourceGroupRow` header responds to double-click, opening the group's `rootUrl`. Individual sub-page rows and loose single links do **not** respond.
2. **Open behavior: auto-start browsing.** The navigator opens directly in the browse phase, already loading the root URL — it skips the input screen and the "Naviguer" click.
3. **Single-click still toggles.** Single-click continues to expand/collapse the group. On a double-click the two single-clicks net to no visual change and the modal opens over it; no click-debounce is added (simple toggle, accepted).
4. **Reuse the existing dialog.** No second dialog instance; the one `AddLinkDialog` (owned by `WorkspaceUploadDropZone`) is opened via shared state.

## Approach

**Lift the `AddLinkDialog` open-state into the Zustand workspace store.** The dialog lives in `WorkspaceUploadDropZone`, but the double-click originates in `SourceGroupRow` (rendered under `WorkspacePage`, a sibling of the dropzone). A store action (`openAddLink`) decouples the trigger from the dialog's owner and matches the codebase's existing heavy Zustand usage.

Alternatives considered and rejected:
- **Prop-drill a callback and render a second `AddLinkDialog` in `WorkspacePage`** — duplicates the dialog and its wiring. Rejected.
- **React context for the dialog** — more machinery than the store already provides. Rejected.

## Architecture & Data Flow

1. **Store (`store.ts`).** Add dialog state and actions:
   - State: `addLinkDialog: { open: boolean; initialUrl: string; autoStart: boolean }` (initial `{ open: false, initialUrl: '', autoStart: false }`).
   - `openAddLink(options?: { url?: string; autoStart?: boolean })` → sets `{ open: true, initialUrl: options?.url ?? '', autoStart: options?.autoStart ?? false }`.
   - `closeAddLink()` → sets `{ open: false, initialUrl: '', autoStart: false }`.

2. **Dropzone (`WorkspaceUploadDropZone.tsx`).** Replace the local `linkOpen`/`linkInitialUrl` `useState` with the store: render `AddLinkDialog` with `open={addLinkDialog.open}`, `initialUrl={addLinkDialog.initialUrl}`, `autoStart={addLinkDialog.autoStart}`, `onOpenChange={(o) => o ? undefined : closeAddLink()}`. The existing "Ajouter un lien" menu item and the drag-drop `openLink(url)` path both call `openAddLink({ url })` (autoStart defaults false — unchanged behavior).

3. **Dialog (`AddLinkDialog.tsx`).** Add an `autoStart?: boolean` prop. In the existing on-open effect, when `open && autoStart && isValidUrl(initialUrl)`, call `session.start(initialUrl.trim())` and set phase to `'browse'` (instead of `'input'`); otherwise keep current behavior. Guard so auto-start fires once per open (not on every render). Invalid/empty `initialUrl` with `autoStart` falls back to the input phase.

4. **Group header (`SourceGroupRow.tsx`).** Add an optional `onOpenInNavigator?: (url: string) => void` prop. Add `onDoubleClick={() => onOpenInNavigator?.(rootUrl)}` to the header button. The existing single-click `onClick` toggle is unchanged.

5. **Page (`WorkspacePage.tsx`).** Pass `onOpenInNavigator={(url) => openAddLink({ url, autoStart: true })}` to each rendered `SourceGroupRow`. `openAddLink` is read from the store.

Flow: double-click group header → `onOpenInNavigator(group.rootUrl)` → `openAddLink({ url, autoStart: true })` → store state flips → `WorkspaceUploadDropZone`'s `AddLinkDialog` opens with `initialUrl` + `autoStart` → the dialog's effect calls `session.start(url)` and shows the browse phase.

## Components / Files

- `store.ts` — new `addLinkDialog` state + `openAddLink` / `closeAddLink` actions (and their type declarations).
- `WorkspaceUploadDropZone.tsx` — drive `AddLinkDialog` from the store instead of local state.
- `AddLinkDialog.tsx` — new `autoStart` prop + guarded auto-start effect.
- `SourceGroupRow.tsx` — new `onOpenInNavigator` prop + `onDoubleClick` on the header.
- `WorkspacePage.tsx` — wire `onOpenInNavigator` to `openAddLink`.

## Edge Cases

- **Double-click while the dialog is already open** → `openAddLink` simply re-sets the target (latest wins); no crash.
- **`autoStart` with an invalid/empty URL** → no `session.start`; the dialog shows the input phase (safe fallback).
- **Existing entry points unchanged** — "Ajouter un lien" (empty URL) and drag-drop (dropped URL) call `openAddLink` with `autoStart` omitted/false, preserving today's input-phase behavior.
- **Closing the dialog** must reset store state (`closeAddLink`) so a later open starts clean; `AddLinkDialog` already calls `session.stop()` on close.
- **Root URL validity** — `rootUrl` is a real start URL the user previously browsed; `isValidUrl` guards `session.start`.

## Testing

**Store:**
- `openAddLink({ url, autoStart: true })` sets `addLinkDialog` to `{ open: true, initialUrl: url, autoStart: true }`.
- `openAddLink()` (no args) sets `{ open: true, initialUrl: '', autoStart: false }`.
- `closeAddLink()` resets to `{ open: false, initialUrl: '', autoStart: false }`.

**SourceGroupRow:**
- Double-clicking the header calls `onOpenInNavigator` with the `rootUrl`.
- Single-clicking the header still toggles children (existing behavior preserved).

**AddLinkDialog:**
- With `open + autoStart + valid initialUrl`, the mounted dialog calls `session.start(initialUrl)` and renders the browse phase (no "Naviguer" click needed).
- With `open + autoStart + empty initialUrl`, it does not call `session.start` and shows the input phase.

## Out of Scope (this iteration)

- Double-click on sub-page rows or loose single links (headers only).
- Click-debounce to suppress the single-click toggle during a double-click (simple toggle accepted).
- Any change to what indexing does once the navigator is open (this only opens the navigator at a URL).
- Persisting or restoring prior selection/collected-pages state from the original browse session.

## Global Constraints

- TDD: failing test first, minimal implementation, then commit.
- Conventional commits: `<type>(<scope>): <subject>`. **No `Co-Authored-By` trailer.**
- Colocated tests (`X.test.ts(x)` frontend).
- Reuse the single existing `AddLinkDialog`; do not introduce a second dialog instance.
- Existing "Ajouter un lien" and drag-drop open paths must keep working unchanged (`autoStart` defaults false).
