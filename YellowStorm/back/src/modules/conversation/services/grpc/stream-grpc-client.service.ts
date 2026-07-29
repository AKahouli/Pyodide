import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { LoggerService } from '../../../logger';
import { GrpcHealthStatus } from '../../interfaces/stream.interface';
import { buildGrpcChannelCredentials } from '../../../../common/grpc/grpc-security.util';

@Injectable()
export class StreamGrpcClientService implements OnModuleInit, OnModuleDestroy {
  private chatbotClient: any;
  private isGrpcAvailable = false;
  private lastError: string | null = null;
  private lastCheckedAt?: Date;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(StreamGrpcClientService.name);
  }

  onModuleInit() {
    this.initGrpcClient();
  }

  onModuleDestroy() {
    if (this.chatbotClient) {
      grpc.closeClient(this.chatbotClient);
    }
  }

  private initGrpcClient() {
    try {
      const protoPath = this.resolveChatbotProtoPath();

      const packageDefinition = protoLoader.loadSync(protoPath, {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
      });

      const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
      const chatbotPackage = protoDescriptor.chatbot as any;

      const grpcUrl = this.configService.get<string>('conversation.grpcUrl', 'localhost:50051');

      const { credentials, options } = buildGrpcChannelCredentials(
        this.configService,
        (msg) => this.logger.warn(msg),
      );

      this.chatbotClient = new chatbotPackage.ChatbotService(grpcUrl, credentials, options);

      const deadline = new Date(Date.now() + 5000);
      this.chatbotClient.waitForReady(deadline, (err: Error | null) => {
        this.lastCheckedAt = new Date();
        if (err) {
          this.logger.warn('gRPC service unavailable at startup', {
            grpcUrl,
            error: err.message,
          });
          this.isGrpcAvailable = false;
          this.lastError = err.message;
        } else {
          this.logger.log('gRPC client connected', { grpcUrl });
          this.isGrpcAvailable = true;
          this.lastError = null;
        }
      });
    } catch (error) {
      this.logger.error('Failed to initialize gRPC client', {
        error: (error as Error).message,
      });
      this.isGrpcAvailable = false;
      this.lastError = (error as Error).message;
      this.lastCheckedAt = new Date();
    }
  }

  private resolveChatbotProtoPath(): string {
    const candidatePaths = [
      path.join(__dirname, '..', '..', 'proto', 'chatbot.proto'),
      path.resolve(process.cwd(), 'dist', 'modules', 'conversation', 'proto', 'chatbot.proto'),
      path.resolve(process.cwd(), 'src', 'modules', 'conversation', 'proto', 'chatbot.proto'),
    ];

    const existingPath = candidatePaths.find((candidatePath) => fs.existsSync(candidatePath));
    if (!existingPath) {
      throw new Error(`chatbot.proto not found in expected locations: ${candidatePaths.join(', ')}`);
    }

    return existingPath;
  }

  isAvailable(): boolean {
    return this.isGrpcAvailable;
  }

  getClient(): any | null {
    if (!this.isGrpcAvailable || !this.chatbotClient) {
      return null;
    }
    return this.chatbotClient;
  }

  waitForReady(timeoutMs = 5000): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.chatbotClient) {
        resolve(false);
        return;
      }
      const deadline = new Date(Date.now() + timeoutMs);
      this.chatbotClient.waitForReady(deadline, (err: Error | null) => {
        this.lastCheckedAt = new Date();
        if (err) {
          this.isGrpcAvailable = false;
          this.lastError = err.message;
          resolve(false);
          return;
        }
        this.isGrpcAvailable = true;
        this.lastError = null;
        resolve(true);
      });
    });
  }

  getHealthStatus(activeStreams: number): GrpcHealthStatus {
    const grpcUrl = this.configService.get<string>('conversation.grpcUrl', 'localhost:50051');

    return {
      available: !!this.chatbotClient,
      connected: this.isGrpcAvailable,
      error: this.lastError,
      lastCheckedAt: this.lastCheckedAt,
      activeStreams,
      grpcUrl,
    };
  }

  @Cron(CronExpression.EVERY_10_SECONDS)
  async checkGrpcHealth() {
    if (!this.chatbotClient) {
      this.isGrpcAvailable = false;
      this.lastError = 'gRPC client not initialized';
      this.lastCheckedAt = new Date();
      return;
    }

    const deadline = new Date(Date.now() + 5000);
    this.chatbotClient.waitForReady(deadline, (err: Error | null) => {
      this.lastCheckedAt = new Date();
      if (err) {
        if (this.isGrpcAvailable) {
          this.logger.warn('gRPC connection lost', { error: err.message });
        }
        this.isGrpcAvailable = false;
        this.lastError = err.message;
      } else {
        if (!this.isGrpcAvailable) {
          this.logger.log('gRPC connection restored');
        }
        this.isGrpcAvailable = true;
        this.lastError = null;
      }
    });
  }
}
