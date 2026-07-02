import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WorkspaceService } from '@modules/workspace/workspace.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { Observable } from 'rxjs';
import type { IGrpcSkill } from '@modules/skill/interfaces/skill.interface';
import type { IGrpcConnector } from '@modules/connector/interfaces/connector.interface';
import {
  ConversationV2Event,
  SessionWithEvents,
  ConversationV2EventType,
} from '../types/conversation-v2.types';
import {
  buildGrpcChannelCredentials,
  createGrpcMetadata,
} from '../../../common/grpc/grpc-security.util';

/**
 * Config namespace for v2's gRPC security. v2 dials a different AI service than
 * the other clients, so it has its own cert + key — see grpc-security-v2.config.
 */
const V2_GRPC_SECURITY_NS = 'grpcSecurityV2';

export interface ConversationV2HealthStatus {
  available: boolean;
  connected: boolean;
  error: string | null;
  lastCheckedAt?: Date;
  grpcUrl: string;
}

interface RawProtoEvent {
  event_id: string;
  timestamp: number | string;
  payload: ConversationV2EventType;
  message?: {
    role: 'user' | 'assistant';
    content: string;
    // proto `FileInfo` carries the Ceph object key in field `url` (field 4);
    // `path` is accepted too for forward-compat if the proto is ever renamed.
    attachments?: Array<{ id: string; name: string; content_type: string; url?: string; path?: string }>;
  };
  tool?: {
    tool_call_id: string;
    name: string;
    status: string;
    function: string;
    args_json: string;
    content?: {
      variant: 'browser' | 'shell' | 'file' | 'search' | 'mcp' | 'webpage' | 'generic';
      browser?: { screenshot_url: string; url?: string; title?: string };
      shell?: { command: string; output: string; exit_code: number; session_handle?: string };
      file?: { path: string; content: string; language?: string; operation?: string };
      search?: { query: string; results?: Array<{ title: string; url: string; snippet: string }> };
      mcp?: { server: string; tool: string; result_json: string };
      webpage?: { url: string; title?: string };
      generic?: { json: string };
    };
  };
  step?: { id: string; status: string; description: string };
  plan?: { steps: Array<{ id: string; status: string; description: string }> };
  title?: { title: string };
  done?: Record<string, never>;
  wait?: Record<string, never>;
  error?: { error: string };
  application_component?: { url: string; title?: string };
}

