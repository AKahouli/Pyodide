# Batch A — folder-aware add, move group to folder, clean-slate duplicates — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Links indexed while viewing a folder land in that folder; a start-URL group can be moved into a folder as a unit and stays grouped there; the manual add-link flow is a clean slate that allows duplicates.

**Architecture:** Frontend-only. `store.addPageLinks` assigns new links to `pageCurrentFolderId` (mirroring uploads). `MoveFileDialog` is generalized to move a set of files; `SourceGroupRow` gets a move button; `WorkspacePage` unifies the move target, wires the group move, and renders grouping inside folders (not only at root). `AddLinkDialog` drops the already-indexed blocking so duplicates are allowed.

**Tech Stack:** React + Zustand + Vitest + Testing Library (frontend only).

## Global Constraints

- TDD: write the failing test first, watch it fail, implement minimally, watch it pass, commit.
- Conventional commits: `<type>(<scope>): <subject>`. **No `Co-Authored-By` trailer.**
- Colocated tests (`X.test.ts(x)`).
- Reuse the existing folder-picker dialog + classifier assignment; no backend/DTO changes.
- Existing single-file move, upload folder-assignment, and the grouping search-bypass keep working.
- Frontend commands run from `YellowStorm/front`. Git repo root is the parent `YellowStorm-poc` — stage repo-root-relative paths, verify with `git status`, don't stage unrelated changes.

---

### Task 1: Store — folder-aware `addPageLinks`

**Files:**
- Modify: `front/src/modules/workspace/store.ts`
- Test: `front/src/modules/workspace/store.test.ts`

**Interfaces:**
- Consumes: `workspaceApi.addLinks` (returns `WorkspaceDocument[]`), `pageApi.assignFileToFolder`, `get().pageCurrentFolderId`.
- Produces: after indexing, each new link doc is assigned to the current folder when one is open.

- [ ] **Step 1: Write the failing test**

In `front/src/modules/workspace/store.test.ts`:

At the top, extend the hoisted `workspaceApiMock` with `addLinks` and add a hoisted `pageApiMock`, then mock `./page-api`:

```ts
// add to the existing `const workspaceApiMock = vi.hoisted(() => ({ ... }))`:
//   addLinks: vi.fn(),

const pageApiMock = vi.hoisted(() => ({
  listFolders: vi.fn().mockResolvedValue([]),
  listFiles: vi.fn().mockResolvedValue([]),
  assignFileToFolder: vi.fn().mockResolvedValue({}),
}));
vi.mock('./page-api', () => pageApiMock);
```

Add this test inside `describe('workspace store', ...)`:

```ts
  it('addPageLinks assigns new links to the current folder', async () => {
    workspaceApiMock.addLinks.mockResolvedValue([{ id: 'd1' }, { id: 'd2' }]);
    useWorkspaceStore.setState({ selectedWorkspaceId: 'w1', pageCurrentFolderId: 'folder1' });
    await useWorkspaceStore.getState().addPageLinks('w1', ['https://a.com/x', 'https://b.com/y'], {});
    expect(pageApiMock.assignFileToFolder).toHaveBeenCalledWith('w1', 'd1', 'folder1');
    expect(pageApiMock.assignFileToFolder).toHaveBeenCalledWith('w1', 'd2', 'folder1');
  });

  it('addPageLinks does not assign when no folder is open', async () => {
    pageApiMock.assignFileToFolder.mockClear();
    workspaceApiMock.addLinks.mockResolvedValue([{ id: 'd1' }]);
    useWorkspaceStore.setState({ selectedWorkspaceId: 'w1', pageCurrentFolderId: null });
    await useWorkspaceStore.getState().addPageLinks('w1', ['https://a.com/x'], {});
    expect(pageApiMock.assignFileToFolder).not.toHaveBeenCalled();
  });
```

Note: `refreshPageData` runs inside `addPageLinks`; the `pageApiMock` `listFolders`/`listFiles` returning `[]` keep it from hitting the network. If `refreshPageData` also pulls artifacts (`dataRoomFeatures.decisionFlowArtifactsEnabled`), mock that call too so the promise resolves.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd front && npx vitest run src/modules/workspace/store.test.ts -t "addPageLinks assigns"`
Expected: FAIL — `assignFileToFolder` is never called (current `addPageLinks` ignores the folder).

- [ ] **Step 3: Make `addPageLinks` folder-aware**

In `front/src/modules/workspace/store.ts`, replace the `addPageLinks` action:

```ts
      addPageLinks: async (workspaceId, urls, options) => {
        const targetFolderId = get().pageCurrentFolderId;
        const docs = await workspaceApi.addLinks(workspaceId, urls, options);
        if (targetFolderId && docs.length > 0) {
          await Promise.allSettled(
            docs.map((doc) => pageApi.assignFileToFolder(workspaceId, doc.id, targetFolderId)),
          );
        }
        await get().refreshPageData();
      },
