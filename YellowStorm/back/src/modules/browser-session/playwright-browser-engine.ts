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
 * Normalize a raw click label reported through the exposed binding. The binding
 * is directly callable from arbitrary page JS, so we re-apply the same clean+cap
 * the in-page script uses (collapse whitespace, trim, cap at 120 chars) instead
 * of trusting the page to have done it — an unbounded page-controlled string
 * must never reach the client. Returns undefined for empty/non-string input so a
 * blank label never displaces the title/URL fallback.
 */
export function sanitizeClickLabel(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const clean = raw.replace(/\s+/g, ' ').trim().slice(0, 120);
  return clean || undefined;
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

const KEY_TO_BUTTON = { left: 'left', right: 'right', middle: 'middle' } as const;

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
    this.cdp.on('Page.screencastFrame', async (evt: { data: string; sessionId: number }) => {
      this.frameCb?.(evt.data);
      try {
        await this.cdp.send('Page.screencastFrameAck', { sessionId: evt.sessionId });
      } catch { /* session may be closing */ }
    });
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
  }

  onFrame(cb: (f: string) => void) { this.frameCb = cb; }

  onNavigated(cb: (n: NavigatedEvent) => void) {
    this.navCb = cb;
    if (this.lastNav) cb(this.lastNav);
  }

  recordClick(label: string): void {
    this.lastClick = { label, at: this.now() };
  }

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
    this.lastClick = undefined; // explicit navigation must not inherit a click label
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
  private readonly chromiumExecutablePath: string;
  private readonly clickLabelTtlMs: number;

  constructor(
    config: ConfigService,
    @Inject(URL_SAFETY) private readonly assertSafe: UrlSafetyFn,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(PlaywrightBrowserEngine.name);
    const c = config.get('browserSession') as {
      viewportWidth: number; viewportHeight: number; screencastQuality: number;
      chromiumExecutablePath: string; clickLabelTtlMs: number;
    };
    this.width = c.viewportWidth;
    this.height = c.viewportHeight;
    this.quality = c.screencastQuality;
    this.chromiumExecutablePath = c.chromiumExecutablePath;
    this.clickLabelTtlMs = c.clickLabelTtlMs;
  }

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser && this.browser.isConnected()) return this.browser;
    // --disable-dev-shm-usage: containers default to a 64MB /dev/shm, which
    // Chromium exhausts and then crashes ("Target closed"); this routes shared
    // memory to /tmp instead. --disable-gpu is a no-op safety in headless.
    this.browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      ...(this.chromiumExecutablePath ? { executablePath: this.chromiumExecutablePath } : {}),
    });
    return this.browser;
  }

  async launchSession(startUrl: string): Promise<EngineSession> {
    const browser = await this.ensureBrowser();
    const context = await browser.newContext({ viewport: { width: this.width, height: this.height } });
    const page = await context.newPage();

    // Browser sessions are for visual navigation only. Downloads and popup
    // windows are outside that contract and increase the attack surface.
    context.on('page', (popup) => {
      if (popup !== page) {
        this.logger.warn('Blocked browser-session popup', { url: popup.url() });
        void popup.close().catch(() => undefined);
      }
    });
    context.on('download', (download) => {
      this.logger.warn('Blocked browser-session download', { url: download.url(), filename: download.suggestedFilename() });
      void download.cancel().catch(() => undefined);
    });

    // SSRF: abort any top-level document navigation to a disallowed host.
    // Registered on the context (not the page) so it also covers popups/new
    // tabs opened via window.open() / target="_blank", which page-scoped
    // routes do not intercept.
    await context.route('**/*', async (route, request) => {
      if (await isNavigationRequestBlocked(this.assertSafe, request.resourceType(), request.url())) {
        await route.abort('blockedbyclient');
        return;
      }
      await route.continue();
    });

    const cdp = await context.newCDPSession(page);
    const session = new PlaywrightSession(context, page, cdp, this.clickLabelTtlMs, () => performance.now());

    // Name visited pages after the clicked link/button text (see resolveClickLabel):
    // the in-page listener reports the label, we pair it with the next navigation.
    await context.exposeBinding('__ysRecordClick', (_source, label: string) => {
      const clean = sanitizeClickLabel(label);
      if (clean) session.recordClick(clean);
    });
    await context.addInitScript(CLICK_CAPTURE_SCRIPT);

    await page.goto(startUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await cdp.send('Page.startScreencast', {
      format: 'jpeg', quality: this.quality,
      maxWidth: this.width, maxHeight: this.height, everyNthFrame: 1,
    });
    return session;
  }
}
