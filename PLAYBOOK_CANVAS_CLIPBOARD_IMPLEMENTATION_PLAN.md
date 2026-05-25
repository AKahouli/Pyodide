# Playbook Canvas Clipboard Implementation Plan

## Goal

Users should be able to select one or more playbook node tasks on the canvas and use copy, cut, and paste within the same playbook or across different playbooks.

Supported interactions:

- Select one node task or multiple node tasks on the canvas.
- `Ctrl+C` / `Cmd+C` copies the selected node tasks.
- `Ctrl+X` / `Cmd+X` cuts the selected node tasks.
- `Ctrl+V` / `Cmd+V` pastes the copied or cut node tasks into the active playbook canvas.
- Pasted node tasks receive new IDs and safe positions.
- Edges and data bindings are preserved only when both connected node tasks are part of the copied selection.
- Copy, cut, and paste should work across different playbooks in the same browser session.

## Current Code To Reuse

- `YellowStorm/front/src/modules/playbook/hooks/usePlaybookCanvas.ts` owns React Flow node and edge state, selection changes, drag, connect, add, and remove behavior.
- `YellowStorm/front/src/modules/playbook/store.ts` owns playbook state, dirty state, undo/redo snapshots, task updates, edge updates, and import/export actions.
- `YellowStorm/front/src/modules/playbook/types.ts` owns playbook task, edge, data binding, and definition export types.
- `YellowStorm/front/src/modules/playbook/utils/playbookExport.ts` already strips runtime-only task fields for portable playbook exports.
- `YellowStorm/front/src/modules/playbook/utils/playbookImport.ts` already validates imported playbook definitions.
- `YellowStorm/front/src/modules/playbook/hooks/helpers/node-serializer.ts` converts `PlaybookTask[]` to React Flow nodes and back.
- `YellowStorm/front/src/modules/playbook/hooks/helpers/control-edge-serializer.ts` converts persisted edges to React Flow edges and back.
- `YellowStorm/front/src/modules/playbook/hooks/helpers/data-binding-serializer.ts` renders data bindings separately from React Flow edges.

## Recommended Architecture

Implement a frontend-owned playbook clipboard feature using a small portable clipboard payload. Do not add backend endpoints for the initial version because the existing playbook definition import/export flow is already client-side and the target operation is canvas editing.

Add a focused utility module:

- `YellowStorm/front/src/modules/playbook/utils/playbookClipboard.ts`

The utility should own:

- Building clipboard payloads from selected tasks.
- Stripping runtime-only task fields.
- Filtering internal-only edges and data bindings.
- Reading and writing the browser clipboard.
- Falling back to local/session storage when browser clipboard access is blocked.
- Validating clipboard payload shape and version.
- Remapping IDs on paste.
- Offsetting pasted positions.

Avoid spreading clipboard logic across components. `usePlaybookCanvas.ts` should orchestrate canvas state changes, while `playbookClipboard.ts` should own serialization and remapping.

## Clipboard Payload

Use a versioned payload so future changes can be migrated safely.

```ts
export const PLAYBOOK_CLIPBOARD_VERSION = 1;
export const PLAYBOOK_CLIPBOARD_MIME = 'application/vnd.yellostorm.playbook.nodes+json';

export interface PlaybookClipboardPayload {
  type: 'yellowstorm/playbook-nodes';
  version: 1;
  operation: 'copy' | 'cut';
  sourcePlaybookId: string;
  sourcePlaybookName?: string;
  copiedAt: string;
  tasks: PlaybookTask[];
  edges: PlaybookEdge[];
  controlEdges?: ControlEdge[];
  dataBindings: DataBinding[];
  bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
  sourceTaskIds: string[];
}
```

Notes:

- `type` prevents accidentally pasting arbitrary JSON.
- `version` allows future migration.
- `operation` distinguishes copy from cut.
- `sourcePlaybookId` is required for cross-playbook cut cleanup.
- `sourceTaskIds` records the original IDs for cut deletion after paste succeeds.
- `bounds` allows paste positioning relative to the selected group rather than stacking nodes unpredictably.

