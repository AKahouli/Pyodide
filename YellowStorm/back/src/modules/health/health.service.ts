import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthCheckResult, HealthCheckDetail } from './interfaces/health.interface';
import { DatabaseConnectionService } from '../database';
import { DocumentConnectionService } from '../document/document-connection.service';
import { EmailConnectionService } from '../email/email-connection.service';
import { UsageService, UsageType } from '../usage';
import { ModelsService } from '../models';
import { LiteLLMConnectionService } from '../models/litellm-connection.service';
import { StreamService } from '../conversation/services/stream.service';
import { ConversationV2GrpcClientService } from '../conversation-v2/services/conversation-v2.grpc-client.service';

@Injectable()
export class HealthService {
  private readonly startTime = Date.now();
  private readonly version = process.env.npm_package_version || '0.0.1';
  private readonly memoryLimitBytes: number;

  constructor(
    private readonly dbConnection: DatabaseConnectionService,
    private readonly documentConnection: DocumentConnectionService,
    private readonly emailConnection: EmailConnectionService,
    private readonly configService: ConfigService,
    private readonly usageService: UsageService,
    private readonly modelsService: ModelsService,
    private readonly litellmConnection: LiteLLMConnectionService,
    private readonly streamService: StreamService,
    private readonly conversationV2Grpc: ConversationV2GrpcClientService,
  ) {
    const memoryLimitMb = this.configService.get<number>('app.memoryLimitMb', 512);
    this.memoryLimitBytes = memoryLimitMb * 1024 * 1024;
  }

  async check(userId?:string): Promise<HealthCheckResult> {
    // Run all checks in parallel — network pings are independent
    const [memory, eventLoop, database, storage, email, litellm, conversationGrpc, conversationV2Grpc] =
      await Promise.all([
        this.checkMemory(),
        this.checkEventLoop(),
        this.checkDatabase(),
        this.checkStorage(),
        this.checkEmail(),
        this.checkLiteLLM(),
        this.checkConversationGrpc(),
        this.checkConversationV2Grpc(),
      ]);

    const checks: Record<string, HealthCheckDetail> = {
      memory, eventLoop, database, storage, email, litellm, conversationGrpc, conversationV2Grpc,
    };

    const allUp = Object.values(checks).every((c) => c.status === 'up');
    const anyDown = Object.values(checks).some((c) => c.status === 'down');
    let status: 'healthy' | 'unhealthy' | 'degraded';
    if (allUp) {
      status = 'healthy';
    } else if (anyDown) {
      status = 'unhealthy';
    } else {
      status = 'degraded';
    }
    return {
      status,
      timestamp: new Date().toISOString(),
      version: this.version,
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      checks,
    };
  }

  async liveness(): Promise<{ status: 'ok' }> {
    return { status: 'ok' };
  }

  async readiness(): Promise<{ status: 'ok' | 'not_ready'; checks: Record<string, boolean> }> {
    const checks: Record<string, boolean> = {};

    const memoryCheck = await this.checkMemory();
    checks.memory = memoryCheck.status === 'up';

    const databaseCheck = await this.checkDatabase();
    checks.database = databaseCheck.status === 'up';

    const storageCheck = await this.checkStorage();
    checks.storage = storageCheck.status === 'up';

    const emailCheck = await this.checkEmail();
    checks.email = emailCheck.status === 'up';

    const litellmCheck = await this.checkLiteLLM();
    checks.litellm = litellmCheck.status === 'up';

    const conversationGrpcCheck = await this.checkConversationGrpc();
    checks.conversationGrpc = conversationGrpcCheck.status === 'up';

    const conversationV2GrpcCheck = await this.checkConversationV2Grpc();
    checks.conversationV2Grpc = conversationV2GrpcCheck.status === 'up';

    const allReady = Object.values(checks).every(Boolean);

    return {
      status: allReady ? 'ok' : 'not_ready',
      checks,
    };
  }

  private async checkMemory(): Promise<HealthCheckDetail> {
    const startTime = Date.now();
    const memoryUsage = process.memoryUsage();
    const rssBytes = memoryUsage.rss;
    const usagePercent = (rssBytes / this.memoryLimitBytes) * 100;
    const rssMb = Math.round(rssBytes / 1024 / 1024);
    const limitMb = Math.round(this.memoryLimitBytes / 1024 / 1024);

    let status: 'up' | 'down' | 'degraded';
    let message: string;

    if (usagePercent < 70) {
      status = 'up';
      message = `RSS: ${rssMb}MB / ${limitMb}MB (${usagePercent.toFixed(1)}%)`;
    } else if (usagePercent < 90) {
      status = 'degraded';
      message = `High memory: ${rssMb}MB / ${limitMb}MB (${usagePercent.toFixed(1)}%)`;
    } else {
      status = 'down';
      message = `Critical memory: ${rssMb}MB / ${limitMb}MB (${usagePercent.toFixed(1)}%)`;
    }

    return {
      status,
      responseTime: Date.now() - startTime,
      message,
      lastChecked: new Date().toISOString(),
    };
  }

  private async checkEventLoop(): Promise<HealthCheckDetail> {
    const startTime = Date.now();

    const delay = await new Promise<number>((resolve) => {
      const start = Date.now();
      setImmediate(() => resolve(Date.now() - start));
    });

    let status: 'up' | 'down' | 'degraded';
    let message: string;

    if (delay < 10) {
      status = 'up';
      message = `Event loop delay: ${delay}ms`;
    } else if (delay < 100) {
      status = 'degraded';
      message = `High event loop delay: ${delay}ms`;
    } else {
      status = 'down';
      message = `Critical event loop delay: ${delay}ms`;
    }

    return {
      status,
      responseTime: Date.now() - startTime,
      message,
      lastChecked: new Date().toISOString(),
    };
  }

