# Workspace Interactive Browse-and-Pick Link Indexing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the auto-crawler link flow with an interactive server-side browser (Playwright, streamed via CDP screencast over WebSocket) where the user browses, every visited page is collected into a sidebar, and the chosen pages are converted+indexed one at a time.

**Architecture:** A new self-contained `browser-session` Nest module owns a Playwright Chromium; each session is one `BrowserContext`+`page` with a CDP screencast relayed over a socket.io gateway and `framenavigated` captured for the sidebar. The frontend `AddLinkDialog` is rewritten to a canvas viewer + chrome bar + collection sidebar. The existing `convertAndStore`→`queueDocument` pipeline is reused unchanged; only `addLinks` scheduling changes to strictly sequential with a delay. The crawler, page-tree, and their UI are deleted.

**Tech Stack:** NestJS 10, `@nestjs/websockets` + `socket.io` 4.7 (already deps), `@nestjs/jwt` (already dep), Playwright (new backend dep), Jest. React/TS/Vite, `socket.io-client` 4.8 (already dep), Zustand, shadcn/Radix, Vitest + @testing-library/react.

## Global Constraints

- SSRF: every navigation (initial + link-follow + address-bar + back/forward) must pass `assertUrlIsSafe` from `back/src/modules/workspace/services/url-safety.ts` before/at load; disallowed → aborted + a `blocked` event. Never bypass it.
- Sequential conversion delay default: `INDEXING_SEQUENTIAL_DELAY_MS=2000`.
- Session limits (config, POC defaults): idle timeout `BROWSER_SESSION_IDLE_MS=300000` (5 min), hard max lifetime `BROWSER_SESSION_MAX_MS=1200000` (20 min), concurrency cap `BROWSER_SESSION_MAX_CONCURRENT=5`.
- Fixed browser viewport `1280x800`; screencast JPEG quality `60`. These constants are shared between the CDP config and the frontend coordinate mapping — keep them in sync.
- WS auth mirrors `whatsapp.gateway.ts`: JWT from `client.handshake.auth.token`, verified with `jwt.secret`/`jwt.issuer`/`jwt.audience`.
- Reuse `convertAndStore` unchanged. Do not build a new indexing path.
- TDD: write the failing test first, watch it fail, implement minimally, watch it pass, commit.

---

## File Structure

**Backend — new module `back/src/modules/browser-session/`:**
- `browser-session.types.ts` — shared event/payload types + DI tokens.
- `browser-session.service.ts` — session registry, concurrency cap, lifecycle timers, SSRF guarding, event relay. Engine-agnostic (unit-tested with a fake engine).
- `playwright-browser-engine.ts` — the real Playwright/CDP adapter implementing `BrowserEngine`.
- `browser-session.gateway.ts` — socket.io gateway: auth, `start`/`input`/`navigate`, relay, teardown on disconnect.
- `browser-session.module.ts` — wiring.
- `browser-session.service.spec.ts`, `browser-session.gateway.spec.ts`, `playwright-browser-engine.spec.ts` — tests.

**Backend — modified:**
- `back/src/config/browser-session.config.ts` — new config (create).
- `back/src/config/indexing.config.ts` — add `sequentialDelayMs`; remove `crawl*`.
- `back/src/app.module.ts` (or wherever root config/module registration lives) — register new module + config.
- `back/src/modules/workspace/workspace-document.service.ts` — `addLinks` sequential; delete `crawlSite`, crawler/page-tree imports.
- `back/src/modules/workspace/workspace-document.controller.ts` — delete `crawl` endpoint.
- `back/src/modules/workspace/workspace.module.ts` — drop `WebsiteCrawlerService`.
- Delete: `services/website-crawler.service.ts`, `services/page-tree.ts`, `dto/crawl-url.dto.ts`, and their spec files.
- `back/package.json` — add `playwright`.

**Frontend — modified/created:**
- `front/src/modules/workspace/hooks/useBrowserSession.ts` — socket hook (create) + `.test.ts`.
- `front/src/modules/workspace/components/BrowserSessionViewer.tsx` — canvas viewer (create) + `.test.tsx`.
- `front/src/modules/workspace/components/CollectionSidebar.tsx` — collected-pages sidebar (create) + `.test.tsx`.
- `front/src/modules/workspace/components/AddLinkDialog.tsx` — rewritten.
- `front/src/modules/workspace/api.ts` — remove `crawlUrl`; keep `addLinks`.
- `front/src/modules/workspace/store.ts` — remove crawl-related; keep `addPageLinks`.
- `front/src/modules/workspace/types.ts` — remove `PageNode`/`CrawlResponse`; add `sourceUrl?`/`type?` to `WorkspaceDocument`.
- Delete: `front/src/modules/workspace/components/PageTree.tsx` + its test.

---

## Task 1: Backend config — session limits + sequential delay

**Files:**
- Create: `back/src/config/browser-session.config.ts`
- Modify: `back/src/config/indexing.config.ts`
- Test: `back/src/config/browser-session.config.spec.ts`

**Interfaces:**
- Produces: `browserSessionConfig` (namespace `browserSession`) with `idleMs`, `maxMs`, `maxConcurrent`, `viewportWidth`, `viewportHeight`, `screencastQuality`. `indexing.sequentialDelayMs`.

- [ ] **Step 1: Write the failing test**

```ts
// back/src/config/browser-session.config.spec.ts
import browserSessionConfig from './browser-session.config';

describe('browserSessionConfig', () => {
  it('provides POC defaults', () => {
    const c = browserSessionConfig();
    expect(c.idleMs).toBe(300000);
    expect(c.maxMs).toBe(1200000);
    expect(c.maxConcurrent).toBe(5);
    expect(c.viewportWidth).toBe(1280);
    expect(c.viewportHeight).toBe(800);
    expect(c.screencastQuality).toBe(60);
  });

  it('reads overrides from env', () => {
    process.env.BROWSER_SESSION_MAX_CONCURRENT = '2';
    expect(browserSessionConfig().maxConcurrent).toBe(2);
    delete process.env.BROWSER_SESSION_MAX_CONCURRENT;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd back && npx jest src/config/browser-session.config.spec.ts`
Expected: FAIL — cannot find `./browser-session.config`.

- [ ] **Step 3: Create the config**

```ts
// back/src/config/browser-session.config.ts
import { registerAs } from '@nestjs/config';

export default registerAs('browserSession', () => ({
  idleMs: Number.parseInt(process.env.BROWSER_SESSION_IDLE_MS || '300000', 10),
  maxMs: Number.parseInt(process.env.BROWSER_SESSION_MAX_MS || '1200000', 10),
  maxConcurrent: Number.parseInt(process.env.BROWSER_SESSION_MAX_CONCURRENT || '5', 10),
  viewportWidth: Number.parseInt(process.env.BROWSER_SESSION_VIEWPORT_W || '1280', 10),
  viewportHeight: Number.parseInt(process.env.BROWSER_SESSION_VIEWPORT_H || '800', 10),
  screencastQuality: Number.parseInt(process.env.BROWSER_SESSION_SCREENCAST_QUALITY || '60', 10),
}));
```

- [ ] **Step 4: Add `sequentialDelayMs` to indexing config, remove crawl keys**

In `back/src/config/indexing.config.ts`, delete the five `crawl*` lines and the `DEFAULT_CRAWL_USER_AGENT` export + its doc comment, and add:

```ts
  sequentialDelayMs: Number.parseInt(process.env.INDEXING_SEQUENTIAL_DELAY_MS || '2000', 10),
```

(If `crawlUserAgent`/`DEFAULT_CRAWL_USER_AGENT` are imported elsewhere, those imports are removed in Task 7/8 where the crawler is deleted — leave them until then if the build breaks, but this task only needs the `indexing` object to gain `sequentialDelayMs`.)

- [ ] **Step 5: Run test to verify it passes**

Run: `cd back && npx jest src/config/browser-session.config.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add back/src/config/browser-session.config.ts back/src/config/browser-session.config.spec.ts back/src/config/indexing.config.ts
git commit -m "feat(config): browser-session limits + sequential conversion delay"
```

---

## Task 2: Backend types + DI tokens for the browser-session engine

**Files:**
- Create: `back/src/modules/browser-session/browser-session.types.ts`
- Test: (none — pure type/const declarations; covered by Task 3.)

**Interfaces:**
- Produces:
  - `NavAction = { kind:'goto'; url:string } | { kind:'back' } | { kind:'forward' } | { kind:'reload' }`
  - `InputEvent` (mouse/wheel/key union, see code)
  - `NavigatedEvent = { url: string; title: string }`
  - `EngineSession` interface: `onFrame(cb)`, `onNavigated(cb)`, `dispatchInput(e)`, `navigate(a)`, `currentUrl()`, `close()`
  - `BrowserEngine` interface: `launchSession(startUrl): Promise<EngineSession>`
  - tokens `BROWSER_ENGINE`, `URL_SAFETY`; type `UrlSafetyFn`

- [ ] **Step 1: Create the file**

