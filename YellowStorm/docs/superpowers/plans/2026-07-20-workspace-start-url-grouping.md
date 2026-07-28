# Workspace start-URL grouping for indexed sources — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Indexed web pages from the same browse session appear together under one collapsible group headed by the session's start URL, instead of as flat top-level rows, keeping the workspace tidy.

**Architecture:** The browse session's start URL is captured client-side (`useBrowserSession.rootUrl`), sent with the multi-link index request, and persisted per document in `metadata.sourceRootUrl` (+ normalized). The classifier file-list response surfaces those fields onto `WorkspaceFile`. The workspace file list derives inline collapsible groups at render time from the persisted key — a group appears only when 2+ root-level url-docs share the same normalized start URL. Manual "classifier" folders are untouched.

**Tech Stack:** NestJS + Mongoose + Jest (backend); React + Zustand + Vitest + Testing Library (frontend).

## Global Constraints

- TDD: write the failing test first, watch it fail, implement minimally, watch it pass, commit.
- Conventional commits: `<type>(<scope>): <subject>`. **No `Co-Authored-By` trailer** (or any attribution trailer).
- Colocated tests (`X.spec.ts` backend, `X.test.ts(x)` frontend).
- Grouping is **derived at render time** from persisted per-document data; **first-seen order preserved** (a group appears only when 2+ root-level url-docs share the same `normalizedSourceRootUrl`; everything else renders flat).
- Grouping applies only at the **workspace root** (`currentFolderId === null`); inside a manual folder, files render flat as today.
- Manual-folder behavior and the client/backend viewport coordinate contract are **untouched**.
- Backend `metadata` is a free-form `Record<string, string>` (`workspace-document.schema.ts`) — adding keys needs **no schema migration**.
- Backend commands run from `YellowStorm/back`; frontend from `YellowStorm/front`. Git repo root is the parent `YellowStorm-poc` — stage repo-root-relative paths and verify with `git status` before committing. Do not stage unrelated working-tree changes.

---

### Task 1: Frontend — `useBrowserSession` retains `rootUrl`

