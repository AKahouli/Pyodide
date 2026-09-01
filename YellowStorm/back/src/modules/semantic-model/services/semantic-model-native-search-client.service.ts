import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import axios from 'axios';
import { createHash } from 'node:crypto';
import semanticModelConfig from '@config/semantic-model.config';
import { ServiceUnavailableException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';

export interface SemanticModelNativeSearchRequest {
  query: string;
  workspace_id: string;
  file_name: string;
}

export interface SemanticModelNativeSearchSection {
  content?: unknown;
  file_name?: unknown;
  page_range?: unknown;
  workspace_id?: unknown;
  section_id?: unknown;
}

export class SemanticModelNativeSearchFatalError extends ServiceUnavailableException {}

@Injectable()
export class SemanticModelNativeSearchClient {
  private readonly logger = new Logger(SemanticModelNativeSearchClient.name);

  constructor(
    @Inject(semanticModelConfig.KEY)
    private readonly config: ConfigType<typeof semanticModelConfig>,
  ) {}

  async search(request: SemanticModelNativeSearchRequest): Promise<SemanticModelNativeSearchSection[]> {
    if (!this.config.nativeSearchAuthToken) {
      throw new SemanticModelNativeSearchFatalError(
        ErrorCode.SERVICE_UNAVAILABLE,
        'SEMANTIC_MODEL_NATIVE_SEARCH_AUTH_TOKEN is not configured',
      );
    }

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const fileMetadata = this.fileMetadata(request.file_name);
        this.logger.debug('Semantic native search request', {
          endpoint: this.config.nativeSearchUrl,
          workspaceId: request.workspace_id,
          ...fileMetadata,
          queryLength: request.query.length,
          ...this.queryMetadata(request.query),
          attempt,
        });
        const { data } = await axios.post<unknown>(
          this.config.nativeSearchUrl,
          request,
          {
            headers: {
              Authorization: `Bearer ${this.config.nativeSearchAuthToken}`,
              'Content-Type': 'application/json',
            },
            timeout: this.config.evidenceSearchTimeoutMs,
          },
        );
        return this.parseSections(data);
      } catch (error) {
        if (error instanceof SemanticModelNativeSearchFatalError) throw error;
        const status = axios.isAxiosError(error) ? error.response?.status : undefined;
        const validationDetails = axios.isAxiosError(error)
          ? this.validationDetails(error.response?.data)
          : [];
        const responseMetadata = axios.isAxiosError(error)
          ? this.responseMetadata(error.response?.data)
          : {};
        const fileMetadata = this.fileMetadata(request.file_name);
        this.logger.warn('Semantic native search request failed', {
          endpoint: this.config.nativeSearchUrl,
          workspaceId: request.workspace_id,
          ...fileMetadata,
          queryLength: request.query.length,
          ...this.queryMetadata(request.query),
          attempt,
          status,
          validationDetails,
          ...responseMetadata,
        });
        if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) {
          const detail = validationDetails.length > 0
            ? `: ${validationDetails.map((item) => `${item.location} [${item.type}]`).join('; ')}`
            : '';
          throw new SemanticModelNativeSearchFatalError(
            ErrorCode.SERVICE_UNAVAILABLE,
            `Semantic native search rejected the request: HTTP ${status}${detail}`,
          );
        }
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          continue;
        }
        const reason = status ? `HTTP ${status}` : 'network or timeout error';
        throw new ServiceUnavailableException(
          ErrorCode.SERVICE_UNAVAILABLE,
          `Semantic native search failed: ${reason}`,
        );
      }
    }
    throw new ServiceUnavailableException(
      ErrorCode.SERVICE_UNAVAILABLE,
      'Semantic native search failed',
    );
  }

  private parseSections(payload: unknown): SemanticModelNativeSearchSection[] {
    const candidate = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as { result?: unknown }).result
      : payload;
    if (!Array.isArray(candidate)) {
      throw new SemanticModelNativeSearchFatalError(
        ErrorCode.SERVICE_UNAVAILABLE,
        'Semantic native search returned an invalid response',
      );
    }
    return candidate.filter(
      (section): section is SemanticModelNativeSearchSection =>
        section !== null && typeof section === 'object' && !Array.isArray(section),
    );
  }

  private validationDetails(payload: unknown): Array<{
    location: string;
    type: string;
  }> {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
    const detail = (payload as { detail?: unknown }).detail;
    if (!Array.isArray(detail)) return [];
    return detail.slice(0, 10).flatMap((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const value = item as Record<string, unknown>;
      const location = Array.isArray(value['loc'])
        ? value['loc'].slice(0, 5).map((part) => String(part).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 50)).join('.')
        : 'request';
      const type = typeof value['type'] === 'string'
        ? value['type'].replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 80) || 'validation_error'
        : 'validation_error';
      return [{ location: location || 'request', type }];
    });
  }

  private fileMetadata(fileName: string): {
    fileNameHash: string;
    fileNameLength: number;
    fileExtension: string;
  } {
    const extensionMatch = fileName.match(/\.([a-zA-Z0-9]{1,10})$/);
    return {
      fileNameHash: createHash('sha256').update(fileName).digest('hex').slice(0, 12),
      fileNameLength: fileName.length,
          fileExtension: extensionMatch ? extensionMatch[1].toLowerCase() : 'none',
    };
  }

  private queryMetadata(query: string): { query?: string } {
    if (!this.config.nativeSearchLogQuery) return {};
    return {
      query: query.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500),
    };
  }

  private responseMetadata(payload: unknown): {
    responseBodyType: string;
    responseKeys?: string[];
  } {
    if (payload === null) return { responseBodyType: 'null' };
    if (Array.isArray(payload)) return { responseBodyType: 'array' };
    if (typeof payload !== 'object') return { responseBodyType: typeof payload };
    return {
      responseBodyType: 'object',
      responseKeys: Object.keys(payload)
        .slice(0, 20)
        .map((key) => key.replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 80))
        .filter(Boolean),
    };
  }
}