```

(`pageApi` is already imported as `import * as pageApi from './page-api'`; `workspaceApi.addLinks` already returns the created `WorkspaceDocument[]`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd front && npx vitest run src/modules/workspace/store.test.ts -t "addPageLinks"`
Expected: PASS (both new tests).

Run: `cd front && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add YellowStorm/front/src/modules/workspace/store.ts YellowStorm/front/src/modules/workspace/store.test.ts
git commit -m "feat(workspace): index links into the current folder"
```

---

### Task 2: Generalize `MoveFileDialog` to move a set of files (+ update the call site)

**Files:**
- Modify: `front/src/modules/workspace/components/MoveFileDialog.tsx`
- Test (create): `front/src/modules/workspace/components/MoveFileDialog.test.tsx`
- Modify: `front/src/modules/workspace/components/WorkspacePage.tsx` (the single-file move wiring, so tsc stays green)

**Interfaces:**
- Consumes: `useWorkspaceStore` (`pageFolders`, `setFileFolderAssignment`, `selectedWorkspaceId`).
- Produces: `MoveFileDialog` props become `{ open, onOpenChange, files: WorkspaceFile[], title: string }`; "Déplacer ici" assigns every file to the picked folder; `WorkspacePage` uses a unified `moveTarget` state.

- [ ] **Step 1: Write the failing test**

Create `front/src/modules/workspace/components/MoveFileDialog.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const setFileFolderAssignment = vi.fn();
vi.mock('../store', () => ({
  useWorkspaceStore: (sel: (s: unknown) => unknown) =>
    sel({
      pageFolders: [{ id: 'f1', workspaceId: 'w1', name: 'Folder1', parentId: null, description: '' }],
      setFileFolderAssignment,
      selectedWorkspaceId: 'w1',
    }),
}));

import { MoveFileDialog } from './MoveFileDialog';

describe('MoveFileDialog', () => {
  it('moves every file in the set to the picked folder', () => {
    const files = [{ id: 'a', name: 'A', folderId: null }, { id: 'b', name: 'B', folderId: null }] as never;
    render(<MoveFileDialog open files={files} title='example.com' onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByText('Folder1'));       // pick Folder1 as destination
    fireEvent.click(screen.getByText('Déplacer ici'));
    expect(setFileFolderAssignment).toHaveBeenCalledWith('a', 'f1');
    expect(setFileFolderAssignment).toHaveBeenCalledWith('b', 'f1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd front && npx vitest run src/modules/workspace/components/MoveFileDialog.test.tsx`
Expected: FAIL — the component still expects a `file` prop (type error / assignment called with wrong args or not called for both).

- [ ] **Step 3: Generalize the dialog**

In `front/src/modules/workspace/components/MoveFileDialog.tsx`:

Change the props type:

```tsx
type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  files: WorkspaceFile[];
  title: string;
};

export function MoveFileDialog({ open, onOpenChange, files, title }: Props) {
```

Change the on-open effect to seed the picker from the first file's folder:

```tsx
  useEffect(() => {
    if (open && files.length > 0) {
      const current = files[0].folderId
        ? folders.find((f) => f.id === files[0].folderId) ?? null
        : null;
      setPickerFolderId(current?.parentId ?? null);
    }
  }, [open, files, folders]);
```

Change the "already here" computation to require ALL files:

```tsx
  const isAlreadyHere = files.length > 0 && files.every((f) => f.folderId === pickerFolderId);
```

Change the header description to the title:

```tsx
              <DialogTitle>Déplacer</DialogTitle>
              <DialogDescription className='truncate'>{title}</DialogDescription>
```

Change the confirm handler to loop over all files:

```tsx
          <Button
            disabled={isAlreadyHere}
            onClick={() => {
              if (files.length === 0) return;
              files.forEach((f) => void setFileFolderAssignment(f.id, pickerFolderId));
              onOpenChange(false);
            }}
          >
            Déplacer ici
          </Button>
```

(The empty-subfolder helper text "Tu peux déplacer le fichier ici." can stay as-is.)

