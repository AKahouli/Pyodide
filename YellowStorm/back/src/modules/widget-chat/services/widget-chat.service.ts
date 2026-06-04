import { Injectable } from '@nestjs/common';
import { LoggerService } from '@modules/logger';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID, createHash } from 'node:crypto';
import { Types } from 'mongoose';
import * as grpc from '@grpc/grpc-js';
import { Observable } from 'rxjs';
import { StreamService } from '@modules/conversation/services/stream.service';
import { WidgetSseStreamRegistry } from './widget-sse-stream.registry';
import { WidgetToken, WidgetTokenDocument } from '../schemas/widget-token.schema';
import { WidgetSession, WidgetSessionDocument } from '../schemas/widget-session.schema';
import { WidgetMessage, WidgetMessageDocument } from '../schemas/widget-message.schema';
import { AgentService } from '@modules/agent/agent.service';
import { ModelsService } from '@modules/models/models.service';
import { IGrpcAgent } from '@modules/agent/interfaces/agent.interface';
import { MessageComponent, ComponentType } from '@modules/conversation/interfaces/message.interface';
import { extractComponentData, aggregateTextFromComponents } from '@modules/conversation/utils/component-mapper';

@Injectable()
export class WidgetChatService {
  private readonly sseRegistry = new WidgetSseStreamRegistry();

