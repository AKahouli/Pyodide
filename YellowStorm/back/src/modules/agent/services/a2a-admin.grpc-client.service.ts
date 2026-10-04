import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as path from 'node:path';
import * as fs from 'node:fs';
import {
  A2AAdminHealthStatus,
  ChatbotAgentInput,
  GetAgentResult,
  PublishAgentResult,
  RevokeAgentResult,
  RotateKeyResult,
  SetAgentEnabledResult,
} from '../types/a2a-admin.types';
import {
  buildGrpcChannelCredentials,
  createGrpcMetadata,
} from '../../../common/grpc/grpc-security.util';

/**
 * gRPC client for the `a2a_admin.A2AAdminService`. The management API is served
 * by the same backend as the conversation chatbot service, so it dials the
 * shared `CONVERSATION_GRPC_URL` endpoint (see `a2a-admin.config.ts`).
 *
 * Mirrors the lifecycle/health pattern of `ConversationV2GrpcClientService`.
 */
@Injectable()
export class A2AAdminGrpcClientService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(A2AAdminGrpcClientService.name);
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
      // a2a_admin.proto does `import "chatbot.proto"`. Rather than vendoring a
      // copy (which would drift from the source), resolve the import against the
      // conversation module's proto dir — the single source of truth for it.
      includeDirs: [path.dirname(protoPath), this.resolveChatbotProtoDir()],
    });
    const proto = grpc.loadPackageDefinition(packageDef) as any;
    const url = this.config.get<string>('a2aAdmin.grpcUrl')!;
    const maxMsg = this.config.get<number>('a2aAdmin.grpcMaxMessageBytes')!;
    const { credentials, options: tlsOptions } = buildGrpcChannelCredentials(
      this.config,
      (msg) => { this.logger.warn(msg); },
    );
    this.client = new proto.a2a_admin.A2AAdminService(url, credentials, {
      ...tlsOptions,
      'grpc.max_send_message_length': maxMsg,
      'grpc.max_receive_message_length': maxMsg,
      'grpc.keepalive_time_ms': 30_000,
    });
    this.logger.log(`A2AAdmin gRPC client initialised against ${url}`);

    // Initial readiness probe so the first /health call has accurate state.
    this.client.waitForReady(Date.now() + 5000, (err: Error | null) => {
      this.lastCheckedAt = new Date();
      if (err) {
        this.isConnected = false;
        this.lastError = err.message;
        this.logger.warn(`A2AAdmin gRPC not ready: ${err.message}`);
      } else {
        this.isConnected = true;
        this.lastError = null;
        this.logger.log('A2AAdmin gRPC connection established');
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
      path.join(__dirname, '..', 'proto', 'a2a_admin.proto'),
      path.resolve(process.cwd(), 'dist', 'modules', 'agent', 'proto', 'a2a_admin.proto'),
      path.resolve(process.cwd(), 'src', 'modules', 'agent', 'proto', 'a2a_admin.proto'),
    ];

    const existingPath = candidatePaths.find((candidatePath) => fs.existsSync(candidatePath));
    if (!existingPath) {
      throw new Error(`a2a_admin.proto not found in expected locations: ${candidatePaths.join(', ')}`);
    }

    return existingPath;
  }

  /**
   * Directory holding the conversation module's `chatbot.proto`, used as an
   * include dir so a2a_admin.proto's `import "chatbot.proto"` resolves without a
   * vendored copy. Mirrors the src/dist candidate-path strategy above.
   */
  private resolveChatbotProtoDir(): string {
    const candidateDirs = [
      path.join(__dirname, '..', '..', 'conversation', 'proto'),
      path.resolve(process.cwd(), 'dist', 'modules', 'conversation', 'proto'),
      path.resolve(process.cwd(), 'src', 'modules', 'conversation', 'proto'),
    ];

    const existingDir = candidateDirs.find((dir) =>
      fs.existsSync(path.join(dir, 'chatbot.proto')),
    );
    if (!existingDir) {
      throw new Error(`chatbot.proto not found in expected locations: ${candidateDirs.join(', ')}`);
    }

    return existingDir;
  }

  getHealthStatus(): A2AAdminHealthStatus {
    return {
      available: !!this.client,
      connected: this.isConnected,
      error: this.lastError,
      lastCheckedAt: this.lastCheckedAt,
      grpcUrl: this.config.get<string>('a2aAdmin.grpcUrl', 'localhost:50051'),
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
            this.logger.warn(`A2AAdmin gRPC connection lost: ${err.message}`);
          }
          this.isConnected = false;
          this.lastError = err.message;
        } else {
          if (!this.isConnected) {
            this.logger.log('A2AAdmin gRPC connection restored');
          }
          this.isConnected = true;
          this.lastError = null;
        }
        resolve();
      });
    });
  }

  private get unaryDeadline(): grpc.CallOptions {
    const ms = this.config.get<number>('a2aAdmin.grpcUnaryDeadlineMs')!;
    return { deadline: Date.now() + ms };
  }

  /**
   * Publish an agent over the A2A protocol. `agent.id` becomes the URL segment.
   * Returns the agent-card URL and the one-time API key.
   */
  async publishAgent(
    agent: ChatbotAgentInput,
    userId = '',
  ): Promise<PublishAgentResult> {
    return new Promise((resolve, reject) => {
      this.client.PublishAgent(
        { agent, user_id: userId },
        createGrpcMetadata(this.config),
        this.unaryDeadline,
        (
          err: grpc.ServiceError | null,
          response: {
            agent_id: string;
            agent_card_url: string;
            api_key: string;
            api_key_header: string;
          },
        ) => {
          if (err) { reject(err); return; }
          resolve({
            agentId: response.agent_id,
            agentCardUrl: response.agent_card_url,
            apiKey: response.api_key,
            apiKeyHeader: response.api_key_header,
          });
        },
      );
    });
  }

  /**
   * Rotate the API key for a published agent. Returns the new key (the old one
   * stops working) and the agent-card URL.
   */
  async rotateKey(agentId: string): Promise<RotateKeyResult> {
    return new Promise((resolve, reject) => {
      this.client.RotateKey(
        { agent_id: agentId },
        createGrpcMetadata(this.config),
        this.unaryDeadline,
        (
          err: grpc.ServiceError | null,
          response: {
            agent_id: string;
            agent_card_url: string;
            api_key: string;
            api_key_header: string;
          },
        ) => {
          if (err) { reject(err); return; }
          resolve({
            agentId: response.agent_id,
            agentCardUrl: response.agent_card_url,
            apiKey: response.api_key,
            apiKeyHeader: response.api_key_header,
          });
        },
      );
    });
  }

  /**
   * Revoke a published agent: its card and message endpoint return 404.
   * Re-exposing the agent is done by publishing it again.
   */
  async revokeAgent(agentId: string): Promise<RevokeAgentResult> {
    return new Promise((resolve, reject) => {
      this.client.RevokeAgent(
        { agent_id: agentId },
        createGrpcMetadata(this.config),
        this.unaryDeadline,
        (
          err: grpc.ServiceError | null,
          response: { agent_id: string; revoked: boolean },
        ) => {
          if (err) { reject(err); return; }
          resolve({ agentId: response.agent_id, revoked: !!response.revoked });
        },
      );
    });
  }

  /** Enable or disable a published agent without unpublishing it. */
  async setAgentEnabled(
    agentId: string,
    enabled: boolean,
  ): Promise<SetAgentEnabledResult> {
    return new Promise((resolve, reject) => {
      this.client.SetAgentEnabled(
        { agent_id: agentId, enabled },
        createGrpcMetadata(this.config),
        this.unaryDeadline,
        (
          err: grpc.ServiceError | null,
          response: { agent_id: string; enabled: boolean },
        ) => {
          if (err) { reject(err); return; }
          resolve({ agentId: response.agent_id, enabled: response.enabled });
        },
      );
    });
  }

  /** Fetch the published-agent metadata (status, key prefix, timestamps). */
  async getAgent(agentId: string): Promise<GetAgentResult> {
    return new Promise((resolve, reject) => {
      this.client.GetAgent(
        { agent_id: agentId },
        createGrpcMetadata(this.config),
        this.unaryDeadline,
        (
          err: grpc.ServiceError | null,
          response: {
            found: boolean;
            agent_id: string;
            name: string;
            enabled: boolean;
            api_key_prefix: string;
            created_at: string;
            updated_at: string;
          },
        ) => {
          if (err) { reject(err); return; }
          resolve({
            found: !!response.found,
            agentId: response.agent_id,
            name: response.name,
            enabled: !!response.enabled,
            apiKeyPrefix: response.api_key_prefix,
            createdAt: response.created_at,
            updatedAt: response.updated_at,
          });
        },
      );
    });
  }
}