```ts
// back/src/modules/browser-session/browser-session.types.ts
export type NavAction =
  | { kind: 'goto'; url: string }
  | { kind: 'back' }
  | { kind: 'forward' }
  | { kind: 'reload' };

export type MouseButton = 'left' | 'right' | 'middle';

export type InputEvent =
  | { kind: 'mouse'; type: 'move' | 'down' | 'up'; x: number; y: number; button?: MouseButton }
  | { kind: 'wheel'; x: number; y: number; deltaX: number; deltaY: number }
  | { kind: 'key'; type: 'down' | 'up'; key: string; text?: string };

export interface NavigatedEvent {
  url: string;
  title: string;
}

/** One live browser page, abstracted so the service is testable without Chromium. */
export interface EngineSession {
  onFrame(cb: (jpegBase64: string) => void): void;
  onNavigated(cb: (nav: NavigatedEvent) => void): void;
  dispatchInput(event: InputEvent): Promise<void>;
  navigate(action: NavAction): Promise<void>;
  currentUrl(): string;
  close(): Promise<void>;
}

export interface BrowserEngine {
  launchSession(startUrl: string): Promise<EngineSession>;
}

export const BROWSER_ENGINE = Symbol('BROWSER_ENGINE');

export type UrlSafetyFn = (url: string) => Promise<void>;
export const URL_SAFETY = Symbol('URL_SAFETY');

/** Emitted to the client over the socket. */
export type ClientEvent =
  | { event: 'frame'; payload: { data: string } }
  | { event: 'navigated'; payload: NavigatedEvent }
  | { event: 'blocked'; payload: { url: string; reason: string } }
  | { event: 'closed'; payload: { reason: string } };
```

- [ ] **Step 2: Commit**

```bash
git add back/src/modules/browser-session/browser-session.types.ts
git commit -m "feat(browser-session): shared engine types and DI tokens"
```

---

## Task 3: `BrowserSessionService` core (engine-agnostic, unit-tested with a fake)

**Files:**
- Create: `back/src/modules/browser-session/browser-session.service.ts`
- Test: `back/src/modules/browser-session/browser-session.service.spec.ts`

**Interfaces:**
- Consumes: `BrowserEngine`, `EngineSession`, `NavAction`, `InputEvent`, `URL_SAFETY`/`UrlSafetyFn`, `BROWSER_ENGINE` (Task 2); `browserSessionConfig` (Task 1); `LoggerService`.
- Produces on `BrowserSessionService`:
  - `create(userId: string, startUrl: string, emit: (event: string, payload: unknown) => void): Promise<string>` — returns `sessionId`; throws `Error('BUSY')` over cap, or the SSRF error for an unsafe start URL.
  - `dispatchInput(sessionId: string, event: InputEvent): Promise<void>`
  - `navigate(sessionId: string, action: NavAction): Promise<void>` — `goto` is SSRF-checked before dispatch.
  - `destroy(sessionId: string): Promise<void>`
  - `count(): number`

- [ ] **Step 1: Write the failing tests**

```ts
// back/src/modules/browser-session/browser-session.service.spec.ts
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BrowserSessionService } from './browser-session.service';
import {
  BROWSER_ENGINE, URL_SAFETY, BrowserEngine, EngineSession, InputEvent, NavAction,
} from './browser-session.types';
import { LoggerService } from '../logger';

class FakeSession implements EngineSession {
  frameCb?: (f: string) => void;
  navCb?: (n: { url: string; title: string }) => void;
  closed = false;
  inputs: InputEvent[] = [];
  navs: NavAction[] = [];
  constructor(private url: string) {}
  onFrame(cb: (f: string) => void) { this.frameCb = cb; }
  onNavigated(cb: (n: { url: string; title: string }) => void) { this.navCb = cb; }
  async dispatchInput(e: InputEvent) { this.inputs.push(e); }
  async navigate(a: NavAction) { this.navs.push(a); if (a.kind === 'goto') this.url = a.url; }
  currentUrl() { return this.url; }
  async close() { this.closed = true; }
}

class FakeEngine implements BrowserEngine {
  sessions: FakeSession[] = [];
  async launchSession(startUrl: string) {
    const s = new FakeSession(startUrl);
    this.sessions.push(s);
    return s;
  }
}

const CONFIG = {
  idleMs: 300000, maxMs: 1200000, maxConcurrent: 2,
  viewportWidth: 1280, viewportHeight: 800, screencastQuality: 60,
};

async function build(engine: FakeEngine, safety = async () => {}) {
  const mod = await Test.createTestingModule({
    providers: [
      BrowserSessionService,
      { provide: BROWSER_ENGINE, useValue: engine },
      { provide: URL_SAFETY, useValue: safety },
      { provide: ConfigService, useValue: { get: () => CONFIG } },
      { provide: LoggerService, useValue: { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } },
    ],
  }).compile();
  return mod.get(BrowserSessionService);
}

describe('BrowserSessionService', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('creates a session and relays frames + navigations', async () => {
    const engine = new FakeEngine();
    const svc = await build(engine);
    const events: Array<{ e: string; p: unknown }> = [];
    const id = await svc.create('u1', 'https://ok.example', (e, p) => events.push({ e, p }));
    expect(id).toBeTruthy();
    const s = engine.sessions[0];
    s.frameCb!('BASE64');
    s.navCb!({ url: 'https://ok.example/a', title: 'A' });
    expect(events).toContainEqual({ e: 'frame', p: { data: 'BASE64' } });
    expect(events).toContainEqual({ e: 'navigated', p: { url: 'https://ok.example/a', title: 'A' } });
  });

  it('rejects a session over the concurrency cap', async () => {
    const engine = new FakeEngine();
    const svc = await build(engine);
    await svc.create('u1', 'https://a.example', () => {});
    await svc.create('u2', 'https://b.example', () => {});
    await expect(svc.create('u3', 'https://c.example', () => {})).rejects.toThrow('BUSY');
  });

  it('rejects an unsafe start URL and launches nothing', async () => {
    const engine = new FakeEngine();
    const safety = jest.fn(async (u: string) => { if (u.includes('169.254')) throw new Error('blocked'); });
    const svc = await build(engine, safety);
    await expect(svc.create('u1', 'http://169.254.169.254/', () => {})).rejects.toThrow('blocked');
    expect(engine.sessions).toHaveLength(0);
  });

  it('emits blocked and suppresses navigated for an unsafe navigation', async () => {
    const engine = new FakeEngine();
    const safety = async (u: string) => { if (u.includes('169.254')) throw new Error('blocked'); };
    const svc = await build(engine, safety);
    const events: Array<{ e: string; p: unknown }> = [];
    await svc.create('u1', 'https://ok.example', (e, p) => events.push({ e, p }));
    engine.sessions[0].navCb!({ url: 'http://169.254.169.254/', title: 'meta' });
    await Promise.resolve();
    expect(events.some((x) => x.e === 'blocked')).toBe(true);
    expect(events.some((x) => x.e === 'navigated')).toBe(false);
  });

  it('SSRF-checks goto before dispatching to the engine', async () => {
    const engine = new FakeEngine();
    const safety = async (u: string) => { if (u.includes('169.254')) throw new Error('blocked'); };
    const svc = await build(engine, safety);
    const id = await svc.create('u1', 'https://ok.example', () => {});
    await expect(svc.navigate(id, { kind: 'goto', url: 'http://169.254.169.254/' })).rejects.toThrow('blocked');
    expect(engine.sessions[0].navs).toHaveLength(0);
  });

  it('destroys a session on idle timeout', async () => {
    const engine = new FakeEngine();
    const svc = await build(engine);
    await svc.create('u1', 'https://ok.example', () => {});
    expect(svc.count()).toBe(1);
    jest.advanceTimersByTime(CONFIG.idleMs + 1);
    await Promise.resolve();
    expect(engine.sessions[0].closed).toBe(true);
    expect(svc.count()).toBe(0);
  });

  it('resets the idle timer on input', async () => {
    const engine = new FakeEngine();
    const svc = await build(engine);
    const id = await svc.create('u1', 'https://ok.example', () => {});
    jest.advanceTimersByTime(CONFIG.idleMs - 1000);
    await svc.dispatchInput(id, { kind: 'mouse', type: 'move', x: 1, y: 1 });
    jest.advanceTimersByTime(2000); // would have fired without the reset
    expect(svc.count()).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd back && npx jest src/modules/browser-session/browser-session.service.spec.ts`
Expected: FAIL — cannot find `./browser-session.service`.

- [ ] **Step 3: Implement the service**

