import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, HeadBucketCommand, CreateBucketCommand } from '@aws-sdk/client-s3';
import { LoggerService } from '../logger';
import { randomBackoffJitter } from '@common/utils';

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
  private s3Client: S3Client | null = null;

  private isConnected = false;
  private isConnecting = false;
  private lastError: string | null = null;
  private lastCheckedAt: Date | null = null;
  private reconnectAttempt = 0;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;

  private readonly endpoint: string;
  private readonly region: string;
  private readonly bucket: string;
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;
  private readonly forcePathStyle: boolean;
  private readonly publicUrl: string;
  private readonly reconnectConfig: ReconnectConfig;
  private readonly healthCheckConfig: HealthCheckConfig;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(DocumentConnectionService.name);

    this.endpoint = this.configService.get<string>('storage.s3.endpoint', '');
    this.region = this.configService.get<string>('storage.s3.region', 'us-east-1');
    this.bucket = this.configService.get<string>('storage.s3.bucket', 'documents');
    this.accessKeyId = this.configService.get<string>('storage.s3.accessKeyId', '');
    this.secretAccessKey = this.configService.get<string>('storage.s3.secretAccessKey', '');
    this.forcePathStyle = this.configService.get<boolean>('storage.s3.forcePathStyle', true);
    this.publicUrl = this.configService.get<string>('storage.s3.publicUrl', '');

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
    this.s3Client?.destroy();
  }

  async connect(): Promise<void> {
    if (this.isConnecting) {
      this.logger.debug('Connection attempt already in progress');
      return;
    }

    if (!this.endpoint || !this.accessKeyId || !this.secretAccessKey) {
      this.logger.warn(
        'Ceph S3 credentials not configured (endpoint/accessKey/secretKey). Document service disabled.',
      );
      this.lastError = 'Ceph S3 credentials not configured';
      return;
    }

    this.isConnecting = true;

    try {
      this.logger.log(
        'Attempting to connect to Ceph S3...',
        {
          attempt: this.reconnectAttempt + 1,
          bucket: this.bucket,
          endpoint: this.endpoint,
        },
        { display: true, save: false },
      );

      this.s3Client = new S3Client({
        endpoint: this.endpoint,
        region: this.region,
        credentials: {
          accessKeyId: this.accessKeyId,
          secretAccessKey: this.secretAccessKey,
        },
        forcePathStyle: this.forcePathStyle,
      });

      await this.ensureBucket();

      this.isConnected = true;
      this.lastError = null;
      this.lastCheckedAt = new Date();
      this.reconnectAttempt = 0;

      this.logger.log('Ceph S3 connection established', {
        bucket: this.bucket,
        endpoint: this.endpoint,
      });
    } catch (error) {
      const err = error as Error;
      this.isConnected = false;
      this.lastError = err.message;
      this.lastCheckedAt = new Date();

      this.logger.error('Ceph S3 connection failed', {
        message: err.message,
        attempt: this.reconnectAttempt + 1,
      });

      this.scheduleReconnect();
    } finally {
      this.isConnecting = false;
    }
  }

  private async ensureBucket(): Promise<void> {
    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }

    try {
      await this.s3Client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };
      const status = err.$metadata?.httpStatusCode;
      if (status === 404 || err.name === 'NotFound' || err.name === 'NoSuchBucket') {
        this.logger.log(`Bucket ${this.bucket} not found, creating it`);
        await this.s3Client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      } else {
        throw error;
      }
    }
  }

  async verifyConnection(): Promise<boolean> {
    if (!this.s3Client) {
      this.isConnected = false;
      this.lastError = 'S3 client not initialized';
      this.lastCheckedAt = new Date();
      return false;
    }

    try {
      await this.s3Client.send(new HeadBucketCommand({ Bucket: this.bucket }));

      const wasDisconnected = !this.isConnected;
      this.isConnected = true;
      this.lastError = null;
      this.lastCheckedAt = new Date();
      this.reconnectAttempt = 0;

      if (wasDisconnected) {
        this.logger.log('Ceph S3 connection restored');
      }

      return true;
    } catch (error) {
      const err = error as Error;
      const wasConnected = this.isConnected;

      this.isConnected = false;
      this.lastError = err.message;
      this.lastCheckedAt = new Date();

      if (wasConnected) {
        this.logger.warn('Ceph S3 connection lost', {
          error: err.message,
        });
        this.scheduleReconnect();
      }

      return false;
    }
  }

  private startHealthCheck(): void {
    if (!this.healthCheckConfig.enabled || !this.endpoint) {
      return;
    }

    this.logger.log('Starting Ceph S3 health check', {
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
      this.logger.warn('Reconnection disabled, Ceph S3 will remain disconnected');
      return;
    }

    if (
      this.reconnectConfig.maxAttempts > 0 &&
      this.reconnectAttempt >= this.reconnectConfig.maxAttempts
    ) {
      this.logger.error(
        `Max reconnection attempts (${this.reconnectConfig.maxAttempts}) reached for Ceph S3. Giving up.`,
      );
      return;
    }

    this.clearReconnectTimeout();

    const delay = this.calculateBackoffDelay();
    this.reconnectAttempt++;

    this.logger.log(
      `Scheduling Ceph S3 reconnection attempt ${this.reconnectAttempt} in ${delay}ms`,
      { display: true, save: false },
    );

    this.reconnectTimeout = setTimeout(() => {
      void this.connect();
    }, delay);

    this.reconnectTimeout.unref();
  }

  private calculateBackoffDelay(): number {
    const { initialDelayMs, maxDelayMs, multiplier } = this.reconnectConfig;

    const jitter = randomBackoffJitter();
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
    return !!this.endpoint && !!this.accessKeyId && !!this.secretAccessKey;
  }

  isConnectedNow(): boolean {
    return this.isConnected;
  }

  getS3Client(): S3Client | null {
    return this.s3Client;
  }

  getBucket(): string {
    return this.bucket;
  }

  getPublicUrl(): string {
    return this.publicUrl || this.endpoint;
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
