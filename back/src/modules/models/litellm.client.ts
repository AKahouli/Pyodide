import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosError } from 'axios';
import { LoggerService } from '../logger';
import {
  LiteLLMModelInfoEntry,
  LiteLLMModelInfoResponse,
  LiteLLMHealthStatus,
} from './interfaces/model.interface';
import { LiteLLMConnectionService, LiteLLMConnectionStatus } from './litellm-connection.service';

@Injectable()
export class LiteLLMClient {
  private readonly modelsEndpoint: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
    private readonly connectionService: LiteLLMConnectionService,
  ) {
    this.modelsEndpoint = this.configService.get<string>(
      'litellm.modelsEndpoint',
      '/v1/model/info',
    );
  }

  async fetchModels(): Promise<LiteLLMModelInfoEntry[]> {
    const httpClient = this.connectionService.getHttpClient();
    if (!httpClient) {
      this.logger.warn('LiteLLM client not initialized, cannot fetch models', {
        context: 'LiteLLMClient',
      });
      return [];
    }

    try {
      const response = await httpClient.get<LiteLLMModelInfoResponse>(
        this.modelsEndpoint,
      );

      return response.data.data || [];
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);
      this.logger.error('Failed to fetch models from LiteLLM', {
        context: 'LiteLLMClient',
        error: errorMessage,
      });

      return [];
    }
  }

  async checkHealth(): Promise<boolean> {
    return this.connectionService.verifyConnection();
  }

  getHealthStatus(): LiteLLMConnectionStatus {
    return this.connectionService.getHealthStatus();
  }

  isConfigured(): boolean {
    return this.connectionService.isConfigured();
  }

  private extractErrorMessage(error: unknown): string {
    if (error instanceof AxiosError) {
      if (error.response) {
        return `HTTP ${error.response.status}: ${error.response.statusText}`;
      }
      if (error.code === 'ECONNREFUSED') {
        return 'Connection refused';
      }
      if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
        return 'Connection timeout';
      }
      return error.message;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return 'Unknown error';
  }
}
