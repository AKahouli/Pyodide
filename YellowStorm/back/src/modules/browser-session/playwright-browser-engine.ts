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