## Browser Clipboard Strategy

Write clipboard data in two layers:

- Browser clipboard text: JSON stringified `PlaybookClipboardPayload`.
- App fallback storage: `localStorage` key such as `ys_playbook_clipboard_payload`.

Recommended behavior:

- On copy or cut, try `navigator.clipboard.writeText(JSON.stringify(payload))` first.
- Always update the app fallback storage after a successful payload build.
- On paste, try `navigator.clipboard.readText()` first.
- If browser read fails or returns invalid content, read fallback storage.
- If both fail, show a localized warning toast.

Do not rely on custom clipboard MIME only. Browser support and permission behavior vary. Plain text JSON plus validation is more reliable.

## Copy Behavior

Copy should:

- Ignore the trigger node `__trigger__`.
- Require at least one selected playbook task.
- Build a task ID set from selected task IDs.
- Copy only selected tasks.
- Strip runtime-only task fields, matching `playbookExport.ts`.
- Copy only control/flow edges where both source and target are selected.
- Copy only data bindings where the target task is selected and, for `node-output` bindings, the source task is also selected.
- Drop trigger bindings from the copied payload unless trigger support is explicitly added later.
- Preserve task configuration, ports, router config, iterator config, human approval config, tool bindings, resource references, and user-authored metadata.

Edges to nodes outside the selected set must be dropped to avoid broken references after paste.

## Cut Behavior

Cut should use the same payload as copy, with `operation: 'cut'`.

Recommended deletion semantics:

- Do not delete source tasks immediately on `Ctrl+X`.
- Delete source tasks only after paste succeeds.
- For same-playbook cut, paste the remapped tasks first, then remove the original selected tasks in the same undo snapshot if feasible.
- For cross-playbook cut, paste into the target playbook first, then update the source playbook through the existing API/store path.
- If source deletion fails after cross-playbook paste, keep the pasted tasks and show a localized warning that the source playbook was not cleaned up.

This avoids losing user work when paste fails, the target playbook is invalid, the user lacks permission, or autosave/API update fails.

## Paste Behavior

Paste should:

- Validate payload `type` and `version`.
- Build an old ID to new ID map for every pasted task.
- Generate new task IDs using the same style already used for new canvas nodes.
- Generate new edge and data binding IDs.
- Remap task references inside edges and data bindings.
- Remap iterator child parent references when both parent and child are pasted.
- Drop iterator parent references when the child is pasted without its parent.
- Offset task positions so pasted nodes do not overlap the originals.
- Select the newly pasted nodes after paste.
- Capture one undo snapshot before applying the paste.
- Mark the playbook dirty and allow the existing autosave/manual save path to persist it.

Recommended position logic:

- If the canvas mouse position is available, paste the group around the last canvas pointer location.
- Otherwise paste around the current viewport center.
- If neither is easy to access, offset by `+48px x` and `+48px y` from the copied bounds.
- Repeated paste should increase the offset to prevent exact stacking.

## Edges And Data Bindings

Preserve only internal relationships.

For `PlaybookEdge[]`:

- Keep when `sourceId` and `targetId` are both in selected task IDs.
- Remap `sourceId` and `targetId` to new task IDs.
- Regenerate `id`, preferably using the existing edge ID format from `usePlaybookCanvas.ts`.

For `ControlEdge[]`, if still used by the current playbook flow model:

- Keep when `source` and `target` are both in selected task IDs.
- Remap `source` and `target` to new task IDs.
- Regenerate `id`.
- Preserve `kind`, `routerLabel`, ports, and priority.

For `DataBinding[]`:

- Keep `node-output` bindings only when `sourceNode` and `targetNode` are both selected.
- Keep `constant`, `state`, and `expression` bindings only when `targetNode` is selected.
- Drop `trigger` bindings in the first implementation unless the target playbook has a compatible trigger contract.
- Remap `sourceNode` and `targetNode` to new task IDs.
- Regenerate `id`.

