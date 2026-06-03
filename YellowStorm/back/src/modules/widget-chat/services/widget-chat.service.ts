import { Injectable } from '@nestjs/common';
import { LoggerService } from '@modules/logger';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID, createHash } from 'node:crypto';
import * as grpc from '@grpc/grpc-js';
import { Observable } from 'rxjs';
import { StreamService } from '@modules/conversation/services/stream.service';
import { WidgetSseStreamRegistry } from './widget-sse-stream.registry';
import { WidgetToken, WidgetTokenDocument } from '../schemas/widget-token.schema';
import { WidgetSession, WidgetSessionDocument } from '../schemas/widget-session.schema';
import { WidgetMessage, WidgetMessageDocument } from '../schemas/widget-message.schema';
import { AgentService } from '@modules/agent/agent.service';
import { IGrpcAgent } from '@modules/agent/interfaces/agent.interface';
import { MessageComponent, ComponentType } from '@modules/conversation/interfaces/message.interface';
import { getComponentType, extractComponentData } from '@modules/conversation/utils/component-mapper';

@Injectable()
export class WidgetChatService {
  private readonly sseRegistry = new WidgetSseStreamRegistry();

  constructor(
    @InjectModel(WidgetToken.name) private readonly widgetTokenModel: Model<WidgetTokenDocument>,
    @InjectModel(WidgetSession.name) private readonly widgetSessionModel: Model<WidgetSessionDocument>,
    @InjectModel(WidgetMessage.name) private readonly widgetMessageModel: Model<WidgetMessageDocument>,
    private readonly agentService: AgentService,
    private readonly streamService: StreamService,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(WidgetChatService.name);
  }

  // ─── Token CRUD ─────────────────────────────────────────────

  async createToken(agentId: string, createdBy: string, opts: { label?: string; allowedOrigins?: string[]; expiresAt?: string }): Promise<{ id: string; token: string; agentId: string }> {
    const token = randomUUID();
    const tokenHash = createHash('sha256').update(token).digest('hex');

    const doc = new this.widgetTokenModel({
      tokenHash,
      agentId,
      label: opts.label,
      allowedOrigins: opts.allowedOrigins || [],
      isActive: true,
      expiresAt: opts.expiresAt ? new Date(opts.expiresAt) : undefined,
      createdBy,
    });
    await doc.save();

    return { id: doc.id, token, agentId };
  }

  async listTokens(agentId: string) {
    return this.widgetTokenModel.find({ agentId }).select('-tokenHash').sort({ createdAt: -1 }).lean().exec();
  }

  async updateToken(agentId: string, tokenId: string, update: { label?: string; allowedOrigins?: string[]; isActive?: boolean; expiresAt?: string }) {
    const doc = await this.widgetTokenModel.findOneAndUpdate(
      { _id: tokenId, agentId },
      {
        ...(update.label !== undefined && { label: update.label }),
        ...(update.allowedOrigins !== undefined && { allowedOrigins: update.allowedOrigins }),
        ...(update.isActive !== undefined && { isActive: update.isActive }),
        ...(update.expiresAt !== undefined && { expiresAt: update.expiresAt ? new Date(update.expiresAt) : null }),
      },
      { new: true },
    ).select('-tokenHash').lean().exec();
    return doc;
  }

  async revokeToken(agentId: string, tokenId: string) {
    return this.widgetTokenModel.findOneAndDelete({ _id: tokenId, agentId }).lean().exec();
  }

  // ─── Session ─────────────────────────────────────────────────

  async createOrGetSession(tokenHash: string, agentId: string, visitorId: string, metadata: Record<string, unknown>): Promise<{ id: string }> {
    let session = await this.widgetSessionModel.findOne({ tokenHash, visitorId, status: 'active' }).lean().exec() as any;
    if (session) {
      const sessionId = session._id.toString();
      this.logger.debug('Widget session reused', { sessionId, agentId, visitorId });
      return { id: sessionId };
    }

    session = await this.widgetSessionModel.create({ tokenHash, agentId, visitorId, metadata });
    const sessionId = (session as any)._id.toString();
    this.logger.log('Widget session created', { sessionId, agentId, visitorId });
    return { id: sessionId };
  }

  // ─── Chat ──────────────────────────────────────────────────

