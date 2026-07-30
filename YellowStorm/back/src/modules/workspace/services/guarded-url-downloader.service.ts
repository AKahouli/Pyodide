import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Readable } from 'stream';
import { DEFAULT_CRAWL_USER_AGENT } from '../../../config/indexing.config';
import { BadRequestException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { assertUrlIsSafe } from './url-safety';

export interface GuardedDownloadOptions {
  maxBytes: number;
  authHeaders?: Record<string, string>;
  deadlineMs?: number;
}

export interface GuardedDownloadResult {
  data: Buffer;
  headers: Record<string, string>;
}

export interface UrlReachabilityResult {
  reachable: boolean;
  status?: number;
  error?: string;
}

/**
 * SSRF-safe remote fetch for workspace flows (URL ingest, link reachability).
 * Validates the initial URL and every redirect hop; streams bodies with a hard
 * byte cap; strips Authorization on cross-origin redirects.
 */
@Injectable()
export class GuardedUrlDownloaderService {
  private readonly crawlUserAgent: string;

  constructor(private readonly configService: ConfigService) {
    this.crawlUserAgent = this.configService.get<string>(
      'indexing.crawlUserAgent',
      DEFAULT_CRAWL_USER_AGENT,
    );
  }

  async assertUrlIsSafe(url: string): Promise<void> {
    return assertUrlIsSafe(url);
  }

  /**
   * Keep only Authorization from caller-supplied ingest headers (defense in depth).
   */
  pickIngestAuthHeaders(
    authHeaders?: Record<string, string>,
  ): Record<string, string> {
    if (!authHeaders) return {};
    const picked: Record<string, string> = {};
    for (const [key, value] of Object.entries(authHeaders)) {
      if (typeof value !== 'string') continue;
      if (key.toLowerCase() === 'authorization') {
        picked.Authorization = value;
      }
    }
    return picked;
  }

  /**
   * Check that a URL is reachable (HEAD, falling back to GET).
   * SSRF: initial URL throws BadRequestException; mid-redirect blocks return
   * { reachable: false }.
   */
  async checkUrlReachable(url: string): Promise<UrlReachabilityResult> {
    await this.assertUrlIsSafe(url);

    try {
      const head = await this.followGuardedRedirects('head', url);
      if (head === null) {
        return { reachable: false, error: 'Redirect target is not allowed' };
      }
      if (head.status >= 200 && head.status < 400) {
        return { reachable: true, status: head.status };
      }

      const get = await this.followGuardedRedirects('get', url);
      if (get === null) {
        return { reachable: false, error: 'Redirect target is not allowed' };
      }
      const ok = get.status >= 200 && get.status < 400;
      (get.data as { destroy?: () => void } | undefined)?.destroy?.();
      return { reachable: ok, status: get.status, error: ok ? undefined : `HTTP ${get.status}` };
    } catch (error) {
      const err = error as { message?: string };
      return { reachable: false, error: err?.message ?? 'unreachable' };
    }
  }

  /**
   * Download a binary URL with manual redirects, HTTPS-only hops, streamed
   * body + hard byte cap, and an end-to-end AbortSignal deadline.
   */
  async download(
    url: string,
    options: GuardedDownloadOptions,
  ): Promise<GuardedDownloadResult> {
    const MAX_HOPS = 5;
    const deadlineMs = options.deadlineMs ?? 30_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deadlineMs);
    let currentUrl = url;
    const headers: Record<string, string> = {
      ...this.pickIngestAuthHeaders(options.authHeaders),
    };

    try {
      for (let hop = 0; hop <= MAX_HOPS; hop++) {
        if (controller.signal.aborted) {
          throw new BadRequestException(
            ErrorCode.WORKSPACE_DOCUMENT_UPLOAD_FAILED,
            'Failed to download file: timed out',
          );
        }

        this.assertIngestUrlIsHttps(currentUrl);
        if (hop > 0) {
          await this.assertUrlIsSafe(currentUrl);
        }

        const res = await axios.get(currentUrl, {
          responseType: 'stream',
          timeout: deadlineMs,
          signal: controller.signal,
          maxRedirects: 0,
          validateStatus: () => true,
          headers: { ...headers },
        });

        const body = res.data as Readable;

        if (res.status >= 300 && res.status < 400) {
          body.destroy();
          const location = res.headers?.location as string | undefined;
          if (!location) {
            throw new BadRequestException(
              ErrorCode.WORKSPACE_DOCUMENT_UPLOAD_FAILED,
              'Failed to download file: redirect without Location',
            );
          }
          const nextUrl = new URL(location, currentUrl).toString();
          if (new URL(nextUrl).origin !== new URL(currentUrl).origin) {
            for (const key of Object.keys(headers)) {
              if (key.toLowerCase() === 'authorization') {
                delete headers[key];
              }
            }
          }
          currentUrl = nextUrl;
          continue;
        }

        if (res.status < 200 || res.status >= 300) {
          body.destroy();
          throw Object.assign(new Error(`Request failed with status code ${res.status}`), {
            response: { status: res.status },
          });
        }

        const contentLengthHeader = res.headers?.['content-length'];
        if (contentLengthHeader) {
          const contentLength = Number.parseInt(String(contentLengthHeader), 10);
          if (Number.isFinite(contentLength) && contentLength > options.maxBytes) {
            body.destroy();
            throw new BadRequestException(
              ErrorCode.WORKSPACE_DOCUMENT_UPLOAD_FAILED,
              `File size exceeds maximum ${Math.round(options.maxBytes / 1024 / 1024)}MB`,
            );
          }
        }

        const data = await this.readStreamWithByteCap(body, options.maxBytes, controller.signal);
        return {
          data,
          headers: (res.headers ?? {}) as Record<string, string>,
        };
      }

      throw new BadRequestException(
        ErrorCode.WORKSPACE_DOCUMENT_UPLOAD_FAILED,
        'Failed to download file: too many redirects',
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private async readStreamWithByteCap(
    stream: Readable,
    maxBytes: number,
    signal: AbortSignal,
  ): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let total = 0;

    try {
      for await (const chunk of stream) {
        if (signal.aborted) {
          stream.destroy();
          throw new BadRequestException(
            ErrorCode.WORKSPACE_DOCUMENT_UPLOAD_FAILED,
            'Failed to download file: timed out',
          );
        }
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buf.length;
        if (total > maxBytes) {
          stream.destroy();
          throw new BadRequestException(
            ErrorCode.WORKSPACE_DOCUMENT_UPLOAD_FAILED,
            `File size exceeds maximum ${Math.round(maxBytes / 1024 / 1024)}MB`,
          );
        }
        chunks.push(buf);
      }
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      stream.destroy();
      throw error;
    }

    return chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, total);
  }

  private assertIngestUrlIsHttps(url: string): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new BadRequestException(
        ErrorCode.WORKSPACE_DOCUMENT_UPLOAD_FAILED,
        'Only https URLs are allowed for ingest',
      );
    }
    if (parsed.protocol !== 'https:') {
      throw new BadRequestException(
        ErrorCode.WORKSPACE_DOCUMENT_UPLOAD_FAILED,
        'Only https URLs are allowed for ingest',
      );
    }
  }

  private async followGuardedRedirects(
    method: 'head' | 'get',
    url: string,
  ): Promise<{ status: number; data?: unknown } | null> {
    const MAX_HOPS = 5;
    let currentUrl = url;
    const opts = {
      timeout: 5000,
      maxRedirects: 0,
      validateStatus: () => true,
      headers: { 'User-Agent': this.crawlUserAgent },
      ...(method === 'get' ? { responseType: 'stream' as const } : {}),
    };

    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      if (hop > 0) {
        try {
          await this.assertUrlIsSafe(currentUrl);
        } catch {
          return null;
        }
      }

      const res =
        method === 'head'
          ? await axios.head(currentUrl, opts)
          : await axios.get(currentUrl, opts);

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers?.location as string | undefined;
        (res.data as { destroy?: () => void } | undefined)?.destroy?.();
        if (!location) return null;
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      return res;
    }
    return null;
  }
}