- [ ] **Step 4: Update the `WorkspacePage` call site (single-file move → unified `moveTarget`)**

In `front/src/modules/workspace/components/WorkspacePage.tsx`:

Change the state declaration (currently `const [mapFile, setMapFile] = useState<WorkspaceFile | null>(null);`):

```tsx
  const [moveTarget, setMoveTarget] = useState<{ files: WorkspaceFile[]; title: string } | null>(null);
```

Change the `FileRow` `onMove` (currently `onMove={() => setMapFile(file)}`):

```tsx
                    onMove={() => setMoveTarget({ files: [file], title: file.name })}
```

Change the dialog render (currently `<MoveFileDialog open={!!mapFile} onOpenChange={(o) => !o && setMapFile(null)} file={mapFile} />`):

```tsx
      <MoveFileDialog open={!!moveTarget} onOpenChange={(o) => !o && setMoveTarget(null)} files={moveTarget?.files ?? []} title={moveTarget?.title ?? ''} />
```

(The group move wiring — `SourceGroupRow.onMove` and the grouping-inside-folders gate — is added in Task 4.)

- [ ] **Step 5: Run test + tsc to verify**

Run: `cd front && npx vitest run src/modules/workspace/components/MoveFileDialog.test.tsx`
Expected: PASS.

Run: `cd front && npx tsc --noEmit`
Expected: no new errors (the `WorkspacePage` call site now matches the new `files`/`title` props).

- [ ] **Step 6: Commit**

```bash
git add YellowStorm/front/src/modules/workspace/components/MoveFileDialog.tsx YellowStorm/front/src/modules/workspace/components/MoveFileDialog.test.tsx YellowStorm/front/src/modules/workspace/components/WorkspacePage.tsx
git commit -m "feat(workspace): move a set of files with MoveFileDialog"
```

---

### Task 3: `SourceGroupRow` — header move button