  constructor(
    @InjectModel(WidgetToken.name) private readonly widgetTokenModel: Model<WidgetTokenDocument>,
    @InjectModel(WidgetSession.name) private readonly widgetSessionModel: Model<WidgetSessionDocument>,
    @InjectModel(WidgetMessage.name) private readonly widgetMessageModel: Model<WidgetMessageDocument>,
    private readonly agentService: AgentService,
    private readonly modelsService: ModelsService,
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

  /** Closes the active visitor session and starts a fresh one (clear chat). */
  async resetVisitorSession(
    tokenHash: string,
    agentId: string,
    visitorId: string,
    metadata: Record<string, unknown>,
  ): Promise<{ sessionId: string }> {
    const active = await this.widgetSessionModel
      .findOne({ tokenHash, visitorId, status: 'active' })
      .lean()
      .exec();

    if (active) {
      const previousSessionId = active._id.toString();
      await this.widgetSessionModel.findByIdAndUpdate(previousSessionId, { status: 'closed' }).exec();
      this.sseRegistry.cleanup(previousSessionId);
      this.logger.log('Widget session closed for reset', { previousSessionId, agentId, visitorId });
    }

    const session = await this.createOrGetSession(tokenHash, agentId, visitorId, metadata);
    return { sessionId: session.id };
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

  /**
   * Synchronous REST integration: one request returns the full agent reply as JSON.
   * Uses the same gRPC pipeline as the widget but not the /widget/* routes.
   */
  async sendIntegrationMessage(params: {
    tokenHash: string;
    agentId: string;
    message: string;
    visitorId: string;
    agent: any;
    metadata: Record<string, unknown>;
  }): Promise<{
    sessionId: string;
    messageId: string;
    reply: string;
    usage: { inputTokens: number; outputTokens: number; model?: string };
  }> {
    const { tokenHash, agentId, message, visitorId, agent, metadata } = params;
    const session = await this.createOrGetSession(tokenHash, agentId, visitorId, metadata);
    const sessionId = session.id;

    const userMsg = await this.widgetMessageModel.create({
      sessionId,
      tokenHash,
      agentId,
      role: 'user',
      content: message,
    });

    await this.widgetSessionModel.findByIdAndUpdate(sessionId, { $inc: { messageCount: 1 } }).exec();
    await this.widgetTokenModel.findOneAndUpdate({ tokenHash }, { lastUsedAt: new Date() }).exec();

    const timeoutMs = this.configService.get<number>('conversation.grpcTimeoutMs', 120000);
    this.sseRegistry.ensureSession(sessionId);

    const streamResult = await new Promise<{
      reply: string;
      usage: { inputTokens: number; outputTokens: number; model?: string };
    }>((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        subscription.unsubscribe();
        fn();
      };

      const timer = setTimeout(() => {
        finish(() => reject(new Error('Integration reply timeout')));
      }, timeoutMs);

      const subscription = this.sseRegistry.observe(sessionId, timeoutMs).subscribe({
        next: (event) => {
          if (event.type === 'stream_complete') {
            const data = event.data as {
              reply?: string;
              usage?: { inputTokens?: number; outputTokens?: number; model?: string };
            };
            finish(() =>
              resolve({
                reply: String(data.reply ?? '').trim(),
                usage: {
                  inputTokens: data.usage?.inputTokens ?? 0,
                  outputTokens: data.usage?.outputTokens ?? 0,
                  model: data.usage?.model,
                },
              }),
            );
          } else if (event.type === 'stream_error') {
            const msg = String((event.data as { message?: string }).message ?? 'AI stream error');
            finish(() => reject(new Error(msg)));
          }
        },
        error: (err) => finish(() => reject(err)),
      });

      this.executeStream(sessionId, agentId, tokenHash, message, agent).catch((err) =>
        finish(() => reject(err)),
      );
    });

    this.sseRegistry.cleanup(sessionId);

    const replyText = streamResult.reply || 'No response generated.';
    await this.widgetMessageModel.create({
      sessionId,
      tokenHash,
      agentId,
      role: 'assistant',
      content: replyText,
      inputTokens: streamResult.usage.inputTokens,
      outputTokens: streamResult.usage.outputTokens,
    });
    await this.widgetSessionModel.findByIdAndUpdate(sessionId, { $inc: { messageCount: 1 } }).exec();

    return {
      sessionId,
      messageId: userMsg.id,
      reply: replyText,
      usage: streamResult.usage,
    };
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

    this.sseRegistry.resetStreamBuffer(sessionId);
    this.sseRegistry.emit(sessionId, { type: 'stream_start', data: { sessionId } });

    try {
      const ownerUserId = this.resolveAgentOwnerUserId(agentDoc);
      if (!ownerUserId) {
        this.logger.error('Widget executeStream aborted: agent missing createdBy', { sessionId, agentId });
        this.sseRegistry.emit(sessionId, {
          type: 'stream_error',
          data: { message: 'Agent configuration is invalid for widget chat.' },
        });
        this.sseRegistry.cleanup(sessionId);
        return;
      }

      const fallbackModelId = await this.resolveFallbackModelId();
      const resolvedAgents = await this.resolveWidgetGrpcAgents(
        ownerUserId,
        agentId,
        fallbackModelId,
        sessionId,
      );
      if (!resolvedAgents) {
        this.logger.warn('Widget executeStream aborted: missing manager for manual gRPC', {
          sessionId,
          agentId,
          ownerUserId,
        });
        this.sseRegistry.emit(sessionId, {
          type: 'stream_error',
          data: {
            message:
              'Widget chat requires a Manager agent. Add an active Manager agent for this account (or a system default Manager).',
          },
        });
        this.sseRegistry.cleanup(sessionId);
        return;
      }

      this.logger.debug('Widget gRPC agents resolved', {
        sessionId,
        requestedAgentId: agentId,
        ownerUserId,
        resolvedCount: resolvedAgents.length,
        agentNames: resolvedAgents.map((a) => ({ name: a.name, type: a.agent_type })),
        fallbackModelId: fallbackModelId || '(none)',
        agentModels: resolvedAgents.map((a) => a.chatbot?.model || '(empty)'),
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
      const managerAgentIds = new Set(
        resolvedAgents.filter((a) => a.agent_type === 'manager').map((a) => a.id),
      );
      const componentAgentIds = new Map<string, string>();
      const managerComponentBuffer = new Map<string, MessageComponent>();
      const fullComponentBuffer = new Map<string, MessageComponent>();

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
          const chunkAgentId = typeof chunk.metadata?.agent_id === 'string' ? chunk.metadata.agent_id : '';

          if (comp?.id && chunkAgentId) {
            componentAgentIds.set(comp.id, chunkAgentId);
          }

          if (comp && comp.id && (action === 'add' || action === 'update' || action === 'delete')) {
            const showInWidget = this.isManagerStreamOutput(
              managerAgentIds,
              componentAgentIds,
              comp.id,
              chunkAgentId,
            );

            if (action === 'delete') {
              managerComponentBuffer.delete(comp.id);
              fullComponentBuffer.delete(comp.id);
              stream.buffer.delete(comp.id);
              componentAgentIds.delete(comp.id);
              if (showInWidget) {
                this.sseRegistry.emit(sessionId, {
                  type: 'stream_chunk',
                  data: { action, component: { id: comp.id } },
                });
              }
            } else {
              const { type, data } = this.extractComponent(comp);
              this.mergeComponentBuffer(fullComponentBuffer, comp.id, action, type, data);
              if (showInWidget) {
                this.mergeComponentBuffer(managerComponentBuffer, comp.id, action, type, data);
                stream.buffer.set(comp.id, managerComponentBuffer.get(comp.id)!);
              }
              if (showInWidget && this.isWidgetDisplayChunk(type, data)) {
                const payload =
                  type === 'error'
                    ? {
                        content: [data.title, data.content].filter(Boolean).join(': ') || 'Agent error',
                      }
                    : data;
                this.sseRegistry.emit(sessionId, {
                  type: 'stream_chunk',
                  data: { action, component: { id: comp.id, type: type === 'error' ? 'text' : type, data: payload } },
                });
              }
            }
          } else if (!chunk.usage) {
            this.logger.warn('Widget gRPC chunk ignored', {
              sessionId,
              action,
              hasComponent: Boolean(comp),
              componentId: comp?.id,
              chunkKeys: Object.keys(chunk || {}),
            });
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
            const managerComponents = Array.from(managerComponentBuffer.values());
            const workerComponents = this.filterWorkerComponents(
              Array.from(fullComponentBuffer.values()),
              agentId,
              managerAgentIds,
              componentAgentIds,
            );
            const managerReply = this.aggregateReplyText(managerComponents);
            const workerReply = this.aggregateReplyText(workerComponents);
            const allComponents = Array.from(fullComponentBuffer.values());
            let displayReply =
              managerReply.trim() || workerReply.trim() || this.extractErrorReply(allComponents);
            const usedWorkerFallback = !managerReply.trim() && Boolean(workerReply.trim());

            if (usedWorkerFallback) {
              this.logger.log('Widget using worker agent reply (manager had no text)', {
                sessionId,
                widgetAgentId: agentId,
                workerReplyLength: workerReply.length,
              });
              this.sseRegistry.emit(sessionId, {
                type: 'stream_chunk',
                data: {
                  action: 'add',
                  component: {
                    id: `widget-worker-${sessionId}`,
                    type: 'text',
                    data: { content: workerReply },
                  },
                },
              });
            }

            if (!displayReply.trim()) {
              this.logger.warn('Widget gRPC stream ended with empty reply', {
                sessionId,
                chunkCount,
                componentTypes: allComponents.map((c) => c.type),
                inputTokens: totalInput,
                outputTokens: totalOutput,
              });
            }

            this.logger.log('Widget gRPC stream completed', {
              sessionId,
              chunkCount,
              replyLength: displayReply.length,
              usedWorkerFallback,
              componentTypes: allComponents.map((c) => c.type),
              inputTokens: totalInput,
              outputTokens: totalOutput,
            });

            await this.widgetMessageModel.create({
              sessionId,
              tokenHash,
              agentId,
              role: 'assistant',
              content: displayReply || 'No response generated.',
              components: allComponents,
              inputTokens: totalInput,
              outputTokens: totalOutput,
            });

            await this.widgetSessionModel.findByIdAndUpdate(sessionId, {
              $inc: { messageCount: 1 },
            }).exec();

            this.sseRegistry.emit(sessionId, {
              type: 'stream_complete',
              data: {
                reply: displayReply,
                usage: { inputTokens: totalInput, outputTokens: totalOutput },
              },
            });

            if (!displayReply.trim()) {
              this.sseRegistry.emit(sessionId, {
                type: 'stream_error',
                data: {
                  message:
                    'The agent returned no text. Check the agent model, ADK logs, and that CONVERSATION_GRPC_URL points to a running ADK server.',
                },
              });
            }
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

  private resolveAgentOwnerUserId(agentDoc: { createdBy?: unknown }): string | null {
    const raw = agentDoc?.createdBy;
    if (!raw) return null;
    const id = typeof raw === 'string' ? raw : (raw as { toString(): string }).toString();
    return Types.ObjectId.isValid(id) ? id : null;
  }

  private extractComponent(comp: any): { type: ComponentType; data: Record<string, unknown> } {
    return extractComponentData(comp);
  }

  private mergeData(type: ComponentType, existing: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, unknown> {
    if (type === 'text' || type === 'reasoning' || type === 'code') {
      return { ...existing, content: (existing.content as string) + (incoming.content as string) };
    }
    return { ...incoming };
  }

  private mergeComponentBuffer(
    buffer: Map<string, MessageComponent>,
    componentId: string,
    action: string,
    type: ComponentType,
    data: Record<string, unknown>,
  ): void {
    const existing = buffer.get(componentId);
    if (action === 'add' || !existing) {
      buffer.set(componentId, { id: componentId, type, data: { ...data } });
      return;
    }
    existing.data = this.mergeData(type, existing.data, data);
  }

  private filterWorkerComponents(
    components: MessageComponent[],
    widgetAgentId: string,
    managerAgentIds: Set<string>,
    componentAgentIds: Map<string, string>,
  ): MessageComponent[] {
    return components.filter((c) => {
      const ownerId = componentAgentIds.get(c.id) || '';
      return ownerId === widgetAgentId && !managerAgentIds.has(ownerId);
    });
  }

  private isManagerStreamOutput(
    managerAgentIds: Set<string>,
    componentAgentIds: Map<string, string>,
    componentId: string,
    chunkAgentId: string,
  ): boolean {
    const agentId = chunkAgentId || componentAgentIds.get(componentId) || '';
    return Boolean(agentId && managerAgentIds.has(agentId));
  }

  private isWidgetDisplayChunk(type: ComponentType, data: Record<string, unknown>): boolean {
    if (type === 'error') {
      return typeof data.content === 'string' || typeof data.title === 'string';
    }
    return type === 'text' && typeof data.content === 'string';
  }

  /**
   * ADK manual mode requires a Manager agent plus the widget worker.
   * Uses the same manager resolution as conversation streams.
   */
  private async resolveWidgetGrpcAgents(
    ownerUserId: string,
    widgetAgentId: string,
    fallbackModelId: string | undefined,
    sessionId: string,
  ): Promise<IGrpcAgent[] | null> {
    let agents = await this.agentService.buildAgentsForStream(
      ownerUserId,
      fallbackModelId,
      [widgetAgentId],
    );

    if (!agents.some((a) => a.id === widgetAgentId)) {
      const widgetOnly = await this.agentService.buildGrpcAgentsForPlaybook(
        ownerUserId,
        [widgetAgentId],
        fallbackModelId,
        sessionId,
      );
      if (widgetOnly.length === 0) {
        return null;
      }
      const byId = new Map(agents.map((a) => [a.id, a]));
      for (const agent of widgetOnly) {
        byId.set(agent.id, agent);
      }
      agents = Array.from(byId.values());
    }

    if (!agents.some((a) => a.agent_type === 'manager')) {
      return null;
    }

    return agents;
  }

  private async resolveFallbackModelId(): Promise<string | undefined> {
    const defaultModel = await this.modelsService.getDefaultModel();
    const identifier = this.modelsService.getModelIdentifier(defaultModel);
    return identifier || undefined;
  }

  private aggregateReplyText(components: MessageComponent[]): string {
    return aggregateTextFromComponents(components.filter((c) => c.type === 'text'));
  }

  private extractErrorReply(components: MessageComponent[]): string {
    for (const component of components) {
      if (component.type !== 'error') continue;
      const title = typeof component.data.title === 'string' ? component.data.title : '';
      const content = typeof component.data.content === 'string' ? component.data.content : '';
      const combined = [title, content].filter(Boolean).join(': ');
      if (combined) return combined;
    }
    return '';
  }
}
