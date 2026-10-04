import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as path from 'node:path';
import * as fs from 'node:fs';
import {
  buildGrpcChannelCredentials,
  createGrpcMetadata,
} from '../../../common/grpc/grpc-security.util';
import { WORKY_ORCHESTRATOR_GRPC_SECURITY_NS } from '../../../config/grpc-security-worky-orchestrator.config';

export interface WorkyOrchestratorHealthStatus {
  available: boolean;
  connected: boolean;
  error: string | null;
  lastCheckedAt?: Date;
  grpcUrl: string;
}

@Injectable()
export class WorkyOrchestratorGrpcClientService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(WorkyOrchestratorGrpcClientService.name);
  private client: any;
  private isConnected = false;
  private lastError: string | null = null;
  private lastCheckedAt?: Date;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const protoPath = this.resolveProtoPath();
    const packageDef = protoLoader.loadSync(protoPath, {
      keepCase: true,
      longs: Number,
      enums: String,
      defaults: true,
      oneofs: true,
      // companion_ai.proto now `import "chatbot.proto"` for chatbot.Agent, which
      // lives in the conversation module's proto dir. Both dirs must be on the
      // include path so the import resolves in dev (src) and build (dist).
      includeDirs: this.resolveProtoIncludeDirs(),
    });
    const proto = grpc.loadPackageDefinition(packageDef) as any;
    const url = this.config.get<string>('workyOrchestrator.grpcUrl')!;
    const maxMsg = this.config.get<number>('workyOrchestrator.grpcMaxMessageBytes')!;
    const { credentials, options: tlsOptions } = buildGrpcChannelCredentials(
      this.config,
      (msg) => { this.logger.warn(msg); },
      WORKY_ORCHESTRATOR_GRPC_SECURITY_NS,
    );
    this.client = new proto.yellowstorm.orchestrator.v1.CompanionAi(
      url,
      credentials,
      {
        ...tlsOptions,
        'grpc.max_send_message_length': maxMsg,
        'grpc.max_receive_message_length': maxMsg,
        'grpc.keepalive_time_ms': 30_000,
      },
    );
    this.logger.log(`WorkyOrchestrator gRPC client initialised against ${url}`);

    // Initial readiness probe so the first health check has accurate state.
    this.client.waitForReady(Date.now() + 5000, (err: Error | null) => {
      this.lastCheckedAt = new Date();
      if (err) {
        this.isConnected = false;
        this.lastError = err.message;
        this.logger.warn(`WorkyOrchestrator gRPC not ready: ${err.message}`);
      } else {
        this.isConnected = true;
        this.lastError = null;
        this.logger.log('WorkyOrchestrator gRPC connection established');
      }
    });
  }

  onModuleDestroy(): void {
    if (this.client) {
      grpc.closeClient(this.client);
    }
  }

  private resolveProtoPath(): string {
    const candidatePaths = [
      path.join(__dirname, '..', 'proto', 'companion_ai.proto'),
      path.resolve(process.cwd(), 'dist', 'modules', 'worky', 'proto', 'companion_ai.proto'),
      path.resolve(process.cwd(), 'src', 'modules', 'worky', 'proto', 'companion_ai.proto'),
    ];

    const existingPath = candidatePaths.find((candidatePath) => fs.existsSync(candidatePath));
    if (!existingPath) {
      throw new Error(`companion_ai.proto not found in expected locations: ${candidatePaths.join(', ')}`);
    }

    return existingPath;
  }

  /**
   * Dirs the proto loader searches to resolve `import` statements: the worky
   * proto dir (for companion_ai.proto's own package) plus the conversation
   * proto dir (for the imported chatbot.proto). Both src and dist variants are
   * listed so it works in dev and after build; only existing dirs are kept.
   */
  private resolveProtoIncludeDirs(): string[] {
    const candidateDirs = [
      path.join(__dirname, '..', 'proto'),
      path.resolve(process.cwd(), 'dist', 'modules', 'worky', 'proto'),
      path.resolve(process.cwd(), 'src', 'modules', 'worky', 'proto'),
      path.join(__dirname, '..', '..', 'conversation', 'proto'),
      path.resolve(process.cwd(), 'dist', 'modules', 'conversation', 'proto'),
      path.resolve(process.cwd(), 'src', 'modules', 'conversation', 'proto'),
    ];
    return candidateDirs.filter((dir) => fs.existsSync(dir));
  }

  getHealthStatus(): WorkyOrchestratorHealthStatus {
    return {
      available: !!this.client,
      connected: this.isConnected,
      error: this.lastError,
      lastCheckedAt: this.lastCheckedAt,
      grpcUrl: this.config.get<string>('workyOrchestrator.grpcUrl', 'localhost:50052'),
    };
  }

  @Cron(CronExpression.EVERY_10_SECONDS)
  async checkGrpcHealth(): Promise<void> {
    if (!this.client) {
      this.isConnected = false;
      this.lastError = 'gRPC client not initialized';
      this.lastCheckedAt = new Date();
      return;
    }
    const deadline = Date.now() + 2000;
    await new Promise<void>((resolve) => {
      this.client.waitForReady(deadline, (err: Error | null) => {
        this.lastCheckedAt = new Date();
        if (err) {
          if (this.isConnected) {
            this.logger.warn(`WorkyOrchestrator gRPC connection lost: ${err.message}`);
          }
          this.isConnected = false;
          this.lastError = err.message;
        } else {
          if (!this.isConnected) {
            this.logger.log('WorkyOrchestrator gRPC connection restored');
          }
          this.isConnected = true;
          this.lastError = null;
        }
        resolve();
      });
    });
  }

  private get unaryDeadline(): grpc.CallOptions {
    const ms = this.config.get<number>('workyOrchestrator.grpcUnaryDeadlineMs')!;
    return { deadline: Date.now() + ms };
  }

  async createSession(userId: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.client.CreateSession(
        { user_id: userId },
        createGrpcMetadata(this.config, WORKY_ORCHESTRATOR_GRPC_SECURITY_NS),
        this.unaryDeadline,
        (err: grpc.ServiceError | null, response: { session_id: string }) => {
          if (err) { reject(err); return; }
          resolve(response.session_id);
        },
      );
    });
  }

  async runTask(
    userId: string,
    sessionId: string,
    message: string,
    opts: {
      agents?: unknown[];
      skills?: unknown[];
      connectors?: unknown[];
      userName?: string;
      userEmail?: string;
      userRole?: string;
      turnId?: string;
    },
  ): Promise<{ sessionId: string; accepted: boolean; runId: string }> {
    const request: Record<string, unknown> = {
      user_id: userId,
      session_id: sessionId,
      message,
    };
    if (opts.agents?.length) request.agents = opts.agents;
    if (opts.skills?.length) request.skills = opts.skills;
    if (opts.connectors?.length) request.connectors = opts.connectors;
    // Who the turn is for — so the planner/executor address the requester and
    // never delegate or email work back to them (orchestrator RunRequest.user_*).
    if (opts.userName) request.user_name = opts.userName;
    if (opts.userEmail) request.user_email = opts.userEmail;
    if (opts.userRole) request.user_role = opts.userRole;
    if (opts.turnId) request.turn_id = opts.turnId;
    return new Promise((resolve, reject) => {
      this.client.RunTask(
        request,
        createGrpcMetadata(this.config, WORKY_ORCHESTRATOR_GRPC_SECURITY_NS),
        this.unaryDeadline,
        (
          err: grpc.ServiceError | null,
          response: { session_id: string; accepted: boolean; run_id: string },
        ) => {
          if (err) { reject(err); return; }
          resolve({
            sessionId: response.session_id,
            accepted: !!response.accepted,
            runId: response.run_id,
          });
        },
      );
    });
  }

  async getSession(
    userId: string,
    sessionId: string,
  ): Promise<{ sessionId: string; title: string; status: string; plan: unknown }> {
    return new Promise((resolve, reject) => {
      this.client.GetSession(
        { user_id: userId, session_id: sessionId },
        createGrpcMetadata(this.config, WORKY_ORCHESTRATOR_GRPC_SECURITY_NS),
        this.unaryDeadline,
        (
          err: grpc.ServiceError | null,
          response: { session_id: string; title: string; status: string; plan: unknown },
        ) => {
          if (err) { reject(err); return; }
          resolve({
            sessionId: response.session_id,
            title: response.title,
            status: response.status,
            plan: response.plan,
          });
        },
      );
    });
  }

  async stopSession(userId: string, sessionId: string): Promise<{ stopped: boolean }> {
    return new Promise((resolve, reject) => {
      this.client.StopSession(
        { user_id: userId, session_id: sessionId },
        createGrpcMetadata(this.config, WORKY_ORCHESTRATOR_GRPC_SECURITY_NS),
        this.unaryDeadline,
        (err: grpc.ServiceError | null, response: { stopped: boolean }) => {
          if (err) { reject(err); return; }
          resolve({ stopped: !!response.stopped });
        },
      );
    });
  }

  /** Pause a running session (non-terminal). Continue later via runTask. */
  async pauseSession(userId: string, sessionId: string): Promise<{ paused: boolean }> {
    return new Promise((resolve, reject) => {
      this.client.PauseSession(
        { user_id: userId, session_id: sessionId },
        createGrpcMetadata(this.config, WORKY_ORCHESTRATOR_GRPC_SECURITY_NS),
        this.unaryDeadline,
        (err: grpc.ServiceError | null, response: { paused: boolean }) => {
          if (err) { reject(err); return; }
          resolve({ paused: !!response.paused });
        },
      );
    });
  }

  /**
   * Hand an email reply to whichever step was waiting for it.
   *
   * We hold only the routing token: the token->session/step mapping lives in the
   * orchestrator's own store, so it resolves and resumes. `delivered: false` is
   * a normal answer, not a failure — the token may be unknown (a mail that
   * isn't ours), already delivered (Graph retried), or expired.
   */
  async deliverMailReply(input: {
    token: string;
    replyBody: string;
    replyFrom?: string;
    agents?: unknown[];
    connectors?: unknown[];
  }): Promise<{ delivered: boolean; sessionId: string; stepId: string }> {
    return new Promise((resolve, reject) => {
      this.client.DeliverMailReply(
        {
          token: input.token,
          reply_body: input.replyBody,
          reply_from: input.replyFrom ?? '',
          agents: input.agents ?? [],
          connectors: input.connectors ?? [],
        },
        createGrpcMetadata(this.config, WORKY_ORCHESTRATOR_GRPC_SECURITY_NS),
        this.unaryDeadline,
        (
          err: grpc.ServiceError | null,
          response: { delivered: boolean; session_id: string; step_id: string },
        ) => {
          if (err) { reject(err); return; }
          resolve({
            delivered: !!response.delivered,
            sessionId: response.session_id ?? '',
            stepId: response.step_id ?? '',
          });
        },
      );
    });
  }

  /**
   * Hand a Teams reply to whichever step was waiting for it. Same resume as
   * mail, but the message carried no routing token — Teams correlates a reply by
   * chat identity — so we pass the chat id and worky resolves it. `delivered:
   * false` is normal (already resumed by an earlier poll tick, or not-a-reply).
   */
  async deliverChatReply(input: {
    chatId: string;
    replyBody: string;
    replyFrom?: string;
    agents?: unknown[];
    connectors?: unknown[];
  }): Promise<{ delivered: boolean; sessionId: string; stepId: string }> {
    return new Promise((resolve, reject) => {
      this.client.DeliverMailReply(
        {
          chat_id: input.chatId,
          reply_body: input.replyBody,
          reply_from: input.replyFrom ?? '',
          agents: input.agents ?? [],
          connectors: input.connectors ?? [],
        },
        createGrpcMetadata(this.config, WORKY_ORCHESTRATOR_GRPC_SECURITY_NS),
        this.unaryDeadline,
        (
          err: grpc.ServiceError | null,
          response: { delivered: boolean; session_id: string; step_id: string },
        ) => {
          if (err) { reject(err); return; }
          resolve({
            delivered: !!response.delivered,
            sessionId: response.session_id ?? '',
            stepId: response.step_id ?? '',
          });
        },
      );
    });
  }

  /**
   * The Teams chats worky is currently waiting on a reply in. The poller reads
   * each and forwards any human reply via deliverChatReply. Empty is the common
   * answer (nothing waiting).
   */
  async listOpenChatWaits(): Promise<
    { chatId: string; userId: string; sessionId: string }[]
  > {
    return new Promise((resolve, reject) => {
      this.client.ListOpenChatWaits(
        {},
        createGrpcMetadata(this.config, WORKY_ORCHESTRATOR_GRPC_SECURITY_NS),
        this.unaryDeadline,
        (
          err: grpc.ServiceError | null,
          response: { waits?: { chat_id: string; user_id: string; session_id: string }[] },
        ) => {
          if (err) { reject(err); return; }
          resolve(
            (response.waits ?? []).map((w) => ({
              chatId: w.chat_id,
              userId: w.user_id,
              sessionId: w.session_id,
            })),
          );
        },
      );
    });
  }
}
