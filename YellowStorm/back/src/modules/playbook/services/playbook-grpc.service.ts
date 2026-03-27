import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as path from 'node:path';
import { LoggerService } from '../../logger';

@Injectable()
export class PlaybookGrpcService implements OnModuleInit, OnModuleDestroy {
  private chatbotClient: any;
  private isGrpcAvailable = false;
  private activeStreamCalls = new Map<string, grpc.ClientReadableStream<any>>();
  private cancelledExecutions = new Set<string>();

  private readonly grpcUrl: string;
  private readonly grpcTimeoutMs: number;
  private readonly grpcWorkflowTimeoutMs: number;

  private watchChannelRetries = 0;
  private static readonly MAX_CHANNEL_RETRIES = 10;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('PlaybookGrpcService');
    this.grpcUrl = this.configService.get<string>('playbook.grpcUrl', 'localhost:50051');
    this.grpcTimeoutMs = this.configService.get<number>('playbook.grpcTimeoutMs', 300000);
    this.grpcWorkflowTimeoutMs = this.configService.get<number>('playbook.grpcWorkflowTimeoutMs', 600000);
  }

  onModuleInit() {
    this.initGrpcClient();
  }

  onModuleDestroy() {
    for (const [executionId, call] of this.activeStreamCalls) {
      this.logger.log('Cancelling active stream on shutdown', { executionId });
      call.cancel();
    }
    this.activeStreamCalls.clear();

    if (this.chatbotClient) {
      grpc.closeClient(this.chatbotClient);
    }
  }

  get isAvailable(): boolean {
    return this.isGrpcAvailable;
  }

  get workflowTimeoutMs(): number {
    return this.grpcWorkflowTimeoutMs;
  }

  // ===== Stream Management =====

  registerStream(executionId: string, call: grpc.ClientReadableStream<any>): void {
    this.activeStreamCalls.set(executionId, call);
  }

  removeStream(executionId: string): void {
    this.activeStreamCalls.delete(executionId);
  }

  getStream(executionId: string): grpc.ClientReadableStream<any> | undefined {
    return this.activeStreamCalls.get(executionId);
  }

  markCancelled(executionId: string): void {
    this.cancelledExecutions.add(executionId);
  }

  wasCancelled(executionId: string): boolean {
    return this.cancelledExecutions.delete(executionId);
  }

  // ===== gRPC Call Wrappers =====

  runStep(request: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const deadline = new Date(Date.now() + this.grpcTimeoutMs);

      this.logger.log('gRPC RunStep call initiated', {
        taskId: request.task?.id,
        playbookId: request.playbook_id,
        timeoutMs: this.grpcTimeoutMs,
      });

      this.chatbotClient.RunStep(request, { deadline }, (err: Error | null, response: any) => {
        if (err) {
          this.logger.error('gRPC RunStep call error', {
            taskId: request.task?.id,
            error: err.message,
          });
          reject(err);
        } else {
          resolve(response);
        }
      });
    });
  }

  runPlaybookWorkflow(request: any): grpc.ClientReadableStream<any> {
    this.logger.log('gRPC RunPlaybookWorkflow stream initiated', {
      playbookId: request.playbook_id,
      taskCount: request.tasks?.length,
      agentCount: request.agents?.length,
    });

    return this.chatbotClient.RunPlaybookWorkflow(request);
  }

  resumePlaybookWorkflow(request: any): grpc.ClientReadableStream<any> {
    this.logger.log('gRPC ResumePlaybookWorkflow stream initiated', {
      playbookId: request.playbook_id,
      threadId: request.thread_id,
      taskId: request.task_id,
    });
    return this.chatbotClient.ResumePlaybookWorkflow(request);
  }

  resumeStep(request: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const deadline = new Date(Date.now() + this.grpcTimeoutMs);

      this.logger.log('gRPC ResumeStep call initiated', {
        playbookId: request.playbook_id,
        threadId: request.thread_id,
        taskId: request.task_id,
        timeoutMs: this.grpcTimeoutMs,
      });

      this.chatbotClient.ResumeStep(
        request,
        { deadline },
        (err: Error | null, response: any) => {
          if (err) {
            this.logger.error('gRPC ResumeStep call error', {
              taskId: request.task_id,
              error: err.message,
            });
            reject(err);
          } else {
            resolve(response);
          }
        },
      );
    });
  }

  evaluateSemanticMatch(request: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const deadline = new Date(Date.now() + this.grpcTimeoutMs);

      this.logger.log('gRPC EvaluateSemanticMatch call initiated', {
        taskTitle: request.task_title,
        baselineLength: request.baseline_output?.length ?? 0,
        currentLength: request.current_output?.length ?? 0,
        timeoutMs: this.grpcTimeoutMs,
      });

      this.chatbotClient.EvaluateSemanticMatch(
        request,
        { deadline },
        (err: Error | null, response: any) => {
          if (err) {
            this.logger.error('gRPC EvaluateSemanticMatch call error', {
              taskTitle: request.task_title,
              error: err.message,
            });
            reject(err);
          } else {
            resolve(response);
          }
        },
      );
    });
  }

  stopPlaybookWorkflow(request: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const deadline = new Date(Date.now() + 10000);

      this.logger.log('gRPC StopPlaybookWorkflow call initiated', {
        playbookId: request.playbook_id,
      });

      this.chatbotClient.StopPlaybookWorkflow(request, { deadline }, (err: Error | null, response: any) => {
        if (err) {
          this.logger.error('gRPC StopPlaybookWorkflow call error', {
            error: err.message,
          });
          reject(err);
        } else {
          resolve(response);
        }
      });
    });
  }

  generatePlaybook(request: any): Promise<any> {
    return new Promise((resolve, reject) => {
      this.chatbotClient.GeneratePlaybook(request, (err: any, response: any) => {
        if (err) return reject(err);
        resolve(response);
      });
    });
  }

  // ===== Private Initialization =====

  private initGrpcClient() {
    try {
      const protoPath = path.join(
        __dirname,
        '..',
        '..',
        'conversation',
        'proto',
        'chatbot.proto',
      );

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
          this.logger.warn('Playbook gRPC not ready at startup', { error: err.message });
          this.isGrpcAvailable = false;
        } else {
          this.logger.log('Playbook gRPC client connected');
          this.isGrpcAvailable = true;
        }
      });

      this.watchChannelState();
    } catch (error) {
      this.logger.error('Failed to init playbook gRPC client', {
        error: (error as Error).message,
      });
    }
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
          this.logger.warn('Playbook gRPC connection lost', { state: newState });
        } else if (!wasAvailable && this.isGrpcAvailable) {
          this.logger.log('Playbook gRPC connection restored', { state: newState });
        }

        this.watchChannelState();
      });
    } catch {
      this.watchChannelRetries++;
      if (this.watchChannelRetries >= PlaybookGrpcService.MAX_CHANNEL_RETRIES) {
        this.logger.error('Playbook gRPC channel watch exceeded max retries, giving up');
        return;
      }
      const delay = Math.min(5000 * Math.pow(2, this.watchChannelRetries - 1), 60000);
      setTimeout(() => this.watchChannelState(), delay);
    }
  }
}
