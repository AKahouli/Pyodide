import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
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
  private readonly httpClient: AxiosInstance;

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

    this.httpClient = axios.create({
      baseURL: this.apiUrl,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Attach API key to every request
    this.httpClient.interceptors.request.use((config) => {
      if (this.vectorstoreApiKey) {
        config.headers['x-api-key'] = this.vectorstoreApiKey;
      }
      return config;
    });

    // Propagate request/correlation IDs to external API
    this.httpClient.interceptors.request.use((config) => {
      const requestId = this.requestContextService.getRequestId();
      const correlationId = this.requestContextService.getCorrelationId();
      if (requestId) {
        config.headers['X-Request-ID'] = requestId;
      }
      if (correlationId) {
        config.headers['X-Correlation-ID'] = correlationId;
      }
      return config;
    });
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
      mistral: request.mistralIndex || false,
    };

    try {
      const response = await this.httpClient.post(
        '/vectorstores/indexDocumentFromCephStore',
        requestBody,
      );

      const { download_id, indexing_id } = response.data;
      this.logger.log('Indexing API call successful', {
        documentId: request.documentId,
        download_id,
        indexing_id,
        request: requestBody,
      });
      return { download_id, indexing_id };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const data = error.response?.data;
        const message = `Indexing API error: ${status} - ${JSON.stringify(data) || error.message}`;
        this.logger.error(message, {
          documentId: request.documentId,
          status,
          responseData: data,
        });
        throw new Error(message);
      }
      throw error;
    }
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
      await this.httpClient.delete('/vectorstores/vectorIds/V2', {
        data: {
          workspace_name: request.workspaceName,
          file_path: request.filePath,
          file_name: request.fileName,
        },
      });

      this.logger.debug('Delete index API success', {
        documentId: request.documentId,
      });

      return { success: true };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const data = error.response?.data;
        const message = `Delete index API error: ${status} - ${JSON.stringify(data) || error.message}`;
        this.logger.warn(message, {
          documentId: request.documentId,
          status,
        });
        return { success: false, error: message };
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