**Files:**
- Modify: `front/src/modules/workspace/components/SourceGroupRow.tsx`
- Test: `front/src/modules/workspace/components/SourceGroupRow.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `SourceGroupRow` accepts optional `onMove?: () => void`; a move-icon button in the header calls it. The header toggle/open-navigator gestures are unchanged.

- [ ] **Step 1: Write the failing test**

In `front/src/modules/workspace/components/SourceGroupRow.test.tsx`, add inside `describe('SourceGroupRow', ...)`:

```ts
  it('calls onMove from the move button without toggling the group', () => {
    const onMove = vi.fn();
    render(
      <SourceGroupRow label='example.com/services' rootUrl='https://example.com/services' count={3} onMove={onMove}>
        <div>child-a</div>
      </SourceGroupRow>,
    );
    fireEvent.click(screen.getByLabelText('move example.com/services'));
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('child-a')).not.toBeInTheDocument(); // still collapsed
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd front && npx vitest run src/modules/workspace/components/SourceGroupRow.test.tsx -t "move button"`
Expected: FAIL — no move button exists.

- [ ] **Step 3: Add the move button (restructure the header row so buttons aren't nested)**

In `front/src/modules/workspace/components/SourceGroupRow.tsx`:

Add `FolderInput` to the lucide import and `onMove` to the props:

```tsx
import { ChevronRight, FolderInput } from 'lucide-react';
```

```tsx
export function SourceGroupRow({
  label, rootUrl, count, status, defaultOpen = false, onOpenInNavigator, onMove, children,
}: {
  label: string;
  rootUrl: string;
  count: number;
  status?: IndexingStatus;
  defaultOpen?: boolean;
  onOpenInNavigator?: (url: string) => void;
  onMove?: () => void;
  children: ReactNode;
}) {
```

Wrap the existing header `<button>` and a new move `<button>` in a flex row (a button cannot be nested inside another button, so the move button is a SIBLING of the header button). Replace the header `<button …>…</button>` block with:

```tsx
      <div className='flex items-center border-b'>
        <button
          type='button'
          aria-label={label}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          onDoubleClick={() => onOpenInNavigator?.(rootUrl)}
          className='flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-sm'
        >
          <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
          <IndexingStatusDot status={status} />
          <span className='min-w-0 flex-1 truncate font-medium' title={rootUrl}>{label}</span>
          <span className='shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-secondary-foreground'>{count}</span>
        </button>
        {onMove && (
          <button
            type='button'
            aria-label={`move ${label}`}
            onClick={onMove}
            className='mr-1 shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground'
          >
            <FolderInput className='h-4 w-4' />
          </button>
        )}
      </div>
```

(The `{open && <div className='space-y-1 p-1'>{children}</div>}` block below is unchanged. The outer `<div className='rounded border'>` wrapper stays; the inner header `border-b` moves onto the new flex row.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd front && npx vitest run src/modules/workspace/components/SourceGroupRow.test.tsx`
Expected: PASS (new test plus existing ones — the header button still has `aria-label={label}` for the toggle/open-navigator tests; the move button is a separate sibling).

Run: `cd front && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add YellowStorm/front/src/modules/workspace/components/SourceGroupRow.tsx YellowStorm/front/src/modules/workspace/components/SourceGroupRow.test.tsx
git commit -m "feat(workspace): add a move button to source-group headers"
```

---

### Task 4: `WorkspacePage` — group move + grouping inside folders

**Files:**
- Modify: `front/src/modules/workspace/components/WorkspacePage.tsx`

**Interfaces:**
- Consumes: the unified `moveTarget` state (Task 2), `SourceGroupRow.onMove` (Task 3), `groupBySourceRoot`.
- Produces: group moves route through `moveTarget`; groups render inside folders too.

> No isolated unit test: `WorkspacePage` has no render harness and this is wiring. Verified by `tsc` + the Final Verification smoke; the moved-file and moved-group behaviors are covered by Task 2 (dialog) and Task 3 (button).

- [ ] **Step 1: Group inside folders + wire the group move**

Change the files-section grouping gate (currently `{currentFolderId || search.trim() ? (`):

```tsx
                  {search.trim() ? (
```

Add `onMove` to the `SourceGroupRow` element (currently `<SourceGroupRow key={group.key} label={group.label} rootUrl={group.rootUrl} count={group.files.length} status={group.status} onOpenInNavigator={(url) => openAddLink({ url, autoStart: true })}>`):

```tsx
                          <SourceGroupRow key={group.key} label={group.label} rootUrl={group.rootUrl} count={group.files.length} status={group.status} onOpenInNavigator={(url) => openAddLink({ url, autoStart: true })} onMove={() => setMoveTarget({ files: group.files, title: group.label })}>
```

- [ ] **Step 2: Verify types and existing tests**

Run: `cd front && npx tsc --noEmit`
Expected: no errors (`setMoveTarget` exists from Task 2; `SourceGroupRow.onMove` exists from Task 3).

Run: `cd front && npx vitest run src/modules/workspace`
Expected: feature tests green (pre-existing unrelated failures in `store.test.ts`/`WorkspaceButton.test.tsx` may remain).

- [ ] **Step 3: Commit**

```bash
git add YellowStorm/front/src/modules/workspace/components/WorkspacePage.tsx
git commit -m "feat(workspace): move groups to folders and group inside folders"
```

---

### Task 5: `AddLinkDialog` — clean-slate manual add (allow duplicates)

**Files:**
- Modify: `front/src/modules/workspace/components/AddLinkDialog.tsx`
- Test: `front/src/modules/workspace/components/AddLinkDialog.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: the manual flow no longer blocks already-indexed URLs; `chosen` includes every selected page.

- [ ] **Step 1: Write the failing test**

In `front/src/modules/workspace/components/AddLinkDialog.test.tsx`:

Make the store mock's `documents` value settable per-test. Change the store mock so it reads a mutable variable — replace the current `vi.mock('../store', ...)` block with:

```ts
let documentsCache: unknown = [];
const addPageLinks = vi.fn().mockResolvedValue(undefined);
vi.mock('../store', () => ({
  useWorkspaceStore: (sel: (s: unknown) => unknown) =>
    sel({ addPageLinks, documents: documentsCache }),
}));
```

(Keep the existing `const addPageLinks = ...` only once — move it into this block if it was declared separately.) In `beforeEach`, add `documentsCache = [];`.

Add this test:

```ts
it('indexes an already-indexed url (clean slate allows duplicates)', async () => {
  session.status = 'live';
  session.rootUrl = 'https://ok.example/start';
  session.pages = [{ url: 'https://ok.example/a', title: 'A' }];
  // Simulate the page already existing in the workspace cache — old behavior filtered it out.
  documentsCache = new Map([[1, [{ id: 'd1', sourceUrl: 'https://ok.example/a' }]]]);
  render(<AddLinkDialog open onOpenChange={vi.fn()} workspaceId='w1' />);
  fireEvent.click(screen.getByRole('button', { name: /Indexer/ }));
  await waitFor(() =>
    expect(addPageLinks).toHaveBeenCalledWith('w1', ['https://ok.example/a'], expect.anything()),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd front && npx vitest run src/modules/workspace/components/AddLinkDialog.test.tsx -t "clean slate"`
Expected: FAIL — the current code marks the URL already-indexed (from the store cache), drops it from `chosen`, so `handleIndex` early-returns and `addPageLinks` is never called.

- [ ] **Step 3: Remove the already-indexed blocking**

In `front/src/modules/workspace/components/AddLinkDialog.tsx`:

- Delete the import `import { checkUrls } from '../api';`.
- Delete `const documentsCache = useWorkspaceStore((s) => s.documents);`.
- Delete `const [serverIndexedUrls, setServerIndexedUrls] = useState<Set<string>>(new Set());`.
- Delete the `indexedUrls` `useMemo` block (the comment + `const indexedUrls = useMemo(...)`).
- Delete the `checkUrls` debounce `useEffect` block (the one that calls `checkUrls(workspaceId, urls)`).
- Change `selectableUrls` to drop the filter:

```tsx
  const selectableUrls = () => session.pages.map((p) => p.url);
```

- Change `chosen` to drop the filter:

```tsx
  const chosen = session.pages
    .map((p) => p.url)
    .filter((u) => selected.has(u));
```

- Change the `CollectionSidebar` render to pass an empty set:

```tsx
              indexedUrls={new Set()}
```

- Remove now-unused imports: if `useMemo` is no longer used, drop it from the `react` import; if `normalizeUrl` is no longer used, drop it from the `useBrowserSession` import. Run `tsc` to confirm which are unused.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd front && npx vitest run src/modules/workspace/components/AddLinkDialog.test.tsx`
Expected: PASS (new clean-slate test plus all existing dialog tests — the existing tests never relied on greying).

Run: `cd front && npx tsc --noEmit`
Expected: no new errors (confirms no dangling `useMemo`/`normalizeUrl`/`checkUrls`/`documentsCache`).

- [ ] **Step 5: Commit**

```bash
git add YellowStorm/front/src/modules/workspace/components/AddLinkDialog.tsx YellowStorm/front/src/modules/workspace/components/AddLinkDialog.test.tsx
git commit -m "feat(workspace): make manual add-link a clean slate that allows duplicates"
```

---

## Final verification

- [ ] Frontend: `cd front && npx vitest run src/modules/workspace/store.test.ts src/modules/workspace/components/MoveFileDialog.test.tsx src/modules/workspace/components/SourceGroupRow.test.tsx src/modules/workspace/components/AddLinkDialog.test.tsx` — feature tests green.
- [ ] Frontend: `cd front && npx tsc --noEmit` — no new errors.
- [ ] Frontend: `cd front && npx vitest run src/modules/workspace` — feature tests green (pre-existing unrelated failures may remain).
- [ ] Live smoke:
  1. Open a folder → **Ajouter un lien** → index a page → it lands **in that folder**.
  2. At root, a start-URL group → click its **move button** → pick a folder → all its pages move there, and inside the folder they **stay grouped** under the start URL.
  3. **Ajouter un lien** → type a URL you've already indexed → navigate → the page is **not greyed**, and indexing it creates a duplicate document.
  4. Search still flattens the list (grouping suspends while searching, at root and in folders).

## Self-review notes

- **Spec coverage:** #1 folder-aware add → Task 1. #2 move group + group-in-folders → Tasks 2 (dialog) + 3 (button) + 4 (wiring + gate). #3 clean-slate duplicates → Task 5. Testing → Tasks 1/2/3/5 unit tests + Final Verification smoke. All covered.
- **Backward compatibility:** `MoveFileDialog` single-file callers become `files:[file]` (Task 4 updates the only call site); `SourceGroupRow.onMove` optional; `AddLinkDialog` clean-slate removes machinery without touching `CollectionSidebar` (it just receives an empty set). Upload folder-assignment and the search bypass are untouched.
- **Type consistency:** `moveTarget: { files: WorkspaceFile[]; title: string }`, `MoveFileDialog` `files`/`title`, and `SourceGroupRow.onMove` used identically across Tasks 2/3/4. `addPageLinks` assigns via the same `pageApi.assignFileToFolder` uploads use.
- **No nested buttons:** the `SourceGroupRow` move button is a sibling of the header button (Task 3), not nested, so it's valid HTML and doesn't inherit the header's click/double-click.