```ts
// back/src/modules/browser-session/browser-session.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { LoggerService } from '../logger';
import {
  BROWSER_ENGINE, URL_SAFETY, BrowserEngine, EngineSession,
  InputEvent, NavAction, UrlSafetyFn,
} from './browser-session.types';

interface ManagedSession {
  id: string;
  userId: string;
  engine: EngineSession;
  emit: (event: string, payload: unknown) => void;
  idleTimer: NodeJS.Timeout;
  maxTimer: NodeJS.Timeout;
}

interface BrowserSessionConfig {
  idleMs: number;
  maxMs: number;
  maxConcurrent: number;
}

@Injectable()
export class BrowserSessionService {
  private readonly sessions = new Map<string, ManagedSession>();
  private readonly cfg: BrowserSessionConfig;

  constructor(
    @Inject(BROWSER_ENGINE) private readonly engine: BrowserEngine,
    @Inject(URL_SAFETY) private readonly assertSafe: UrlSafetyFn,
    config: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(BrowserSessionService.name);
    this.cfg = config.get('browserSession') as BrowserSessionConfig;
  }

  count(): number {
    return this.sessions.size;
  }

  async create(
    userId: string,
    startUrl: string,
    emit: (event: string, payload: unknown) => void,
  ): Promise<string> {
    if (this.sessions.size >= this.cfg.maxConcurrent) {
      throw new Error('BUSY');
    }
    await this.assertSafe(startUrl); // throws on unsafe → nothing launched

    const engineSession = await this.engine.launchSession(startUrl);
    const id = randomUUID();
    const managed: ManagedSession = {
      id,
      userId,
      engine: engineSession,
      emit,
      idleTimer: this.armIdle(id),
      maxTimer: setTimeout(() => void this.destroy(id, 'max-lifetime'), this.cfg.maxMs),
    };
    this.sessions.set(id, managed);

    engineSession.onFrame((data) => {
      this.touch(id);
      emit('frame', { data });
    });
    engineSession.onNavigated((nav) => {
      void this.assertSafe(nav.url).then(
        () => emit('navigated', nav),
        () => emit('blocked', { url: nav.url, reason: 'private/internal address blocked' }),
      );
    });

    this.logger.debug('Browser session created', { id, userId });
    return id;
  }

  async dispatchInput(sessionId: string, event: InputEvent): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    this.touch(sessionId);
    await s.engine.dispatchInput(event);
  }

  async navigate(sessionId: string, action: NavAction): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    this.touch(sessionId);
    if (action.kind === 'goto') {
      await this.assertSafe(action.url); // throws → caller surfaces error, engine untouched
    }
    await s.engine.navigate(action);
  }

  async destroy(sessionId: string, reason = 'closed'): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    clearTimeout(s.idleTimer);
    clearTimeout(s.maxTimer);
    this.sessions.delete(sessionId);
    try {
      await s.engine.close();
    } catch (e) {
      this.logger.warn('engine close failed', { id: sessionId, error: (e as Error).message });
    }
    s.emit('closed', { reason });
    this.logger.debug('Browser session destroyed', { id: sessionId, reason });
  }

  private touch(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    clearTimeout(s.idleTimer);
    s.idleTimer = this.armIdle(sessionId);
  }

  private armIdle(sessionId: string): NodeJS.Timeout {
    return setTimeout(() => void this.destroy(sessionId, 'idle-timeout'), this.cfg.idleMs);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd back && npx jest src/modules/browser-session/browser-session.service.spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add back/src/modules/browser-session/browser-session.service.ts back/src/modules/browser-session/browser-session.service.spec.ts
git commit -m "feat(browser-session): engine-agnostic session service with SSRF guard + lifecycle"
```

---

## Task 4: `PlaywrightBrowserEngine` — the real CDP adapter

**Files:**
- Create: `back/src/modules/browser-session/playwright-browser-engine.ts`
- Test: `back/src/modules/browser-session/playwright-browser-engine.spec.ts`
- Modify: `back/package.json` (add `playwright`)

**Interfaces:**
- Consumes: `BrowserEngine`, `EngineSession`, `InputEvent`, `NavAction` (Task 2); `browserSession` config (Task 1); `URL_SAFETY` (for route interception); `LoggerService`.
- Produces: `PlaywrightBrowserEngine implements BrowserEngine`; exported pure helper `isNavigationRequestBlocked(assertSafe, resourceType, url): Promise<boolean>` for unit testing the SSRF route predicate without a browser.

- [ ] **Step 1: Add Playwright dependency**

Run: `cd back && npm install playwright@^1.48.0`
Then document the image step (applied in Task 12 verification / ops): the backend Docker build must run `npx playwright install --with-deps chromium`.

- [ ] **Step 2: Write the failing test (pure SSRF route predicate)**

```ts
// back/src/modules/browser-session/playwright-browser-engine.spec.ts
import { isNavigationRequestBlocked } from './playwright-browser-engine';

describe('isNavigationRequestBlocked', () => {
  const safe = async (u: string) => { if (u.includes('169.254')) throw new Error('blocked'); };

  it('blocks a document navigation to an unsafe host', async () => {
    expect(await isNavigationRequestBlocked(safe, 'document', 'http://169.254.169.254/')).toBe(true);
  });

  it('allows a document navigation to a safe host', async () => {
    expect(await isNavigationRequestBlocked(safe, 'document', 'https://example.com/')).toBe(false);
  });

  it('does not block sub-resources (only main-frame documents are checked)', async () => {
    expect(await isNavigationRequestBlocked(safe, 'image', 'http://169.254.169.254/x.png')).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd back && npx jest src/modules/browser-session/playwright-browser-engine.spec.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 4: Implement the engine**

```ts
// back/src/modules/browser-session/playwright-browser-engine.ts
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Browser, BrowserContext, CDPSession, Page, chromium,
} from 'playwright';
import { LoggerService } from '../logger';
import {
  BrowserEngine, EngineSession, InputEvent, NavAction, NavigatedEvent,
  URL_SAFETY, UrlSafetyFn,
} from './browser-session.types';

/**
 * Route predicate: block a top-level document navigation whose URL is unsafe.
 * Only `document` requests are checked — sub-resources ride the main frame's
 * already-validated origin, and DNS-checking every asset would be prohibitive.
 */
export async function isNavigationRequestBlocked(
  assertSafe: UrlSafetyFn,
  resourceType: string,
  url: string,
): Promise<boolean> {
  if (resourceType !== 'document') return false;
  try {
    await assertSafe(url);
    return false;
  } catch {
    return true;
  }
}

const KEY_TO_BUTTON = { left: 'left', right: 'right', middle: 'middle' } as const;

class PlaywrightSession implements EngineSession {
  private frameCb?: (f: string) => void;
  private navCb?: (n: NavigatedEvent) => void;

  constructor(
    private readonly context: BrowserContext,
    private readonly page: Page,
    private readonly cdp: CDPSession,
  ) {
    this.cdp.on('Page.screencastFrame', async (evt: { data: string; sessionId: number }) => {
      this.frameCb?.(evt.data);
      try {
        await this.cdp.send('Page.screencastFrameAck', { sessionId: evt.sessionId });
      } catch { /* session may be closing */ }
    });
    this.page.on('framenavigated', async (frame) => {
      if (frame !== this.page.mainFrame()) return; // main frame only
      this.navCb?.({ url: frame.url(), title: await this.page.title().catch(() => '') });
    });
  }

  onFrame(cb: (f: string) => void) { this.frameCb = cb; }
  onNavigated(cb: (n: NavigatedEvent) => void) { this.navCb = cb; }

  async dispatchInput(e: InputEvent): Promise<void> {
    if (e.kind === 'mouse') {
      if (e.type === 'move') await this.page.mouse.move(e.x, e.y);
      else if (e.type === 'down') await this.page.mouse.down({ button: KEY_TO_BUTTON[e.button ?? 'left'] });
      else await this.page.mouse.up({ button: KEY_TO_BUTTON[e.button ?? 'left'] });
    } else if (e.kind === 'wheel') {
      await this.page.mouse.move(e.x, e.y);
      await this.page.mouse.wheel(e.deltaX, e.deltaY);
    } else {
      if (e.type === 'down') {
        if (e.text) await this.page.keyboard.type(e.text);
        else await this.page.keyboard.down(e.key);
      } else if (!e.text) {
        await this.page.keyboard.up(e.key);
      }
    }
  }

  async navigate(a: NavAction): Promise<void> {
    if (a.kind === 'goto') await this.page.goto(a.url, { waitUntil: 'domcontentloaded' }).catch(() => {});
    else if (a.kind === 'back') await this.page.goBack().catch(() => {});
    else if (a.kind === 'forward') await this.page.goForward().catch(() => {});
    else await this.page.reload().catch(() => {});
  }

  currentUrl(): string { return this.page.url(); }

  async close(): Promise<void> {
    await this.context.close().catch(() => {});
  }
}

@Injectable()
export class PlaywrightBrowserEngine implements BrowserEngine {
  private browser: Browser | null = null;
  private readonly width: number;
  private readonly height: number;
  private readonly quality: number;

