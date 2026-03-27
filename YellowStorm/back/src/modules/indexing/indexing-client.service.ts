import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
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
  private readonly apiAdkUrl: string;
  private readonly username: string;
  private readonly password: string;
  private readonly webhookUrl: string;
  private readonly httpClient: AxiosInstance;
  private accessToken: string | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
    private readonly requestContextService: RequestContextService,
  ) {
    this.logger.setContext('IndexingClientService');
    this.apiUrl = this.configService.get<string>('indexing.apiUrl', 'http://localhost:4000');
    this.apiAdkUrl = this.configService.get<string>('indexing.apiAdk', 'http://localhost:4001');
    this.username = this.configService.get<string>('indexing.username', '');
    this.password = this.configService.get<string>('indexing.password', '');

    const backendUrl = this.configService.get<string>('app.backendUrl', 'http://localhost:3000');
    const apiPrefix = this.configService.get<string>('app.apiPrefix', 'api');
    this.webhookUrl = `${backendUrl}/${apiPrefix}/v1/indexing/webhook`;

    this.httpClient = axios.create({
      baseURL: this.apiUrl,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Attach Bearer token to every request
    this.httpClient.interceptors.request.use((config) => {
      if (this.accessToken) {
        config.headers.Authorization = `Bearer ${this.accessToken}`;
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
    await this.authenticate();
  }

  /**
   * Authenticate with the indexing API and store the access token
   */
  private async authenticate(): Promise<void> {
    if (!this.username || !this.password) {
      this.logger.warn('Indexing API credentials not configured, skipping authentication');
      return;
    }

    try {
      const params = new URLSearchParams();
      params.append('username', this.username);
      params.append('password', this.password);
      const response = await axios.post(`${this.apiAdkUrl}/token`, params, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      this.accessToken = response.data.access_token;
      this.logger.log('Indexing API authentication successful');
    } catch (error: any) {
      this.accessToken = null;
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        this.logger.error('Indexing API authentication failed', {
          status,
          message: error.message,
        });
      } else {
        this.logger.error('Indexing API authentication failed', {
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  }

  /**
   * Refresh access token every 29 minutes (token expires in 29 min)
   */
  @Interval(29 * 60 * 1000)
  async refreshToken(): Promise<void> {
    this.logger.debug('Refreshing indexing API access token');
    await this.authenticate();
  }

  /**
   * Index a document via the external indexing API
   */
  async indexDocument(request: IndexDocumentRequest): Promise<IndexDocumentResponse> {
    this.logger.log('Calling indexing API', {
      endpoint: `${this.apiUrl}/vectorstores/indexDocumentFromAzureDatalake`,
      documentId: request.documentId,
      workspaceId: request.workspaceId,
      filename: request.filename,
      size: request.size,
      request: request,
    });

    try {
      const requestBody = {
        metadata: {
          external_id: request.documentId,
          brain_id: request.workspaceId,
          source: request.blobUrl,
        },
        brain_id: request.workspaceId,
        external_id: request.documentId,
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
      };
      const response = await this.httpClient.post(
        '/vectorstores/indexDocumentFromAzureDatalake',
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

  /**
   * Get index status from the indexing API
   */
  async getIndexStatus(externalId: string): Promise<IndexStatus> {
    this.logger.debug('Calling index status API', {
      endpoint: `${this.apiUrl}/status/${externalId}`,
    });

    return {
      status: 'processing',
      processedAt: new Date(),
    };
  }

  /**
   * Delete index from the indexing API
   */
  async deleteIndex(request: DeleteIndexRequest): Promise<DeleteIndexResponse> {
    this.logger.log('Calling delete index API', {
      endpoint: `${this.apiUrl}/vectorstores/vectorIds/V2`,
      documentId: request.documentId,
      workspaceId: request.workspaceId,
    });

    try {
      await this.httpClient.delete('/vectorstores/vectorIds/V2', {
        data: {
          brain_id: request.workspaceId,
          external_id: request.documentId,
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
