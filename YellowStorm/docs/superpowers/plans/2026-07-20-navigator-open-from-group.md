# Double-click a start-URL group to open the navigator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Double-clicking a start-URL group header in the workspace opens the navigator (`AddLinkDialog`) already browsing that group's root URL, so the user can index more pages without retyping.

**Architecture:** Lift the single `AddLinkDialog`'s open-state into the Zustand workspace store (`addLinkDialog` state + `openAddLink`/`closeAddLink` actions). `WorkspaceUploadDropZone` drives the dialog from the store; `SourceGroupRow`'s header gets an `onDoubleClick` that `WorkspacePage` wires to `openAddLink({ url: rootUrl, autoStart: true })`. `AddLinkDialog` gains an `autoStart` prop that starts the browse session on open.

**Tech Stack:** React + Zustand + Vitest + Testing Library (frontend only).

## Global Constraints

- TDD: write the failing test first, watch it fail, implement minimally, watch it pass, commit.
- Conventional commits: `<type>(<scope>): <subject>`. **No `Co-Authored-By` trailer.**
- Colocated tests (`X.test.ts(x)`).
- Reuse the single existing `AddLinkDialog`; do NOT add a second dialog instance.
- Existing open paths ("Ajouter un lien" menu item and drag-drop) must keep working unchanged — they call `openAddLink` with `autoStart` omitted (defaults `false`), preserving today's input-phase behavior.
- Single-click still toggles the group; double-click opens the navigator (no click-debounce).
- Frontend commands run from `YellowStorm/front`. Git repo root is the parent `YellowStorm-poc` — stage repo-root-relative paths and verify with `git status`; do not stage unrelated changes.

---

### Task 1: Store — `addLinkDialog` state + `openAddLink`/`closeAddLink`