  constructor(
    config: ConfigService,
    @Inject(URL_SAFETY) private readonly assertSafe: UrlSafetyFn,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(PlaywrightBrowserEngine.name);
    const c = config.get('browserSession') as {
      viewportWidth: number; viewportHeight: number; screencastQuality: number;
    };
    this.width = c.viewportWidth;
    this.height = c.viewportHeight;
    this.quality = c.screencastQuality;
  }

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser && this.browser.isConnected()) return this.browser;
    this.browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    return this.browser;
  }

  async launchSession(startUrl: string): Promise<EngineSession> {
    const browser = await this.ensureBrowser();
    const context = await browser.newContext({ viewport: { width: this.width, height: this.height } });
    const page = await context.newPage();

    // SSRF: abort any top-level document navigation to a disallowed host.
    await page.route('**/*', async (route, request) => {
      if (await isNavigationRequestBlocked(this.assertSafe, request.resourceType(), request.url())) {
        await route.abort('blockedbyclient');
        return;
      }
      await route.continue();
    });

    const cdp = await context.newCDPSession(page);
    const session = new PlaywrightSession(context, page, cdp);

    await page.goto(startUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await cdp.send('Page.startScreencast', {
      format: 'jpeg', quality: this.quality,
      maxWidth: this.width, maxHeight: this.height, everyNthFrame: 1,
    });
    return session;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd back && npx jest src/modules/browser-session/playwright-browser-engine.spec.ts`
Expected: PASS (3 tests). (No real browser is launched — only the pure predicate is tested.)

- [ ] **Step 6: Commit**

```bash
git add back/src/modules/browser-session/playwright-browser-engine.ts back/src/modules/browser-session/playwright-browser-engine.spec.ts back/package.json back/package-lock.json
git commit -m "feat(browser-session): Playwright CDP engine with screencast + SSRF route guard"
```

---

## Task 5: `BrowserSessionGateway` (socket.io) + module wiring

**Files:**
- Create: `back/src/modules/browser-session/browser-session.gateway.ts`
- Create: `back/src/modules/browser-session/browser-session.module.ts`
- Test: `back/src/modules/browser-session/browser-session.gateway.spec.ts`
- Modify: root module registration (register `BrowserSessionModule` + `browserSessionConfig`).

**Interfaces:**
- Consumes: `BrowserSessionService` (Task 3), `PlaywrightBrowserEngine` (Task 4), `assertUrlIsSafe` from `../workspace/services/url-safety`, `BROWSER_ENGINE`/`URL_SAFETY` tokens, `JwtService`, `ConfigService`, `LoggerService`.
- Produces: gateway namespace `/browser-session`; messages `start`({url}) → ack `{ok, sessionId}|{ok:false, error}`, `input`({event}), `navigate`({action}); frames/nav/blocked/closed emitted to the client socket. `BrowserSessionModule` exported.

- [ ] **Step 1: Write the failing test**

```ts
// back/src/modules/browser-session/browser-session.gateway.spec.ts
import { BrowserSessionGateway } from './browser-session.gateway';

function fakeClient(userId?: string) {
  const emitted: Array<{ e: string; p: unknown }> = [];
  return {
    id: 'sock1',
    data: { userId } as { userId?: string; sessionId?: string },
    handshake: { auth: { token: userId ? 'tok' : undefined }, headers: {} },
    emit: (e: string, p: unknown) => emitted.push({ e, p }),
    disconnect: jest.fn(),
    emitted,
  };
}

describe('BrowserSessionGateway', () => {
  let svc: { create: jest.Mock; dispatchInput: jest.Mock; navigate: jest.Mock; destroy: jest.Mock };
  let gw: BrowserSessionGateway;

  beforeEach(() => {
    svc = {
      create: jest.fn().mockResolvedValue('sess1'),
      dispatchInput: jest.fn().mockResolvedValue(undefined),
      navigate: jest.fn().mockResolvedValue(undefined),
      destroy: jest.fn().mockResolvedValue(undefined),
    };
    const jwt = { verifyAsync: jest.fn().mockResolvedValue({ sub: 'u1' }) };
    const config = { get: jest.fn() };
    const logger = { setContext: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn(), log: jest.fn() };
    gw = new BrowserSessionGateway(svc as never, jwt as never, config as never, logger as never);
  });

  it('creates a session on start and returns the id', async () => {
    const client = fakeClient('u1');
    const ack = await gw.handleStart(client as never, { url: 'https://ok.example' });
    expect(svc.create).toHaveBeenCalledWith('u1', 'https://ok.example', expect.any(Function));
    expect(ack).toEqual({ ok: true, sessionId: 'sess1' });
    expect(client.data.sessionId).toBe('sess1');
  });

  it('returns busy when the service is over capacity', async () => {
    svc.create.mockRejectedValue(new Error('BUSY'));
    const client = fakeClient('u1');
    const ack = await gw.handleStart(client as never, { url: 'https://ok.example' });
    expect(ack).toEqual({ ok: false, error: 'BUSY' });
  });

  it('forwards input to the bound session', async () => {
    const client = fakeClient('u1');
    await gw.handleStart(client as never, { url: 'https://ok.example' });
    await gw.handleInput(client as never, { event: { kind: 'mouse', type: 'down', x: 5, y: 6 } });
    expect(svc.dispatchInput).toHaveBeenCalledWith('sess1', { kind: 'mouse', type: 'down', x: 5, y: 6 });
  });

  it('destroys the session on disconnect', () => {
    const client = fakeClient('u1');
    client.data.sessionId = 'sess1';
    gw.handleDisconnect(client as never);
    expect(svc.destroy).toHaveBeenCalledWith('sess1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd back && npx jest src/modules/browser-session/browser-session.gateway.spec.ts`
Expected: FAIL — cannot find `./browser-session.gateway`.

- [ ] **Step 3: Implement the gateway**

```ts
// back/src/modules/browser-session/browser-session.gateway.ts
import {
  ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect,
  SubscribeMessage, WebSocketGateway,
} from '@nestjs/websockets';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';
import { LoggerService } from '../logger';
import { BrowserSessionService } from './browser-session.service';
import { InputEvent, NavAction } from './browser-session.types';

interface AuthedSocket extends Socket {
  data: { userId?: string; sessionId?: string };
}

@WebSocketGateway({ namespace: '/browser-session', cors: { origin: true, credentials: true } })
@Injectable()
export class BrowserSessionGateway implements OnGatewayConnection, OnGatewayDisconnect {
  constructor(
    private readonly sessions: BrowserSessionService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(BrowserSessionGateway.name);
  }

  async handleConnection(client: AuthedSocket): Promise<void> {
    const token = this.extractToken(client);
    if (!token) { client.disconnect(true); return; }
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string }>(token, {
        secret: this.config.get<string>('jwt.secret'),
        issuer: this.config.get<string>('jwt.issuer'),
        audience: this.config.get<string>('jwt.audience'),
      });
      client.data.userId = payload.sub;
    } catch (e) {
      this.logger.warn('browser-session auth failed', { error: (e as Error).message });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: AuthedSocket): void {
    if (client.data.sessionId) void this.sessions.destroy(client.data.sessionId);
  }

  @SubscribeMessage('start')
  async handleStart(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { url: string },
  ): Promise<{ ok: true; sessionId: string } | { ok: false; error: string }> {
    const userId = client.data.userId;
    if (!userId || !body?.url) return { ok: false, error: 'BAD_REQUEST' };
    try {
      const sessionId = await this.sessions.create(userId, body.url, (event, payload) => {
        client.emit(event, payload);
      });
      client.data.sessionId = sessionId;
      return { ok: true, sessionId };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  @SubscribeMessage('input')
  async handleInput(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { event: InputEvent },
  ): Promise<void> {
    if (client.data.sessionId) await this.sessions.dispatchInput(client.data.sessionId, body.event);
  }

  @SubscribeMessage('navigate')
  async handleNavigate(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { action: NavAction },
  ): Promise<{ ok: boolean; error?: string }> {
    if (!client.data.sessionId) return { ok: false, error: 'NO_SESSION' };
    try {
      await this.sessions.navigate(client.data.sessionId, body.action);
      return { ok: true };
    } catch (e) {
      client.emit('blocked', { url: body.action.kind === 'goto' ? body.action.url : '', reason: (e as Error).message });
      return { ok: false, error: (e as Error).message };
    }
  }

  private extractToken(client: Socket): string | undefined {
    const authToken = client.handshake.auth?.token;
    if (typeof authToken === 'string' && authToken.length > 0) return authToken;
    const header = client.handshake.headers.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) return header.slice(7);
    return undefined;
  }
}
```

- [ ] **Step 4: Implement the module**

```ts
// back/src/modules/browser-session/browser-session.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import browserSessionConfig from '../../config/browser-session.config';
import { AuthModule } from '../auth/auth.module';
import { LoggerModule } from '../logger';
import { assertUrlIsSafe } from '../workspace/services/url-safety';
import { BrowserSessionService } from './browser-session.service';
import { BrowserSessionGateway } from './browser-session.gateway';
import { PlaywrightBrowserEngine } from './playwright-browser-engine';
import { BROWSER_ENGINE, URL_SAFETY } from './browser-session.types';

@Module({
  imports: [ConfigModule.forFeature(browserSessionConfig), AuthModule, LoggerModule],
  providers: [
    BrowserSessionService,
    BrowserSessionGateway,
    PlaywrightBrowserEngine,
    { provide: BROWSER_ENGINE, useExisting: PlaywrightBrowserEngine },
    { provide: URL_SAFETY, useValue: assertUrlIsSafe },
  ],
})
export class BrowserSessionModule {}
```

- [ ] **Step 5: Register the module at the app root**

Find the root module that imports feature modules (e.g. `back/src/app.module.ts`) and add `BrowserSessionModule` to its `imports`, and add `browserSessionConfig` to the `ConfigModule.forRoot({ load: [...] })` list if that repo pattern loads configs centrally. Run `cd back && npx tsc --noEmit` and fix any wiring errors.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd back && npx jest src/modules/browser-session/browser-session.gateway.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add back/src/modules/browser-session/browser-session.gateway.ts back/src/modules/browser-session/browser-session.module.ts back/src/modules/browser-session/browser-session.gateway.spec.ts back/src/app.module.ts
git commit -m "feat(browser-session): socket.io gateway + module wiring"
```

---

## Task 6: `addLinks` → strictly sequential with delay

**Files:**
- Modify: `back/src/modules/workspace/workspace-document.service.ts:741-758`
- Test: `back/src/modules/workspace/workspace-document.service.spec.ts` (add a describe block)

**Interfaces:**
- Consumes: `indexing.sequentialDelayMs` (Task 1); existing `convertAndStore` (unchanged).
- Produces: `addLinks` converts one URL at a time, awaiting `sequentialDelayMs` between items; a failed item does not stop the rest.

- [ ] **Step 1: Write the failing test**

Add to `workspace-document.service.spec.ts` a new describe that builds the service with a stubbed `urlToPdfClient` and asserts sequential ordering. Because `convertAndStore` is private and fire-and-forget, test through the public `addLinks` and assert the conversion client is called once per URL, in order. Use a manual mock that records call order:

```ts
describe('WorkspaceDocumentService.addLinks sequencing', () => {
  it('converts URLs strictly one at a time', async () => {
    const order: string[] = [];
    const convert = jest.fn(async (url: string) => { order.push(url); return Buffer.from('pdf'); });
    // Build svc with: documentModel.create → returns { _id, ... }, mapToResponse-friendly doc;
    // workspaceService quota/context/usage stubs; urlToPdfClient: { convert };
    // documentService.upload → { storedName, blobPath, url, contentHash };
    // indexingService.queueDocument → resolves; configService.get('indexing') → { sequentialDelayMs: 0 }.
    // (Mirror the providers block from the existing 'upload validation' describe, adding urlToPdfClient + indexingService.)
    // ...build svc...
    // await svc.addLinks(WS_ID, USER_ID, ['https://a.example', 'https://b.example']);
    // Because conversion is fire-and-forget, await a microtask/timer flush before asserting:
    // await new Promise((r) => setTimeout(r, 0));
    expect(order).toEqual(['https://a.example', 'https://b.example']);
    expect(convert).toHaveBeenCalledTimes(2);
  });
});
```

Flesh out the providers block by copying the `upload validation` describe's providers and adding:
`{ provide: UrlToPdfClientService, useValue: { convert } }`,
`{ provide: IndexingService, useValue: { queueDocument: jest.fn().mockResolvedValue(undefined), sendIndexingStatusNotification: jest.fn() } }`,
and a `ConfigService` whose `get('indexing')` returns `{ sequentialDelayMs: 0 }`. Make `documentModel.create` return an object with `_id` (ObjectId), `toString`, and the fields `mapToResponse` reads; and `findByIdAndUpdate` a `jest.fn().mockResolvedValue({})`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd back && npx jest workspace-document.service.spec.ts -t "one at a time"`
Expected: FAIL — current fan-out may interleave, or (more likely) the test fails to compile until the delay config is read. Confirm red before proceeding.

- [ ] **Step 3: Replace the conversion loop**

In `workspace-document.service.ts`, replace lines 741-756 (the `CONCURRENCY`/`workers`/`Promise.all` block) with:

```ts
    // Convert strictly one at a time, spaced by a delay, so a rate-limited target
    // (HTTP 429) gets its window to reset between pages instead of being hit in a
    // burst. Fire-and-forget the whole loop; respond as soon as the docs exist.
    const delayMs = this.configService.get<number>('indexing.sequentialDelayMs') ?? 2000;
    void (async () => {
      for (let idx = 0; idx < created.length; idx++) {
        const item = created[idx];
        await this.convertAndStore(item.id, workspaceId, item.url, item.name).catch((err) => {
          this.logger.error('convertAndStore failed', {
            documentId: item.id,
            error: err instanceof Error ? err.message : 'Unknown error',
          });
        });
        if (idx < created.length - 1 && delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    })();
```

Confirm `this.configService` is the injected `ConfigService` field name used elsewhere in this file (it is used in the constructor); if the field is named differently, match it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd back && npx jest workspace-document.service.spec.ts`
Expected: PASS (existing + new).

- [ ] **Step 5: Commit**

```bash
git add back/src/modules/workspace/workspace-document.service.ts back/src/modules/workspace/workspace-document.service.spec.ts
git commit -m "feat(workspace): convert added links strictly sequentially with a delay"
```

---

## Task 7: Remove the crawler + page-tree (backend)

**Files:**
- Delete: `back/src/modules/workspace/services/website-crawler.service.ts` (+ `.spec.ts`), `back/src/modules/workspace/services/page-tree.ts` (+ `.spec.ts`), `back/src/modules/workspace/dto/crawl-url.dto.ts`.
- Modify: `workspace-document.controller.ts` (remove `crawl` endpoint + `CrawlUrlDto` import), `workspace-document.service.ts` (remove `crawlSite` + crawler/page-tree imports), `workspace.module.ts` (remove `WebsiteCrawlerService`).

**Interfaces:**
- Produces: no `crawl` endpoint, no `crawlSite`, no crawler service. Build stays green.

- [ ] **Step 1: Delete the files**

```bash
cd back
rm src/modules/workspace/services/website-crawler.service.ts src/modules/workspace/services/website-crawler.service.spec.ts
rm src/modules/workspace/services/page-tree.ts src/modules/workspace/services/page-tree.spec.ts
rm src/modules/workspace/dto/crawl-url.dto.ts
```

(If any `.spec.ts` path differs, `git status` will show it — remove the matching one.)

- [ ] **Step 2: Strip references**

- In `workspace-document.controller.ts`: delete the `@Post('crawl')` method (lines ~132-146) and the `import { CrawlUrlDto }` line (~48).
- In `workspace-document.service.ts`: delete `import { WebsiteCrawlerService }` (line 57) and `import { buildPageTree, PageNode }` (line 58), the constructor injection of `WebsiteCrawlerService`, and the `crawlSite` method (lines ~949-…). Also remove any now-unused `crawlUserAgent`/crawler config reads.
- In `workspace.module.ts`: delete the `WebsiteCrawlerService` import (line 37) and its entry in `providers` (line 94).

- [ ] **Step 3: Typecheck + test**

Run: `cd back && npx tsc --noEmit && npx jest src/modules/workspace`
Expected: PASS, no references to deleted symbols.

- [ ] **Step 4: Commit**

```bash
git add -A back/src/modules/workspace
git commit -m "refactor(workspace): remove crawler + page-tree in favor of interactive browsing"
```

---

## Task 8: Frontend types + api cleanup

**Files:**
- Modify: `front/src/modules/workspace/types.ts` (remove `PageNode`, `CrawlResponse`; add `sourceUrl?`/`type?` to `WorkspaceDocument`).
- Modify: `front/src/modules/workspace/api.ts` (remove `crawlUrl`).
- Modify: `front/src/modules/workspace/store.ts` (remove crawl usages if any; keep `addPageLinks`).

**Interfaces:**
- Produces: `WorkspaceDocument.sourceUrl?: string`, `WorkspaceDocument.type?: 'url' | 'doc'`. `addLinks` unchanged. No `crawlUrl`/`PageNode`/`CrawlResponse`.

- [ ] **Step 1: Update types**

In `front/src/modules/workspace/types.ts`, add to `WorkspaceDocument` (after `metadata?`):

```ts
  type?: 'url' | 'doc';
  sourceUrl?: string;
```

Remove the `PageNode` and `CrawlResponse` interfaces (search the file; they were added for the crawl feature).

- [ ] **Step 2: Remove `crawlUrl` from api.ts**

Delete the `crawlUrl` function (lines ~778-787) and the `API_ENDPOINTS.workspaceDocuments.crawl` entry it references (in the endpoints config file). Leave `validateUrl`, `addLink`, `addLinks`.

- [ ] **Step 3: Typecheck**

Run: `cd front && npx tsc --noEmit`
Expected: errors only from files still importing the removed symbols (`AddLinkDialog`, `PageTree`) — those are handled in Tasks 9-12. Note them and continue.

- [ ] **Step 4: Commit**

```bash
git add front/src/modules/workspace/types.ts front/src/modules/workspace/api.ts
git commit -m "chore(workspace): expose doc type/sourceUrl, drop crawl api + types"
```

---

## Task 9: `useBrowserSession` hook

**Files:**
- Create: `front/src/modules/workspace/hooks/useBrowserSession.ts`
- Test: `front/src/modules/workspace/hooks/useBrowserSession.test.ts`

**Interfaces:**
- Produces:
  - Constants `VIEWPORT_W = 1280`, `VIEWPORT_H = 800` (exported).
  - `normalizeUrl(url: string): string` (exported; strips hash, lowercases host, drops trailing slash).
  - types `CollectedPage = { url: string; title: string }`, `InputEvent`, `NavAction` (mirror backend).
  - `useBrowserSession(): { status, frame, currentUrl, pages, blockedNotice, start(url), sendInput(e), navigate(a), stop() }`.
- Consumes: `socket.io-client`, `getSocketBaseUrl`, `AUTH_STORAGE_KEYS` from `@/lib/api/config`.

- [ ] **Step 1: Write the failing test**

```ts
// front/src/modules/workspace/hooks/useBrowserSession.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const handlers: Record<string, (p: unknown) => void> = {};
const emit = vi.fn((event: string, payload: unknown, ack?: (r: unknown) => void) => {
  if (event === 'start' && ack) ack({ ok: true, sessionId: 's1' });
});
vi.mock('socket.io-client', () => ({
  io: () => ({
    on: (e: string, cb: (p: unknown) => void) => { handlers[e] = cb; },
    off: vi.fn(),
    emit,
    disconnect: vi.fn(),
  }),
}));
vi.mock('@/lib/api/config', () => ({
  getSocketBaseUrl: () => 'http://x',
  AUTH_STORAGE_KEYS: { accessToken: 'at' },
}));

import { useBrowserSession, normalizeUrl } from './useBrowserSession';

beforeEach(() => { localStorage.setItem('at', 'tok'); emit.mockClear(); });

describe('normalizeUrl', () => {
  it('strips hash and trailing slash and lowercases host', () => {
    expect(normalizeUrl('https://Ex.com/a/#x')).toBe('https://ex.com/a');
    expect(normalizeUrl('https://ex.com/')).toBe('https://ex.com');
  });
});

describe('useBrowserSession', () => {
  it('starts a session and paints frames', async () => {
    const { result } = renderHook(() => useBrowserSession());
    act(() => { result.current.start('https://ok.example'); });
    await waitFor(() => expect(result.current.status).toBe('live'));
    act(() => { handlers['frame']({ data: 'B64' }); });
    expect(result.current.frame).toBe('data:image/jpeg;base64,B64');
  });

  it('collects navigations deduped by normalized url', async () => {
    const { result } = renderHook(() => useBrowserSession());
    act(() => { result.current.start('https://ok.example'); });
    await waitFor(() => expect(result.current.status).toBe('live'));
    act(() => {
      handlers['navigated']({ url: 'https://ok.example/a', title: 'A' });
      handlers['navigated']({ url: 'https://ok.example/a/#frag', title: 'A' });
      handlers['navigated']({ url: 'https://ok.example/b', title: 'B' });
    });
    expect(result.current.pages.map((p) => p.title)).toEqual(['A', 'B']);
  });

  it('surfaces a blocked notice', async () => {
    const { result } = renderHook(() => useBrowserSession());
    act(() => { result.current.start('https://ok.example'); });
    await waitFor(() => expect(result.current.status).toBe('live'));
    act(() => { handlers['blocked']({ url: 'http://169.254.169.254/', reason: 'blocked' }); });
    expect(result.current.blockedNotice).toContain('169.254');
  });

  it('reports busy when start is rejected', async () => {
    emit.mockImplementationOnce((_e, _p, ack?: (r: unknown) => void) => ack?.({ ok: false, error: 'BUSY' }));
    const { result } = renderHook(() => useBrowserSession());
    act(() => { result.current.start('https://ok.example'); });
    await waitFor(() => expect(result.current.status).toBe('busy'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd front && npx vitest run src/modules/workspace/hooks/useBrowserSession.test.ts`
Expected: FAIL — cannot find `./useBrowserSession`.

- [ ] **Step 3: Implement the hook**

```ts
// front/src/modules/workspace/hooks/useBrowserSession.ts
import { useCallback, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { AUTH_STORAGE_KEYS, getSocketBaseUrl } from '@/lib/api/config';

export const VIEWPORT_W = 1280;
export const VIEWPORT_H = 800;

export type MouseButton = 'left' | 'right' | 'middle';
export type InputEvent =
  | { kind: 'mouse'; type: 'move' | 'down' | 'up'; x: number; y: number; button?: MouseButton }
  | { kind: 'wheel'; x: number; y: number; deltaX: number; deltaY: number }
  | { kind: 'key'; type: 'down' | 'up'; key: string; text?: string };
export type NavAction =
  | { kind: 'goto'; url: string } | { kind: 'back' } | { kind: 'forward' } | { kind: 'reload' };

export interface CollectedPage { url: string; title: string; }
export type BrowserSessionStatus = 'idle' | 'connecting' | 'live' | 'busy' | 'error';

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    let s = u.toString();
    if (s.endsWith('/')) s = s.slice(0, -1);
    return s;
  } catch {
    return url;
  }
}

export function useBrowserSession() {
  const socketRef = useRef<Socket | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const [status, setStatus] = useState<BrowserSessionStatus>('idle');
  const [frame, setFrame] = useState<string | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [pages, setPages] = useState<CollectedPage[]>([]);
  const [blockedNotice, setBlockedNotice] = useState<string | null>(null);

  const start = useCallback((url: string) => {
    const token = localStorage.getItem(AUTH_STORAGE_KEYS.accessToken);
    if (!token) { setStatus('error'); return; }
    setStatus('connecting');
    seenRef.current = new Set();
    setPages([]); setFrame(null); setBlockedNotice(null); setCurrentUrl(url);

    const socket = io(`${getSocketBaseUrl()}/browser-session`, {
      auth: { token }, transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('start', { url }, (res: { ok: boolean; sessionId?: string; error?: string }) => {
        if (res.ok) setStatus('live');
        else setStatus(res.error === 'BUSY' ? 'busy' : 'error');
      });
    });
    socket.on('frame', (p: { data: string }) => setFrame(`data:image/jpeg;base64,${p.data}`));
    socket.on('navigated', (p: CollectedPage) => {
      setCurrentUrl(p.url);
      const key = normalizeUrl(p.url);
      if (seenRef.current.has(key)) return;
      seenRef.current.add(key);
      setPages((prev) => [...prev, { url: p.url, title: p.title || p.url }]);
    });
    socket.on('blocked', (p: { url: string; reason: string }) =>
      setBlockedNotice(`Navigation bloquée (${p.url}) : ${p.reason}`));
    socket.on('closed', () => setStatus('idle'));
    socket.on('disconnect', () => setStatus('idle'));
  }, []);

  const sendInput = useCallback((event: InputEvent) => {
    socketRef.current?.emit('input', { event });
  }, []);
  const navigate = useCallback((action: NavAction) => {
    socketRef.current?.emit('navigate', { action });
  }, []);
  const stop = useCallback(() => {
    socketRef.current?.disconnect();
    socketRef.current = null;
    setStatus('idle');
  }, []);

  return { status, frame, currentUrl, pages, blockedNotice, start, sendInput, navigate, stop };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd front && npx vitest run src/modules/workspace/hooks/useBrowserSession.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add front/src/modules/workspace/hooks/useBrowserSession.ts front/src/modules/workspace/hooks/useBrowserSession.test.ts
git commit -m "feat(workspace): useBrowserSession socket hook with dedup + blocked notice"
```

---

## Task 10: `BrowserSessionViewer` (canvas + input mapping)

**Files:**
- Create: `front/src/modules/workspace/components/BrowserSessionViewer.tsx`
- Test: `front/src/modules/workspace/components/BrowserSessionViewer.test.tsx`

**Interfaces:**
- Consumes: `VIEWPORT_W`, `VIEWPORT_H`, `InputEvent` (Task 9); exported pure `toViewportCoords(clientX, clientY, rect, w, h)`.
- Produces: `BrowserSessionViewer({ frame, onInput }: { frame: string | null; onInput: (e: InputEvent) => void })`.

- [ ] **Step 1: Write the failing test (pure coordinate mapping)**

```tsx
// front/src/modules/workspace/components/BrowserSessionViewer.test.tsx
import { describe, it, expect } from 'vitest';
import { toViewportCoords } from './BrowserSessionViewer';

describe('toViewportCoords', () => {
  it('maps a canvas-relative click to viewport pixels', () => {
    const rect = { left: 0, top: 0, width: 640, height: 400 } as DOMRect;
    // canvas is half the viewport size → click at (320,200) → (640,400)
    expect(toViewportCoords(320, 200, rect, 1280, 800)).toEqual({ x: 640, y: 400 });
  });

  it('accounts for a non-zero canvas offset', () => {
    const rect = { left: 100, top: 50, width: 1280, height: 800 } as DOMRect;
    expect(toViewportCoords(100, 50, rect, 1280, 800)).toEqual({ x: 0, y: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd front && npx vitest run src/modules/workspace/components/BrowserSessionViewer.test.tsx`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement the viewer**

```tsx
// front/src/modules/workspace/components/BrowserSessionViewer.tsx
import { useEffect, useRef } from 'react';
import { VIEWPORT_W, VIEWPORT_H, type InputEvent, type MouseButton } from '../hooks/useBrowserSession';

export function toViewportCoords(
  clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number },
  w: number, h: number,
): { x: number; y: number } {
  const x = ((clientX - rect.left) / rect.width) * w;
  const y = ((clientY - rect.top) / rect.height) * h;
  return { x: Math.round(x), y: Math.round(y) };
}

const BTN: Record<number, MouseButton> = { 0: 'left', 1: 'middle', 2: 'right' };

export function BrowserSessionViewer({
  frame, onInput,
}: { frame: string | null; onInput: (e: InputEvent) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!frame || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, VIEWPORT_W, VIEWPORT_H);
    img.src = frame;
  }, [frame]);

  const coordsFrom = (e: React.MouseEvent) =>
    toViewportCoords(e.clientX, e.clientY, canvasRef.current!.getBoundingClientRect(), VIEWPORT_W, VIEWPORT_H);

  return (
    <canvas
      ref={canvasRef}
      width={VIEWPORT_W}
      height={VIEWPORT_H}
      tabIndex={0}
      className='h-full w-full bg-white outline-none'
      onMouseMove={(e) => { const { x, y } = coordsFrom(e); onInput({ kind: 'mouse', type: 'move', x, y }); }}
      onMouseDown={(e) => { const { x, y } = coordsFrom(e); onInput({ kind: 'mouse', type: 'down', x, y, button: BTN[e.button] ?? 'left' }); }}
      onMouseUp={(e) => { const { x, y } = coordsFrom(e); onInput({ kind: 'mouse', type: 'up', x, y, button: BTN[e.button] ?? 'left' }); }}
      onWheel={(e) => { const { x, y } = coordsFrom(e); onInput({ kind: 'wheel', x, y, deltaX: e.deltaX, deltaY: e.deltaY }); }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => { e.preventDefault(); onInput({ kind: 'key', type: 'down', key: e.key, text: e.key.length === 1 ? e.key : undefined }); }}
      onKeyUp={(e) => { e.preventDefault(); onInput({ kind: 'key', type: 'up', key: e.key }); }}
    />
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd front && npx vitest run src/modules/workspace/components/BrowserSessionViewer.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add front/src/modules/workspace/components/BrowserSessionViewer.tsx front/src/modules/workspace/components/BrowserSessionViewer.test.tsx
git commit -m "feat(workspace): canvas browser viewer with input coordinate mapping"
```

---

## Task 11: `CollectionSidebar` (select / deselect / delete / already-indexed)

**Files:**
- Create: `front/src/modules/workspace/components/CollectionSidebar.tsx`
- Test: `front/src/modules/workspace/components/CollectionSidebar.test.tsx`

**Interfaces:**
- Consumes: `CollectedPage` (Task 9).
- Produces: `CollectionSidebar({ pages, selected, indexedUrls, onToggle, onDelete, onSelectAll, onSelectNone })` where `selected: Set<string>` (keyed by page.url), `indexedUrls: Set<string>` (normalized urls already in the workspace, rendered disabled).

- [ ] **Step 1: Write the failing test**

```tsx
// front/src/modules/workspace/components/CollectionSidebar.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CollectionSidebar } from './CollectionSidebar';

const pages = [
  { url: 'https://ex.com/a', title: 'A' },
  { url: 'https://ex.com/b', title: 'B' },
];

it('toggles selection and deletes rows', () => {
  const onToggle = vi.fn();
  const onDelete = vi.fn();
  render(
    <CollectionSidebar
      pages={pages}
      selected={new Set(['https://ex.com/a'])}
      indexedUrls={new Set()}
      onToggle={onToggle}
      onDelete={onDelete}
      onSelectAll={vi.fn()}
      onSelectNone={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByLabelText('B'));
  expect(onToggle).toHaveBeenCalledWith('https://ex.com/b');
  fireEvent.click(screen.getByLabelText('delete https://ex.com/a'));
  expect(onDelete).toHaveBeenCalledWith('https://ex.com/a');
});

it('disables rows already indexed in the workspace', () => {
  render(
    <CollectionSidebar
      pages={pages}
      selected={new Set()}
      indexedUrls={new Set(['https://ex.com/a'])}
      onToggle={vi.fn()}
      onDelete={vi.fn()}
      onSelectAll={vi.fn()}
      onSelectNone={vi.fn()}
    />,
  );
  expect(screen.getByLabelText('A')).toBeDisabled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd front && npx vitest run src/modules/workspace/components/CollectionSidebar.test.tsx`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement the sidebar**

```tsx
// front/src/modules/workspace/components/CollectionSidebar.tsx
import { Trash2 } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { normalizeUrl, type CollectedPage } from '../hooks/useBrowserSession';

export function CollectionSidebar({
  pages, selected, indexedUrls, onToggle, onDelete, onSelectAll, onSelectNone,
}: {
  pages: CollectedPage[];
  selected: Set<string>;
  indexedUrls: Set<string>;
  onToggle: (url: string) => void;
  onDelete: (url: string) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
}) {
  return (
    <div className='flex min-h-0 min-w-0 flex-col rounded border'>
      <div className='flex shrink-0 items-center gap-2 border-b px-2 py-1.5 text-xs'>
        <span className='font-medium'>Pages visitées ({pages.length})</span>
        <button type='button' className='ml-auto underline' onClick={onSelectAll}>Tout</button>
        <span className='text-muted-foreground'>·</span>
        <button type='button' className='underline' onClick={onSelectNone}>Aucun</button>
      </div>
      <div className='min-h-0 flex-1 overflow-y-auto'>
        {pages.length === 0 ? (
          <p className='p-3 text-sm text-muted-foreground'>Naviguez pour collecter des pages.</p>
        ) : (
          pages.map((p) => {
            const already = indexedUrls.has(normalizeUrl(p.url));
            return (
              <div key={p.url} className='flex items-center gap-2 border-b px-2 py-1.5 text-sm'>
                <Checkbox
                  aria-label={p.title}
                  checked={selected.has(p.url)}
                  disabled={already}
                  onCheckedChange={() => onToggle(p.url)}
                />
                <div className='min-w-0 flex-1'>
                  <div className='truncate' title={p.title}>{p.title}</div>
                  <div className='truncate text-[11px] text-muted-foreground' title={p.url}>{p.url}</div>
                  {already && <span className='text-[10px] text-muted-foreground'>Déjà indexée</span>}
                </div>
                <button
                  type='button'
                  aria-label={`delete ${p.url}`}
                  className='shrink-0 text-muted-foreground hover:text-destructive'
                  onClick={() => onDelete(p.url)}
                >
                  <Trash2 className='h-4 w-4' />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
```

If `@/components/ui/checkbox` does not exist, use a native `<input type="checkbox" aria-label=... />` instead — verify with `ls front/src/components/ui/checkbox.tsx` first.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd front && npx vitest run src/modules/workspace/components/CollectionSidebar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add front/src/modules/workspace/components/CollectionSidebar.tsx front/src/modules/workspace/components/CollectionSidebar.test.tsx
git commit -m "feat(workspace): collected-pages sidebar with select/delete/already-indexed"
```

---

## Task 12: Rewrite `AddLinkDialog` + remove `PageTree`

**Files:**
- Modify: `front/src/modules/workspace/components/AddLinkDialog.tsx` (full rewrite)
- Delete: `front/src/modules/workspace/components/PageTree.tsx` (+ its test)
- Test: `front/src/modules/workspace/components/AddLinkDialog.test.tsx` (create/replace)

**Interfaces:**
- Consumes: `useBrowserSession` (Task 9), `BrowserSessionViewer` (Task 10), `CollectionSidebar` (Task 11), `useWorkspaceStore().addPageLinks`, `useWorkspaceStore().documents` (to compute `indexedUrls`), `normalizeUrl`.
- Produces: two-phase dialog — `input` (URL entry → `start`) and `browse` (viewer + chrome bar + sidebar → `addPageLinks(selected)`).

- [ ] **Step 1: Delete PageTree**

```bash
cd front
rm src/modules/workspace/components/PageTree.tsx
rm src/modules/workspace/components/PageTree.test.tsx  # if present (check git status)
```

- [ ] **Step 2: Write the failing test**

```tsx
// front/src/modules/workspace/components/AddLinkDialog.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const session = {
  status: 'idle' as string, frame: null as string | null, currentUrl: null as string | null,
  pages: [] as Array<{ url: string; title: string }>, blockedNotice: null as string | null,
  start: vi.fn(), sendInput: vi.fn(), navigate: vi.fn(), stop: vi.fn(),
};
vi.mock('../hooks/useBrowserSession', async () => {
  const actual = await vi.importActual<typeof import('../hooks/useBrowserSession')>('../hooks/useBrowserSession');
  return { ...actual, useBrowserSession: () => session };
});
const addPageLinks = vi.fn().mockResolvedValue(undefined);
vi.mock('../store', () => ({
  useWorkspaceStore: (sel: (s: unknown) => unknown) =>
    sel({ addPageLinks, documents: [] }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AddLinkDialog } from './AddLinkDialog';

beforeEach(() => {
  session.status = 'idle'; session.pages = []; addPageLinks.mockClear();
  session.start.mockClear();
});

it('starts a browse session from the entered url', () => {
  render(<AddLinkDialog open onOpenChange={vi.fn()} workspaceId='w1' />);
  fireEvent.change(screen.getByPlaceholderText('https://exemple.com'), { target: { value: 'https://ok.example' } });
  fireEvent.click(screen.getByText('Naviguer'));
  expect(session.start).toHaveBeenCalledWith('https://ok.example');
});

it('indexes the selected pages', async () => {
  session.status = 'live';
  session.pages = [{ url: 'https://ok.example/a', title: 'A' }, { url: 'https://ok.example/b', title: 'B' }];
  const onOpenChange = vi.fn();
  render(<AddLinkDialog open onOpenChange={onOpenChange} workspaceId='w1' />);
  // both selected by default → index
  fireEvent.click(screen.getByRole('button', { name: /Indexer/ }));
  await waitFor(() => expect(addPageLinks).toHaveBeenCalledWith('w1', ['https://ok.example/a', 'https://ok.example/b']));
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd front && npx vitest run src/modules/workspace/components/AddLinkDialog.test.tsx`
Expected: FAIL — the current dialog renders the crawl UI (button text "Cartographier"), not "Naviguer".

- [ ] **Step 4: Rewrite the dialog**

```tsx
// front/src/modules/workspace/components/AddLinkDialog.tsx
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Loader2, RotateCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useWorkspaceStore } from '../store';
import { useBrowserSession, normalizeUrl } from '../hooks/useBrowserSession';
import { BrowserSessionViewer } from './BrowserSessionViewer';
import { CollectionSidebar } from './CollectionSidebar';

function isValidUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch { return false; }
}

export function AddLinkDialog({
  open, onOpenChange, workspaceId, initialUrl = '',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  initialUrl?: string;
}) {
  const addPageLinks = useWorkspaceStore((s) => s.addPageLinks);
  const documents = useWorkspaceStore((s) => s.documents) as Array<{ sourceUrl?: string }>;
  const session = useBrowserSession();

  const [phase, setPhase] = useState<'input' | 'browse'>('input');
  const [url, setUrl] = useState(initialUrl);
  const [addressBar, setAddressBar] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) {
      setPhase('input'); setUrl(initialUrl); setError(null); setBusy(false); setSelected(new Set());
    } else {
      session.stop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialUrl]);

  // Auto-select each newly collected page.
  useEffect(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      session.pages.forEach((p) => next.add(p.url));
      return next;
    });
  }, [session.pages]);

  useEffect(() => { if (session.currentUrl) setAddressBar(session.currentUrl); }, [session.currentUrl]);

  const indexedUrls = useMemo(
    () => new Set(documents.filter((d) => d.sourceUrl).map((d) => normalizeUrl(d.sourceUrl!))),
    [documents],
  );

  const handleStart = () => {
    setError(null);
    if (!isValidUrl(url)) { setError('Veuillez saisir une URL valide (http:// ou https://).'); return; }
    session.start(url.trim());
    setPhase('browse');
  };

  const toggle = (u: string) =>
    setSelected((prev) => { const n = new Set(prev); n.has(u) ? n.delete(u) : n.add(u); return n; });
  const remove = (u: string) =>
    setSelected((prev) => { const n = new Set(prev); n.delete(u); return n; });
  const selectableUrls = () => session.pages.filter((p) => !indexedUrls.has(normalizeUrl(p.url))).map((p) => p.url);
  const selectAll = () => setSelected(new Set(selectableUrls()));
  const selectNone = () => setSelected(new Set());

  const chosen = session.pages
    .map((p) => p.url)
    .filter((u) => selected.has(u) && !indexedUrls.has(normalizeUrl(u)));

  const handleIndex = async () => {
    if (busy || chosen.length === 0) return;
    setBusy(true);
    try {
      await addPageLinks(workspaceId, chosen);
      toast.success(`${chosen.length} page(s) ajoutée(s) · conversion en cours`);
      onOpenChange(false);
    } catch {
      setError("Une erreur est survenue lors de l'ajout. Réessayez.");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent
        className={phase === 'browse' ? 'flex h-[92vh] w-[96vw] max-w-[96vw] flex-col gap-3 overflow-hidden' : undefined}
      >
        <DialogHeader className={phase === 'browse' ? 'shrink-0' : undefined}>
          <DialogTitle>Ajouter un lien</DialogTitle>
          <DialogDescription>
            {phase === 'input'
              ? "Naviguez sur le site et collectez les pages à indexer."
              : 'Naviguez ; les pages visitées sont collectées à droite. Sélectionnez celles à indexer.'}
          </DialogDescription>
        </DialogHeader>

        {phase === 'input' ? (
          <div className='space-y-2'>
            <Label htmlFor='workspace-link-url'>Lien du site web</Label>
            <Input
              id='workspace-link-url'
              placeholder='https://exemple.com'
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleStart(); }}
              autoFocus
            />
            {error && <p className='text-sm text-destructive'>{error}</p>}
          </div>
        ) : (
          <div className='grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-[1fr_320px]'>
            <div className='flex min-h-0 min-w-0 flex-col rounded border'>
              <div className='flex shrink-0 items-center gap-1 border-b px-2 py-1.5'>
                <Button size='icon' variant='ghost' className='h-7 w-7' onClick={() => session.navigate({ kind: 'back' })}><ArrowLeft className='h-4 w-4' /></Button>
                <Button size='icon' variant='ghost' className='h-7 w-7' onClick={() => session.navigate({ kind: 'forward' })}><ArrowRight className='h-4 w-4' /></Button>
                <Button size='icon' variant='ghost' className='h-7 w-7' onClick={() => session.navigate({ kind: 'reload' })}><RotateCw className='h-4 w-4' /></Button>
                <Input
                  value={addressBar}
                  onChange={(e) => setAddressBar(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && isValidUrl(addressBar)) session.navigate({ kind: 'goto', url: addressBar.trim() }); }}
                  className='h-7 text-xs'
                />
              </div>
              <div className='relative min-h-0 flex-1 overflow-hidden bg-muted/10'>
                {session.status === 'busy' ? (
                  <div className='flex h-full items-center justify-center text-sm text-muted-foreground'>Navigateur occupé. Réessayez dans un instant.</div>
                ) : session.status === 'connecting' ? (
                  <div className='flex h-full items-center justify-center'><Loader2 className='h-6 w-6 animate-spin' /></div>
                ) : (
                  <BrowserSessionViewer frame={session.frame} onInput={session.sendInput} />
                )}
                {session.blockedNotice && (
                  <div className='absolute inset-x-0 bottom-0 bg-destructive/90 px-3 py-1.5 text-xs text-destructive-foreground'>
                    {session.blockedNotice}
                  </div>
                )}
              </div>
            </div>
            <CollectionSidebar
              pages={session.pages}
              selected={selected}
              indexedUrls={indexedUrls}
              onToggle={toggle}
              onDelete={remove}
              onSelectAll={selectAll}
              onSelectNone={selectNone}
            />
          </div>
        )}

        <DialogFooter>
          {phase === 'input' ? (
            <>
              <Button variant='outline' onClick={() => onOpenChange(false)}>Annuler</Button>
              <Button onClick={handleStart}>Naviguer</Button>
            </>
          ) : (
            <>
              <Button variant='outline' onClick={() => { session.stop(); setPhase('input'); }} disabled={busy}>Retour</Button>
              <Button onClick={handleIndex} disabled={busy || chosen.length === 0} className='gap-1.5'>
                {busy && <Loader2 className='h-4 w-4 animate-spin' />}
                Indexer ({chosen.length})
              </Button>
            </>
          )}
        </DialogFooter>
        {phase === 'browse' && error && <p className='text-sm text-destructive'>{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd front && npx vitest run src/modules/workspace/components/AddLinkDialog.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck the whole frontend + run workspace tests**

Run: `cd front && npx tsc --noEmit && npx vitest run src/modules/workspace`
Expected: PASS; no dangling imports of `crawlUrl`/`PageNode`/`PageTree`.

- [ ] **Step 7: Commit**

```bash
git add -A front/src/modules/workspace
git commit -m "feat(workspace): interactive browse-and-pick AddLinkDialog; remove PageTree"
```

---

## Task 13: End-to-end verification + ops

**Files:** none (verification task).

- [ ] **Step 1: Backend build + full test suite**

Run: `cd back && npx tsc --noEmit && npx jest`
Expected: green (no crawler references; new browser-session specs pass).

- [ ] **Step 2: Frontend build + tests**

Run: `cd front && npx tsc --noEmit && npx vitest run`
Expected: green.

- [ ] **Step 3: Add the Playwright install step to the backend image**

In the backend Dockerfile, after `npm ci`, add:

```dockerfile
RUN npx playwright install --with-deps chromium
```

(Or, if the base image forbids `--with-deps`, install the OS libs separately per Playwright's Debian package list, then `npx playwright install chromium`.)

- [ ] **Step 4: Manual smoke (drive the real feature)**

Use the `superpowers:verification-before-completion` / project `run` skill: start backend + frontend, open a workspace, click Add link, enter a real URL (e.g. `https://example.com`), confirm: the canvas streams the page; clicking a link navigates and the sidebar gains an entry; entering an internal URL like `http://169.254.169.254/` shows the blocked banner and does not navigate; selecting pages + "Indexer" creates docs that reach `completed`, converted ~2s apart. Capture the observations.

- [ ] **Step 5: Commit ops change**

```bash
git add back/Dockerfile
git commit -m "chore(backend): install Chromium for the browser-session service"
```

---

## Self-Review

**Spec coverage:**
- Remove crawler/page-tree → Tasks 7 (backend), 8 & 12 (frontend). ✓
- Reuse `convertAndStore` unchanged → Task 6 keeps it; only scheduling changes. ✓
- Playwright browser-session service (Decision 1) → Tasks 2-5. ✓
- CDP screencast over WS (Decision 2) → Task 4 (screencast) + Task 5 (gateway) + Task 9-10 (client). ✓
- Navigation capture main-frame only (Decision 3) → Task 4 (`framenavigated` main-frame filter) + Task 9 (dedup). ✓
- Per-navigation SSRF guard (Decision 4) → Task 3 (service goto + navigated), Task 4 (route interception). ✓
- Sequential conversion + 2s delay (Decision 5) → Tasks 1 + 6. ✓
- Session lifecycle: idle/max/cap (Decision 6) → Tasks 1 + 3. ✓
- Playwright in image (Decision 7) → Tasks 4 (dep) + 13 (Dockerfile). ✓
- Collection sidebar select/deselect/delete/already-indexed → Task 11 + 12. ✓
- Chrome bar / address-bar escape hatch → Task 12. ✓
- Testing (backend + frontend) → per-task tests + Task 13. ✓

**Placeholder scan:** No TODO/TBD; every code step carries full code. Task 6's test providers reference the existing spec's provider block explicitly rather than restating 60 lines — the fields to add are enumerated. The one intentional discovery step is the root-module registration path in Task 5 Step 5 (repo-specific) — flagged with a typecheck gate.

**Type consistency:** `EngineSession`/`BrowserEngine`/`InputEvent`/`NavAction`/`NavigatedEvent` defined in Task 2 are used verbatim in Tasks 3-5. Frontend `InputEvent`/`NavAction`/`CollectedPage`/`normalizeUrl`/`VIEWPORT_W`/`VIEWPORT_H` defined in Task 9, consumed by Tasks 10-12. Gateway messages (`start`/`input`/`navigate`; events `frame`/`navigated`/`blocked`/`closed`) match between Task 5 and Task 9. `create(userId, url, emit)` signature matches between Tasks 3 and 5.
