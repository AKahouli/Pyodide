# Manually add & edit links in the browse collection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user, mid-browse-session, manually add a link (any domain) to the collection and edit the name or URL of any collected page before indexing; manual links index rooted to themselves.

**Architecture:** `useBrowserSession` (which owns the collected `pages`) gains `addManualPage`/`updatePage` mutators; `CollectionSidebar` gains an inline add row and a per-leaf pencil→popover editor; `AddLinkDialog` wires those to the session, migrates selection on URL edits, and sends a per-link `roots` map so `manual` pages root to their own URL. The backend `addLinks` applies a per-URL source-root override (`roots[url] ?? sourceRootUrl`).

**Tech Stack:** React + Zustand + Vitest + Testing Library (frontend); NestJS + Jest (backend).

## Global Constraints

- TDD: write the failing test first, watch it fail, implement minimally, watch it pass, commit.
- Conventional commits: `<type>(<scope>): <subject>`. **No `Co-Authored-By` trailer.**
- Colocated tests (`X.spec.ts` backend, `X.test.ts(x)` frontend).
- URL-keyed page identity preserved; duplicate URLs rejected on add and edit; `seenRef` kept consistent.
- Any `http(s)` domain allowed for manual links (no client-side reachability/SSRF check).
- Existing capture flow, selection contract, and the `names`/`sourceRootUrl` indexing path are untouched except where extended here.
- Frontend commands run from `YellowStorm/front`, backend from `YellowStorm/back`. Git repo root is the parent `YellowStorm-poc` — stage repo-root-relative paths, verify with `git status`, don't stage unrelated changes.

---

### Task 1: `useBrowserSession` — `addManualPage` + `updatePage`

