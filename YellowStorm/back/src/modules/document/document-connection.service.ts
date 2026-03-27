import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BlobServiceClient,
  ContainerClient,
  StorageSharedKeyCredential,
} from '@azure/storage-blob';
import { LoggerService } from '../logger';

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

@Injectable()
export class DocumentConnectionService implements OnModuleInit, OnModuleDestroy {
  private blobServiceClient: BlobServiceClient | null = null;
  private containerClient: ContainerClient | null = null;
  private sharedKeyCredential: StorageSharedKeyCredential | null = null;

  private isConnected = false;
  private isConnecting = false;
  private lastError: string | null = null;
  private lastCheckedAt: Date | null = null;
  private reconnectAttempt = 0;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;

  private readonly connectionString: string;
  private readonly containerName: string;
  private readonly accountName: string;
  private readonly reconnectConfig: ReconnectConfig;
  private readonly healthCheckConfig: HealthCheckConfig;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(DocumentConnectionService.name);

    this.connectionString = this.configService.get<string>('storage.azure.connectionString', '');
    this.containerName = this.configService.get<string>('storage.azure.containerName', 'documents');
    this.accountName = this.configService.get<string>('storage.azure.accountName', '');

    this.reconnectConfig = {
      enabled: this.configService.get<boolean>('storage.reconnect.enabled', true),
      initialDelayMs: this.configService.get<number>('storage.reconnect.initialDelayMs', 1000),
      maxDelayMs: this.configService.get<number>('storage.reconnect.maxDelayMs', 30000),
      maxAttempts: this.configService.get<number>('storage.reconnect.maxAttempts', 0),
      multiplier: this.configService.get<number>('storage.reconnect.multiplier', 2),
    };

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
    this.clearReconnectTimeout();
  }

  async connect(): Promise<void> {
    if (this.isConnecting) {
      this.logger.debug('Connection attempt already in progress');
      return;
    }

    if (!this.connectionString) {
      this.logger.warn('Azure Storage connection string not configured. Document service disabled.');
      this.lastError = 'Connection string not configured';
      return;
    }

    this.isConnecting = true;

    try {
      this.logger.log('Attempting to connect to Azure Blob Storage...', {
        attempt: this.reconnectAttempt + 1,
        container: this.containerName,
      },{display:true,save:false});

      this.blobServiceClient = BlobServiceClient.fromConnectionString(this.connectionString);
      this.containerClient = this.blobServiceClient.getContainerClient(this.containerName);

      // Extract account key for SAS generation
      const accountKeyMatch = this.connectionString.match(/AccountKey=([^;]+)/);
      if (accountKeyMatch && this.accountName) {
        this.sharedKeyCredential = new StorageSharedKeyCredential(
          this.accountName,
          accountKeyMatch[1],
        );
      }

      // Verify connection by checking container exists
      await this.containerClient.createIfNotExists({ access: undefined });

      this.isConnected = true;
      this.lastError = null;
      this.lastCheckedAt = new Date();
      this.reconnectAttempt = 0;

      this.logger.log('Azure Blob Storage connection established', {
        container: this.containerName,
        account: this.accountName,
      });
    } catch (error) {
      const err = error as Error;
      this.isConnected = false;
      this.lastError = err.message;
      this.lastCheckedAt = new Date();

      this.logger.error('Azure Blob Storage connection failed', {
        message: err.message,
        attempt: this.reconnectAttempt + 1,
      });

      this.scheduleReconnect();
    } finally {
      this.isConnecting = false;
    }
  }

  async verifyConnection(): Promise<boolean> {
    if (!this.containerClient) {
      this.isConnected = false;
      this.lastError = 'Container client not initialized';
      this.lastCheckedAt = new Date();
      return false;
    }

    try {
      // Perform a lightweight operation to verify connection
      await this.containerClient.getProperties();

      const wasDisconnected = !this.isConnected;
      this.isConnected = true;
      this.lastError = null;
      this.lastCheckedAt = new Date();
      this.reconnectAttempt = 0;

      if (wasDisconnected) {
        this.logger.log('Azure Blob Storage connection restored');
      }

      return true;
    } catch (error) {
      const err = error as Error;
      const wasConnected = this.isConnected;

      this.isConnected = false;
      this.lastError = err.message;
      this.lastCheckedAt = new Date();

      if (wasConnected) {
        this.logger.warn('Azure Blob Storage connection lost', {
          error: err.message,
        });
        this.scheduleReconnect();
      }

      return false;
    }
  }

  private startHealthCheck(): void {
    if (!this.healthCheckConfig.enabled || !this.connectionString) {
      return;
    }

    this.logger.log('Starting Azure Storage health check', {
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

  private scheduleReconnect(): void {
    if (!this.reconnectConfig.enabled) {
      this.logger.warn('Reconnection disabled, Azure Storage will remain disconnected');
      return;
    }

    if (
      this.reconnectConfig.maxAttempts > 0 &&
      this.reconnectAttempt >= this.reconnectConfig.maxAttempts
    ) {
      this.logger.error(
        `Max reconnection attempts (${this.reconnectConfig.maxAttempts}) reached for Azure Storage. Giving up.`,
      );
      return;
    }

    this.clearReconnectTimeout();

    const delay = this.calculateBackoffDelay();
    this.reconnectAttempt++;

    this.logger.log(`Scheduling Azure Storage reconnection attempt ${this.reconnectAttempt} in ${delay}ms`,{display:true,save:false});

    this.reconnectTimeout = setTimeout(() => {
      void this.connect();
    }, delay);

    this.reconnectTimeout.unref();
  }

  private calculateBackoffDelay(): number {
    const { initialDelayMs, maxDelayMs, multiplier } = this.reconnectConfig;

    // Add jitter (±10%) to prevent thundering herd
    const jitter = 0.9 + Math.random() * 0.2;
    const exponentialDelay = initialDelayMs * Math.pow(multiplier, this.reconnectAttempt);
    const delayWithJitter = exponentialDelay * jitter;

    return Math.min(delayWithJitter, maxDelayMs);
  }

  private clearReconnectTimeout(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  // Public accessors

  isAvailable(): boolean {
    return !!this.connectionString;
  }

  isConnectedNow(): boolean {
    return this.isConnected;
  }

  getContainerClient(): ContainerClient | null {
    return this.containerClient;
  }

  getBlobServiceClient(): BlobServiceClient | null {
    return this.blobServiceClient;
  }

  getSharedKeyCredential(): StorageSharedKeyCredential | null {
    return this.sharedKeyCredential;
  }

  getContainerName(): string {
    return this.containerName;
  }

  getHealthStatus(): StorageConnectionStatus {
    return {
      available: this.isAvailable(),
      connected: this.isConnected,
      error: this.lastError,
      lastCheckedAt: this.lastCheckedAt || undefined,
      reconnectAttempts: this.reconnectAttempt,
      isReconnecting: this.reconnectTimeout !== null,
    };
  }
}