  private async checkDatabase(): Promise<HealthCheckDetail> {
    const startTime = Date.now();

    try {
      const connection = this.dbConnection.getConnection();
      const info = this.dbConnection.getConnectionInfo();

      // Actual round-trip ping to MongoDB
      await connection.db!.admin().ping();

      return {
        status: 'up',
        responseTime: Date.now() - startTime,
        message: `Connected to ${info.name}`,
        lastChecked: new Date().toISOString(),
      };
    } catch {
      const info = this.dbConnection.getConnectionInfo();
      return {
        status: 'down',
        responseTime: Date.now() - startTime,
        message: info.isReconnecting
          ? `Database ${info.state} (reconnect attempt ${info.reconnectAttempts})`
          : `Database ${info.state}`,
        lastChecked: new Date().toISOString(),
      };
    }
  }

  private async checkStorage(): Promise<HealthCheckDetail> {
    const startTime = Date.now();

    try {
      const ok = await this.documentConnection.verifyConnection();
      if (!ok) {
        const healthStatus = this.documentConnection.getHealthStatus();
        return {
          status: 'down',
          responseTime: Date.now() - startTime,
          message: healthStatus.error || 'Ceph S3 storage not available',
          lastChecked: new Date().toISOString(),
        };
      }

      return {
        status: 'up',
        responseTime: Date.now() - startTime,
        message: 'Ceph S3 storage connected',
        lastChecked: new Date().toISOString(),
      };
    } catch {
      const healthStatus = this.documentConnection.getHealthStatus();
      return {
        status: 'down',
        responseTime: Date.now() - startTime,
        message: healthStatus.isReconnecting
          ? `Ceph S3 reconnecting (attempt ${healthStatus.reconnectAttempts})`
          : healthStatus.error || 'Ceph S3 connection failed',
        lastChecked: new Date().toISOString(),
      };
    }
  }

  private async checkEmail(): Promise<HealthCheckDetail> {
    const startTime = Date.now();
    const provider = this.emailConnection.getProvider();
    const label = provider === 'outlook' ? 'Outlook' : 'SMTP';

    try {
      const ok = await this.emailConnection.verifyConnection();

      return {
        status: ok ? 'up' : 'down',
        responseTime: Date.now() - startTime,
        message: ok ? `${label} email connected` : `${label} verification failed`,
        lastChecked: new Date().toISOString(),
      };
    } catch {
      const healthStatus = this.emailConnection.getHealthStatus();
      return {
        status: 'down',
        responseTime: Date.now() - startTime,
        message: healthStatus.error || `${label} not configured`,
        lastChecked: new Date().toISOString(),
      };
    }
  }

  private async checkLiteLLM(): Promise<HealthCheckDetail> {
    const startTime = Date.now();

    try {
      const httpClient = this.litellmConnection.getHttpClient();
      if (!httpClient) {
        return {
          status: 'down',
          responseTime: Date.now() - startTime,
          message: 'LiteLLM not configured',
          lastChecked: new Date().toISOString(),
        };
      }

      // Actual HTTP round-trip to LiteLLM health endpoint
      await httpClient.get('/health/readiness');

      return {
        status: 'up',
        responseTime: Date.now() - startTime,
        message: 'LiteLLM API connected',
        lastChecked: new Date().toISOString(),
      };
    } catch {
      const healthStatus = this.litellmConnection.getHealthStatus();
      return {
        status: 'down',
        responseTime: Date.now() - startTime,
        message: healthStatus.error || 'LiteLLM connection failed',
        lastChecked: new Date().toISOString(),
      };
    }
  }

  private async checkConversationGrpc(): Promise<HealthCheckDetail> {
    const startTime = Date.now();

    const healthStatus = this.streamService.getHealthStatus();

    let status: 'up' | 'down' | 'degraded';
    let message: string;

    if (healthStatus.connected) {
      status = 'up';
      message = `Conversation Service Operational`;
    } else if (healthStatus.available) {
      status = 'down';
      message = healthStatus.error || 'Conversation service unavailable';
    } else {
      status = 'down';
      message = healthStatus.error || 'Conversation service not configured';
    }

    return {
      status,
      responseTime: Date.now() - startTime,
      message,
      lastChecked: healthStatus.lastCheckedAt?.toISOString() || new Date().toISOString(),
    };
  }

  private async checkConversationV2Grpc(): Promise<HealthCheckDetail> {
    const startTime = Date.now();
    const healthStatus = this.conversationV2Grpc.getHealthStatus();

    let status: 'up' | 'down' | 'degraded';
    let message: string;

    if (healthStatus.connected) {
      status = 'up';
      message = `ConversationV2 (Manus) gRPC operational at ${healthStatus.grpcUrl}`;
    } else if (healthStatus.available) {
      status = 'down';
      message = healthStatus.error || 'ConversationV2 gRPC unavailable';
    } else {
      status = 'down';
      message = healthStatus.error || 'ConversationV2 gRPC not configured';
    }

    return {
      status,
      responseTime: Date.now() - startTime,
      message,
      lastChecked: healthStatus.lastCheckedAt?.toISOString() || new Date().toISOString(),
    };
  }
}
