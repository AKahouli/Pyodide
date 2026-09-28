import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, AxiosError } from 'axios';
import { LoggerService } from '../logger';
import { ReconnectBackoff } from '@common/utils';

interface ReconnectConfig {
  enabled: boolean;
  initialDelayMs: number;
  maxDelayMs: number;
  maxAttempts: number;
  multiplier: number;
}

interface HealthCheckConfig {
  enabled: boolean;
  intervalMs: number;
}

export interface LiteLLMConnectionStatus {
  available: boolean;
  connected: boolean;
  error: string | null;
  lastCheckedAt?: Date;
  reconnectAttempts: number;
  isReconnecting: boolean;
}

// Surfaces the proxy's error body (the part that says WHY a request failed —
// invalid model name, context overflow, unsupported response_format...) instead
// of Axios's generic "Request failed with status code N".
export function describeLiteLlmHttpError(error: unknown): string {
  if (error instanceof AxiosError) {
    if (error.code === 'ECONNREFUSED') {
      return 'Connection refused';
    }
    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
      return 'Connection timeout';
    }
    if (error.response) {
      const data = error.response.data as unknown;
      let detail = '';
      if (typeof data === 'string') {
        detail = data.trim();
      } else if (data && typeof data === 'object') {
        const record = data as Record<string, unknown>;
        const candidate = (record.error ?? record.detail ?? record.message) as unknown;
        if (typeof candidate === 'string') {
          detail = candidate;
        } else if (candidate && typeof candidate === 'object' && typeof (candidate as { message?: unknown }).message === 'string') {
          detail = (candidate as { message: string }).message;
        } else {
          detail = JSON.stringify(data);
        }
      }
      detail = detail ? `: ${detail.slice(0, 500)}` : `: ${error.response.statusText}`;
      return `HTTP ${error.response.status}${detail}`;
    }
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Unknown error';
}

@Injectable()
export class LiteLLMConnectionService implements OnModuleInit, OnModuleDestroy {
  private httpClient: AxiosInstance | null = null;

  private isConnected = false;
  private isConnecting = false;
  private lastError: string | null = null;
  private lastCheckedAt: Date | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;

  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly healthEndpoint: string;
  private readonly reconnectConfig: ReconnectConfig;
  private readonly reconnect: ReconnectBackoff;
  private readonly healthCheckConfig: HealthCheckConfig;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(LiteLLMConnectionService.name);

    this.apiUrl = this.configService.get<string>('litellm.apiUrl', '');
    this.apiKey = this.configService.get<string>('litellm.apiKey', '');
    this.timeoutMs = this.configService.get<number>('litellm.timeoutMs', 10000);
    this.healthEndpoint = this.configService.get<string>('litellm.healthEndpoint', '/health/readiness');

    this.reconnectConfig = {
      enabled: this.configService.get<boolean>('litellm.reconnect.enabled', true),
      initialDelayMs: this.configService.get<number>('litellm.reconnect.initialDelayMs', 1000),
      maxDelayMs: this.configService.get<number>('litellm.reconnect.maxDelayMs', 30000),
      maxAttempts: this.configService.get<number>('litellm.reconnect.maxAttempts', 0),
      multiplier: this.configService.get<number>('litellm.reconnect.multiplier', 2),
    };

    this.reconnect = new ReconnectBackoff(this.reconnectConfig, {
      connect: () => this.connect(),
      label: () => 'LiteLLM',
      log: (message) => this.logger.log(message, { display: true, save: false }),
      warn: (message) => this.logger.warn(message),
      error: (message) => this.logger.error(message),
    });