## Cross-Playbook Compatibility

Cross-playbook paste must validate references that may not exist in the target playbook.

References to check:

- Assigned agent IDs.
- Tool bindings and connector bindings.
- Workspace IDs.
- Document, folder, and resource references.
- Input files and resource bindings.
- Replay baseline and output-format runtime fields.

Recommended first implementation:

- Strip runtime replay/output-format fields during copy.
- Preserve assigned agents and tool/resource references as authored data.
- After paste, mark or warn when a referenced workspace/resource is not available in the target playbook context.
- Do not silently delete user-authored configuration unless it is runtime-only.

Future hardening:

- Add a compatibility check that returns structured warnings before paste.
- Show a confirmation dialog if pasted nodes reference unavailable agents, workspaces, documents, or connectors.
- Offer a repair flow to rebind missing resources.

## Undo And Dirty State

Clipboard mutations must integrate with existing canvas history.

Requirements:

- Copy should not affect undo/redo history or dirty state.
- Cut should not affect undo/redo history until the source is actually deleted.
- Paste should be one undoable action.
- Same-playbook cut-paste should ideally be one undoable action: original nodes removed and remapped nodes added together.
- Cross-playbook cut-paste cannot be truly atomic with the current frontend-only flow; target paste and source cleanup are separate persisted updates.
- `canvasSyncVersion` should be bumped if store-level bulk replacement is used so the canvas re-renders correctly.

## UI And Keyboard Handling

Recommended keyboard behavior:

- Attach key handling at the canvas page or canvas wrapper level, not globally across the app.
- Ignore shortcuts when the active element is an input, textarea, select, contenteditable element, or node editor form field.
- Support `Ctrl` on Windows/Linux and `Meta` on macOS.
- Prevent default browser behavior only when the playbook canvas handles the shortcut.
- Keep toolbar/context menu buttons optional for phase 1, but add them if discoverability is important.

Recommended user feedback:

- Copy success: localized info/success toast with copied count.
- Cut success: localized info toast with cut count and paste instruction.
- Paste success: localized success toast with pasted count.
- Paste invalid: localized warning toast.
- Cross-playbook cut cleanup failure: localized warning toast.

All user-facing strings must be added to both playbook locale files.

## Store And Hook Changes

Recommended minimal changes:

- Add clipboard helper functions to `utils/playbookClipboard.ts`.
- Add tests in `utils/playbookClipboard.test.ts` for payload filtering, validation, ID remapping, and position offset.
- Extend `usePlaybookCanvas.ts` with actions such as `copySelection`, `cutSelection`, and `pasteClipboard`.
- Keep direct React Flow state updates in `usePlaybookCanvas.ts` because it already owns `nodes`, `edges`, and refs.
- Use existing store actions: `captureSnapshot`, `updateTasks`, `updateEdges`, `updateDataBindings`, and `selectStep`.
- Avoid adding a new Zustand slice; project guidance keeps one `store.ts` per module.

If cross-playbook cut cleanup requires updating a playbook that is not currently loaded, add a focused store/API helper rather than changing the clipboard payload contract.

## Implementation Phases

### Phase 1 - Copy/Paste MVP

- Add `PlaybookClipboardPayload` types and constants.
- Extract or reuse runtime field stripping from `playbookExport.ts` so clipboard and export stay consistent.
- Implement payload creation from selected tasks.
- Implement browser clipboard plus localStorage fallback.
- Implement paste remapping for tasks, edges, and data bindings.
- Add keyboard shortcuts for copy and paste.
- Select newly pasted nodes.
- Add unit tests for clipboard utility behavior.

### Phase 2 - Cut Support

- Add `operation: 'cut'` payload support.
- Add keyboard shortcut for cut.
- Implement same-playbook cut cleanup after paste succeeds.
- Implement cross-playbook source cleanup through existing playbook update API.
- Add warnings for cleanup failure.
- Add tests for same-playbook and cross-playbook cut semantics.

