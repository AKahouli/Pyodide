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
