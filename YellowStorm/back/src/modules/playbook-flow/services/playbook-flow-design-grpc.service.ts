import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { LoggerService } from '@modules/logger';

@Injectable()
export class PlaybookFlowDesignGrpcService implements OnModuleInit, OnModuleDestroy {
  private chatbotClient: any;
  private isGrpcAvailable = false;

  private readonly grpcUrl: string;
  private readonly grpcTimeoutMs: number;

  private watchChannelRetries = 0;
  private static readonly MAX_CHANNEL_RETRIES = 10;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('PlaybookFlowDesignGrpcService');
    this.grpcUrl = this.configService.get<string>('playbook.grpcUrl', 'localhost:50051');
    this.grpcTimeoutMs = this.configService.get<number>('playbook.grpcTimeoutMs', 300000);
  }

  onModuleInit() {
    this.initGrpcClient();
  }

  onModuleDestroy() {
    if (this.chatbotClient) {
      grpc.closeClient(this.chatbotClient);
    }
  }

  get isAvailable(): boolean {
    return this.isGrpcAvailable;
  }

  generatePlaybook(request: any): Promise<any> {
    return new Promise((resolve, reject) => {
      this.chatbotClient.GeneratePlaybook(request, (err: any, response: any) => {
        if (err) return reject(err);
        resolve(response);
      });
    });
  }

  advisePlaybookNode(request: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const deadline = new Date(Date.now() + this.grpcTimeoutMs);

      this.logger.debug('gRPC AdvisePlaybookNode call initiated', {
        playbookId: request.playbook_id,
        taskId: request.task_id,
        suggestionTypeCount: request.suggestion_types?.length ?? 0,
      });

      this.chatbotClient.AdvisePlaybookNode(request, { deadline }, (err: Error | null, response: any) => {
        if (err) {
          this.logger.error('gRPC AdvisePlaybookNode call error', {
            playbookId: request.playbook_id,
            taskId: request.task_id,
            error: err.message,
          });
          reject(err);
        } else {
          resolve(response);
        }
      });
    });
  }

  evaluateTask(request: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const deadline = new Date(Date.now() + this.grpcTimeoutMs);

      this.chatbotClient.EvaluateTask(request, { deadline }, (err: Error | null, response: any) => {
        if (err) {
          this.logger.error('gRPC EvaluateTask call error', {
            executionId: request.execution_id,
            taskId: request.task_id,
            error: err.message,
          });
          reject(err);
          return;
        }
        resolve(response);
      });
    });
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

      this.chatbotClient = new chatbotPackage.ChatbotService(
        this.grpcUrl,
        grpc.credentials.createInsecure(),
      );

      const deadline = new Date();
      deadline.setSeconds(deadline.getSeconds() + 5);

      this.chatbotClient.waitForReady(deadline, (err: Error | null) => {
        if (err) {
          this.logger.warn('Playbook flow gRPC not ready at startup', { error: err.message });
          this.isGrpcAvailable = false;
        } else {
          this.logger.log('Playbook flow gRPC client connected');
          this.isGrpcAvailable = true;
        }
      });

      this.watchChannelState();
    } catch (error) {
      this.logger.error('Failed to init playbook flow gRPC client', {
        error: (error as Error).message,
      });
    }
  }

  private resolveChatbotProtoPath(): string {
    const candidatePaths = [
      path.join(__dirname, '..', '..', 'conversation', 'proto', 'chatbot.proto'),
      path.resolve(process.cwd(), 'dist', 'modules', 'conversation', 'proto', 'chatbot.proto'),
      path.resolve(process.cwd(), 'src', 'modules', 'conversation', 'proto', 'chatbot.proto'),
    ];

    const existingPath = candidatePaths.find((candidatePath) => fs.existsSync(candidatePath));
    if (!existingPath) {
      throw new Error(`chatbot.proto not found in expected locations: ${candidatePaths.join(', ')}`);
    }

    return existingPath;
  }

  private watchChannelState() {
    try {
      const channel = this.chatbotClient.getChannel();
      const currentState = channel.getConnectivityState(false);

      this.watchChannelRetries = 0;

      channel.watchConnectivityState(currentState, Infinity, () => {
        const newState = channel.getConnectivityState(false);
        const wasAvailable = this.isGrpcAvailable;
        this.isGrpcAvailable =
          newState === grpc.connectivityState.READY ||
          newState === grpc.connectivityState.IDLE;

        if (wasAvailable && !this.isGrpcAvailable) {
          this.logger.warn('Playbook flow gRPC connection lost', { state: newState });
        } else if (!wasAvailable && this.isGrpcAvailable) {
          this.logger.debug('Playbook flow gRPC connection restored', { state: newState });
        }

        this.watchChannelState();
      });
    } catch {
      this.watchChannelRetries++;
      if (this.watchChannelRetries >= PlaybookFlowDesignGrpcService.MAX_CHANNEL_RETRIES) {
        this.logger.error('Playbook flow gRPC channel watch exceeded max retries, giving up');
        return;
      }
      const delay = Math.min(5000 * Math.pow(2, this.watchChannelRetries - 1), 60000);
      setTimeout(() => this.watchChannelState(), delay);
    }
  }
}