@Injectable()
export class ConversationV2GrpcClientService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ConversationV2GrpcClientService.name);
  private client: any;
  private isConnected = false;
  private lastError: string | null = null;
  private lastCheckedAt?: Date;

  constructor(
    private readonly config: ConfigService,
    @Inject(forwardRef(() => WorkspaceService))
    private readonly workspaceService: WorkspaceService,
  ) {}

  onModuleInit(): void {
    const protoPath = this.resolveProtoPath();
    const packageDef = protoLoader.loadSync(protoPath, {
      keepCase: true,
      longs: Number,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    const proto = grpc.loadPackageDefinition(packageDef) as any;
    const url = this.config.get<string>('conversationV2.grpcUrl')!;
    const maxMsg = this.config.get<number>('conversationV2.grpcMaxMessageBytes')!;
    const { credentials, options: tlsOptions } = buildGrpcChannelCredentials(
      this.config,
      (msg) => this.logger.warn(msg),
      V2_GRPC_SECURITY_NS,
    );
    this.client = new proto.yellostorm.manus.v1.ConversationV2(url, credentials, {
      ...tlsOptions,
      'grpc.max_send_message_length': maxMsg,
      'grpc.max_receive_message_length': maxMsg,
      'grpc.keepalive_time_ms': 30_000,
    });
    this.logger.log(`ConversationV2 gRPC client initialised against ${url}`);

    // Initial readiness probe so the first /health call has accurate state.
    this.client.waitForReady(Date.now() + 5000, (err: Error | null) => {
      this.lastCheckedAt = new Date();
      if (err) {
        this.isConnected = false;
        this.lastError = err.message;
        this.logger.warn(`ConversationV2 gRPC not ready: ${err.message}`);
      } else {
        this.isConnected = true;
        this.lastError = null;
        this.logger.log('ConversationV2 gRPC connection established');
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
      path.join(__dirname, '..', 'proto', 'conversation.proto'),
      path.resolve(process.cwd(), 'dist', 'modules', 'conversation-v2', 'proto', 'conversation.proto'),
      path.resolve(process.cwd(), 'src', 'modules', 'conversation-v2', 'proto', 'conversation.proto'),
    ];

    const existingPath = candidatePaths.find((candidatePath) => fs.existsSync(candidatePath));
    if (!existingPath) {
      throw new Error(`conversation.proto not found in expected locations: ${candidatePaths.join(', ')}`);
    }

    return existingPath;
  }

  getHealthStatus(): ConversationV2HealthStatus {
    return {
      available: !!this.client,
      connected: this.isConnected,
      error: this.lastError,
      lastCheckedAt: this.lastCheckedAt,
      grpcUrl: this.config.get<string>('conversationV2.grpcUrl', 'localhost:50051'),
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
            this.logger.warn(`ConversationV2 gRPC connection lost: ${err.message}`);
          }
          this.isConnected = false;
          this.lastError = err.message;
        } else {
          if (!this.isConnected) {
            this.logger.log('ConversationV2 gRPC connection restored');
          }
          this.isConnected = true;
          this.lastError = null;
        }
        resolve();
      });
    });
  }

  private get unaryDeadline(): grpc.CallOptions {
    const ms = this.config.get<number>('conversationV2.grpcUnaryDeadlineMs')!;
    return { deadline: Date.now() + ms };
  }

  async createSession(userId: string, workspaceIds: string[] = []): Promise<string> {
    // Translate workspaceIds → `{ownerUserId}/{storagePrefix}` paths. Note the
    // path root is the workspace OWNER, not the current user, so a session that
    // attaches a shared workspace points the AI service at the owner's prefix
    // where all the workspace's documents live.
    const workspacePaths = await this.workspaceService.getStoragePathsByIds(workspaceIds);
    return new Promise((resolve, reject) => {
      this.client.CreateSession(
        { user_id: userId, workspace_paths: workspacePaths },
        createGrpcMetadata(this.config, V2_GRPC_SECURITY_NS),
        this.unaryDeadline,
        (err: grpc.ServiceError | null, response: { session_id: string }) => {
          if (err) return reject(err);
          resolve(response.session_id);
        },
      );
    });
  }

  async getSession(userId: string, sessionId: string): Promise<SessionWithEvents> {
    return new Promise((resolve, reject) => {
      this.client.GetSession(
        { user_id: userId, session_id: sessionId },
        createGrpcMetadata(this.config, V2_GRPC_SECURITY_NS),
        this.unaryDeadline,
        (err: grpc.ServiceError | null, response: any) => {
          if (err) return reject(err);
          resolve({
            sessionId: response.session_id,
            title: response.title,
            status: response.status,
            isShared: !!response.is_shared,
            events: (response.events as RawProtoEvent[]).map(this.normaliseEvent),
          });
        },
      );
    });
  }

  async stopSession(userId: string, sessionId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.StopSession(
        { user_id: userId, session_id: sessionId },
        createGrpcMetadata(this.config, V2_GRPC_SECURITY_NS),
        this.unaryDeadline,
        (err: grpc.ServiceError | null) => (err ? reject(err) : resolve()),
      );
    });
  }

  async pauseSession(userId: string, sessionId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.PauseSession(
        { user_id: userId, session_id: sessionId },
        createGrpcMetadata(this.config, V2_GRPC_SECURITY_NS),
        this.unaryDeadline,
        (err: grpc.ServiceError | null) => (err ? reject(err) : resolve()),
      );
    });
  }

  async resumeSession(userId: string, sessionId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.ResumeSession(
        { user_id: userId, session_id: sessionId },
        createGrpcMetadata(this.config, V2_GRPC_SECURITY_NS),
        this.unaryDeadline,
        (err: grpc.ServiceError | null) => (err ? reject(err) : resolve()),
      );
    });
  }

  async getVncSignedUrl(
    userId: string,
    sessionId: string,
  ): Promise<{ url: string; expiresAt: number } | null> {
    return new Promise((resolve, reject) => {
      this.client.GetVncSignedUrl(
        { user_id: userId, session_id: sessionId },
        createGrpcMetadata(this.config, V2_GRPC_SECURITY_NS),
        this.unaryDeadline,
        (
          err: grpc.ServiceError | null,
          response: { url: string; expires_at: number },
        ) => {
          if (err) {
            if (
              err.code === grpc.status.UNIMPLEMENTED ||
              err.code === grpc.status.NOT_FOUND
            ) {
              return resolve(null);
            }
            return reject(err);
          }
          if (!response.url) return resolve(null);
          resolve({ url: response.url, expiresAt: response.expires_at });
        },
      );
    });
  }

  /**
   * Deploy/publish the session's app. Blocking unary call — Manus performs the
   * deployment and returns the live URL. Generous 5-minute deadline since a
   * first deploy can be slow. Returns null when Manus doesn't implement Deploy
   * yet (UNIMPLEMENTED), mirroring getVncSignedUrl, so the caller can fall back.
   */
  async deploy(
    userId: string,
    sessionId: string,
  ): Promise<{ url: string; deployedAt: number } | null> {
    return new Promise((resolve, reject) => {
      this.client.Deploy(
        { user_id: userId, session_id: sessionId },
        new grpc.Metadata(),
        { deadline: Date.now() + 300_000 },
        (
          err: grpc.ServiceError | null,
          response: { url: string; deployed_at: number },
        ) => {
          if (err) {
            if (err.code === grpc.status.UNIMPLEMENTED) return resolve(null);
            return reject(err);
          }
          if (!response.url) return resolve(null);
          resolve({ url: response.url, deployedAt: response.deployed_at });
        },
      );
    });
  }

  chat(
    userId: string,
    sessionId: string,
    message: string,
    model?: string,
    connectorRepo?: {
      connectorId: string;
      connectorName: string;
      repoId: string;
      repoName: string;
      repoUrl?: string;
    },
    skills?: IGrpcSkill[],
    connectors?: IGrpcConnector[],
  ): Observable<ConversationV2Event> {
    return new Observable<ConversationV2Event>((subscriber) => {
      const request: Record<string, unknown> = {
        user_id: userId,
        session_id: sessionId,
        message,
      };
      if (model) request.model = model;
      if (connectorRepo) {
        request.connector_repo = {
          connector_id: connectorRepo.connectorId,
          connector_name: connectorRepo.connectorName,
          repo_id: connectorRepo.repoId,
          repo_name: connectorRepo.repoName,
          repo_url: connectorRepo.repoUrl ?? '',
        };
      }
      if (skills?.length) request.skills = skills;
      if (connectors?.length) request.connectors = connectors;
      // Pass metadata positionally (NOT `{ metadata }`) so grpc-js sends the
      // x-api-key header instead of treating it as call options.
      const call = this.client.Chat(
        request,
        createGrpcMetadata(this.config, V2_GRPC_SECURITY_NS),
      );
      call.on('data', (raw: RawProtoEvent) => {
        try {
          const event = this.normaliseEvent(raw);
          if (event.type === 'tool' && (event.payload as any).name === 'browser') {
            const p = event.payload as any;
            this.logger.log(
              `[browser-tool] session=${sessionId} tool_call_id=${p.tool_call_id} status=${p.status} content=${p.content ? `{kind:${p.content.kind} screenshot=${p.content.screenshot_url || '(empty)'}}` : 'undefined'}`,
            );
          }
          subscriber.next(event);
        } catch (err) {
          subscriber.error(err);
        }
      });
      call.on('end', () => subscriber.complete());
      call.on('error', (err: Error) => subscriber.error(err));
      return () => {
        try {
          call.cancel();
        } catch {
          /* noop on already-closed */
        }
      };
    });
  }

  private normaliseEvent = (raw: RawProtoEvent): ConversationV2Event => {
    const base = {
      event_id: raw.event_id,
      timestamp: typeof raw.timestamp === 'string' ? Number.parseInt(raw.timestamp, 10) : raw.timestamp,
    };
    switch (raw.payload) {
      case 'message':
        return {
          type: 'message',
          payload: {
            ...base,
            role: raw.message!.role,
            content: raw.message!.content,
            // The AI service emits the Ceph object key in `FileInfo.url` (proto
            // field 4). The frontend contract calls this `path` (the value the
            // signed-url endpoint expects), so normalise the field name here.
            // Reading `.path` directly downstream yields undefined → an empty
            // signing request → a misleading 400 "path must be shorter than 4096".
            attachments: (raw.message!.attachments ?? []).map((a) => ({
              id: a.id,
              name: a.name,
              content_type: a.content_type,
              path: a.path ?? a.url ?? '',
            })),
          },
        };
      case 'tool': {
        const t = raw.tool!;
        const v = t.content?.variant;
        let content: any;
        switch (v) {
          case 'browser':
            content = { kind: 'browser', ...t.content!.browser! };
            break;
          case 'shell':
            content = { kind: 'shell', ...t.content!.shell! };
            break;
          case 'file':
            content = { kind: 'file', ...t.content!.file! };
            break;
          case 'search':
            content = { kind: 'search', query: t.content!.search!.query, results: t.content!.search!.results ?? [] };
            break;
          case 'mcp':
            content = { kind: 'mcp', server: t.content!.mcp!.server, tool: t.content!.mcp!.tool, result: safeJson(t.content!.mcp!.result_json) };
            break;
          case 'webpage':
            content = { kind: 'webpage', url: t.content!.webpage!.url, title: t.content!.webpage!.title };
            break;
          case 'generic':
            content = { kind: 'generic', data: safeJson(t.content!.generic!.json) };
            break;
          default:
            content = undefined;
        }
        return {
          type: 'tool',
          payload: {
            ...base,
            tool_call_id: t.tool_call_id,
            name: t.name,
            status: t.status,
            function: t.function,
            args: safeJson(t.args_json || '{}') as Record<string, unknown>,
            content,
          },
        };
      }
      case 'step':
        return { type: 'step', payload: { ...base, ...raw.step! } };
      case 'plan':
        return { type: 'plan', payload: { ...base, steps: raw.plan?.steps ?? [] } };
      case 'title':
        return { type: 'title', payload: { ...base, title: raw.title!.title } };
      case 'done':
        return { type: 'done', payload: base };
      case 'wait':
        return { type: 'wait', payload: base };
      case 'error':
        return { type: 'error', payload: { ...base, error: raw.error!.error } };
      case 'application_component':
        return {
          type: 'application_component',
          payload: {
            ...base,
            url: raw.application_component!.url,
            title: raw.application_component!.title,
          },
        };
      default:
        throw new Error(`Unknown event payload: ${raw.payload}`);
    }
  };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
