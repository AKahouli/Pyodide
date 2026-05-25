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
import { Observable } from 'rxjs';
import {
  ConversationV2Event,
  SessionWithEvents,
  ConversationV2EventType,
} from '../types/conversation-v2.types';

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
    attachments?: Array<{ id: string; name: string; content_type: string; url: string }>;
  };
  tool?: {
    tool_call_id: string;
    name: string;
    status: string;
    function: string;
    args_json: string;
    content?: {
      variant: 'browser' | 'shell' | 'file' | 'search' | 'mcp' | 'generic';
      browser?: { screenshot_url: string; url?: string; title?: string };
      shell?: { command: string; output: string; exit_code: number; session_handle?: string };
      file?: { path: string; content: string; language?: string; operation?: string };
      search?: { query: string; results?: Array<{ title: string; url: string; snippet: string }> };
      mcp?: { server: string; tool: string; result_json: string };
      generic?: { json: string };
    };
  };
  step?: { id: string; status: string; description: string };
  plan?: { steps: Array<{ id: string; status: string; description: string }> };
  title?: { title: string };
  done?: Record<string, never>;
  wait?: Record<string, never>;
  error?: { error: string };
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

  constructor(private readonly config: ConfigService) {}

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
    this.client = new proto.yellostorm.manus.v1.ConversationV2(
      url,
      grpc.credentials.createInsecure(),
      {
        'grpc.max_send_message_length': maxMsg,
        'grpc.max_receive_message_length': maxMsg,
        'grpc.keepalive_time_ms': 30_000,
      },
    );
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

  async createSession(userId: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.client.CreateSession(
        { user_id: userId },
        new grpc.Metadata(),
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
        new grpc.Metadata(),
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
        new grpc.Metadata(),
        this.unaryDeadline,
        (err: grpc.ServiceError | null) => (err ? reject(err) : resolve()),
      );
    });
  }

  async pauseSession(userId: string, sessionId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.PauseSession(
        { user_id: userId, session_id: sessionId },
        new grpc.Metadata(),
        this.unaryDeadline,
        (err: grpc.ServiceError | null) => (err ? reject(err) : resolve()),
      );
    });
  }

  async resumeSession(userId: string, sessionId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.ResumeSession(
        { user_id: userId, session_id: sessionId },
        new grpc.Metadata(),
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
        new grpc.Metadata(),
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

  chat(
    userId: string,
    sessionId: string,
    message: string,
  ): Observable<ConversationV2Event> {
    return new Observable<ConversationV2Event>((subscriber) => {
      const call = this.client.Chat({
        user_id: userId,
        session_id: sessionId,
        message,
      });
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
      timestamp: typeof raw.timestamp === 'string' ? parseInt(raw.timestamp, 10) : raw.timestamp,
    };
    switch (raw.payload) {
      case 'message':
        return {
          type: 'message',
          payload: {
            ...base,
            role: raw.message!.role,
            content: raw.message!.content,
            attachments: raw.message!.attachments ?? [],
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
