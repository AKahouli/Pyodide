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

export interface SemanticModelNativeSearchBatchResult {
  sections: SemanticModelNativeSearchSection[];
  error: string | null;
}

interface NativeSearchBatchResponseItem {
  id?: unknown;
  result?: unknown;
  error?: unknown;
}

const NATIVE_SEARCH_BATCH_SIZE = 10;

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
            // No timeout: the semantic-model pipeline is a background job driven by the
            // build orchestrator + heartbeat. Native search can legitimately take a long time
            // for large evidence sets.
            timeout: 0,
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

  async searchBatch(
    requests: SemanticModelNativeSearchRequest[],
  ): Promise<SemanticModelNativeSearchBatchResult[]> {
    if (requests.length === 0) return [];
    if (requests.length > NATIVE_SEARCH_BATCH_SIZE) {
      throw new SemanticModelNativeSearchFatalError(
        ErrorCode.SERVICE_UNAVAILABLE,
        `Semantic native search batch exceeds the ${NATIVE_SEARCH_BATCH_SIZE}-request limit`,
      );
    }
    if (!this.config.nativeSearchAuthToken) {
      throw new SemanticModelNativeSearchFatalError(
        ErrorCode.SERVICE_UNAVAILABLE,
        'SEMANTIC_MODEL_NATIVE_SEARCH_AUTH_TOKEN is not configured',
      );
    }

    const batchedRequests = requests.map((request, index) => ({
      id: String(index),
      ...request,
    }));
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        this.logger.debug('Semantic native search batch request', {
          endpoint: this.config.nativeSearchBatchUrl,
          requestCount: requests.length,
          attempt,
        });
        const { data } = await axios.post<unknown>(
          this.config.nativeSearchBatchUrl,
          { requests: batchedRequests },
          {
            headers: {
              Authorization: `Bearer ${this.config.nativeSearchAuthToken}`,
              'Content-Type': 'application/json',
            },
            // No timeout: the semantic-model pipeline is a background job driven by the
            // build orchestrator + heartbeat. Native search can legitimately take a long time
            // for large evidence sets.
            timeout: 0,
          },
        );
        return this.parseBatchResults(data, requests.length);
      } catch (error) {
        if (error instanceof SemanticModelNativeSearchFatalError) throw error;
        const status = axios.isAxiosError(error) ? error.response?.status : undefined;
        const validationDetails = axios.isAxiosError(error)
          ? this.validationDetails(error.response?.data)
          : [];
        this.logger.warn('Semantic native search batch request failed', {
          endpoint: this.config.nativeSearchBatchUrl,
          requestCount: requests.length,
          attempt,
          status,
          validationDetails,
        });
        if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) {
          const detail = validationDetails.length > 0
            ? `: ${validationDetails.map((item) => `${item.location} [${item.type}]`).join('; ')}`
            : '';
          throw new SemanticModelNativeSearchFatalError(
            ErrorCode.SERVICE_UNAVAILABLE,
            `Semantic native search batch rejected the request: HTTP ${status}${detail}`,
          );
        }
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          continue;
        }
        const reason = status ? `HTTP ${status}` : 'network or timeout error';
        throw new ServiceUnavailableException(
          ErrorCode.SERVICE_UNAVAILABLE,
          `Semantic native search batch failed: ${reason}`,
        );
      }
    }
    throw new ServiceUnavailableException(
      ErrorCode.SERVICE_UNAVAILABLE,
      'Semantic native search batch failed',
    );
  }

  private parseBatchResults(payload: unknown, requestCount: number): SemanticModelNativeSearchBatchResult[] {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw this.invalidBatchResponse();
    }
    const items = (payload as { results?: unknown }).results;
    if (!Array.isArray(items) || items.length !== requestCount) {
      throw this.invalidBatchResponse();
    }
    const byId = new Map<string, NativeSearchBatchResponseItem>();
    for (const item of items) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw this.invalidBatchResponse();
      const value = item as NativeSearchBatchResponseItem;
      if (typeof value.id !== 'string' || byId.has(value.id)) throw this.invalidBatchResponse();
      byId.set(value.id, value);
    }
    return Array.from({ length: requestCount }, (_, index) => {
      const item = byId.get(String(index));
      if (!item) throw this.invalidBatchResponse();
      if (item.error != null) {
        return { sections: [], error: this.batchItemError(item.error) };
      }
      return { sections: this.parseSections(item.result), error: null };
    });
  }

  private batchItemError(error: unknown): string {
    if (typeof error === 'string') return error.slice(0, 300) || 'Native search failed';
    if (error && typeof error === 'object' && !Array.isArray(error)) {
      const message = (error as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim()) return message.trim().slice(0, 300);
    }
    return 'Native search failed';
  }

  private invalidBatchResponse(): SemanticModelNativeSearchFatalError {
    return new SemanticModelNativeSearchFatalError(
      ErrorCode.SERVICE_UNAVAILABLE,
      'Semantic native search returned an invalid batch response',
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