  async handleMessage(params: {
    tokenHash: string;
    agentId: string;
    sessionId: string;
    message: string;
    agent: any;
    metadata: Record<string, unknown>;
  }): Promise<{ messageId: string; sessionId: string }> {
    const { tokenHash, agentId, sessionId, message, agent, metadata } = params;

    this.logger.log('Widget chat message received', {
      sessionId,
      agentId,
      messageLength: message.length,
      origin: metadata.origin,
    });

    this.sseRegistry.ensureSession(sessionId);

    const userMsg = await this.widgetMessageModel.create({
      sessionId,
      tokenHash,
      agentId,
      role: 'user',
      content: message,
    });

    await this.widgetSessionModel.findByIdAndUpdate(sessionId, {
      $inc: { messageCount: 1 },
    }).exec();

    await this.widgetTokenModel.findOneAndUpdate({ tokenHash }, { lastUsedAt: new Date() }).exec();

    this.executeStream(sessionId, agentId, tokenHash, message, agent).catch((err) => {
      this.logger.error('Widget stream failed', { sessionId, error: (err as Error).message });
      this.sseRegistry.emit(sessionId, { type: 'stream_error', data: { message: 'AI service error' } });
      this.sseRegistry.cleanup(sessionId);
    });

    this.logger.log('Widget chat accepted, stream starting', { sessionId, messageId: userMsg.id });
    return { messageId: userMsg.id, sessionId };
  }

  getStream(sessionId: string): Observable<{ type: string; data: Record<string, unknown> }> | null {
    if (!sessionId) {
      this.logger.warn('Widget SSE rejected: empty sessionId');
      return null;
    }
    this.sseRegistry.ensureSession(sessionId);
    const heartbeatMs = this.configService.get<number>('conversation.sseHeartbeatMs', 15000);
    this.logger.log('Widget SSE stream opened', { sessionId });
    return this.sseRegistry.observe(sessionId, heartbeatMs);
  }

  removeStream(sessionId: string): void {
    this.logger.debug('Widget SSE stream closed', { sessionId });
    this.sseRegistry.cleanup(sessionId);
  }