### Phase 3 - Compatibility Warnings

- Validate agent, workspace, document, folder, connector, and tool references on paste.
- Warn before or after paste when references are unavailable in the target playbook.
- Preserve invalid references unless there is a security/correctness reason to remove them.
- Add tests for unavailable resource warnings.

### Phase 4 - Discoverability And Polish

- Add context menu actions: Copy, Cut, Paste.
- Optionally add toolbar actions when selected nodes exist.
- Add disabled states and tooltips.
- Add localized shortcut hints.
- Verify desktop and mobile/tablet behavior. Keyboard shortcuts are desktop-first, but paste actions should remain available from menu controls where possible.

## Test Plan

Unit tests:

- Copy one task with no edges.
- Copy multiple connected tasks and preserve only internal edges.
- Copy tasks with external incoming/outgoing edges and drop those edges.
- Copy `node-output` data bindings only when source and target are selected.
- Keep `constant`, `state`, and `expression` bindings for selected targets.
- Drop trigger bindings in MVP.
- Paste remaps all task IDs.
- Paste remaps iterator parent references when parent and child are copied together.
- Paste drops iterator parent reference when parent is not copied.
- Paste offsets positions.
- Runtime-only fields are stripped.
- Invalid clipboard JSON is rejected.
- Unsupported clipboard version is rejected.

Component/hook tests:

- `Ctrl+C` with selected nodes writes a payload.
- `Ctrl+V` adds remapped nodes and selects them.
- `Ctrl+X` does not delete immediately.
- Same-playbook cut removes originals only after paste succeeds.
- Shortcuts are ignored while typing in inputs/textareas.

Manual/browser QA:

- Copy and paste within one playbook.
- Multi-select three nodes with two internal edges and one external edge; paste should preserve only the two internal edges.
- Copy from playbook A and paste into playbook B.
- Cut from playbook A and paste into playbook B; source cleanup should happen only after target paste succeeds.
- Undo paste in the target playbook.
- Verify no console errors.
- Verify pasted nodes are visible and not stacked exactly on the original nodes.
- Verify autosave/manual save persists pasted nodes.

## Acceptance Criteria

- Users can copy one selected node task.
- Users can copy multiple selected node tasks.
- Users can paste copied node tasks into the same playbook.
- Users can paste copied node tasks into a different playbook.
- Users can cut and paste within the same playbook without losing data.
- Users can cut and paste across playbooks; if source cleanup fails, target paste remains and the user is warned.
- Pasted tasks always receive new IDs.
- Pasted internal edges and data bindings point to the new IDs.
- Edges and node-output bindings to unselected nodes are not pasted.
- Runtime-only execution/replay/output-format fields are not copied.
- Paste is undoable as a single target-canvas action.
- Keyboard shortcuts do not interfere with text editing fields.
- User-facing messages are localized in English and French.

## Risks And Decisions

- Cross-playbook cut is not truly transactional in the frontend-only architecture. The safest behavior is paste-first, then cleanup source, with a warning if cleanup fails.
- Browser clipboard permissions are inconsistent. The localStorage fallback is required for reliability.
- Resource references may be unavailable in the target playbook. Preserve the configuration and warn rather than silently deleting user-authored data.
- Trigger bindings are playbook-level contracts, not normal task-to-task relationships. Drop them in MVP unless compatible trigger paste behavior is explicitly designed.
- Reusing import/export stripping logic reduces the risk of copying runtime-only fields into new tasks.

## Suggested First PR Scope

Keep the first PR focused:

- Implement copy and paste for selected tasks, internal edges, and internal data bindings.
- Add clipboard fallback storage.
- Add keyboard shortcuts.
- Add unit tests for clipboard serialization/remapping.
- Defer cross-playbook cut cleanup and compatibility warning dialogs to follow-up PRs if the first PR becomes too large.
