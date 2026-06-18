import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Typed HTTP client to the standalone `worky-adk-runtime` FastAPI service
 * (canonical §6.1). The runtime handles LLM reasoning, ephemeral worker
 * spawning, and tool binding. NestJS owns all state — the runtime never
 * writes to Mongo and only mutates state via `/worky/internal/*` callbacks
 * (see `worky-internal.controller.ts`).
 *
 * Uses native `fetch` (Node 20+) so the backend avoids pulling in
 * `@nestjs/axios`. In Part 1 the only call is the boot-time `/health` probe
 * so a misconfigured runtime URL is logged at startup, not at first request.
 * Part 2/3 add planning/start/resume/stop calls.
 */
@Injectable()
export class WorkyRuntimeClient implements OnModuleInit {
  private readonly logger = new Logger(WorkyRuntimeClient.name);
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.config.get<string>('worky.runtimeBaseUrl') ?? 'http://worky-adk-runtime:8011';
    this.timeoutMs = this.config.get<number>('worky.runtimeTimeoutMs') ?? 15000;
  }

  get baseURL(): string {
    return this.baseUrl;
  }

  async onModuleInit(): Promise<void> {
    const result = await this.ping();
    if (!result.ok) {
      this.logger.warn('Worky runtime is not reachable at boot', { baseUrl: this.baseUrl });
    } else {
      this.logger.log('Worky runtime health probe OK', { baseUrl: this.baseUrl });
    }
  }

  /**
   * Liveness probe. Returns `ok=false` (no throw) on any network or HTTP
   * error so boot-time failure is a warning, not a crash.
   */
  async ping(): Promise<{ ok: boolean; status?: number; body?: unknown }> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      const res = await fetch(`${this.baseUrl}/health`, { signal: controller.signal });
      clearTimeout(timer);
      const body = (await res.json().catch(() => null)) as unknown;
      return { ok: res.ok, status: res.status, body };
    } catch (err) {
      this.logger.warn('Worky runtime health check failed', {
        baseUrl: this.baseUrl,
        message: (err as Error).message,
      });
      return { ok: false };
    }
  }
}