    this.healthCheckConfig = {
      enabled: this.configService.get<boolean>('litellm.healthCheck.enabled', true),
      intervalMs: this.configService.get<number>('litellm.healthCheck.intervalMs', 60000),
    };
  }

  async onModuleInit(): Promise<void> {
    await this.connect();
    this.startHealthCheck();
  }

  onModuleDestroy(): void {
    this.stopHealthCheck();
    this.reconnect.clear();
  }

  async connect(): Promise<void> {
    if (this.isConnecting) {
      this.logger.debug('Connection attempt already in progress');
      return;
    }

    if (!this.apiUrl) {
      this.logger.warn('LiteLLM API URL not configured, skipping initialization');
      this.lastError = 'LiteLLM API URL not configured';
      return;
    }

    this.isConnecting = true;
    try {
      this.logger.log('Attempting to connect to LiteLLM...', {
        attempt: this.reconnect.attempts + 1,
        apiUrl: this.maskUrl(this.apiUrl),
      },{display:true,save:false});

      // Create or recreate HTTP client
      this.httpClient = axios.create({
        baseURL: this.apiUrl,
        timeout: this.timeoutMs,
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey && { Authorization: `Bearer ${this.apiKey}` }),
        },
      });

      // Test connection with health check
      await this.httpClient.get(this.healthEndpoint);

      this.isConnected = true;
      this.lastError = null;
      this.lastCheckedAt = new Date();
      this.reconnect.reset();

      this.logger.log('LiteLLM connection established', {
        apiUrl: this.maskUrl(this.apiUrl),
      });
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);
      this.isConnected = false;
      this.lastError = errorMessage;
      this.lastCheckedAt = new Date();

      this.logger.error('LiteLLM connection failed', {
        message: errorMessage,
        attempt: this.reconnect.attempts + 1,
      });

      this.reconnect.schedule();
    } finally {
      this.isConnecting = false;
    }
  }

  async verifyConnection(): Promise<boolean> {
    if (!this.httpClient) {
      this.isConnected = false;
      this.lastError = 'HTTP client not initialized';
      this.lastCheckedAt = new Date();
      return false;
    }

    try {
      await this.httpClient.get(this.healthEndpoint);

      const wasDisconnected = !this.isConnected;
      this.isConnected = true;
      this.lastError = null;
      this.lastCheckedAt = new Date();
      this.reconnect.reset();

      if (wasDisconnected) {
        this.logger.log('LiteLLM connection restored');
      }

      return true;
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);
      const wasConnected = this.isConnected;

      this.isConnected = false;
      this.lastError = errorMessage;
      this.lastCheckedAt = new Date();

      if (wasConnected) {
        this.logger.warn('LiteLLM connection lost', {
          error: errorMessage,
        });
        this.reconnect.schedule();
      }

      return false;
    }
  }

  private startHealthCheck(): void {
    if (!this.healthCheckConfig.enabled || !this.apiUrl) {
      return;
    }

    this.logger.log('Starting LiteLLM health check', {
      intervalMs: this.healthCheckConfig.intervalMs,
    });

    this.healthCheckInterval = setInterval(async () => {
      await this.verifyConnection();
    }, this.healthCheckConfig.intervalMs);

    this.healthCheckInterval.unref();
  }

  private stopHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }


  private maskUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      return `${urlObj.protocol}//${urlObj.host}`;
    } catch {
      return url.substring(0, 30) + '...';
    }
  }

  private extractErrorMessage(error: unknown): string {
    return describeLiteLlmHttpError(error);
  }

  // Public accessors

  isConfigured(): boolean {
    return !!this.apiUrl;
  }

  isAvailable(): boolean {
    return this.isConfigured();
  }

  isConnectedNow(): boolean {
    return this.isConnected;
  }

  getHttpClient(): AxiosInstance | null {
    return this.httpClient;
  }

  getHealthStatus(): LiteLLMConnectionStatus {
    return {
      available: this.isAvailable(),
      connected: this.isConnected,
      error: this.lastError,
      lastCheckedAt: this.lastCheckedAt || undefined,
      reconnectAttempts: this.reconnect.attempts,
      isReconnecting: this.reconnect.isWaiting,
    };
  }
}
