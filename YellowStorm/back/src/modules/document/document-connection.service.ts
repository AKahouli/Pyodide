import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../logger';
import { ReconnectBackoff } from '@common/utils';
import { AzureStorageBackend, type AzureBackendConfig } from './storage/azure.backend';
import { S3StorageBackend, type S3BackendConfig } from './storage/s3.backend';
import type { StorageBackend } from './storage/types';

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

export interface StorageConnectionStatus {
  available: boolean;
  connected: boolean;
  error: string | null;
  lastCheckedAt?: Date;
  reconnectAttempts: number;
  isReconnecting: boolean;
}

type StorageProvider = 'ceph' | 'azure';

@Injectable()
export class DocumentConnectionService implements OnModuleInit, OnModuleDestroy {
  private backend: StorageBackend | null = null;

  private isConnected = false;
  private isConnecting = false;
  private lastError: string | null = null;
  private lastCheckedAt: Date | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;

  private readonly provider: StorageProvider;
  private readonly providerLabel: string;
  private readonly s3Config: S3BackendConfig;
  private readonly azureConfig: AzureBackendConfig;
  private readonly reconnectConfig: ReconnectConfig;
  private readonly reconnect: ReconnectBackoff;
  private readonly healthCheckConfig: HealthCheckConfig;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(DocumentConnectionService.name);

    this.provider =
      this.configService.get<string>('storage.provider', 'ceph') === 'azure' ? 'azure' : 'ceph';
    this.providerLabel = this.provider === 'azure' ? 'Azure Blob' : 'Ceph S3';

    this.s3Config = {
      endpoint: this.configService.get<string>('storage.s3.endpoint', ''),
      region: this.configService.get<string>('storage.s3.region', 'us-east-1'),
      bucket: this.configService.get<string>('storage.s3.bucket', 'documents'),
      accessKeyId: this.configService.get<string>('storage.s3.accessKeyId', ''),
      secretAccessKey: this.configService.get<string>('storage.s3.secretAccessKey', ''),
      forcePathStyle: this.configService.get<boolean>('storage.s3.forcePathStyle', true),
      publicUrl: this.configService.get<string>('storage.s3.publicUrl', ''),
    };

    this.azureConfig = {
      connectionString: this.configService.get<string>('storage.azure.connectionString', ''),
      container: this.configService.get<string>('storage.azure.container', 'documents'),
    };

    this.reconnectConfig = {
      enabled: this.configService.get<boolean>('storage.reconnect.enabled', true),
      initialDelayMs: this.configService.get<number>('storage.reconnect.initialDelayMs', 1000),
      maxDelayMs: this.configService.get<number>('storage.reconnect.maxDelayMs', 30000),
      maxAttempts: this.configService.get<number>('storage.reconnect.maxAttempts', 0),
      multiplier: this.configService.get<number>('storage.reconnect.multiplier', 2),
    };

    this.reconnect = new ReconnectBackoff(this.reconnectConfig, {
      connect: () => this.connect(),
      label: () => 'Ceph S3',
      log: (message) => { this.logger.log(message, { display: true, save: false }); },
      warn: (message) => { this.logger.warn(message); },
      error: (message) => { this.logger.error(message); },
    });

    this.healthCheckConfig = {
      enabled: this.configService.get<boolean>('storage.healthCheck.enabled', true),
      intervalMs: this.configService.get<number>('storage.healthCheck.intervalMs', 60000),
    };
  }

  async onModuleInit(): Promise<void> {
    await this.connect();
    this.startHealthCheck();
  }

  onModuleDestroy(): void {
    this.stopHealthCheck();
    this.reconnect.clear();
    this.backend?.destroy();
  }

  async connect(): Promise<void> {
    if (this.isConnecting) {
      this.logger.debug('Connection attempt already in progress');
      return;
    }

    if (!this.isAvailable()) {
      this.logger.warn(
        `${this.providerLabel} credentials not configured. Document service disabled.`,
      );
      this.lastError = `${this.providerLabel} credentials not configured`;
      return;
    }

    this.isConnecting = true;

    try {
      this.logger.log(
        `Attempting to connect to ${this.providerLabel}...`,
        { attempt: this.reconnect.attempts + 1, target: this.describeTarget() },
        { display: true, save: false },
      );

      const backend = this.createBackend();
      await backend.connect();
      this.backend = backend;

      this.isConnected = true;
      this.lastError = null;
      this.lastCheckedAt = new Date();
      this.reconnect.reset();

      this.logger.log(`${this.providerLabel} connection established`, {
        target: this.describeTarget(),
      });
    } catch (error) {
      const err = error as Error;
      this.isConnected = false;
      this.lastError = err.message;
      this.lastCheckedAt = new Date();

      this.logger.error(`${this.providerLabel} connection failed`, {
        message: err.message,
        attempt: this.reconnect.attempts + 1,
      });

      this.reconnect.schedule();
    } finally {
      this.isConnecting = false;
    }
  }

  private createBackend(): StorageBackend {
    if (this.provider === 'azure') {
      return new AzureStorageBackend(this.azureConfig);
    }

    return new S3StorageBackend(this.s3Config, {
      log: (message, context) => this.logger.log(message, context),
      warn: (message, context) => this.logger.warn(message, context),
    });
  }

  private describeTarget(): string {
    return this.provider === 'azure'
      ? this.azureConfig.container
      : `${this.s3Config.endpoint}/${this.s3Config.bucket}`;
  }

  async verifyConnection(): Promise<boolean> {
    if (!this.backend) {
      this.isConnected = false;
      this.lastError = 'Storage backend not initialized';
      this.lastCheckedAt = new Date();
      return false;
    }

    try {
      await this.backend.verify();

      const wasDisconnected = !this.isConnected;
      this.isConnected = true;
      this.lastError = null;
      this.lastCheckedAt = new Date();
      this.reconnect.reset();

      if (wasDisconnected) {
        this.logger.log(`${this.providerLabel} connection restored`);
      }

      return true;
    } catch (error) {
      const err = error as Error;
      const wasConnected = this.isConnected;

      this.isConnected = false;
      this.lastError = err.message;
      this.lastCheckedAt = new Date();

      if (wasConnected) {
        this.logger.warn(`${this.providerLabel} connection lost`, { error: err.message });
        this.reconnect.schedule();
      }

      return false;
    }
  }

  private startHealthCheck(): void {
    if (!this.healthCheckConfig.enabled || !this.isAvailable()) {
      return;
    }

    this.logger.log(`Starting ${this.providerLabel} health check`, {
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


  // Public accessors

  isAvailable(): boolean {
    if (this.provider === 'azure') {
      return !!this.azureConfig.connectionString;
    }
    return !!this.s3Config.endpoint && !!this.s3Config.accessKeyId && !!this.s3Config.secretAccessKey;
  }

  isConnectedNow(): boolean {
    return this.isConnected;
  }

  getBackend(): StorageBackend | null {
    return this.backend;
  }

  getHealthStatus(): StorageConnectionStatus {
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