**Files:**
- Modify: `front/src/modules/workspace/store.ts`
- Test: `front/src/modules/workspace/store.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - State `addLinkDialog: { open: boolean; initialUrl: string; autoStart: boolean }`.
  - `openAddLink(options?: { url?: string; autoStart?: boolean }): void`.
  - `closeAddLink(): void`.

- [ ] **Step 1: Write the failing test**

In `front/src/modules/workspace/store.test.ts`, add inside `describe('workspace store', ...)`:

```ts
  it('openAddLink opens the dialog with url and autoStart, closeAddLink resets it', () => {
    act(() => { useWorkspaceStore.getState().openAddLink({ url: 'https://ex.com/services', autoStart: true }); });
    expect(useWorkspaceStore.getState().addLinkDialog).toEqual({ open: true, initialUrl: 'https://ex.com/services', autoStart: true });
    act(() => { useWorkspaceStore.getState().closeAddLink(); });
    expect(useWorkspaceStore.getState().addLinkDialog).toEqual({ open: false, initialUrl: '', autoStart: false });
  });

  it('openAddLink defaults to an empty url and no autoStart', () => {
    act(() => { useWorkspaceStore.getState().openAddLink(); });
    expect(useWorkspaceStore.getState().addLinkDialog).toEqual({ open: true, initialUrl: '', autoStart: false });
    act(() => { useWorkspaceStore.getState().closeAddLink(); });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd front && npx vitest run src/modules/workspace/store.test.ts -t "AddLink"`
Expected: FAIL — `openAddLink` is not a function / `addLinkDialog` is undefined.

- [ ] **Step 3: Add the state type and action declarations**

In `front/src/modules/workspace/store.ts`, in the store's state/actions interface, add the state field near the other modal state (after the `isSettingsModalOpen: boolean;` line):

```ts
  addLinkDialog: { open: boolean; initialUrl: string; autoStart: boolean };
```

And add the action declarations near the other modal action declarations (after the `closeSettingsModal: () => void;` line):

```ts
  openAddLink: (options?: { url?: string; autoStart?: boolean }) => void;
  closeAddLink: () => void;
```

- [ ] **Step 4: Add the initial state and action implementations**

In the store's initial state object, add near the other modal defaults (after the `isSettingsModalOpen: false,` line):

```ts
  addLinkDialog: { open: false, initialUrl: '', autoStart: false },
```

In the store's action implementations, add after the `closeSettingsModal: () => set({ ... })` action:

```ts
      openAddLink: (options) =>
        set({ addLinkDialog: { open: true, initialUrl: options?.url ?? '', autoStart: options?.autoStart ?? false } }),

      closeAddLink: () =>
        set({ addLinkDialog: { open: false, initialUrl: '', autoStart: false } }),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd front && npx vitest run src/modules/workspace/store.test.ts -t "AddLink"`
Expected: PASS.

Run: `cd front && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add YellowStorm/front/src/modules/workspace/store.ts YellowStorm/front/src/modules/workspace/store.test.ts
git commit -m "feat(workspace): add addLinkDialog state and open/close actions to store"
```

---

### Task 2: `AddLinkDialog` — `autoStart` prop

**Files:**
- Modify: `front/src/modules/workspace/components/AddLinkDialog.tsx`
- Test: `front/src/modules/workspace/components/AddLinkDialog.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `AddLinkDialog` accepts `autoStart?: boolean`. When `open && autoStart && isValidUrl(initialUrl)`, it starts the browse session for `initialUrl` and shows the browse phase; otherwise unchanged.

- [ ] **Step 1: Write the failing tests**

In `front/src/modules/workspace/components/AddLinkDialog.test.tsx`, add:

```ts
it('auto-starts browsing when opened with autoStart and a valid url', () => {
  session.status = 'idle';
  render(<AddLinkDialog open autoStart initialUrl='https://ok.example/services' onOpenChange={vi.fn()} workspaceId='w1' />);
  expect(session.start).toHaveBeenCalledWith('https://ok.example/services');
  // browse phase — the input-phase URL field is gone
  expect(screen.queryByPlaceholderText('https://exemple.com')).not.toBeInTheDocument();
});

it('does not auto-start with an empty url (stays on the input phase)', () => {
  session.status = 'idle';
  render(<AddLinkDialog open autoStart initialUrl='' onOpenChange={vi.fn()} workspaceId='w1' />);
  expect(session.start).not.toHaveBeenCalled();
  expect(screen.getByPlaceholderText('https://exemple.com')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd front && npx vitest run src/modules/workspace/components/AddLinkDialog.test.tsx -t "auto-start"`
Expected: FAIL — `autoStart` is not a known prop; `session.start` is not called on open.

- [ ] **Step 3: Add the `autoStart` prop and auto-start behavior**

In `front/src/modules/workspace/components/AddLinkDialog.tsx`, add `autoStart` to the props type and destructure:

Change the signature:

```ts
export function AddLinkDialog({
  open, onOpenChange, workspaceId, initialUrl = '', autoStart = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  initialUrl?: string;
  autoStart?: boolean;
}) {
```

Change the on-open effect to auto-start when requested:

```ts
  useEffect(() => {
    if (open) {
      if (autoStart && isValidUrl(initialUrl)) {
        // Opened from an existing group: skip the input step and browse the
        // root URL directly so the user can index more pages immediately.
        setUrl(initialUrl); setError(null); setBusy(false); setSelected(new Set());
        session.start(initialUrl.trim());
        setPhase('browse');
      } else {
        // An already-active session (e.g. carried over from a prior open) should
        // drop the user straight into the browse phase instead of forcing a
        // redundant "input" step.
        setPhase(session.status === 'idle' ? 'input' : 'browse');
        setUrl(initialUrl); setError(null); setBusy(false); setSelected(new Set());
      }
    } else {
      session.stop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialUrl]);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd front && npx vitest run src/modules/workspace/components/AddLinkDialog.test.tsx`
Expected: PASS (new auto-start tests plus the existing dialog tests — `autoStart` defaults `false`, so existing tests are unaffected).

Run: `cd front && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add YellowStorm/front/src/modules/workspace/components/AddLinkDialog.tsx YellowStorm/front/src/modules/workspace/components/AddLinkDialog.test.tsx
git commit -m "feat(workspace): add autoStart prop to AddLinkDialog"
```

---

### Task 3: `WorkspaceUploadDropZone` — drive `AddLinkDialog` from the store

**Files:**
- Modify: `front/src/modules/workspace/components/WorkspaceUploadDropZone.tsx`

**Interfaces:**
- Consumes: `addLinkDialog`, `openAddLink`, `closeAddLink` (Task 1); `autoStart` prop (Task 2).
- Produces: the dialog is now controlled by store state (no local `linkOpen`/`linkInitialUrl`).

> No new unit test: this is a wiring change with no isolated harness (there is no `WorkspaceUploadDropZone` test). Verified by `tsc` and the existing dialog/store tests; behavior is exercised by the Final Verification smoke.

- [ ] **Step 1: Replace local dialog state with the store**

In `front/src/modules/workspace/components/WorkspaceUploadDropZone.tsx`:

Remove the two local state lines:

```ts
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkInitialUrl, setLinkInitialUrl] = useState('');
```

Add store selectors near the existing `useWorkspaceStore` calls (after the `selectedWorkspaceId` selector):

```ts
  const addLinkDialog = useWorkspaceStore((s) => s.addLinkDialog);
  const openAddLink = useWorkspaceStore((s) => s.openAddLink);
  const closeAddLink = useWorkspaceStore((s) => s.closeAddLink);
```

Change `openLink` to route through the store:

```ts
  const openLink = (initialUrl: string) => openAddLink({ url: initialUrl });
```

Change the rendered dialog to read from the store:

```tsx
      {selectedWorkspaceId && (
        <AddLinkDialog
          open={addLinkDialog.open}
          onOpenChange={(o) => { if (!o) closeAddLink(); }}
          workspaceId={selectedWorkspaceId}
          initialUrl={addLinkDialog.initialUrl}
          autoStart={addLinkDialog.autoStart}
        />
      )}
```

If `useState` is now unused in the file, remove it from the `react` import (keep `useCallback`, `useRef`); if `useState` is still used elsewhere in the file, leave the import as-is.

- [ ] **Step 2: Verify types and existing tests**

Run: `cd front && npx tsc --noEmit`
Expected: no new errors (confirms the store fields and the `autoStart` prop resolve, and no dangling `useState`).

Run: `cd front && npx vitest run src/modules/workspace/components/AddLinkDialog.test.tsx src/modules/workspace/store.test.ts`
Expected: PASS (unchanged — the dropzone has no test; these confirm its dependencies still pass).

- [ ] **Step 3: Commit**

```bash
git add YellowStorm/front/src/modules/workspace/components/WorkspaceUploadDropZone.tsx
git commit -m "feat(workspace): control AddLinkDialog from the store"
```

---

### Task 4: `SourceGroupRow` — `onOpenInNavigator` + double-click

**Files:**
- Modify: `front/src/modules/workspace/components/SourceGroupRow.tsx`
- Test: `front/src/modules/workspace/components/SourceGroupRow.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `SourceGroupRow` accepts `onOpenInNavigator?: (url: string) => void`; double-clicking the header calls it with `rootUrl`. Single-click still toggles.

- [ ] **Step 1: Write the failing test**

In `front/src/modules/workspace/components/SourceGroupRow.test.tsx`, add inside `describe('SourceGroupRow', ...)`:

```ts
  it('calls onOpenInNavigator with the root url on double-click', () => {
    const onOpen = vi.fn();
    render(
      <SourceGroupRow label='example.com/services' rootUrl='https://example.com/services' count={3} onOpenInNavigator={onOpen}>
        <div>child-a</div>
      </SourceGroupRow>,
    );
    fireEvent.doubleClick(screen.getByRole('button', { name: 'example.com/services' }));
    expect(onOpen).toHaveBeenCalledWith('https://example.com/services');
  });
```

Add `vi` to the vitest import at the top of the file if it is not already imported (change `import { describe, it, expect } from 'vitest';` to `import { describe, it, expect, vi } from 'vitest';`).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd front && npx vitest run src/modules/workspace/components/SourceGroupRow.test.tsx -t "onOpenInNavigator"`
Expected: FAIL — the double-click handler / prop does not exist, so `onOpen` is not called.

- [ ] **Step 3: Add the prop and double-click handler**

In `front/src/modules/workspace/components/SourceGroupRow.tsx`, add `onOpenInNavigator` to the props:

```tsx
export function SourceGroupRow({
  label, rootUrl, count, status, defaultOpen = false, onOpenInNavigator, children,
}: {
  label: string;
  rootUrl: string;
  count: number;
  status?: IndexingStatus;
  defaultOpen?: boolean;
  onOpenInNavigator?: (url: string) => void;
  children: ReactNode;
}) {
```

Add `onDoubleClick` to the header button (keep the existing `onClick` toggle):

```tsx
      <button
        type='button'
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onDoubleClick={() => onOpenInNavigator?.(rootUrl)}
        className='flex w-full items-center gap-2 border-b px-2 py-1.5 text-left text-sm'
      >
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd front && npx vitest run src/modules/workspace/components/SourceGroupRow.test.tsx`
Expected: PASS (new test plus the existing toggle test — the single-click `onClick` is unchanged).

Run: `cd front && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add YellowStorm/front/src/modules/workspace/components/SourceGroupRow.tsx YellowStorm/front/src/modules/workspace/components/SourceGroupRow.test.tsx
git commit -m "feat(workspace): open navigator on double-click of a source group"
```

---

### Task 5: `WorkspacePage` — wire the double-click to `openAddLink`

**Files:**
- Modify: `front/src/modules/workspace/components/WorkspacePage.tsx`

**Interfaces:**
- Consumes: `openAddLink` (Task 1); `SourceGroupRow.onOpenInNavigator` (Task 4).
- Produces: double-clicking a group header opens the navigator at the group's root URL with auto-start.

> No isolated unit test: `WorkspacePage` has no render-test harness and this is a one-prop wiring change. The store action (Task 1), dialog auto-start (Task 2), and the double-click handler (Task 4) are each unit-tested; this task is verified by `tsc` + the Final Verification smoke.

- [ ] **Step 1: Read `openAddLink` from the store**

In `front/src/modules/workspace/components/WorkspacePage.tsx`, add a store selector near the other `useWorkspaceStore` selectors in the `WorkspacePage` component body:

```ts
  const openAddLink = useWorkspaceStore((s) => s.openAddLink);
```

- [ ] **Step 2: Pass `onOpenInNavigator` to each `SourceGroupRow`**

In the grouped-render branch, change the `SourceGroupRow` element to add the prop:

```tsx
                          <SourceGroupRow key={group.key} label={group.label} rootUrl={group.rootUrl} count={group.files.length} status={group.status} onOpenInNavigator={(url) => openAddLink({ url, autoStart: true })}>
                            {group.files.map(renderFileRow)}
                          </SourceGroupRow>
```

- [ ] **Step 3: Verify types and existing tests**

Run: `cd front && npx tsc --noEmit`
Expected: no new errors.

Run: `cd front && npx vitest run src/modules/workspace`
Expected: feature tests green (pre-existing unrelated failures in `store.test.ts`/`WorkspaceButton.test.tsx` may remain).

- [ ] **Step 4: Commit**

```bash
git add YellowStorm/front/src/modules/workspace/components/WorkspacePage.tsx
git commit -m "feat(workspace): wire source-group double-click to open the navigator"
```

---

## Final verification

- [ ] Frontend: `cd front && npx vitest run src/modules/workspace/store.test.ts src/modules/workspace/components/AddLinkDialog.test.tsx src/modules/workspace/components/SourceGroupRow.test.tsx` — feature tests green.
- [ ] Frontend: `cd front && npx tsc --noEmit` — no new errors.
- [ ] Live smoke (covers the store→dropzone→dialog wiring that has no unit test):
  1. Index 2+ pages from a site so a start-URL group appears in the workspace.
  2. **Double-click the group header** → the navigator opens and is already browsing the group's root URL (no input screen, no "Naviguer" click).
  3. Click around and index another page → it lands in the workspace.
  4. Single-click the group header still just expands/collapses it.
  5. "Ajouter un lien" (empty) and dragging a link onto the dropzone still open the navigator on the input screen as before.

## Self-review notes

- **Spec coverage:** store state/actions → Task 1. Auto-start → Task 2. Dialog controlled by store → Task 3. Double-click trigger → Task 4. Wire trigger to action → Task 5. Testing → Tasks 1/2/4 unit tests + Final Verification smoke. Edge cases (empty-url fallback → Task 2 test; existing paths preserved → Task 3 routes through `openAddLink` with `autoStart` false). All covered.
- **Existing behavior preserved:** "Ajouter un lien" (`openLink('')`) and drag-drop (`openLink(url)`) both call `openAddLink` with `autoStart` omitted → `false`, so they still open on the input phase.
- **Type consistency:** `addLinkDialog: { open, initialUrl, autoStart }`, `openAddLink({url?, autoStart?})`, `AddLinkDialog.autoStart`, and `SourceGroupRow.onOpenInNavigator(url)` are used identically across producing and consuming tasks.
- **Single-click preserved:** `SourceGroupRow`'s `onClick` toggle is untouched; `onDoubleClick` is additive (Task 4).