  private async executeStream(sessionId: string, agentId: string, tokenHash: string, query: string, agentDoc: any): Promise<void> {
    const grpcUrl = this.configService.get<string>('conversation.grpcUrl', 'localhost:50051');
    const grpcReady = await this.streamService.waitForGrpcReady(5000);
    this.logger.log('Widget executeStream start', { sessionId, agentId, grpcReady, grpcUrl });

    const chatbotClient = this.streamService.getChatbotClient();
    if (!grpcReady || !chatbotClient) {
      this.logger.warn('Widget executeStream aborted: gRPC unavailable', {
        sessionId,
        grpcUrl,
        health: this.streamService.getHealthStatus(),
      });
      this.sseRegistry.emit(sessionId, {
        type: 'stream_error',
        data: {
          message: `AI service unavailable. Start the ADK gRPC server (${grpcUrl}).`,
        },
      });
      this.sseRegistry.cleanup(sessionId);
      return;
    }

    const stream = this.sseRegistry.getActiveStream(sessionId);
    if (!stream) {
      this.logger.error('Widget executeStream aborted: no stream registry', { sessionId });
      return;
    }

    this.sseRegistry.emit(sessionId, { type: 'stream_start', data: { sessionId } });

    try {
      const agents = await this.agentService.buildAgentsForStream('widget', undefined, [agentId]);
      const resolvedAgents = agents.length > 0 ? agents : await this.agentService.buildAgentsForStream('widget', undefined, undefined);
      this.logger.debug('Widget gRPC agents resolved', {
        sessionId,
        requestedAgentId: agentId,
        resolvedCount: resolvedAgents.length,
      });

      const grpcRequest = {
        user_context: { user_id: `widget-${sessionId}`, username: 'WidgetVisitor' },
        conversation_id: sessionId,
        query,
        agents: resolvedAgents,
        workspace_context: [{ workspace_id: sessionId, workspace_name: 'widget', workspace_documents: [] }],
        agent_mode: 'manual',
        attached_files: [],
        previous_attached_files: [],
      };

      const timeoutMs = this.configService.get<number>('conversation.grpcTimeoutMs', 120000);

      await new Promise<void>((resolve, reject) => {
        const metadata = new grpc.Metadata();
        metadata.set('user', 'WidgetVisitor');
        const call = chatbotClient.RunAgentTeam(grpcRequest, { metadata });

        let totalInput = 0;
        let totalOutput = 0;
        let chunkCount = 0;

        let timeoutHandle: NodeJS.Timeout | null = null;
        const resetIdle = () => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          timeoutHandle = setTimeout(() => {
            call.cancel();
            reject(new Error('Widget stream idle timeout'));
          }, timeoutMs);
        };
        resetIdle();

        call.on('data', (chunk: any) => {
          resetIdle();
          chunkCount++;

          const action = chunk.action;
          const comp = chunk.component;

          if (comp && comp.id && (action === 'add' || action === 'update' || action === 'delete')) {
            if (action === 'delete') {
              stream.buffer.delete(comp.id);
              this.sseRegistry.emit(sessionId, { type: 'stream_chunk', data: { action, component: { id: comp.id } } });
            } else {
              const { type, data } = this.extractComponent(comp);
              if (action === 'add') {
                stream.buffer.set(comp.id, { id: comp.id, type, data: { ...data } });
              } else {
                const existing = stream.buffer.get(comp.id);
                if (existing) existing.data = this.mergeData(type, existing.data, data);
              }
              this.sseRegistry.emit(sessionId, {
                type: 'stream_chunk',
                data: { action, component: { id: comp.id, type, data } },
              });
            }
          }

          if (chunk.usage) {
            totalInput += chunk.usage.input_tokens || 0;
            totalOutput += chunk.usage.output_tokens || 0;
            stream.usage.inputTokens = totalInput;
            stream.usage.outputTokens = totalOutput;
            if (chunk.usage.model) stream.usage.model = chunk.usage.model;
          }
        });

        call.on('end', async () => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          try {
            const components = Array.from(stream.buffer.values());
            let replyText = '';
            for (const c of components) {
              if (c.type === 'text' && typeof c.data.content === 'string') {
                replyText += c.data.content;
              }
            }

            this.logger.log('Widget gRPC stream completed', {
              sessionId,
              chunkCount,
              replyLength: replyText.length,
              inputTokens: totalInput,
              outputTokens: totalOutput,
            });

            await this.widgetMessageModel.create({
              sessionId,
              tokenHash,
              agentId,
              role: 'assistant',
              content: replyText || 'No response generated.',
              components,
              inputTokens: totalInput,
              outputTokens: totalOutput,
            });

            await this.widgetSessionModel.findByIdAndUpdate(sessionId, {
              $inc: { messageCount: 1 },
            }).exec();

            this.sseRegistry.emit(sessionId, {
              type: 'stream_complete',
              data: {
                reply: replyText,
                usage: { inputTokens: totalInput, outputTokens: totalOutput },
              },
            });
            this.sseRegistry.cleanup(sessionId);
            resolve();
          } catch (err) {
            this.logger.error('Failed to persist widget AI message', { sessionId, error: (err as Error).message });
            this.sseRegistry.cleanup(sessionId);
            reject(err);
          }
        });

        call.on('error', (error: any) => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          this.logger.error('Widget gRPC stream error', { sessionId, error: error.message, chunkCount });
          this.sseRegistry.emit(sessionId, { type: 'stream_error', data: { message: 'AI stream error' } });
          this.sseRegistry.cleanup(sessionId);
          reject(error);
        });
      });
    } catch (error) {
      this.logger.error('Widget stream setup failed', { sessionId, error: (error as Error).message });
      this.sseRegistry.emit(sessionId, { type: 'stream_error', data: { message: 'Failed to start AI stream' } });
      this.sseRegistry.cleanup(sessionId);
      throw error;
    }
  }

  private extractComponent(comp: any): { type: ComponentType; data: Record<string, unknown> } {
    return { type: getComponentType(comp), data: extractComponentData(comp) };
  }

  private mergeData(type: ComponentType, existing: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, unknown> {
    if (type === 'text' || type === 'reasoning' || type === 'code') {
      return { ...existing, content: (existing.content as string) + (incoming.content as string) };
    }
    return { ...incoming };
  }
}
