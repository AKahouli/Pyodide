import { Injectable, Logger, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AppDataErrorCode,
  AppDataException,
} from '../constants/app-data.errors';
import type { AppDataEndUserGrants } from '../constants/app-data.types';

interface RequestOptions {
  body?: unknown;
  query?: Record<string, string | undefined>;
  authorization?: string;
  timeoutMs?: number;
}

export interface RemoteAppRow {
  id: string;
  workspaceId: string;
  [key: string]: unknown;
}

interface RemoteAppStatusResponse {
  app: RemoteAppRow;
  environments: Array<Record<string, unknown>>;
}

interface RemoteBindResponse {
  publicUrl: string;
  appDataId: string;
  environment: string;
}

/**
 * HTTP client for the standalone app-data microservice.
 * All requests authenticate with the shared static service token
 * (Authorization: Bearer <APP_DATA_SERVICE_TOKEN>).
 */
@Injectable()
export class AppDataClientService {
  private readonly logger = new Logger(AppDataClientService.name);

  constructor(private readonly config: ConfigService) {}

  isEnabled(): boolean {
    return this.config.get<boolean>('appData.remote', false) === true;
  }

  private baseUrl(): string {
    const url = this.config.get<string>('appData.serviceUrl') ?? '';
    if (!url) {
      throw new AppDataException(
        AppDataErrorCode.REMOTE_UNAVAILABLE,
        'APP_DATA_SERVICE_URL is not configured',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return url.replace(/\/$/, '');
  }

  private serviceToken(): string {
    return this.config.get<string>('appData.serviceToken') || '';
  }

  private defaultTimeoutMs(): number {
    return this.config.get<number>('appData.remoteTimeoutMs') || 15_000;
  }

  private bindTimeoutMs(): number {
    return this.config.get<number>('appData.remoteBindTimeoutMs') || 120_000;
  }

  async getAppByWorkspace(workspaceId: string): Promise<RemoteAppRow | null> {
    const res = await this.request<RemoteAppRow>(
      'GET',
      `/v1/internal/apps/by-workspace/${encodeURIComponent(workspaceId)}`,
      { tolerant404: true },
    );
    return res.status === 404 ? null : res.body;
  }

  async getStatus(appDataId: string): Promise<RemoteAppStatusResponse> {
    const res = await this.request<RemoteAppStatusResponse>(
      'GET',
      `/v1/internal/apps/${encodeURIComponent(appDataId)}/status`,
    );
    return res.body;
  }

  async ensureApp(
    workspaceId: string,
    name?: string,
    ownerUserId?: string,
  ): Promise<{ id: string; workspaceId: string; name: string; ownerUserId: string | null }> {
    const res = await this.request<{
      id: string;
      workspaceId: string;
      name: string;
      ownerUserId: string | null;
    }>('POST', '/v1/internal/apps', { body: { workspaceId, name, ownerUserId } });
    return res.body;
  }

  /** Issue an owner/app/env-scoped data ticket (microservice JWT). */
  async issueTicket(params: {
    workspaceId: string;
    userId: string;
    appDataId: string;
    env: 'dev' | 'prod';
  }): Promise<{ ticket: string }> {
    const res = await this.request<{ ticket: string }>('POST', '/v1/internal/tickets', {
      body: params,
    });
    return res.body;
  }

  async provision(appDataId: string, env: 'dev' | 'prod'): Promise<{ database: string }> {
    const res = await this.request<{ database: string }>(
      'POST',
      `/v1/internal/apps/${encodeURIComponent(appDataId)}/${env}/provision`,
      { body: {} },
    );
    return res.body;
  }

  async applySchema(
    appDataId: string,
    env: 'dev' | 'prod',
    tables: Array<Record<string, unknown>>,
  ): Promise<{ message: string; tables: number }> {
    const res = await this.request<{ message: string; tables: number }>(
      'POST',
      `/v1/internal/apps/${encodeURIComponent(appDataId)}/${env}/schema`,
      { body: { tables }, timeoutMs: this.bindTimeoutMs() },
    );
    return res.body;
  }

  async bindRelease(
    workspaceId: string,
    revisionId: string,
  ): Promise<RemoteBindResponse> {
    const res = await this.request<RemoteBindResponse>('POST', '/v1/internal/releases/bind', {
      body: { workspaceId, revisionId },
      timeoutMs: this.bindTimeoutMs(),
    });
    return res.body;
  }

  async listEndUsers(
    appDataId: string,
  ): Promise<
    Array<{
      id: string;
      email: string;
      displayName: string | null;
      status: string;
      grants: AppDataEndUserGrants;
      createdAt: string;
    }>
  > {
    const res = await this.request<{
      users: Array<{
        id: string;
        email: string;
        displayName: string | null;
        status: string;
        grants: AppDataEndUserGrants;
        createdAt: string;
      }>;
    }>('GET', `/v1/internal/apps/${encodeURIComponent(appDataId)}/end-users`);
    return res.body.users ?? [];
  }

  async replaceWildcardGrants(
    appDataId: string,
    userId: string,
    grants: AppDataEndUserGrants,
  ): Promise<void> {
    await this.request(
      'PUT',
      `/v1/internal/apps/${encodeURIComponent(appDataId)}/end-users/${encodeURIComponent(userId)}/wildcard-grants`,
      { body: { grants } },
    );
  }

  async updateUserStatus(appDataId: string, userId: string, status: string): Promise<unknown> {
    const res = await this.request<unknown>(
      'PATCH',
      `/v1/internal/apps/${encodeURIComponent(appDataId)}/end-users/${encodeURIComponent(userId)}/status`,
      { body: { status } },
    );
    return res.body;
  }

  async listTables(appDataId: string, env: 'dev' | 'prod'): Promise<string[]> {
    const res = await this.request<{ tables: string[] }>(
      'GET',
      `/v1/internal/apps/${encodeURIComponent(appDataId)}/${env}/tables`,
    );
    return res.body.tables ?? [];
  }

  async listOwnerRows(
    appDataId: string,
    env: 'dev' | 'prod',
    table: string,
    query: Record<string, string | undefined>,
  ): Promise<{
    rows: Array<Record<string, unknown>>;
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.request<{
      rows: Array<Record<string, unknown>>;
      total: number;
      page: number;
      pageSize: number;
    }>(
      'GET',
      `/v1/internal/apps/${encodeURIComponent(appDataId)}/${env}/tables/${encodeURIComponent(table)}/rows`,
      { query },
    ).then((res) => res.body);
  }

  async insertOwnerRow(
    appDataId: string,
    env: 'dev' | 'prod',
    table: string,
    row: Record<string, unknown>,
    ownerId?: string,
  ): Promise<Record<string, unknown>> {
    const payload: Record<string, unknown> = { ...row };
    if (ownerId) payload.owner_id = ownerId;
    const res = await this.request<Record<string, unknown>>(
      'POST',
      `/v1/internal/apps/${encodeURIComponent(appDataId)}/${env}/tables/${encodeURIComponent(table)}/rows`,
      { body: payload },
    );
    return res.body;
  }

  async updateOwnerRow(
    appDataId: string,
    env: 'dev' | 'prod',
    table: string,
    id: string,
    patch: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    const res = await this.request<Record<string, unknown> | null>(
      'PATCH',
      `/v1/internal/apps/${encodeURIComponent(appDataId)}/${env}/tables/${encodeURIComponent(table)}/rows/${encodeURIComponent(id)}`,
      { body: patch },
    );
    return res.body;
  }

  async deleteOwnerRow(
    appDataId: string,
    env: 'dev' | 'prod',
    table: string,
    id: string,
  ): Promise<boolean> {
    const res = await this.request<{ deleted: boolean }>(
      'DELETE',
      `/v1/internal/apps/${encodeURIComponent(appDataId)}/${env}/tables/${encodeURIComponent(table)}/rows/${encodeURIComponent(id)}`,
    );
    return res.body?.deleted === true;
  }

  async seedRows(
    appDataId: string,
    env: 'dev' | 'prod',
    tables: { name: string; rows: Record<string, unknown>[] }[],
    ownerId?: string,
  ): Promise<{
    total: number;
    inserted: number;
    skipped: number;
    tables: { table: string; inserted: number; skipped: number }[];
  }> {
    const res = await this.request<{
      total: number;
      inserted: number;
      skipped: number;
      tables: { table: string; inserted: number; skipped: number }[];
    }>('POST', `/v1/internal/apps/${encodeURIComponent(appDataId)}/${env}/seed`, {
      body: { owner_id: ownerId, tables },
      timeoutMs: this.bindTimeoutMs(),
    });
    return res.body;
  }

  async mcpRpc(
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const res = await this.request<Record<string, unknown>>('POST', '/v1/mcp', {
      body: payload,
      timeoutMs: this.defaultTimeoutMs(),
    });
    return res.body;
  }

  /** Create a register-invite in the microservice. Returns raw token + expiry. */
  async createInvite(
    appDataId: string,
    email: string,
    ttlDays = 7,
  ): Promise<{ token: string; expiresAt: string }> {
    const res = await this.request<{ token: string; expiresAt: string }>(
      'POST',
      `/v1/internal/apps/${encodeURIComponent(appDataId)}/invites`,
      { body: { email, ttlDays } },
    );
    return res.body;
  }

  /**
   * Raw passthrough for proxy controllers. Returns the upstream status and
   * parsed body verbatim for successful responses. For non-2xx responses,
   * sanitizes the body to prevent information disclosure from the microservice.
   */
  async forward(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    options: { body?: unknown; query?: Record<string, string | undefined>; authorization?: string },
  ): Promise<{ status: number; body: unknown }> {
    const result = await this.request<unknown>(method, path, {
      body: options.body,
      query: options.query,
      authorization: options.authorization,
      passthrough: true,
    });
    // Sanitize error responses to avoid leaking microservice internals.
    if (result.status >= 400) {
      const safeBody = this.sanitizeUpstreamError(result.body);
      return { status: result.status, body: safeBody };
    }
    return result;
  }

  private sanitizeUpstreamError(body: unknown): unknown {
    if (!body || typeof body !== 'object') return { message: 'Upstream error' };
    const obj = body as Record<string, unknown>;
    // Preserve only safe fields: message, code, error code.
    const safe: Record<string, unknown> = {};
    if (typeof obj.message === 'string') safe.message = obj.message;
    if (typeof obj.code === 'string') safe.code = obj.code;
    if (typeof obj.error === 'object' && obj.error !== null) {
      const err = obj.error as Record<string, unknown>;
      if (typeof err.code === 'string') safe.error = { code: err.code };
    }
    return Object.keys(safe).length > 0 ? safe : { message: 'Upstream error' };
  }

  async ready(): Promise<boolean> {
    try {
      const res = await this.request<{ status: string }>('GET', '/v1/health/ready', {
        timeoutMs: 3_000,
        tolerant404: true,
        passthrough: true,
      });
      return res.status === 200 && (res.body as { status?: string })?.status === 'ok';
    } catch {
      return false;
    }
  }

  async live(): Promise<boolean> {
    try {
      const res = await this.request<{ status: string }>('GET', '/v1/health/live', {
        timeoutMs: 3_000,
        tolerant404: true,
        passthrough: true,
      });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  async healthDetail(): Promise<{
    reachable: boolean;
    live: boolean;
    ready: boolean;
    database?: string;
    error?: string;
  }> {
    const [liveRes, readyRes] = await Promise.allSettled([
      this.request<{ status: string }>('GET', '/v1/health/live', {
        timeoutMs: 3_000,
        tolerant404: true,
        passthrough: true,
      }),
      this.request<{ status: string; database?: string }>('GET', '/v1/health/ready', {
        timeoutMs: 3_000,
        tolerant404: true,
        passthrough: true,
      }),
    ]);

    const live = liveRes.status === 'fulfilled' && liveRes.value.status === 200;
    const ready =
      readyRes.status === 'fulfilled' &&
      readyRes.value.status === 200 &&
      (readyRes.value.body as { status?: string })?.status === 'ok';
    const database =
      readyRes.status === 'fulfilled'
        ? (readyRes.value.body as { database?: string })?.database
        : undefined;

    const reachable = liveRes.status === 'fulfilled' || readyRes.status === 'fulfilled';
    const error =
      !reachable
        ? (liveRes.status === 'rejected' ? liveRes.reason?.message : readyRes.reason?.message) ?? 'unreachable'
        : undefined;

    return { reachable, live, ready, database, ...(error ? { error } : {}) };
  }

  private buildUrl(path: string, query?: Record<string, string | undefined>): string {
    const url = new URL(`${this.baseUrl()}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.set(key, value);
        }
      }
    }
    return url.toString();
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    options: RequestOptions & { tolerant404?: boolean; passthrough?: boolean } = {},
  ): Promise<{ status: number; body: T }> {
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs();
    const headers: Record<string, string> = {};
    const token = this.serviceToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    if (options.authorization) {
      headers.Authorization = options.authorization;
    }
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    let response: Response;
    try {
      response = await fetch(this.buildUrl(path, options.query), {
        method,
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (options.passthrough) throw err;
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`app-data service unreachable (${method} ${path}): ${message}`);
      throw new AppDataException(
        AppDataErrorCode.REMOTE_UNAVAILABLE,
        `app-data service unreachable: ${message}`,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    let bodyText = '';
    try {
      bodyText = await response.text();
    } catch {
      bodyText = '';
    }
    let body: unknown = null;
    if (bodyText) {
      try {
        body = JSON.parse(bodyText);
      } catch {
        body = bodyText;
      }
    }

    if (options.passthrough) {
      return { status: response.status, body: body as T };
    }
    if (!response.ok) {
      if (response.status === 404 && options.tolerant404) {
        return { status: 404, body: null as T };
      }
      throw this.mapUpstreamError(response.status, body, path);
    }
    return { status: response.status, body: body as T };
  }

  private mapUpstreamError(status: number, body: unknown, path: string): AppDataException {
    const message =
      body && typeof body === 'object' && 'message' in body
        ? String((body as { message: unknown }).message)
        : `app-data service request failed (${status}) on ${path}`;
    switch (status) {
      case HttpStatus.NOT_FOUND:
        return new AppDataException(AppDataErrorCode.NOT_PROVISIONED, message, HttpStatus.NOT_FOUND);
      case HttpStatus.UNAUTHORIZED:
        return new AppDataException(AppDataErrorCode.AUTH_INVALID, message, HttpStatus.UNAUTHORIZED);
      case HttpStatus.FORBIDDEN:
        return new AppDataException(AppDataErrorCode.GRANT_DENIED, message, HttpStatus.FORBIDDEN);
      case HttpStatus.CONFLICT:
        return new AppDataException(AppDataErrorCode.EMAIL_TAKEN, message, HttpStatus.CONFLICT);
      case HttpStatus.BAD_REQUEST:
        return new AppDataException(AppDataErrorCode.INVALID_MANIFEST, message, HttpStatus.BAD_REQUEST);
      default:
        return new AppDataException(
          AppDataErrorCode.REMOTE_UNAVAILABLE,
          message,
          HttpStatus.BAD_GATEWAY,
        );
    }
  }
}