**Files:**
- Modify: `front/src/modules/workspace/hooks/useBrowserSession.ts`
- Test: `front/src/modules/workspace/hooks/useBrowserSession.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `useBrowserSession().rootUrl: string | null` — the session's start URL, set once in `start(url)`, never overwritten by `navigated` events.

- [ ] **Step 1: Write the failing test**

In `front/src/modules/workspace/hooks/useBrowserSession.test.ts`, add inside `describe('useBrowserSession', ...)`:

```ts
  it('retains the session root url across navigations', async () => {
    const { result } = renderHook(() => useBrowserSession());
    act(() => { result.current.start('https://root.example/start'); });
    await waitFor(() => expect(result.current.status).toBe('live'));
    expect(result.current.rootUrl).toBe('https://root.example/start');
    act(() => { handlers['navigated']({ url: 'https://root.example/other', title: 'Other' }); });
    expect(result.current.currentUrl).toBe('https://root.example/other');
    expect(result.current.rootUrl).toBe('https://root.example/start');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd front && npx vitest run src/modules/workspace/hooks/useBrowserSession.test.ts`
Expected: FAIL — `result.current.rootUrl` is `undefined`.

- [ ] **Step 3: Add `rootUrl` state and set it in `start`**

In `front/src/modules/workspace/hooks/useBrowserSession.ts`:

Add the state near the other `useState` declarations (after the `currentUrl` line):

```ts
  const [rootUrl, setRootUrl] = useState<string | null>(null);
```

Inside `start`, set it in the reset block. Change:

```ts
    setPages([]); setFrame(null); setBlockedNotice(null); setCurrentUrl(url);
```

to:

```ts
    setPages([]); setFrame(null); setBlockedNotice(null); setCurrentUrl(url); setRootUrl(url);
```

Add `rootUrl` to the returned object. Change:

```ts
  return { status, frame, currentUrl, pages, blockedNotice, start, sendInput, navigate, stop };
```

to:

```ts
  return { status, frame, currentUrl, rootUrl, pages, blockedNotice, start, sendInput, navigate, stop };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd front && npx vitest run src/modules/workspace/hooks/useBrowserSession.test.ts`
Expected: PASS (new test plus existing ones — `rootUrl` is additive).

- [ ] **Step 5: Commit**

```bash
git add YellowStorm/front/src/modules/workspace/hooks/useBrowserSession.ts YellowStorm/front/src/modules/workspace/hooks/useBrowserSession.test.ts
git commit -m "feat(workspace): retain browse-session root url in useBrowserSession"
```

---

### Task 2: Backend — persist `sourceRootUrl` through the add-links write path

**Files:**
- Modify: `back/src/modules/workspace/dto/add-links.dto.ts`
- Test (create): `back/src/modules/workspace/dto/add-links.dto.spec.ts`
- Modify: `back/src/modules/workspace/workspace-document.controller.ts`
- Modify: `back/src/modules/workspace/workspace-document.service.ts`
- Test: `back/src/modules/workspace/workspace-document.service.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `AddLinksDto.sourceRootUrl?: string` (optional, validated http(s) URL).
  - `WorkspaceDocumentService.addLinks(workspaceId, userId, urls, options?)` where `options` gains `sourceRootUrl?: string`; when present, each created document's `metadata` gains `sourceRootUrl` (raw) and `normalizedSourceRootUrl` (via `normalizeWorkspaceUrl`).

- [ ] **Step 1: Write the failing DTO test**

Create `back/src/modules/workspace/dto/add-links.dto.spec.ts`:

```ts
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AddLinksDto } from './add-links.dto';

async function errorsFor(obj: Record<string, unknown>) {
  return validate(plainToInstance(AddLinksDto, obj));
}

describe('AddLinksDto sourceRootUrl', () => {
  it('accepts a valid sourceRootUrl', async () => {
    const errors = await errorsFor({ urls: ['https://a.com/x'], sourceRootUrl: 'https://a.com' });
    expect(errors).toHaveLength(0);
  });

  it('allows sourceRootUrl to be omitted', async () => {
    const errors = await errorsFor({ urls: ['https://a.com/x'] });
    expect(errors).toHaveLength(0);
  });

  it('rejects a non-url sourceRootUrl', async () => {
    const errors = await errorsFor({ urls: ['https://a.com/x'], sourceRootUrl: 'not a url' });
    expect(errors.some((e) => e.property === 'sourceRootUrl')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd back && npx jest src/modules/workspace/dto/add-links.dto.spec.ts`
Expected: FAIL — `sourceRootUrl` is not a known property / no validation error is produced for the bad value.

- [ ] **Step 3: Add `sourceRootUrl` to the DTO**

In `back/src/modules/workspace/dto/add-links.dto.ts`, add after the `autoIndex` field (inside the class):

```ts
  @IsOptional()
  @IsUrl({ require_protocol: true })
  sourceRootUrl?: string;
```

(`IsOptional`, `IsUrl` are already imported in this file.)

- [ ] **Step 4: Run the DTO test to verify it passes**

Run: `cd back && npx jest src/modules/workspace/dto/add-links.dto.spec.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing service test**

In `back/src/modules/workspace/workspace-document.service.spec.ts`, locate the `describe` block that has `documentModel` (with `create`/`findByIdAndUpdate` mocks), `service`, `WS_ID`, and `USER_ID` in scope and already contains an `addLinks creates one processing url doc per URL...` test (around line 441). Add these two tests inside that same block:

```ts
  it('addLinks persists sourceRootUrl and its normalized form in metadata', async () => {
    (service as any).convertAndStore = jest.fn().mockResolvedValue(undefined);
    await service.addLinks(WS_ID, USER_ID, ['https://a.com/x'], { sourceRootUrl: 'https://a.com/services' });
    const createArg = documentModel.create.mock.calls[0][0];
    expect(createArg.metadata.sourceRootUrl).toBe('https://a.com/services');
    expect(createArg.metadata.normalizedSourceRootUrl).toBe('https://a.com/services');
  });

  it('addLinks omits sourceRootUrl metadata when none is provided', async () => {
    (service as any).convertAndStore = jest.fn().mockResolvedValue(undefined);
    await service.addLinks(WS_ID, USER_ID, ['https://a.com/x']);
    const createArg = documentModel.create.mock.calls[0][0];
    expect(createArg.metadata.sourceRootUrl).toBeUndefined();
  });
```

- [ ] **Step 6: Run the service test to verify it fails**

Run: `cd back && npx jest src/modules/workspace/workspace-document.service.spec.ts -t "sourceRootUrl"`
Expected: FAIL — `createArg.metadata.sourceRootUrl` is `undefined` in the first test.

- [ ] **Step 7: Thread `sourceRootUrl` through the controller and service**

In `back/src/modules/workspace/workspace-document.controller.ts`, change the `addLinks` service call:

```ts
    return this.workspaceDocumentService.addLinks(
      workspaceId,
      user._id.toString(),
      body.urls,
      { deepSearch: body.deepSearch, autoIndex: body.autoIndex, sourceRootUrl: body.sourceRootUrl },
    );
```

In `back/src/modules/workspace/workspace-document.service.ts`, change the `addLinks` options param type:

```ts
    options?: { deepSearch?: boolean; autoIndex?: boolean; sourceRootUrl?: string },
```

and change the `metadata` object inside the per-URL `this.documentModel.create({ ... })` call:

```ts
        metadata: {
          deepSearchRequested: String(Boolean(options?.deepSearch)),
          autoIndexRequested: String(options?.autoIndex !== false),
          normalizedSourceUrl: normalizeWorkspaceUrl(url),
          ...(options?.sourceRootUrl
            ? {
                sourceRootUrl: options.sourceRootUrl,
                normalizedSourceRootUrl: normalizeWorkspaceUrl(options.sourceRootUrl),
              }
            : {}),
        },
```

(`normalizeWorkspaceUrl` is already imported. `convertAndStore`'s later `$set` only updates `filename/path/url/contentHash/size/status/uploadedAt`, so it never overwrites `metadata` — the new keys survive conversion.)

- [ ] **Step 8: Run the backend tests to verify they pass**

Run: `cd back && npx jest src/modules/workspace/dto/add-links.dto.spec.ts src/modules/workspace/workspace-document.service.spec.ts`
Expected: PASS (new tests plus existing `addLinks` tests — `sourceRootUrl` is optional and additive).

Run: `cd back && npx tsc --noEmit`
Expected: no new errors in the changed files.

- [ ] **Step 9: Commit**

```bash
git add YellowStorm/back/src/modules/workspace/dto/add-links.dto.ts YellowStorm/back/src/modules/workspace/dto/add-links.dto.spec.ts YellowStorm/back/src/modules/workspace/workspace-document.controller.ts YellowStorm/back/src/modules/workspace/workspace-document.service.ts YellowStorm/back/src/modules/workspace/workspace-document.service.spec.ts
git commit -m "feat(workspace): persist sourceRootUrl on indexed link documents"
```

---

### Task 3: Backend — surface `sourceRootUrl` in the classifier file-list response

**Files:**
- Modify: `back/src/modules/classifier/interfaces/classifier.interface.ts`
- Modify: `back/src/modules/classifier/services/classifier-file.service.ts`
- Test (create): `back/src/modules/classifier/services/classifier-file.service.spec.ts`

**Interfaces:**
- Consumes: documents whose `metadata` may carry `sourceRootUrl`/`normalizedSourceRootUrl` (Task 2).
- Produces: `IClassifierFileResponse.sourceRootUrl?: string` and `IClassifierFileResponse.normalizedSourceRootUrl?: string`, populated by `ClassifierFileService.listFiles` from `doc.metadata`.

- [ ] **Step 1: Write the failing test**

Create `back/src/modules/classifier/services/classifier-file.service.spec.ts`:

```ts
import { ClassifierFileService } from './classifier-file.service';

function makeDoc() {
  return {
    _id: { toString: () => 'd1' },
    workspaceId: { toString: () => 'w1' },
    originalName: 'a',
    mimeType: 'application/pdf',
    size: 0,
    type: 'url',
    sourceUrl: 'https://a.com/x',
    indexingStatus: 'none',
    status: 'processing',
    metadata: { sourceRootUrl: 'https://a.com/services', normalizedSourceRootUrl: 'https://a.com/services' },
  };
}

function makeService(doc: unknown) {
  const documentModel = {
    find: jest.fn(() => ({ sort: () => ({ lean: () => ({ exec: async () => [doc] }) }) })),
    db: { name: 'test', host: 'test' },
  } as any;
  const folderModel = {} as any;
  const assignmentModel = {
    find: jest.fn(() => ({ lean: () => ({ exec: async () => [] }) })),
  } as any;
  const access = { assertWorkspaceAccess: jest.fn().mockResolvedValue(undefined) } as any;
  const logger = { setContext: jest.fn(), log: jest.fn(), debug: jest.fn(), error: jest.fn(), warn: jest.fn() } as any;
  return new ClassifierFileService(documentModel, folderModel, assignmentModel, access, logger);
}

describe('ClassifierFileService.listFiles sourceRootUrl', () => {
  it('surfaces sourceRootUrl and normalizedSourceRootUrl from metadata', async () => {
    const service = makeService(makeDoc());
    const res = await service.listFiles('u1', 'w1', {} as any);
    expect(res[0].sourceRootUrl).toBe('https://a.com/services');
    expect(res[0].normalizedSourceRootUrl).toBe('https://a.com/services');
  });

  it('leaves the fields undefined when metadata has no root url', async () => {
    const doc = makeDoc();
    doc.metadata = {} as any;
    const service = makeService(doc);
    const res = await service.listFiles('u1', 'w1', {} as any);
    expect(res[0].sourceRootUrl).toBeUndefined();
    expect(res[0].normalizedSourceRootUrl).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd back && npx jest src/modules/classifier/services/classifier-file.service.spec.ts`
Expected: FAIL — `res[0].sourceRootUrl` is `undefined` in the first test.

- [ ] **Step 3: Add the fields to the response interface**

In `back/src/modules/classifier/interfaces/classifier.interface.ts`, add inside `IClassifierFileResponse` (after `sourceUrl?: string;`):

```ts
  /** Browse-session start URL this url-doc was indexed from (workspace grouping). */
  sourceRootUrl?: string;
  /** Normalized form of sourceRootUrl, used as the workspace grouping key. */
  normalizedSourceRootUrl?: string;
```

- [ ] **Step 4: Populate them in `toResponse`**

In `back/src/modules/classifier/services/classifier-file.service.ts`, in the `toResponse` method's returned object, add after the `sourceUrl` line:

```ts
      sourceRootUrl: (doc.metadata?.sourceRootUrl as string | undefined) ?? undefined,
      normalizedSourceRootUrl: (doc.metadata?.normalizedSourceRootUrl as string | undefined) ?? undefined,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd back && npx jest src/modules/classifier/services/classifier-file.service.spec.ts`
Expected: PASS.

Run: `cd back && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add YellowStorm/back/src/modules/classifier/interfaces/classifier.interface.ts YellowStorm/back/src/modules/classifier/services/classifier-file.service.ts YellowStorm/back/src/modules/classifier/services/classifier-file.service.spec.ts
git commit -m "feat(classifier): surface sourceRootUrl on listed files"
```

---

### Task 4: Frontend — carry `sourceRootUrl` on `WorkspaceFile` and send it on index

**Files:**
- Modify: `front/src/modules/workspace/types.ts`
- Modify: `front/src/modules/workspace/api.ts`
- Modify: `front/src/modules/workspace/store.ts`
- Modify: `front/src/modules/workspace/components/AddLinkDialog.tsx`
- Test: `front/src/modules/workspace/components/AddLinkDialog.test.tsx`

**Interfaces:**
- Consumes: `useBrowserSession().rootUrl` (Task 1); the backend `sourceRootUrl`/`normalizedSourceRootUrl` fields (Task 3).
- Produces:
  - `WorkspaceFile.sourceRootUrl?: string`, `WorkspaceFile.normalizedSourceRootUrl?: string`.
  - `addLinks`/`addPageLinks` options gain `sourceRootUrl?: string`; `AddLinkDialog` sends `session.rootUrl`.

- [ ] **Step 1: Write the failing test**

In `front/src/modules/workspace/components/AddLinkDialog.test.tsx`:

Add `rootUrl` to the shared `session` mock object (in the `const session = { ... }` literal near the top):

```ts
  rootUrl: null as string | null,
```

Then replace the existing `it('indexes the selected pages', ...)` test with:

```ts
it('indexes the selected pages under the session root url', async () => {
  session.status = 'live';
  session.rootUrl = 'https://ok.example/start';
  session.pages = [{ url: 'https://ok.example/a', title: 'A' }, { url: 'https://ok.example/b', title: 'B' }];
  const onOpenChange = vi.fn();
  render(<AddLinkDialog open onOpenChange={onOpenChange} workspaceId='w1' />);
  fireEvent.click(screen.getByRole('button', { name: /Indexer/ }));
  await waitFor(() =>
    expect(addPageLinks).toHaveBeenCalledWith(
      'w1',
      ['https://ok.example/a', 'https://ok.example/b'],
      expect.objectContaining({ sourceRootUrl: 'https://ok.example/start' }),
    ),
  );
});
```

Also add `session.rootUrl = null;` to the `beforeEach` reset block (alongside `session.pages = []`).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd front && npx vitest run src/modules/workspace/components/AddLinkDialog.test.tsx`
Expected: FAIL — `addPageLinks` was called without a `sourceRootUrl` in its options.

- [ ] **Step 3: Add the type fields and thread `sourceRootUrl`**

In `front/src/modules/workspace/types.ts`, add to the `WorkspaceFile` interface (after `sourceUrl?: string;`):

```ts
  /** Browse-session start URL this url-doc was indexed from (workspace grouping). */
  sourceRootUrl?: string;
  /** Normalized form of sourceRootUrl, used as the workspace grouping key. */
  normalizedSourceRootUrl?: string;
```

In `front/src/modules/workspace/api.ts`, widen the `addLinks` options type:

```ts
export async function addLinks(workspaceId: string, urls: string[], options?: { deepSearch?: boolean; autoIndex?: boolean; sourceRootUrl?: string }): Promise<WorkspaceDocument[]> {
```

(The body already spreads `...options` into the request, so `sourceRootUrl` is forwarded automatically.)

In `front/src/modules/workspace/store.ts`, widen the `addPageLinks` type declaration (the interface line, ~304):

```ts
  addPageLinks: (workspaceId: string, urls: string[], options?: { deepSearch?: boolean; autoIndex?: boolean; sourceRootUrl?: string }) => Promise<void>;
```

(The action body `addPageLinks: async (workspaceId, urls, options) => { await workspaceApi.addLinks(workspaceId, urls, options); ... }` forwards `options` unchanged — no body change needed.)

In `front/src/modules/workspace/components/AddLinkDialog.tsx`, change the `handleIndex` call:

```ts
      await addPageLinks(workspaceId, chosen, {
        deepSearch: readDeepSearchIndexationValue(),
        autoIndex: readAutoIndexationValue(),
        sourceRootUrl: session.rootUrl ?? undefined,
      });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd front && npx vitest run src/modules/workspace/components/AddLinkDialog.test.tsx`
Expected: PASS.

Run: `cd front && npx tsc --noEmit`
Expected: no new errors in the changed files.

- [ ] **Step 5: Commit**

```bash
git add YellowStorm/front/src/modules/workspace/types.ts YellowStorm/front/src/modules/workspace/api.ts YellowStorm/front/src/modules/workspace/store.ts YellowStorm/front/src/modules/workspace/components/AddLinkDialog.tsx YellowStorm/front/src/modules/workspace/components/AddLinkDialog.test.tsx
git commit -m "feat(workspace): send session root url when indexing links"
```

---

### Task 5: Frontend — `groupBySourceRoot` grouping helper

**Files:**
- Create: `front/src/modules/workspace/lib/source-groups.ts`
- Test (create): `front/src/modules/workspace/lib/source-groups.test.ts`

**Interfaces:**
- Consumes: `WorkspaceFile` (with `type`, `indexingStatus`, `sourceRootUrl`, `normalizedSourceRootUrl` from Task 4).
- Produces:
  - `SourceGroup { key: string; label: string; rootUrl: string; files: WorkspaceFile[]; status: IndexingStatus }`.
  - `GroupedFiles { groups: SourceGroup[]; loose: WorkspaceFile[] }`.
  - `groupBySourceRoot(files: WorkspaceFile[]): GroupedFiles`.

- [ ] **Step 1: Write the failing tests**

Create `front/src/modules/workspace/lib/source-groups.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { groupBySourceRoot } from './source-groups';
import type { WorkspaceFile } from '../types';

function urlFile(id: string, over: Partial<WorkspaceFile> = {}): WorkspaceFile {
  return {
    id, workspaceId: 'w1', name: id, mimeType: 'application/pdf', size: 0, uploadedAt: null,
    folderId: null, assignmentSource: null, type: 'url',
    sourceRootUrl: 'https://ex.com/services', normalizedSourceRootUrl: 'https://ex.com/services',
    indexingStatus: 'ready', ...over,
  };
}

describe('groupBySourceRoot', () => {
  it('groups 2+ url-docs sharing a normalized root and cleans the label', () => {
    const { groups, loose } = groupBySourceRoot([urlFile('a'), urlFile('b')]);
    expect(loose).toHaveLength(0);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('https://ex.com/services');
    expect(groups[0].label).toBe('ex.com/services');
    expect(groups[0].files.map((f) => f.id)).toEqual(['a', 'b']);
  });

  it('keeps a lone url-doc loose (no group of one)', () => {
    const { groups, loose } = groupBySourceRoot([urlFile('a')]);
    expect(groups).toHaveLength(0);
    expect(loose.map((f) => f.id)).toEqual(['a']);
  });

  it('excludes non-url docs and docs without a normalized root', () => {
    const { groups, loose } = groupBySourceRoot([
      urlFile('a'), urlFile('b'),
      urlFile('c', { type: 'doc' }),
      urlFile('d', { normalizedSourceRootUrl: undefined }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].files.map((f) => f.id)).toEqual(['a', 'b']);
    expect(loose.map((f) => f.id)).toEqual(['c', 'd']);
  });

  it('preserves first-seen order of groups and loose files', () => {
    const other = { sourceRootUrl: 'https://z.io/docs', normalizedSourceRootUrl: 'https://z.io/docs' };
    const { groups, loose } = groupBySourceRoot([
      urlFile('single', { normalizedSourceRootUrl: 'https://solo.io/p' }),
      urlFile('a'), urlFile('z1', other), urlFile('b'), urlFile('z2', other),
    ]);
    expect(groups.map((g) => g.key)).toEqual(['https://ex.com/services', 'https://z.io/docs']);
    expect(loose.map((f) => f.id)).toEqual(['single']);
  });

  it('aggregates status: failed beats processing beats ready', () => {
    expect(groupBySourceRoot([urlFile('a'), urlFile('b', { indexingStatus: 'failed' })]).groups[0].status).toBe('failed');
    expect(groupBySourceRoot([urlFile('a'), urlFile('b', { indexingStatus: 'processing' })]).groups[0].status).toBe('processing');
    expect(groupBySourceRoot([urlFile('a'), urlFile('b')]).groups[0].status).toBe('ready');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd front && npx vitest run src/modules/workspace/lib/source-groups.test.ts`
Expected: FAIL — cannot import `groupBySourceRoot` (module does not exist).

- [ ] **Step 3: Implement the helper**

Create `front/src/modules/workspace/lib/source-groups.ts`:

```ts
import type { IndexingStatus, WorkspaceFile } from '../types';

export interface SourceGroup {
  /** Normalized start URL — the grouping key. */
  key: string;
  /** Cleaned display label (host + path, no scheme). */
  label: string;
  /** Raw start URL, for the header tooltip. */
  rootUrl: string;
  files: WorkspaceFile[];
  /** Aggregate indexing status across the group's files. */
  status: IndexingStatus;
}

export interface GroupedFiles {
  groups: SourceGroup[];
  loose: WorkspaceFile[];
}

function aggregateStatus(files: WorkspaceFile[]): IndexingStatus {
  const statuses = files.map((f) => f.indexingStatus ?? 'none');
  if (statuses.some((s) => s === 'failed')) return 'failed';
  if (statuses.some((s) => s === 'pending' || s === 'processing')) return 'processing';
  if (statuses.length > 0 && statuses.every((s) => s === 'ready')) return 'ready';
  return 'none';
}

function cleanRootLabel(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const path = u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '');
    return `${u.host}${path}`;
  } catch {
    return rawUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
  }
}

/**
 * Partition workspace files into start-URL groups and loose files. A group is
 * formed only when 2+ url-documents share the same `normalizedSourceRootUrl`;
 * every other file (non-url, missing root, or a lone url-doc) stays loose.
 * First-seen order is preserved for both groups and loose files.
 */
export function groupBySourceRoot(files: WorkspaceFile[]): GroupedFiles {
  const counts = new Map<string, number>();
  for (const f of files) {
    if (f.type === 'url' && f.normalizedSourceRootUrl) {
      counts.set(f.normalizedSourceRootUrl, (counts.get(f.normalizedSourceRootUrl) ?? 0) + 1);
    }
  }

  const groupByKey = new Map<string, SourceGroup>();
  const order: string[] = [];
  const loose: WorkspaceFile[] = [];

  for (const f of files) {
    const key = f.type === 'url' ? f.normalizedSourceRootUrl : undefined;
    if (key && (counts.get(key) ?? 0) >= 2) {
      let group = groupByKey.get(key);
      if (!group) {
        group = { key, label: cleanRootLabel(f.sourceRootUrl ?? key), rootUrl: f.sourceRootUrl ?? key, files: [], status: 'none' };
        groupByKey.set(key, group);
        order.push(key);
      }
      group.files.push(f);
    } else {
      loose.push(f);
    }
  }

  const groups = order.map((k) => {
    const group = groupByKey.get(k) as SourceGroup;
    return { ...group, status: aggregateStatus(group.files) };
  });

  return { groups, loose };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd front && npx vitest run src/modules/workspace/lib/source-groups.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add YellowStorm/front/src/modules/workspace/lib/source-groups.ts YellowStorm/front/src/modules/workspace/lib/source-groups.test.ts
git commit -m "feat(workspace): add groupBySourceRoot helper for indexed sources"
```

---

### Task 6: Frontend — extract `IndexingStatusDot` and build `SourceGroupRow`

**Files:**
- Create: `front/src/modules/workspace/components/IndexingStatusDot.tsx`
- Modify: `front/src/modules/workspace/components/WorkspacePage.tsx` (remove the local `IndexingStatusDot`, import the extracted one)
- Create: `front/src/modules/workspace/components/SourceGroupRow.tsx`
- Test (create): `front/src/modules/workspace/components/SourceGroupRow.test.tsx`

**Interfaces:**
- Consumes: `IndexingStatus` (from `../types`).
- Produces:
  - `IndexingStatusDot` — exported from its own module (same rendering as before).
  - `SourceGroupRow({ label, rootUrl, count, status?, defaultOpen?, children })` — presentational inline collapsible section; children are supplied by the caller.

- [ ] **Step 1: Write the failing test**

Create `front/src/modules/workspace/components/SourceGroupRow.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SourceGroupRow } from './SourceGroupRow';

describe('SourceGroupRow', () => {
  it('shows the label and count, and toggles children open/closed', () => {
    render(
      <SourceGroupRow label='example.com/services' rootUrl='https://example.com/services' count={3} status='ready'>
        <div>child-a</div>
      </SourceGroupRow>,
    );
    expect(screen.getByText('example.com/services')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    // collapsed by default
    expect(screen.queryByText('child-a')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'example.com/services' }));
    expect(screen.getByText('child-a')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd front && npx vitest run src/modules/workspace/components/SourceGroupRow.test.tsx`
Expected: FAIL — cannot import `SourceGroupRow` (module does not exist).

- [ ] **Step 3: Extract `IndexingStatusDot` into its own module**

Create `front/src/modules/workspace/components/IndexingStatusDot.tsx`:

```tsx
import { cn } from '@/lib/utils';
import type { WorkspaceFile } from '../types';

/** Small colored dot reflecting a file's vectorstore indexing status. */
export function IndexingStatusDot({ status, error }: { status?: WorkspaceFile['indexingStatus']; error?: string }) {
  const config: Record<NonNullable<WorkspaceFile['indexingStatus']>, { color: string; pulse?: boolean; label: string }> = {
    ready: { color: 'bg-green-500', label: 'Indexé' },
    failed: { color: 'bg-red-500', label: "Échec de l'indexation" },
    pending: { color: 'bg-orange-500', pulse: true, label: 'Indexation en attente' },
    processing: { color: 'bg-orange-500', pulse: true, label: 'Indexation en cours' },
    none: { color: 'bg-muted-foreground/40', label: 'Non indexé' },
  };
  const cfg = config[status ?? 'none'] ?? config.none;
  const title = status === 'failed' && error ? `${cfg.label} : ${error}` : cfg.label;
  return (
    <span
      className={cn('inline-block h-2 w-2 shrink-0 rounded-full', cfg.color, cfg.pulse && 'animate-pulse')}
      title={title}
      aria-label={title}
      role='img'
    />
  );
}
```

In `front/src/modules/workspace/components/WorkspacePage.tsx`:
- Delete the local `IndexingStatusDot` function (the `/** Small colored dot ... */` block and the function that follows it).
- Add an import near the other component imports:

```ts
import { IndexingStatusDot } from './IndexingStatusDot';
```

- [ ] **Step 4: Implement `SourceGroupRow`**

Create `front/src/modules/workspace/components/SourceGroupRow.tsx`:

```tsx
import { useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { IndexingStatus } from '../types';
import { IndexingStatusDot } from './IndexingStatusDot';

/** Inline collapsible group of indexed pages sharing a browse-session start URL. */
export function SourceGroupRow({
  label, rootUrl, count, status, defaultOpen = false, children,
}: {
  label: string;
  rootUrl: string;
  count: number;
  status?: IndexingStatus;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className='rounded border'>
      <button
        type='button'
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className='flex w-full items-center gap-2 border-b px-2 py-1.5 text-left text-sm'
      >
        <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
        <IndexingStatusDot status={status} />
        <span className='min-w-0 flex-1 truncate font-medium' title={rootUrl}>{label}</span>
        <span className='shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-secondary-foreground'>{count}</span>
      </button>
      {open && <div className='space-y-1 p-1'>{children}</div>}
    </div>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd front && npx vitest run src/modules/workspace/components/SourceGroupRow.test.tsx`
Expected: PASS.

Run: `cd front && npx tsc --noEmit`
Expected: no new errors (confirms the `IndexingStatusDot` extraction + WorkspacePage import resolve).

- [ ] **Step 6: Commit**

```bash
git add YellowStorm/front/src/modules/workspace/components/IndexingStatusDot.tsx YellowStorm/front/src/modules/workspace/components/SourceGroupRow.tsx YellowStorm/front/src/modules/workspace/components/SourceGroupRow.test.tsx YellowStorm/front/src/modules/workspace/components/WorkspacePage.tsx
git commit -m "feat(workspace): add SourceGroupRow and extract IndexingStatusDot"
```

---

### Task 7: Frontend — render start-URL groups in the workspace file list

**Files:**
- Modify: `front/src/modules/workspace/components/WorkspacePage.tsx`

**Interfaces:**
- Consumes: `groupBySourceRoot` (Task 5), `SourceGroupRow` (Task 6), `WorkspaceFile.sourceRootUrl`/`normalizedSourceRootUrl` (Task 4).
- Produces: grouped rendering of `visibleFiles` at the workspace root; unchanged flat rendering inside a manual folder.

> This task changes rendering inside the large `WorkspacePage` component; it has no isolated unit-test harness. Correctness of the grouping logic and the group UI is already covered by Task 5 (`source-groups.test.ts`) and Task 6 (`SourceGroupRow.test.tsx`); this task is verified by `tsc` plus the live smoke check in Final Verification.

- [ ] **Step 1: Add imports**

In `front/src/modules/workspace/components/WorkspacePage.tsx`, add near the other imports:

```ts
import { groupBySourceRoot } from '../lib/source-groups';
import { SourceGroupRow } from './SourceGroupRow';
```

- [ ] **Step 2: Add a `renderFileRow` helper in the component body**

Inside the `WorkspacePage` function, after the `visibleFiles` `useMemo` (around line 231), add:

```tsx
  const renderFileRow = (file: WorkspaceFile) => {
    const query = search.trim().toLowerCase();
    const sourceMatches = file.name.toLowerCase().includes(query);
    const allLinkedArtifacts = artifacts.filter((artifact) => artifact.primarySource.documentId === file.id);
    const linkedArtifacts = allLinkedArtifacts.filter((artifact) => !query || sourceMatches || artifact.name.toLowerCase().includes(query));
    return (
      <FileRow
        key={file.id}
        file={file}
        artifacts={linkedArtifacts}
        totalArtifactCount={allLinkedArtifacts.length}
        forceExpanded={!!query && !sourceMatches && linkedArtifacts.length > 0}
        onMove={() => setMapFile(file)}
      />
    );
  };
```

- [ ] **Step 3: Replace the flat files render with grouped rendering**

In the JSX, replace the existing files-section body:

```tsx
              {visibleFiles.length > 0 && (
                <section>
                  <SectionHeader title='Fichiers' count={visibleFiles.length} icon={<FileIcon className='h-3.5 w-3.5' />} />
                  <div className='space-y-1'>
                    {visibleFiles.map((file) => {
                      const query = search.trim().toLowerCase();
                      const sourceMatches = file.name.toLowerCase().includes(query);
                      const allLinkedArtifacts = artifacts.filter((artifact) => artifact.primarySource.documentId === file.id);
                      const linkedArtifacts = allLinkedArtifacts.filter((artifact) => !query || sourceMatches || artifact.name.toLowerCase().includes(query));
                      return <FileRow key={file.id} file={file} artifacts={linkedArtifacts} totalArtifactCount={allLinkedArtifacts.length} forceExpanded={!!query && !sourceMatches && linkedArtifacts.length > 0} onMove={() => setMapFile(file)} />;
                    })}
                  </div>
                </section>
              )}
```

with:

```tsx
              {visibleFiles.length > 0 && (
                <section>
                  <SectionHeader title='Fichiers' count={visibleFiles.length} icon={<FileIcon className='h-3.5 w-3.5' />} />
                  {currentFolderId ? (
                    <div className='space-y-1'>{visibleFiles.map(renderFileRow)}</div>
                  ) : (() => {
                    const { groups, loose } = groupBySourceRoot(visibleFiles);
                    return (
                      <div className='space-y-1'>
                        {groups.map((group) => (
                          <SourceGroupRow key={group.key} label={group.label} rootUrl={group.rootUrl} count={group.files.length} status={group.status}>
                            {group.files.map(renderFileRow)}
                          </SourceGroupRow>
                        ))}
                        {loose.map(renderFileRow)}
                      </div>
                    );
                  })()}
                </section>
              )}
```

- [ ] **Step 4: Verify types and existing frontend tests**

Run: `cd front && npx tsc --noEmit`
Expected: no new errors.

Run: `cd front && npx vitest run src/modules/workspace`
Expected: feature tests green (pre-existing unrelated failures, if any, may remain).

- [ ] **Step 5: Commit**

```bash
git add YellowStorm/front/src/modules/workspace/components/WorkspacePage.tsx
git commit -m "feat(workspace): group indexed sources under their start URL in the file list"
```

---

## Final verification

- [ ] Backend: `cd back && npx jest src/modules/workspace/dto/add-links.dto.spec.ts src/modules/workspace/workspace-document.service.spec.ts src/modules/classifier/services/classifier-file.service.spec.ts` — all green.
- [ ] Backend: `cd back && npx tsc --noEmit` — clean (no new errors from changed files).
- [ ] Frontend: `cd front && npx vitest run src/modules/workspace` — feature tests green.
- [ ] Frontend: `cd front && npx tsc --noEmit` — no new errors.
- [ ] Live smoke (covers the WorkspacePage render wiring that has no unit test):
  1. Open a workspace → **Ajouter un lien** → enter a site URL → browse and select **2+ pages** → **Indexer**.
  2. In the workspace root, the pages appear under **one collapsible group** labeled with the cleaned start URL (host + path), with a count and an aggregate status dot; expand/collapse works.
  3. Index a **single** page from a different site → it appears **flat** (no group).
  4. Move a grouped page into a manual folder → it **leaves** the group; open the folder → it renders **flat** (no url-grouping inside folders).
  5. Reload the page → grouping **persists** (served from `metadata.sourceRootUrl`).

## Self-review notes

- **Spec coverage:** Capture root → Task 1. Persist per document → Task 2. Surface to frontend → Task 3 (classifier) + Task 4 (type). Send on index → Task 4. Derive grouping (≥2 rule, first-seen order, aggregate status, cleaned label) → Task 5. Inline collapsible group UI separate from folders → Task 6. Root-only rendering + folder-flat coexistence + loose singles → Task 7. Testing plan → each task's tests + Final Verification smoke. All spec sections covered.
- **Coexistence:** grouping is gated on `!currentFolderId` (Task 7); inside a folder, files render flat. A folder-assigned url-doc is excluded from root grouping because it isn't in `visibleFiles` at root. Manual folders and the viewport contract are untouched.
- **First-wins / order:** `groupBySourceRoot` preserves first-seen order for groups and loose files, and the group is keyed on `normalizedSourceRootUrl` (consistent normalization with the backend `normalizeWorkspaceUrl`).
- **Type consistency:** `sourceRootUrl`/`normalizedSourceRootUrl` used identically across `AddLinksDto` (Task 2), `IClassifierFileResponse` (Task 3), `WorkspaceFile` (Task 4), and `groupBySourceRoot`/`SourceGroup` (Task 5). `addLinks`/`addPageLinks` options carry `sourceRootUrl?: string` in api + store + dialog (Task 4). `IndexingStatusDot` is exported once (Task 6) and consumed by both `WorkspacePage` and `SourceGroupRow`.
```