**Files:**
- Modify: `front/src/modules/workspace/hooks/useBrowserSession.ts`
- Test: `front/src/modules/workspace/hooks/useBrowserSession.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `CollectedPage` gains `manual?: boolean`.
  - `addManualPage(url: string, name?: string): boolean` — validates http(s) + dedups; adds `{ url, title:'', linkText:name?, manual:true }`.
  - `updatePage(oldUrl: string, patch: { url?: string; name?: string }): boolean` — edits an existing page's url/name; rejects invalid or colliding url.

- [ ] **Step 1: Write the failing tests**

In `front/src/modules/workspace/hooks/useBrowserSession.test.ts`, add inside `describe('useBrowserSession', ...)`:

```ts
  it('addManualPage adds a manual page and rejects invalid/duplicate urls', () => {
    const { result } = renderHook(() => useBrowserSession());
    let ok!: boolean;
    act(() => { ok = result.current.addManualPage('https://other.org/docs', '  My  Docs '); });
    expect(ok).toBe(true);
    expect(result.current.pages.at(-1)).toMatchObject({ url: 'https://other.org/docs', linkText: 'My Docs', manual: true });
    act(() => { ok = result.current.addManualPage('https://other.org/docs'); }); // duplicate
    expect(ok).toBe(false);
    act(() => { ok = result.current.addManualPage('not a url'); }); // invalid
    expect(ok).toBe(false);
    expect(result.current.pages).toHaveLength(1);
  });

  it('updatePage edits name and url and rejects collisions', () => {
    const { result } = renderHook(() => useBrowserSession());
    act(() => { result.current.addManualPage('https://a.com/x', 'X'); });
    act(() => { result.current.addManualPage('https://b.com/y', 'Y'); });
    let ok!: boolean;
    act(() => { ok = result.current.updatePage('https://a.com/x', { name: 'New Name', url: 'https://a.com/z' }); });
    expect(ok).toBe(true);
    expect(result.current.pages.find((p) => p.url === 'https://a.com/z')).toMatchObject({ linkText: 'New Name', url: 'https://a.com/z' });
    act(() => { ok = result.current.updatePage('https://a.com/z', { url: 'https://b.com/y' }); }); // collides with Y
    expect(ok).toBe(false);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd front && npx vitest run src/modules/workspace/hooks/useBrowserSession.test.ts -t "addManualPage|updatePage"`
Expected: FAIL — `addManualPage`/`updatePage` are not functions.

- [ ] **Step 3: Add the `manual` field, a URL validator, and the two mutators**

In `front/src/modules/workspace/hooks/useBrowserSession.ts`:

Change the interface:

```ts
export interface CollectedPage { url: string; title: string; linkText?: string; manual?: boolean; }
```

Add a module-level validator after `normalizeUrl`:

```ts
function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
```

Inside `useBrowserSession`, after the `stop` callback, add:

```ts
  const addManualPage = useCallback((url: string, name?: string): boolean => {
    if (!isHttpUrl(url)) return false;
    const key = normalizeUrl(url);
    if (seenRef.current.has(key)) return false;
    seenRef.current.add(key);
    const linkText = name?.replace(/\s+/g, ' ').trim() || undefined;
    setPages((prev) => [...prev, { url: url.trim(), title: '', linkText, manual: true }]);
    return true;
  }, []);

  const updatePage = useCallback((oldUrl: string, patch: { url?: string; name?: string }): boolean => {
    const oldKey = normalizeUrl(oldUrl);
    if (!seenRef.current.has(oldKey)) return false; // no such page
    let newUrl: string | undefined;
    if (patch.url !== undefined && patch.url !== oldUrl) {
      if (!isHttpUrl(patch.url)) return false;
      const newKey = normalizeUrl(patch.url);
      if (newKey !== oldKey && seenRef.current.has(newKey)) return false; // collides with another page
      newUrl = patch.url.trim();
      seenRef.current.delete(oldKey);
      seenRef.current.add(newKey);
    }
    setPages((prev) =>
      prev.map((p) =>
        p.url === oldUrl
          ? {
              ...p,
              ...(newUrl !== undefined ? { url: newUrl } : {}),
              ...(patch.name !== undefined ? { linkText: patch.name.replace(/\s+/g, ' ').trim() || undefined } : {}),
            }
          : p,
      ),
    );
    return true;
  }, []);
```

Add both to the returned object:

```ts
  return { status, frame, currentUrl, rootUrl, pages, blockedNotice, start, sendInput, navigate, stop, addManualPage, updatePage };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd front && npx vitest run src/modules/workspace/hooks/useBrowserSession.test.ts`
Expected: PASS (new tests plus existing ones — additive).

- [ ] **Step 5: Commit**

```bash
git add YellowStorm/front/src/modules/workspace/hooks/useBrowserSession.ts YellowStorm/front/src/modules/workspace/hooks/useBrowserSession.test.ts
git commit -m "feat(workspace): add manual add/edit of pages to useBrowserSession"
```

---

### Task 2: Backend — per-link source-root override (`roots`)

**Files:**
- Modify: `back/src/modules/workspace/dto/add-links.dto.ts`
- Test: `back/src/modules/workspace/dto/add-links.dto.spec.ts`
- Modify: `back/src/modules/workspace/workspace-document.controller.ts`
- Modify: `back/src/modules/workspace/workspace-document.service.ts`
- Test: `back/src/modules/workspace/workspace-document.service.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `AddLinksDto.roots?: Record<string,string>`; `addLinks` options gain `roots?`; each doc's source root is `roots[url] ?? sourceRootUrl`.

- [ ] **Step 1: Write the failing DTO test**

In `back/src/modules/workspace/dto/add-links.dto.spec.ts`, add:

```ts
describe('AddLinksDto roots', () => {
  it('accepts a roots map', async () => {
    const errors = await errorsFor({ urls: ['https://a.com/x'], roots: { 'https://a.com/x': 'https://a.com/x' } });
    expect(errors).toHaveLength(0);
  });

  it('allows roots to be omitted', async () => {
    const errors = await errorsFor({ urls: ['https://a.com/x'] });
    expect(errors).toHaveLength(0);
  });

  it('rejects a non-object roots value', async () => {
    const errors = await errorsFor({ urls: ['https://a.com/x'], roots: 'nope' });
    expect(errors.some((e) => e.property === 'roots')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd back && npx jest src/modules/workspace/dto/add-links.dto.spec.ts -t "roots"`
Expected: FAIL — the reject-non-object test fails (no validation on an unknown property).

- [ ] **Step 3: Add `roots` to the DTO**

In `back/src/modules/workspace/dto/add-links.dto.ts`, add after the `names` field:

```ts
  /** Optional per-URL source-root override (manual links root themselves), keyed by url. */
  @IsOptional()
  @IsObject()
  roots?: Record<string, string>;
```

(`IsOptional`, `IsObject` are already imported.)

- [ ] **Step 4: Run the DTO test to verify it passes**

Run: `cd back && npx jest src/modules/workspace/dto/add-links.dto.spec.ts -t "roots"`
Expected: PASS.

- [ ] **Step 5: Write the failing service test**

In `back/src/modules/workspace/workspace-document.service.spec.ts`, add inside the same `describe` block that contains the `addLinks persists sourceRootUrl...` test (the one with `documentModel`/`WS_ID`/`USER_ID`/`service` in scope):

```ts
  it('addLinks roots a manual link to its own url via the roots override', async () => {
    (service as any).convertAndStore = jest.fn().mockResolvedValue(undefined);
    await service.addLinks(WS_ID, USER_ID, ['https://a.com/x', 'https://manual.org/p'], {
      sourceRootUrl: 'https://a.com/services',
      roots: { 'https://manual.org/p': 'https://manual.org/p' },
    });
    const first = documentModel.create.mock.calls[0][0];
    const second = documentModel.create.mock.calls[1][0];
    expect(first.metadata.sourceRootUrl).toBe('https://a.com/services'); // session root
    expect(second.metadata.sourceRootUrl).toBe('https://manual.org/p'); // self-rooted
  });
```

- [ ] **Step 6: Run the service test to verify it fails**

Run: `cd back && npx jest src/modules/workspace/workspace-document.service.spec.ts -t "roots a manual link"`
Expected: FAIL — the second doc's `sourceRootUrl` is `https://a.com/services` (roots override not applied).

- [ ] **Step 7: Thread `roots` through the controller and service**

In `back/src/modules/workspace/workspace-document.controller.ts`, change the `addLinks` service-call options:

```ts
      { deepSearch: body.deepSearch, autoIndex: body.autoIndex, sourceRootUrl: body.sourceRootUrl, names: body.names, roots: body.roots },
```

In `back/src/modules/workspace/workspace-document.service.ts`, change the `addLinks` options type:

```ts
    options?: { deepSearch?: boolean; autoIndex?: boolean; sourceRootUrl?: string; names?: Record<string, string>; roots?: Record<string, string> },
```

Inside the per-URL loop, compute the per-link root just after the `filename` line:

```ts
      const providedName = options?.names?.[url]?.replace(/\s+/g, ' ').trim();
      const filename = providedName ? providedName.slice(0, 200) : this.deriveFilenameFromUrl(url);
      const root = options?.roots?.[url] ?? options?.sourceRootUrl;
```

And change the `metadata` source-root block to use `root`:

```ts
          ...(root
            ? {
                sourceRootUrl: root,
                normalizedSourceRootUrl: normalizeWorkspaceUrl(root),
              }
            : {}),
```

- [ ] **Step 8: Run the backend tests + tsc**

Run: `cd back && npx jest src/modules/workspace/dto/add-links.dto.spec.ts && npx jest src/modules/workspace/workspace-document.service.spec.ts -t "roots a manual link|sourceRootUrl"`
Expected: PASS (roots tests + existing sourceRootUrl tests — `roots` falls back to `sourceRootUrl` so existing behavior is unchanged).

Run: `cd back && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 9: Commit**

```bash
git add YellowStorm/back/src/modules/workspace/dto/add-links.dto.ts YellowStorm/back/src/modules/workspace/dto/add-links.dto.spec.ts YellowStorm/back/src/modules/workspace/workspace-document.controller.ts YellowStorm/back/src/modules/workspace/workspace-document.service.ts YellowStorm/back/src/modules/workspace/workspace-document.service.spec.ts
git commit -m "feat(workspace): support per-link source-root override in addLinks"
```

---

### Task 3: `CollectionSidebar` — inline add row + per-leaf edit popover

**Files:**
- Modify: `front/src/modules/workspace/components/CollectionSidebar.tsx`
- Test: `front/src/modules/workspace/components/CollectionSidebar.test.tsx`

**Interfaces:**
- Consumes: nothing (callbacks are injected).
- Produces: `CollectionSidebar` accepts optional `onAdd(url, name?) => boolean` and `onEdit(oldUrl, { url?, name? }) => boolean`; renders an add row (when `onAdd` given) and a pencil→popover editor on each leaf (when `onEdit` given).

- [ ] **Step 1: Write the failing tests**

In `front/src/modules/workspace/components/CollectionSidebar.test.tsx`, add inside `describe('CollectionSidebar', ...)` (the render-tests block):

```ts
  const baseProps = {
    selected: new Set<string>(), indexedUrls: new Set<string>(),
    onToggle: vi.fn(), onDelete: vi.fn(), onSelectAll: vi.fn(), onSelectNone: vi.fn(),
  };

  it('add row calls onAdd with the url and name', () => {
    const onAdd = vi.fn().mockReturnValue(true);
    render(<CollectionSidebar pages={[]} {...baseProps} onAdd={onAdd} onEdit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('URL du lien'), { target: { value: 'https://x.com/p' } });
    fireEvent.change(screen.getByLabelText('Nom du lien'), { target: { value: 'My Page' } });
    fireEvent.click(screen.getByLabelText('Ajouter le lien'));
    expect(onAdd).toHaveBeenCalledWith('https://x.com/p', 'My Page');
  });

  it('shows feedback when onAdd rejects', () => {
    const onAdd = vi.fn().mockReturnValue(false);
    render(<CollectionSidebar pages={[]} {...baseProps} onAdd={onAdd} onEdit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('URL du lien'), { target: { value: 'https://x.com/p' } });
    fireEvent.click(screen.getByLabelText('Ajouter le lien'));
    expect(screen.getByText(/invalide ou déjà/i)).toBeInTheDocument();
  });

  it('editing a leaf via the pencil popover calls onEdit', () => {
    const onEdit = vi.fn().mockReturnValue(true);
    render(<CollectionSidebar pages={[{ url: 'https://ex.com/a', title: '', linkText: 'A' }]} {...baseProps} onAdd={vi.fn()} onEdit={onEdit} />);
    fireEvent.click(screen.getByLabelText('edit https://ex.com/a'));
    fireEvent.change(screen.getByLabelText('Nom du lien à éditer'), { target: { value: 'B' } });
    fireEvent.change(screen.getByLabelText('URL du lien à éditer'), { target: { value: 'https://ex.com/b' } });
    fireEvent.click(screen.getByText('Enregistrer'));
    expect(onEdit).toHaveBeenCalledWith('https://ex.com/a', { url: 'https://ex.com/b', name: 'B' });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd front && npx vitest run src/modules/workspace/components/CollectionSidebar.test.tsx -t "add row|onAdd rejects|pencil popover"`
Expected: FAIL — no add row / pencil exists yet.

- [ ] **Step 3: Add imports and the `AddLinkRow` + `EditLeafPopover` components**

In `front/src/modules/workspace/components/CollectionSidebar.tsx`, change the imports at the top:

```ts
import { useCallback, useState } from 'react';
import { ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { normalizeUrl, type CollectedPage } from '../hooks/useBrowserSession';
```

Add these two components just above `function TrieRows(...)`:

```tsx
function AddLinkRow({ onAdd }: { onAdd: (url: string, name?: string) => boolean }) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    if (!url.trim()) return;
    const ok = onAdd(url.trim(), name.trim() || undefined);
    if (ok) { setUrl(''); setName(''); setError(null); }
    else setError('URL invalide ou déjà dans la liste.');
  };
  return (
    <div className='flex flex-col gap-1 border-b p-1.5'>
      <div className='flex items-center gap-1'>
        <Input aria-label='URL du lien' value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} placeholder='https://…' className='h-7 flex-1 text-xs' />
        <Input aria-label='Nom du lien' value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} placeholder='Nom (optionnel)' className='h-7 w-24 text-xs' />
        <button type='button' aria-label='Ajouter le lien' onClick={submit} className='flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground'>
          <Plus className='h-4 w-4' />
        </button>
      </div>
      {error && <p className='text-[11px] text-destructive'>{error}</p>}
    </div>
  );
}

function EditLeafPopover({ node, onEdit }: { node: TrieNode; onEdit: (oldUrl: string, patch: { url?: string; name?: string }) => boolean }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const onOpenChange = (o: boolean) => {
    if (o) { setName(node.label ?? ''); setUrl(node.url ?? ''); setError(null); }
    setOpen(o);
  };
  const save = () => {
    const ok = onEdit(node.url as string, { url: url.trim(), name });
    if (ok) setOpen(false);
    else setError('URL invalide ou déjà dans la liste.');
  };
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button type='button' aria-label={`edit ${node.url}`} className='shrink-0 text-muted-foreground hover:text-foreground'>
          <Pencil className='h-4 w-4' />
        </button>
      </PopoverTrigger>
      <PopoverContent align='end' className='w-64 space-y-2'>
        <div className='space-y-1'>
          <label className='text-xs font-medium'>Nom</label>
          <Input aria-label='Nom du lien à éditer' value={name} onChange={(e) => setName(e.target.value)} className='h-7 text-xs' />
        </div>
        <div className='space-y-1'>
          <label className='text-xs font-medium'>URL</label>
          <Input aria-label='URL du lien à éditer' value={url} onChange={(e) => setUrl(e.target.value)} className='h-7 text-xs' />
        </div>
        {error && <p className='text-[11px] text-destructive'>{error}</p>}
        <div className='flex justify-end gap-2'>
          <button type='button' className='text-xs underline' onClick={() => setOpen(false)}>Annuler</button>
          <button type='button' className='text-xs font-medium text-primary' onClick={save}>Enregistrer</button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 4: Thread `onEdit` through `TrieRows` and render the pencil; render the add row in `CollectionSidebar`**

In `TrieRows`, add `onEdit` to its props type and destructuring:

```tsx
function TrieRows({
  nodes, parentKey, selected, indexedUrls, collapsed, onToggleCollapse, onToggle, onDelete, onEdit,
}: {
  nodes: TrieNode[];
  parentKey: string;
  selected: Set<string>;
  indexedUrls: Set<string>;
  collapsed: Set<string>;
  onToggleCollapse: (key: string) => void;
  onToggle: (url: string) => void;
  onDelete: (url: string) => void;
  onEdit?: (oldUrl: string, patch: { url?: string; name?: string }) => boolean;
}) {
```

In the `node.url ?` leaf branch, add the pencil just before the existing delete `<button>`:

```tsx
                  {onEdit && <EditLeafPopover node={node} onEdit={onEdit} />}
                  <button
                    type='button'
                    aria-label={`delete ${node.url}`}
                    className='shrink-0 text-muted-foreground hover:text-destructive'
                    onClick={() => onDelete(node.url as string)}
                  >
                    <Trash2 className='h-4 w-4' />
                  </button>
```

In the recursive `<TrieRows ... />` call, forward `onEdit={onEdit}`.

In `CollectionSidebar`, add the props and render:

```tsx
export function CollectionSidebar({
  pages, selected, indexedUrls, onToggle, onDelete, onSelectAll, onSelectNone, onAdd, onEdit,
}: {
  pages: CollectedPage[];
  selected: Set<string>;
  indexedUrls: Set<string>;
  onToggle: (url: string) => void;
  onDelete: (url: string) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  onAdd?: (url: string, name?: string) => boolean;
  onEdit?: (oldUrl: string, patch: { url?: string; name?: string }) => boolean;
}) {
```

Render the add row right after the header `<div>` (before the scrollable list `<div className='min-h-0 flex-1 overflow-y-auto p-1'>`):

```tsx
      {onAdd && <AddLinkRow onAdd={onAdd} />}
```

And pass `onEdit` into the `<TrieRows ... />` render:

```tsx
          <TrieRows
            nodes={roots}
            parentKey=''
            selected={selected}
            indexedUrls={indexedUrls}
            collapsed={collapsed}
            onToggleCollapse={onToggleCollapse}
            onToggle={onToggle}
            onDelete={onDelete}
            onEdit={onEdit}
          />
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd front && npx vitest run src/modules/workspace/components/CollectionSidebar.test.tsx`
Expected: PASS (new tests plus all existing CollectionSidebar/buildTrie tests — `onAdd`/`onEdit` are optional, so existing render calls that omit them render no add row and no pencil, unchanged).

Run: `cd front && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add YellowStorm/front/src/modules/workspace/components/CollectionSidebar.tsx YellowStorm/front/src/modules/workspace/components/CollectionSidebar.test.tsx
git commit -m "feat(workspace): add inline add row and edit popover to CollectionSidebar"
```

---

### Task 4: `AddLinkDialog` — wire add/edit, migrate selection, send `roots`

**Files:**
- Modify: `front/src/modules/workspace/api.ts`
- Modify: `front/src/modules/workspace/store.ts`
- Modify: `front/src/modules/workspace/components/AddLinkDialog.tsx`
- Test: `front/src/modules/workspace/components/AddLinkDialog.test.tsx`

**Interfaces:**
- Consumes: `session.addManualPage`/`updatePage` (Task 1); `CollectionSidebar.onAdd`/`onEdit` (Task 3); backend `roots` (Task 2).
- Produces: manual add/edit wired into the dialog; selection migrates on URL edit; `handleIndex` sends a `roots` map (manual pages self-rooted).

- [ ] **Step 1: Write the failing test**

In `front/src/modules/workspace/components/AddLinkDialog.test.tsx`:

Widen the mock `session` `pages` type and add the two new session methods (in the `const session = { ... }` literal):

```ts
  pages: [] as Array<{ url: string; title: string; linkText?: string; manual?: boolean }>, blockedNotice: null as string | null,
```

and add to the same object literal (alongside `start`, `stop`, etc.):

```ts
  addManualPage: vi.fn().mockReturnValue(true), updatePage: vi.fn().mockReturnValue(true),
```

Then add this test:

```ts
it('sends a roots map with manual links self-rooted', async () => {
  session.status = 'live';
  session.rootUrl = 'https://ok.example/start';
  session.pages = [
    { url: 'https://ok.example/a', title: 'A' },
    { url: 'https://manual.org/p', title: '', linkText: 'Manual', manual: true },
  ];
  render(<AddLinkDialog open onOpenChange={vi.fn()} workspaceId='w1' />);
  fireEvent.click(screen.getByRole('button', { name: /Indexer/ }));
  await waitFor(() =>
    expect(addPageLinks).toHaveBeenCalledWith(
      'w1',
      ['https://ok.example/a', 'https://manual.org/p'],
      expect.objectContaining({ roots: { 'https://manual.org/p': 'https://manual.org/p' } }),
    ),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd front && npx vitest run src/modules/workspace/components/AddLinkDialog.test.tsx -t "roots map"`
Expected: FAIL — `addPageLinks` is called without a `roots` option.

- [ ] **Step 3: Add `roots` to the api and store option types**

In `front/src/modules/workspace/api.ts`, widen the `addLinks` options:

```ts
export async function addLinks(workspaceId: string, urls: string[], options?: { deepSearch?: boolean; autoIndex?: boolean; sourceRootUrl?: string; names?: Record<string, string>; roots?: Record<string, string> }): Promise<WorkspaceDocument[]> {
```

In `front/src/modules/workspace/store.ts`, widen the `addPageLinks` type declaration:

```ts
  addPageLinks: (workspaceId: string, urls: string[], options?: { deepSearch?: boolean; autoIndex?: boolean; sourceRootUrl?: string; names?: Record<string, string>; roots?: Record<string, string> }) => Promise<void>;
```

(Both bodies already spread/forward `options`, so no body change.)

- [ ] **Step 4: Wire the sidebar callbacks and build the `roots` map**

In `front/src/modules/workspace/components/AddLinkDialog.tsx`, in `handleIndex`, build the `roots` map alongside the existing `names` map (just after the `names` loop, before the `await addPageLinks(...)` call):

```ts
      const roots: Record<string, string> = {};
      for (const page of session.pages) {
        if (!chosen.includes(page.url)) continue;
        if (page.manual) roots[page.url] = page.url;
      }
```

and add `roots` to the `addPageLinks` options object:

```ts
      await addPageLinks(workspaceId, chosen, {
        deepSearch: readDeepSearchIndexationValue(),
        autoIndex: readAutoIndexationValue(),
        sourceRootUrl: session.rootUrl ?? undefined,
        names,
        roots,
      });
```

Add `onAdd` and `onEdit` props to the `<CollectionSidebar ... />` element:

```tsx
            <CollectionSidebar
              pages={session.pages}
              selected={selected}
              indexedUrls={indexedUrls}
              onToggle={toggle}
              onDelete={remove}
              onSelectAll={selectAll}
              onSelectNone={selectNone}
              onAdd={(url, name) => session.addManualPage(url, name)}
              onEdit={(oldUrl, patch) => {
                const ok = session.updatePage(oldUrl, patch);
                if (ok && patch.url && patch.url !== oldUrl) {
                  setSelected((prev) => {
                    if (!prev.has(oldUrl)) return prev;
                    const next = new Set(prev);
                    next.delete(oldUrl);
                    next.add(patch.url as string);
                    return next;
                  });
                }
                return ok;
              }}
            />
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd front && npx vitest run src/modules/workspace/components/AddLinkDialog.test.tsx`
Expected: PASS (new roots test plus existing dialog tests — `roots` defaults to an empty object when no manual pages are chosen, unaffecting existing assertions that use `objectContaining`).

Run: `cd front && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add YellowStorm/front/src/modules/workspace/api.ts YellowStorm/front/src/modules/workspace/store.ts YellowStorm/front/src/modules/workspace/components/AddLinkDialog.tsx YellowStorm/front/src/modules/workspace/components/AddLinkDialog.test.tsx
git commit -m "feat(workspace): wire manual add/edit and self-root manual links on index"
```

---

## Final verification

- [ ] Frontend: `cd front && npx vitest run src/modules/workspace/hooks/useBrowserSession.test.ts src/modules/workspace/components/CollectionSidebar.test.tsx src/modules/workspace/components/AddLinkDialog.test.tsx` — feature tests green.
- [ ] Frontend: `cd front && npx tsc --noEmit` — no new errors.
- [ ] Backend: `cd back && npx jest src/modules/workspace/dto/add-links.dto.spec.ts` — green; `cd back && npx jest src/modules/workspace/workspace-document.service.spec.ts -t "roots a manual link|sourceRootUrl"` — green.
- [ ] Backend: `cd back && npx tsc --noEmit` — no new errors.
- [ ] Live smoke (covers the wiring across hook → sidebar → dialog → index that unit tests only partly reach):
  1. Start a browse session; use the sidebar's add row to add a link on a **different domain** → it appears in the hierarchy, auto-selected.
  2. Click a leaf's pencil → change its name and URL → Save → the row updates and moves in the hierarchy; if it was selected it stays selected.
  3. Try adding a duplicate URL or an invalid URL → inline rejection, collection unchanged.
  4. Index → the manually-added different-domain link appears in the workspace **standing on its own** (not nested under the session's site), named after the name you gave it; browsed pages still group under the session root.

## Self-review notes

- **Spec coverage:** manual add → Task 1 (`addManualPage`) + Task 3 (add row) + Task 4 (wire). Edit name/URL → Task 1 (`updatePage`) + Task 3 (pencil popover) + Task 4 (wire + selection migration). Manual links self-rooted → Task 1 (`manual` flag) + Task 4 (`roots` map) + Task 2 (backend per-link root). Duplicate/invalid rejection → Task 1 (mutators return false) + Task 3 (inline feedback). Testing → each task's tests + Final Verification smoke. All covered.
- **Backward compatibility:** `onAdd`/`onEdit` are optional on `CollectionSidebar`, so existing callers/tests are unaffected; `roots` falls back to `sourceRootUrl` in the backend, so non-manual indexing is unchanged; `manual` is an optional additive field.
- **Type consistency:** `addManualPage(url, name?)`, `updatePage(oldUrl, {url?, name?})`, `CollectionSidebar.onAdd`/`onEdit`, and the `roots: Record<string,string>` option are used identically across producing (Task 1/2/3) and consuming (Task 4) tasks. `roots[url] ?? sourceRootUrl` in the service matches the frontend building `roots[url] = url` only for `manual` pages.
- **URL-keyed identity preserved:** selection migration in Task 4 keeps the `selected` set consistent when a URL changes; `seenRef` is migrated in `updatePage` (Task 1).
