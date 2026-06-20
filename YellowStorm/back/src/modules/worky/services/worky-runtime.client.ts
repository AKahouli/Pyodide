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
 * `@nestjs/axios`. Methods follow the runtime FastAPI router contract in
 * `worky-adk-runtime/app/routers/execution.py`:
 *   - POST /runtime/streams/{id}/start     (SSE)
 *   - POST /runtime/streams/{id}/resume    (SSE)
 *   - POST /runtime/streams/{id}/replan    (SSE)
 *   - POST /runtime/streams/{id}/stop      (SSE)
 *   - POST /runtime/streams/tasks/{id}/cancel  (SSE)
 *
 * No method throws on network/HTTP/SSE errors — the caller decides whether
 * to translate `ok=false` into a user-visible stream event. This keeps the
 * Start / Resume / Stop user actions "always clickable" per canonical §4.4
 * (errors surface as live frames, not as a 5xx response).
 */
export interface WorkyRuntimeStartRequest {
  ready_task_ids: string[];
  task_contexts?: Record<string, Record<string, unknown>>;
  context_snapshot?: Record<string, unknown> | null;
  worker_model_id?: string | null;
}

export interface WorkyRuntimeResumeRequest {
  trigger?: string;
  context_snapshot?: Record<string, unknown> | null;
}

export interface WorkyRuntimeReplanRequest {
  trigger_event?: Record<string, unknown> | null;
  context_snapshot?: Record<string, unknown> | null;
}

export interface WorkyRuntimeFrame {
  type: string;
  emitted_at: number;
  payload: Record<string, unknown>;
}

export interface WorkyRuntimeSseResult {
  ok: boolean;
  status?: number;
  frames: WorkyRuntimeFrame[];
  error?: string;
}

@Injectable()
export class WorkyRuntimeClient implements OnModuleInit {
  private readonly logger = new Logger(WorkyRuntimeClient.name);
  private readonly baseUrl: string;
  private readonly healthTimeoutMs: number;
  private readonly sseTimeoutMs: number;

  constructor(private readonly config: ConfigService) {
    this.baseUrl =
      this.config.get<string>('worky.runtimeBaseUrl') ?? 'http://worky-adk-runtime:8011';
    // Health probe is short and clamped to keep boot-time failure non-fatal.
    this.healthTimeoutMs = Math.min(this.config.get<number>('worky.runtimeTimeoutMs') ?? 15000, 15000);
    // SSE calls get the full configured budget; default 120s (matches
    // planning-turn). The runtime emits `execution.done` to close the
    // stream; this is the backstop if it never does.
    this.sseTimeoutMs = this.config.get<number>('worky.runtimeTimeoutMs') ?? 120000;
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
    return this.healthFetch(`${this.baseUrl}/health`);
  }

  // =================================================================
  // Execution surface (Part 3 §3.2a)
  // =================================================================

  /**
   * Dispatch a stream's ready tasks to the runtime. The runtime responds
   * with an SSE stream of `ExecutionEvent` frames; we accumulate and
   * return them. Caller is responsible for forwarding to the SSE channel.
   */
  start(streamId: string, body: WorkyRuntimeStartRequest): Promise<WorkyRuntimeSseResult> {
    return this.postSse(`/runtime/streams/${encodeURIComponent(streamId)}/start`, body);
  }

  resume(streamId: string, body: WorkyRuntimeResumeRequest): Promise<WorkyRuntimeSseResult> {
    return this.postSse(`/runtime/streams/${encodeURIComponent(streamId)}/resume`, body);
  }

  replan(streamId: string, body: WorkyRuntimeReplanRequest): Promise<WorkyRuntimeSseResult> {
    return this.postSse(`/runtime/streams/${encodeURIComponent(streamId)}/replan`, body);
  }

  stop(streamId: string): Promise<WorkyRuntimeSseResult> {
    return this.postSse(`/runtime/streams/${encodeURIComponent(streamId)}/stop`, {});
  }

  /**
   * Cancel a single in-flight task worker. Runtime route is mounted at
   * `/runtime/streams/tasks/{taskId}/cancel` (see runtime router prefix
   * in `worky-adk-runtime/app/routers/execution.py:59`).
   */
  cancelTask(taskId: string): Promise<WorkyRuntimeSseResult> {
    return this.postSse(`/runtime/streams/tasks/${encodeURIComponent(taskId)}/cancel`, {});
  }

  // =================================================================
  // Internals
  // =================================================================

  private async healthFetch(url: string): Promise<{ ok: boolean; status?: number; body?: unknown }> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.healthTimeoutMs);
      const res = await fetch(url, { signal: controller.signal });
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

  private async postSse(path: string, body: unknown): Promise<WorkyRuntimeSseResult> {
    const url = `${this.baseUrl}${path}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(this.sseTimeoutMs),
      });
    } catch (err) {
      const message = (err as Error).message;
      this.logger.warn('Worky runtime SSE call failed', { url, message });
      return { ok: false, frames: [], error: message };
    }
    if (!response.ok || !response.body) {
      this.logger.warn('Worky runtime SSE non-ok response', {
        url,
        status: response.status,
      });
      return {
        ok: false,
        status: response.status,
        frames: [],
        error: `Runtime returned ${response.status}`,
      };
    }
    return this.parseSse(response, url);
  }

  private async parseSse(response: Response, url: string): Promise<WorkyRuntimeSseResult> {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const frames: WorkyRuntimeFrame[] = [];
    let buffer = '';
    let eventName: string | null = null;
    let dataLines: string[] = [];
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const raw of lines) {
          const line = raw.replace(/\r$/, '');
          if (line === '') {
            if (dataLines.length === 0 && !eventName) continue;
            const frame = this.parseSseFrame(eventName, dataLines);
            eventName = null;
            dataLines = [];
            if (frame) frames.push(frame);
            continue;
          }
          if (line.startsWith(':')) continue;
          if (line.startsWith('event:')) {
            eventName = line.slice('event:'.length).trim();
            continue;
          }
          if (line.startsWith('data:')) {
            dataLines.push(line.slice('data:'.length).trimStart());
          }
        }
      }
    } catch (err) {
      // Malformed stream: return what we have so far rather than throwing.
      this.logger.warn('Worky runtime SSE parse aborted', {
        url,
        message: (err as Error).message,
        frameCount: frames.length,
      });
      return { ok: false, status: response.status, frames, error: (err as Error).message };
    }
    return { ok: true, status: response.status, frames };
  }

  private parseSseFrame(eventName: string | null, dataLines: string[]): WorkyRuntimeFrame | null {
    const data = dataLines.join('\n');
    if (!data) return null;
    let payload: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(data) as { type?: string; emitted_at?: number; payload?: unknown };
      payload =
        parsed.payload && typeof parsed.payload === 'object' && parsed.payload !== null
          ? (parsed.payload as Record<string, unknown>)
          : {};
      return {
        type: parsed.type ?? eventName ?? 'unknown',
        emitted_at: typeof parsed.emitted_at === 'number' ? parsed.emitted_at : Date.now() / 1000,
        payload,
      };
    } catch {
      return { type: eventName ?? 'unknown', emitted_at: Date.now() / 1000, payload: { raw: data } };
    }
  }
}
