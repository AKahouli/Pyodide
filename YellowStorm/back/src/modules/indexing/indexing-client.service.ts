import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../logger';
import { RequestContextService } from '../request-context';
import type {
  IndexingClient,
  IndexDocumentRequest,
  IndexDocumentResponse,
  DeleteIndexRequest,
  DeleteIndexResponse,
  IndexStatus,
} from './interfaces/indexing.interface';

@Injectable()
export class IndexingClientService implements IndexingClient, OnModuleInit {
  private readonly apiUrl: string;
  private readonly vectorstoreApiKey: string;
  private readonly webhookUrl: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
    private readonly requestContextService: RequestContextService,
  ) {
    this.logger.setContext('IndexingClientService');
    this.apiUrl = this.configService.get<string>('indexing.apiUrl', 'http://localhost:4000');
    this.vectorstoreApiKey = this.configService.get<string>('indexing.vectorstoreApiKey', '');

    const backendUrl = this.configService.get<string>('app.backendUrl', 'http://localhost:3000');
    const apiPrefix = this.configService.get<string>('app.apiPrefix', 'api');
    this.webhookUrl = `${backendUrl}/${apiPrefix}/v1/indexing/webhook`;
  }

  /** Replaces the former axios request interceptors: static API key + request/correlation ID propagation. */
  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.vectorstoreApiKey) {
      headers['x-api-key'] = this.vectorstoreApiKey;
    }
    const requestId = this.requestContextService.getRequestId();
    const correlationId = this.requestContextService.getCorrelationId();
    if (requestId) {
      headers['X-Request-ID'] = requestId;
    }
    if (correlationId) {
      headers['X-Correlation-ID'] = correlationId;
    }
    return headers;
  }

  async onModuleInit(): Promise<void> {
    if (this.webhookUrl.includes('localhost') || this.webhookUrl.includes('127.0.0.1')) {
      this.logger.warn(
        'Indexing webhook URL points to localhost — set BACKEND_URL to a publicly reachable URL or status callbacks will never arrive',
        { webhookUrl: this.webhookUrl },
      );
    } else {
      this.logger.log('Indexing webhook URL configured', { webhookUrl: this.webhookUrl });
    }

    if (!this.vectorstoreApiKey) {
      this.logger.warn(
        'VECTORSTORE_API_KEY is not configured — calls to the indexing API will be rejected (401)',
      );
    }
  }

  async indexDocument(request: IndexDocumentRequest): Promise<IndexDocumentResponse> {
    this.logger.log('Calling indexing API', {
      endpoint: `${this.apiUrl}/vectorstores/indexDocumentFromCephStore`,
      documentId: request.documentId,
      workspaceId: request.workspaceId,
      filename: request.filename,
      size: request.size,
      request: request,
    });

    const requestBody = {
      metadata: {
        external_id: request.documentId,
        brain_id: request.workspaceId,
        source: request.blobUrl,
        user_id: request.user_id,
      },
      brain_id: request.workspaceId,
      external_id: request.documentId,
      workspace_name: request.workspaceName,
      file_name: request.fileName,
      filepath: request.path,
      source: request.blobUrl,
      chunk_size: request.chunkSize,
      chunk_overlap: 400,
      lang_code: 'fr',
      enable_smart_chunk: request.enableSmartChunk,
      brain_type: 'doc',
      enable_extract_images: true,
      webhook_url: this.webhookUrl,
      oneshot_prompt: request.oneshotPrompt || undefined,
      brain_tag: [''],
      deep_research: request.deepSearch || false,
    };

    const res = await fetch(`${this.apiUrl}/vectorstores/indexDocumentFromCephStore`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      const body = await res.text();
      let data: unknown = body;
      try { data = JSON.parse(body) as unknown; } catch { /* non-JSON error body */ }
      const message = `Indexing API error: ${res.status} - ${JSON.stringify(data) || 'request failed'}`;
      this.logger.error(message, {
        documentId: request.documentId,
        status: res.status,
        responseData: data,
      });
      throw new Error(message);
    }

    const { download_id, indexing_id } = await res.json() as { download_id: string; indexing_id: string };
    this.logger.log('Indexing API call successful', {
      documentId: request.documentId,
      download_id,
      indexing_id,
      request: requestBody,
    });
    return { download_id, indexing_id };
  }

  async getIndexStatus(externalId: string): Promise<IndexStatus> {
    this.logger.debug('Calling index status API', {
      endpoint: `${this.apiUrl}/status/${externalId}`,
    });

    return {
      status: 'processing',
      processedAt: new Date(),
    };
  }

  async deleteIndex(request: DeleteIndexRequest): Promise<DeleteIndexResponse> {
    this.logger.log('Calling delete index API', {
      endpoint: `${this.apiUrl}/vectorstores/vectorIds/V2`,
      documentId: request.documentId,
      workspaceId: request.workspaceId,
      workspaceName: request.workspaceName,
      filePath: request.filePath,
      fileName: request.fileName,
    });

    try {
      const res = await fetch(`${this.apiUrl}/vectorstores/vectorIds/V2`, {
        method: 'DELETE',
        headers: this.buildHeaders(),
        body: JSON.stringify({
          workspace_name: request.workspaceName,
          file_path: request.filePath,
          file_name: request.fileName,
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        let data: unknown = body;
        try { data = JSON.parse(body) as unknown; } catch { /* non-JSON error body */ }
        const message = `Delete index API error: ${res.status} - ${JSON.stringify(data) || 'request failed'}`;
        this.logger.warn(message, {
          documentId: request.documentId,
          status: res.status,
        });
        return { success: false, error: message };
      }

      this.logger.debug('Delete index API success', {
        documentId: request.documentId,
      });

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
