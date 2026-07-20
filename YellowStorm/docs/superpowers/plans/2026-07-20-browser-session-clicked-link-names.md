# Browser session: page names from clicked link text — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Name each visited page in the browser-session sidebar after the text of the link/button the user clicked to reach it, falling back to the page `<title>` then the last URL segment.

**Architecture:** An injected capture-phase click listener in the remote Playwright page reports the clicked element's label to the backend via an exposed binding. The backend session remembers the last label and pairs it (single-use, within a TTL) with the next committed navigation, adding `linkText` to the `navigated` event. The frontend stores `linkText` on each collected page; `buildTrie` resolves the leaf display label (`linkText` → `title` → URL segment) while the URL-path tree grouping is unchanged.

**Tech Stack:** NestJS + Playwright + Jest (backend); React + Zustand + socket.io-client + Vitest (frontend).

## Global Constraints

- TDD: write the failing test first, watch it fail, implement minimally, watch it pass, commit.
- Conventional commits: `<type>(<scope>): <subject>`. No `Co-Authored-By` trailer.
- Colocated tests (`X.spec.ts` backend, `X.test.ts(x)` frontend).
- No hardcoded user-facing strings added; sidebar labels come from page data (aria-labels are dynamic data, allowed).
- Backend TS has no DOM lib — never reference `document`/`window`/DOM types in backend `.ts` bodies; inject browser code as a **string** script.
- The client/backend viewport coordinate contract is untouched by this change.
- Dedup stays **first-wins**; no name-upgrade-on-revisit.

---

### Task 1: Config — `clickLabelTtlMs`

**Files:**
- Modify: `back/src/config/browser-session.config.ts`
- Test: `back/src/config/browser-session.config.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `browserSession.clickLabelTtlMs: number` (default `5000`, env `BROWSER_SESSION_CLICK_LABEL_TTL_MS`).

- [ ] **Step 1: Add the failing assertions**

In `back/src/config/browser-session.config.spec.ts`, add to the `provides POC defaults` test (after the `screencastQuality` line):

```ts
    expect(c.clickLabelTtlMs).toBe(5000);
