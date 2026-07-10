import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BrowserSessionService } from './browser-session.service';
import {
  BROWSER_ENGINE, URL_SAFETY, BrowserEngine, EngineSession, InputEvent, NavAction, UrlSafetyFn,
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

async function build(engine: FakeEngine, safety: UrlSafetyFn = async () => {}) {
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
    await Promise.resolve();
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