```

And add a new test after the `reads chromiumExecutablePath override from env` test:

```ts
  it('reads clickLabelTtlMs override from env', () => {
    process.env.BROWSER_SESSION_CLICK_LABEL_TTL_MS = '8000';
    expect(browserSessionConfig().clickLabelTtlMs).toBe(8000);
    delete process.env.BROWSER_SESSION_CLICK_LABEL_TTL_MS;
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd back && npx jest src/config/browser-session.config.spec.ts`
Expected: FAIL — `clickLabelTtlMs` is `undefined`.

- [ ] **Step 3: Add the config key**

In `back/src/config/browser-session.config.ts`, add inside the returned object (after `chromiumExecutablePath`):

```ts
  // How long (ms) after a click its captured link/button text stays eligible to
  // name the resulting navigation. Single-use; explicit navigations clear it.
  clickLabelTtlMs: Number.parseInt(process.env.BROWSER_SESSION_CLICK_LABEL_TTL_MS || '5000', 10),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd back && npx jest src/config/browser-session.config.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add back/src/config/browser-session.config.ts back/src/config/browser-session.config.spec.ts
git commit -m "feat(browser-session): add clickLabelTtlMs config"
```

---

### Task 2: Backend — `linkText` event, `resolveClickLabel`, click capture & pairing

**Files:**
- Modify: `back/src/modules/browser-session/browser-session.types.ts` (add `linkText` to `NavigatedEvent`)
- Modify: `back/src/modules/browser-session/playwright-browser-engine.ts` (pure `resolveClickLabel`, init script, binding, session pairing, `navigate` clears)
- Test: `back/src/modules/browser-session/playwright-browser-engine.spec.ts`

**Interfaces:**
- Consumes: `browserSession.clickLabelTtlMs` (Task 1).
- Produces:
  - `NavigatedEvent { url: string; title: string; linkText?: string }`.
  - `resolveClickLabel(lastClick: { label: string; at: number } | undefined, now: number, ttlMs: number): string | undefined`.
  - `navigated` socket payload now carries optional `linkText` (forwarded unchanged by service + gateway — no code change there).

- [ ] **Step 1: Write the failing test for `resolveClickLabel`**

Append to `back/src/modules/browser-session/playwright-browser-engine.spec.ts`:

```ts
import { isNavigationRequestBlocked, resolveClickLabel } from './playwright-browser-engine';

describe('resolveClickLabel', () => {
  it('returns the recorded label inside the ttl window', () => {
    expect(resolveClickLabel({ label: 'Our Services', at: 1000 }, 3000, 5000)).toBe('Our Services');
  });

  it('returns undefined when the click is older than the ttl', () => {
    expect(resolveClickLabel({ label: 'Our Services', at: 1000 }, 7000, 5000)).toBeUndefined();
  });

  it('returns undefined when there is no recorded click', () => {
    expect(resolveClickLabel(undefined, 3000, 5000)).toBeUndefined();
  });
});
```

Note: the existing file already `import { isNavigationRequestBlocked } from './playwright-browser-engine';` on line 1 — replace that line with the combined import above (do not create a duplicate import).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd back && npx jest src/modules/browser-session/playwright-browser-engine.spec.ts`
Expected: FAIL — `resolveClickLabel` is not exported.

- [ ] **Step 3: Add `linkText` to `NavigatedEvent`**

In `back/src/modules/browser-session/browser-session.types.ts`, change:

```ts
export interface NavigatedEvent {
  url: string;
  title: string;
}
```

to:

```ts
export interface NavigatedEvent {
  url: string;
  title: string;
  /** Text of the link/button clicked to reach this page, when the navigation was click-driven. */
  linkText?: string;
}
```

- [ ] **Step 4: Implement `resolveClickLabel` and the click-capture script**

In `back/src/modules/browser-session/playwright-browser-engine.ts`, after the `isNavigationRequestBlocked` function (before `const KEY_TO_BUTTON`), add:

```ts
/**
 * Pair a recorded click with a navigation: return the label iff the click was
 * recorded within `ttlMs` of `now`. Clock-agnostic (operates on numbers) so it
 * is unit-testable without a real browser or timers.
 */
export function resolveClickLabel(
  lastClick: { label: string; at: number } | undefined,
  now: number,
  ttlMs: number,
): string | undefined {
  if (!lastClick) return undefined;
  if (now - lastClick.at > ttlMs) return undefined;
  return lastClick.label;
}

/**
 * Injected into every page (as a string so backend TS never type-checks DOM
 * globals). A capture-phase click listener walks up to the nearest link/button,
 * extracts a clean label (visible text → aria-label → title → image alt), and
 * reports it to the backend binding. Read-only: never calls preventDefault.
 */
const CLICK_CAPTURE_SCRIPT = `
(() => {
  const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim().slice(0, 120);
  document.addEventListener('click', (e) => {
    let node = e.target;
    let found = null;
    while (node && node !== document.body) {
      const tag = node.tagName ? node.tagName.toLowerCase() : '';
      const role = node.getAttribute ? node.getAttribute('role') : null;
      if (tag === 'a' || tag === 'button' || role === 'link' || role === 'button' || (node.hasAttribute && node.hasAttribute('onclick'))) { found = node; break; }
      node = node.parentElement;
    }
    if (!found) return;
    let label = clean(found.innerText);
    if (!label) label = clean(found.getAttribute('aria-label'));
    if (!label) label = clean(found.getAttribute('title'));
    if (!label) { const img = found.querySelector('img[alt]'); if (img) label = clean(img.getAttribute('alt')); }
    if (label && typeof window.__ysRecordClick === 'function') window.__ysRecordClick(label);
  }, true);
})();
`;
```

- [ ] **Step 5: Run the pure-function test to verify it passes**

Run: `cd back && npx jest src/modules/browser-session/playwright-browser-engine.spec.ts`
Expected: PASS (the three `resolveClickLabel` tests and the existing `isNavigationRequestBlocked` tests).

- [ ] **Step 6: Wire click capture and pairing into `PlaywrightSession`**

In `back/src/modules/browser-session/playwright-browser-engine.ts`:

(a) Add fields and constructor params. Change the class field block and constructor of `PlaywrightSession`:

```ts
class PlaywrightSession implements EngineSession {
  private frameCb?: (f: string) => void;
  private navCb?: (n: NavigatedEvent) => void;
  private lastNav: NavigatedEvent | undefined;
  private lastClick: { label: string; at: number } | undefined;

  constructor(
    private readonly context: BrowserContext,
    private readonly page: Page,
    private readonly cdp: CDPSession,
    private readonly ttlMs: number,
    private readonly now: () => number,
  ) {
```

(b) Replace the `framenavigated` handler body inside the constructor:

```ts
    this.page.on('framenavigated', async (frame) => {
      if (frame !== this.page.mainFrame()) return; // main frame only
      // Read + consume the pending click label synchronously (before any await)
      // so concurrent navigations can't double-consume it. Single-use.
      const linkText = resolveClickLabel(this.lastClick, this.now(), this.ttlMs);
      this.lastClick = undefined;
      const nav: NavigatedEvent = { url: frame.url(), title: await this.page.title().catch(() => ''), linkText };
      this.lastNav = nav;
      this.navCb?.(nav);
    });
```

(c) Add a `recordClick` method (place it just after `onNavigated`):

```ts
  recordClick(label: string): void {
    this.lastClick = { label, at: this.now() };
  }
```

(d) Make `navigate` clear the pending label first. Change the start of `navigate`:

```ts
  async navigate(a: NavAction): Promise<void> {
    this.lastClick = undefined; // explicit navigation must not inherit a click label
    if (a.kind === 'goto') await this.page.goto(a.url, { waitUntil: 'domcontentloaded' }).catch(() => {});
    else if (a.kind === 'back') await this.page.goBack().catch(() => {});
    else if (a.kind === 'forward') await this.page.goForward().catch(() => {});
    else await this.page.reload().catch(() => {});
  }
```

- [ ] **Step 7: Register the binding + init script and pass config in `launchSession`**

In `PlaywrightBrowserEngine`, add a field and read the config value. Change the class fields and constructor body:

Add field near the other `private readonly` fields:

```ts
  private readonly clickLabelTtlMs: number;
```

Extend the config cast and assignment in the constructor:

```ts
    const c = config.get('browserSession') as {
      viewportWidth: number; viewportHeight: number; screencastQuality: number;
      chromiumExecutablePath: string; clickLabelTtlMs: number;
    };
    this.width = c.viewportWidth;
    this.height = c.viewportHeight;
    this.quality = c.screencastQuality;
    this.chromiumExecutablePath = c.chromiumExecutablePath;
    this.clickLabelTtlMs = c.clickLabelTtlMs;
```

In `launchSession`, change the session construction line:

```ts
    const cdp = await context.newCDPSession(page);
    const session = new PlaywrightSession(context, page, cdp, this.clickLabelTtlMs, () => performance.now());

    // Name visited pages after the clicked link/button text (see resolveClickLabel):
    // the in-page listener reports the label, we pair it with the next navigation.
    await context.exposeBinding('__ysRecordClick', (_source, label: string) => {
      if (typeof label === 'string') session.recordClick(label);
    });
    await context.addInitScript(CLICK_CAPTURE_SCRIPT);
```

(Insert this in place of the existing `const session = new PlaywrightSession(context, page, cdp);` line, keeping the subsequent `await page.goto(startUrl, ...)` and `startScreencast` calls exactly where they are so the init script + binding are registered before the first navigation.)

- [ ] **Step 8: Verify the whole backend module compiles and tests pass**

Run: `cd back && npx jest src/modules/browser-session src/config/browser-session.config.spec.ts`
Expected: PASS (engine, gateway, service, config specs all green — service/gateway forward `linkText` unchanged, so their existing specs are unaffected).

Run: `cd back && npx tsc --noEmit`
Expected: no errors (confirms the string-script approach avoids DOM typing and `performance.now()` types resolve).

- [ ] **Step 9: Commit**

```bash
git add back/src/modules/browser-session/browser-session.types.ts back/src/modules/browser-session/playwright-browser-engine.ts back/src/modules/browser-session/playwright-browser-engine.spec.ts
git commit -m "feat(browser-session): capture clicked link text and emit as linkText"
```

---

### Task 3: Frontend — carry `linkText` on collected pages

**Files:**
- Modify: `front/src/modules/workspace/hooks/useBrowserSession.ts` (`CollectedPage.linkText`, store raw title + linkText)
- Test: `front/src/modules/workspace/hooks/useBrowserSession.test.ts`

**Interfaces:**
- Consumes: `navigated` payload `{ url, title, linkText? }` (Task 2).
- Produces: `CollectedPage { url: string; title: string; linkText?: string }` on `useBrowserSession().pages`.

- [ ] **Step 1: Write the failing test**

In `front/src/modules/workspace/hooks/useBrowserSession.test.ts`, add inside `describe('useBrowserSession', ...)`:

```ts
  it('stores the clicked link text on the collected page', async () => {
    const { result } = renderHook(() => useBrowserSession());
    act(() => { result.current.start('https://ok.example'); });
    await waitFor(() => expect(result.current.status).toBe('live'));
    act(() => { handlers['navigated']({ url: 'https://ok.example/a', title: 'A', linkText: 'About Us' }); });
    expect(result.current.pages[0].linkText).toBe('About Us');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd front && npx vitest run src/modules/workspace/hooks/useBrowserSession.test.ts`
Expected: FAIL — `linkText` is `undefined` (not stored).

- [ ] **Step 3: Add `linkText` to the type and store it**

In `front/src/modules/workspace/hooks/useBrowserSession.ts`:

Change the interface:

```ts
export interface CollectedPage { url: string; title: string; linkText?: string; }
```

Change the `navigated` handler (store the clicked text and the raw title so the display fallback chain works — no longer default the title to the URL):

```ts
    socket.on('navigated', (p: CollectedPage) => {
      setCurrentUrl(p.url);
      const key = normalizeUrl(p.url);
      if (seenRef.current.has(key)) return;
      seenRef.current.add(key);
      setPages((prev) => [...prev, { url: p.url, title: p.title || '', linkText: p.linkText }]);
    });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd front && npx vitest run src/modules/workspace/hooks/useBrowserSession.test.ts`
Expected: PASS (new test plus the existing `collects navigations deduped by normalized url` test — the dedup test provides non-empty titles `A`/`B`, unaffected by dropping the `|| p.url` fallback).

- [ ] **Step 5: Commit**

```bash
git add front/src/modules/workspace/hooks/useBrowserSession.ts front/src/modules/workspace/hooks/useBrowserSession.test.ts
git commit -m "feat(workspace): carry linkText on collected browser-session pages"
```

---

### Task 4: Frontend — resolve and render the clicked-text leaf name

**Files:**
- Modify: `front/src/modules/workspace/components/CollectionSidebar.tsx` (`TrieNode.label`, resolution in `buildTrie`, render in `TrieRows`)
- Test: `front/src/modules/workspace/components/CollectionSidebar.test.tsx`

**Interfaces:**
- Consumes: `CollectedPage { url, title, linkText? }` (Task 3).
- Produces: `TrieNode { segment, url?, label?, children }`; leaves render `label ?? segment`.

- [ ] **Step 1: Write the failing tests**

In `front/src/modules/workspace/components/CollectionSidebar.test.tsx`, add to the `describe('buildTrie', ...)` block:

```ts
  it('names a visited-page leaf after the clicked link text when present', () => {
    const roots = buildTrie([{ url: 'https://ex.com/a/b', title: 'B Title', linkText: 'Our Services' }]);
    const a = roots[0].children.find((n) => n.segment === 'a')!;
    const b = a.children.find((n) => n.segment === 'b')!;
    expect(b.label).toBe('Our Services');
  });

  it('falls back to the page title when there is no link text', () => {
    const roots = buildTrie([{ url: 'https://ex.com/a/b', title: 'B Title' }]);
    const b = roots[0].children[0].children[0];
    expect(b.label).toBe('B Title');
  });

  it('leaves label undefined (URL-segment fallback) when neither link text nor title exist', () => {
    const roots = buildTrie([{ url: 'https://ex.com/a/b', title: '' }]);
    const b = roots[0].children[0].children[0];
    expect(b.label).toBeUndefined();
  });
```

And add a new render test after the existing `renders the path hierarchy...` test:

```ts
it('shows the clicked link text as the leaf name, keeping the URL segment as its category', () => {
  render(
    <CollectionSidebar
      pages={[{ url: 'https://ex.com/services/pricing', title: 'Pricing', linkText: 'See Pricing' }]}
      selected={new Set()}
      indexedUrls={new Set()}
      onToggle={vi.fn()}
      onDelete={vi.fn()}
      onSelectAll={vi.fn()}
      onSelectNone={vi.fn()}
    />,
  );
  expect(screen.getByText('services')).toBeInTheDocument(); // category = URL segment
  expect(screen.getByLabelText('See Pricing')).toBeInTheDocument(); // leaf = clicked text
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd front && npx vitest run src/modules/workspace/components/CollectionSidebar.test.tsx`
Expected: FAIL — `label` is `undefined` on all nodes; `getByLabelText('See Pricing')` not found.

- [ ] **Step 3: Add `label` to `TrieNode` and resolve it in `buildTrie`**

In `front/src/modules/workspace/components/CollectionSidebar.tsx`:

Add to the interface:

```ts
export interface TrieNode {
  /** Display name for this level: the host at the root, otherwise a path segment. */
  segment: string;
  /** Set when a collected page lives exactly at this path (a selectable leaf/branch). */
  url?: string;
  /** Preferred leaf display name (clicked link text → page title); falls back to `segment` when absent. */
  label?: string;
  children: TrieNode[];
}
```

Change the leaf-marking line at the end of the per-page loop in `buildTrie`:

```ts
    if (!node.url) {
      node.url = p.url;
      const label = (p.linkText || p.title || '').replace(/\s+/g, ' ').trim();
      if (label) node.label = label;
    }
```

- [ ] **Step 4: Render `label ?? segment` for leaves in `TrieRows`**

In `TrieRows`, inside the `nodes.map` callback, add a local after `const already = ...`:

```ts
        const displayName = node.label ?? node.segment;
```

Then in the `node.url ?` branch, change the checkbox `aria-label` and the title `<div>` to use `displayName`:

```ts
                  <Checkbox
                    aria-label={displayName}
                    checked={selected.has(node.url)}
                    disabled={already}
                    onCheckedChange={() => onToggle(node.url as string)}
                  />
                  <div className='min-w-0 flex-1'>
                    <div className='truncate font-medium' title={displayName}>{displayName}</div>
                    <div className='truncate text-[11px] text-muted-foreground' title={node.url}>{node.url}</div>
                    {already && <span className='text-[10px] text-muted-foreground'>Déjà indexée</span>}
                  </div>
```

(Leave the category-row button and the chevron `aria-label` on `node.segment` — categories keep URL-segment names. Leave the delete button `aria-label={`delete ${node.url}`}` unchanged.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd front && npx vitest run src/modules/workspace/components/CollectionSidebar.test.tsx`
Expected: PASS — new tests plus all existing CollectionSidebar tests (existing tests use `title: ''` and no `linkText`, so their leaves fall back to `node.segment` exactly as before, e.g. `getByLabelText('b')`).

- [ ] **Step 6: Full frontend check**

Run: `cd front && npx vitest run src/modules/workspace/components/CollectionSidebar.test.tsx src/modules/workspace/hooks/useBrowserSession.test.ts`
Expected: PASS.

Run: `cd front && npx tsc --noEmit`
Expected: no new errors in the changed files.

- [ ] **Step 7: Commit**

```bash
git add front/src/modules/workspace/components/CollectionSidebar.tsx front/src/modules/workspace/components/CollectionSidebar.test.tsx
git commit -m "feat(workspace): name sidebar leaves after clicked link text"
```

---

## Final verification

- [ ] Backend: `cd back && npx jest src/modules/browser-session src/config/browser-session.config.spec.ts` — all green.
- [ ] Backend: `cd back && npx tsc --noEmit` — clean.
- [ ] Frontend: `cd front && npx vitest run src/modules/workspace` — feature tests green (pre-existing unrelated failures in `store.test.ts`/`WorkspaceButton.test.tsx` may remain).
- [ ] Frontend: `cd front && npx tsc --noEmit` — no new errors.
- [ ] Live smoke (manual, covers the in-page DOM extraction that has no unit test): start a browser session, click a text link → sidebar leaf shows that link's text; click an icon-only link with an `aria-label` → shows the aria-label; type/back/forward navigation → leaf shows page `<title>` or URL segment, never a stale click label.

## Self-review notes

- **Spec coverage:** §1 capture → Task 2 (init script + binding). §2 pairing → Task 2 (`resolveClickLabel`, `recordClick`, framenavigated, `navigate` clears). §3 plumbing → Task 2 (`NavigatedEvent.linkText`; service/gateway forward as-is, verified in Step 8). §4 consume → Task 3. §5 display → Task 4. §6 config → Task 1. §7 tests → each task's tests + Final verification smoke. All covered.
- **First-wins dedup preserved:** hook `seenRef` (Task 3) and the `if (!node.url)` guard in `buildTrie` (Task 4) both keep first occurrence.
- **Type consistency:** `resolveClickLabel(lastClick, now, ttlMs)`, `recordClick(label)`, `CollectedPage.linkText`, `TrieNode.label` used identically across producing and consuming tasks.
