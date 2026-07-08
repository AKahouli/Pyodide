import { Injectable } from '@nestjs/common';
import { LoggerService } from '@modules/logger';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID, createHash } from 'node:crypto';
import { Types } from 'mongoose';
import { Observable } from 'rxjs';
import { ServiceUnavailableException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
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
import {
  normalizeWidgetComponent,
  normalizeWidgetSourcesData,
  sanitizeWidgetTextContent,
  shouldEmitWidgetComponent,
  WIDGET_PRIMARY_TEXT_ID,
  WidgetStreamComponentType,
} from '../utils/widget-component-normalizer';
import { createGrpcMetadata } from '../../../common/grpc/grpc-security.util';

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

  async hasActiveToken(agentId: string): Promise<boolean> {
    const now = new Date();
    const token = await this.widgetTokenModel
      .findOne({
        agentId,
        isActive: true,
        $or: [{ expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gt: now } }],
      })
      .select('_id')
      .lean()
      .exec();
    return Boolean(token);
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
   * Calls RunSingleAgent directly (no SSE registry).
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

    this.logger.log('Integration message received', {
      sessionId,
      agentId,
      visitorId,
      messageLength: message.length,
    });

    const userMsg = await this.widgetMessageModel.create({
      sessionId,
      tokenHash,
      agentId,
      role: 'user',
      content: message,
    });

    await this.widgetSessionModel.findByIdAndUpdate(sessionId, { $inc: { messageCount: 1 } }).exec();
    await this.widgetTokenModel.findOneAndUpdate({ tokenHash }, { lastUsedAt: new Date() }).exec();

    const streamResult = await this.runSingleAgentGrpc({
      sessionId,
      agentId,
      query: message,
      agentDoc: agent,
      channel: 'integration',
      visitorId,
    });

    if (!streamResult.reply.trim()) {
      this.logger.warn('Integration message returned empty reply', {
        sessionId,
        agentId,
        chunkCount: streamResult.chunkCount,
        model: streamResult.usage.model,
      });
      throw new ServiceUnavailableException(
        ErrorCode.WIDGET_AI_UNAVAILABLE,
        'The agent returned no response. Check the agent model, ADK logs, and CONVERSATION_GRPC_URL.',
      );
    }

    const replyText = streamResult.reply;
    await this.widgetMessageModel.create({
      sessionId,
      tokenHash,
      agentId,
      role: 'assistant',
      content: replyText,
      components: streamResult.components,
      inputTokens: streamResult.usage.inputTokens,
      outputTokens: streamResult.usage.outputTokens,
    });
    await this.widgetSessionModel.findByIdAndUpdate(sessionId, { $inc: { messageCount: 1 } }).exec();

    this.logger.log('Integration message completed', {
      sessionId,
      agentId,
      replyLength: replyText.length,
      inputTokens: streamResult.usage.inputTokens,
      outputTokens: streamResult.usage.outputTokens,
    });

    return {
      sessionId,
      messageId: userMsg.id,
      reply: replyText,
      usage: streamResult.usage,
    };
  }

  private async executeStream(sessionId: string, agentId: string, tokenHash: string, query: string, agentDoc: any): Promise<void> {
    const stream = this.sseRegistry.getActiveStream(sessionId);
    if (!stream) {
      this.logger.error('Widget executeStream aborted: no stream registry', { sessionId });
      return;
    }

    this.sseRegistry.resetStreamBuffer(sessionId);
    this.sseRegistry.emit(sessionId, { type: 'stream_start', data: { sessionId } });

    let widgetTextAggregate = '';

    try {
      const result = await this.runSingleAgentGrpc({
        sessionId,
        agentId,
        query,
        agentDoc,
        channel: 'widget',
        onChunk: (chunkEvent) => {
          const emitEvent = this.buildWidgetStreamChunkEvent(chunkEvent, widgetTextAggregate);
          if (!emitEvent) {
            return;
          }

          if (emitEvent.component.type === 'text' && emitEvent.component.data?.content) {
            widgetTextAggregate = String(emitEvent.component.data.content);
          }

          const comp = emitEvent.component;
          if (comp.id && comp.data) {
            stream.buffer.set(comp.id, {
              id: comp.id,
              type: (comp.type as ComponentType) || 'text',
              data: comp.data,
            });
          } else if (comp.id && emitEvent.action === 'delete') {
            stream.buffer.delete(comp.id);
          }

          this.sseRegistry.emit(sessionId, { type: 'stream_chunk', data: emitEvent });
        },
        onUsage: (usage) => {
          stream.usage.inputTokens = usage.inputTokens;
          stream.usage.outputTokens = usage.outputTokens;
          if (usage.model) stream.usage.model = usage.model;
        },
      });

      const sanitizedReply = sanitizeWidgetTextContent(result.reply || '');

      await this.widgetMessageModel.create({
        sessionId,
        tokenHash,
        agentId,
        role: 'assistant',
        content: sanitizedReply || 'No response generated.',
        components: result.components,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      });
      await this.widgetSessionModel.findByIdAndUpdate(sessionId, { $inc: { messageCount: 1 } }).exec();

      this.sseRegistry.emit(sessionId, {
        type: 'stream_complete',
        data: { reply: sanitizedReply, usage: result.usage },
      });

      if (!result.reply.trim()) {
        this.sseRegistry.emit(sessionId, {
          type: 'stream_error',
          data: {
            message:
              'The agent returned no text. Check the agent model, ADK logs, and that CONVERSATION_GRPC_URL points to a running ADK server.',
          },
        });
      }
    } catch (error) {
      this.logger.error('Widget stream failed', { sessionId, error: (error as Error).message });
      this.sseRegistry.emit(sessionId, { type: 'stream_error', data: { message: (error as Error).message || 'AI stream error' } });
      this.sseRegistry.cleanup(sessionId);
      throw error;
    }
  }

  /** Shared RunSingleAgent gRPC call for widget SSE and REST integration. */
  private async runSingleAgentGrpc(params: {
    sessionId: string;
    agentId: string;
    query: string;
    agentDoc: any;
    channel: 'widget' | 'integration';
    visitorId?: string;
    onChunk?: (event: {
      action: string;
      component: { id: string; type?: string; data?: Record<string, unknown> };
    }) => void;
    onUsage?: (usage: { inputTokens: number; outputTokens: number; model?: string }) => void;
  }): Promise<{
    reply: string;
    usage: { inputTokens: number; outputTokens: number; model?: string };
    components: MessageComponent[];
    chunkCount: number;
  }> {
    const { sessionId, agentId, query, agentDoc, channel, visitorId, onChunk, onUsage } = params;
    const grpcUrl = this.configService.get<string>('conversation.grpcUrl', 'localhost:50051');
    const grpcReady = await this.streamService.waitForGrpcReady(5000);
    const chatbotClient = this.streamService.getChatbotClient();

    if (!grpcReady || !chatbotClient) {
      throw new Error(`AI service unavailable. Start the ADK gRPC server (${grpcUrl}).`);
    }

    const ownerUserId = this.resolveAgentOwnerUserId(agentDoc);
    if (!ownerUserId) {
      throw new Error('Agent configuration is invalid for widget chat.');
    }

    const fallbackModelId = await this.resolveFallbackModelId();
    const grpcAgent = await this.resolveWidgetGrpcAgent(ownerUserId, agentId, fallbackModelId, sessionId);
    if (!grpcAgent) {
      throw new Error('Agent configuration is invalid or inactive for widget chat.');
    }

    await this.streamService.resolveAgentsBrainContext([grpcAgent]);

    const defaultWorkspaceName = channel === 'integration' ? 'integration' : 'widget';
    const workspaceContext = grpcAgent.brain_context?.length
      ? grpcAgent.brain_context
      : [{ workspace_id: sessionId, workspace_name: defaultWorkspaceName, workspace_documents: [] }];

    const username = channel === 'integration' ? (visitorId || 'IntegrationClient') : 'WidgetVisitor';
    const grpcRequest = {
      user_context: { user_id: ownerUserId, username },
      conversation_id: sessionId,
      query,
      agent: grpcAgent,
      workspace_context: workspaceContext,
      attached_files: [],
      previous_attached_files: [],
    };

    this.logger.log('RunSingleAgent gRPC request prepared', {
      sessionId,
      channel,
      agentId,
      agentName: grpcAgent.name,
      model: grpcAgent.chatbot?.model,
      ownerUserId,
      workspaceCount: workspaceContext.length,
      toolCount: grpcAgent.tools?.length ?? 0,
    });

    const timeoutMs = this.configService.get<number>('conversation.grpcTimeoutMs', 120000);
    const componentBuffer = new Map<string, MessageComponent>();

    return new Promise((resolve, reject) => {
      const metadata = createGrpcMetadata(this.configService);
      metadata.set('user', username);
      const call = chatbotClient.RunSingleAgent(grpcRequest, metadata);

      let totalInput = 0;
      let totalOutput = 0;
      let model: string | undefined;
      let chunkCount = 0;
      let timeoutHandle: NodeJS.Timeout | null = null;

      const resetIdle = () => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        timeoutHandle = setTimeout(() => {
          call.cancel();
          reject(new Error(`${channel} stream idle timeout`));
        }, timeoutMs);
      };
      resetIdle();

      call.on('data', (chunk: any) => {
        resetIdle();
        chunkCount++;
        const action = chunk.action;
        const comp = chunk.component;

        if (comp?.id && (action === 'add' || action === 'update' || action === 'delete')) {
          if (action === 'delete') {
            componentBuffer.delete(comp.id);
            onChunk?.({ action, component: { id: comp.id } });
          } else {
            const { type, data } = this.extractComponent(comp);
            this.mergeComponentBuffer(componentBuffer, comp.id, action, type, data);
            const normalized = normalizeWidgetComponent(type, data);
            onChunk?.({
              action,
              component: { id: comp.id, type: normalized.type, data: normalized.data },
            });
          }
        } else if (!chunk.usage) {
          this.logger.warn('RunSingleAgent chunk ignored', {
            sessionId,
            channel,
            action,
            hasComponent: Boolean(comp),
            componentId: comp?.id,
          });
        }

        if (chunk.usage) {
          totalInput += chunk.usage.input_tokens || 0;
          totalOutput += chunk.usage.output_tokens || 0;
          if (chunk.usage.model) model = chunk.usage.model;
          onUsage?.({ inputTokens: totalInput, outputTokens: totalOutput, model });
        }
      });

      call.on('end', () => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        const allComponents = Array.from(componentBuffer.values());
        const reply = this.aggregateReplyText(allComponents) || this.extractErrorReply(allComponents);
        const usage = { inputTokens: totalInput, outputTokens: totalOutput, model };

        this.logger.log('RunSingleAgent stream completed', {
          sessionId,
          channel,
          chunkCount,
          replyLength: reply.length,
          inputTokens: totalInput,
          outputTokens: totalOutput,
          model: grpcAgent.chatbot?.model,
          ownerUserId,
        });

        resolve({ reply, usage, components: allComponents, chunkCount });
      });

      call.on('error', (error: Error) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        this.logger.error('RunSingleAgent stream error', { sessionId, channel, error: error.message, chunkCount });
        reject(error);
      });
    });
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

  /**
   * Filters orchestration noise and consolidates incremental text chunks for the widget SSE stream.
   */
  private buildWidgetStreamChunkEvent(
    chunkEvent: {
      action: string;
      component: { id: string; type?: string; data?: Record<string, unknown> };
    },
    widgetTextAggregate: string,
  ): {
    action: string;
    component: { id: string; type: string; data?: Record<string, unknown> };
  } | null {
    const comp = chunkEvent.component;
    if (!comp?.id) {
      return null;
    }

    if (chunkEvent.action === 'delete') {
      return chunkEvent as { action: string; component: { id: string; type: string; data?: Record<string, unknown> } };
    }

    if (!comp.data) {
      return null;
    }

    const componentType = (comp.type || 'text') as WidgetStreamComponentType;
    if (!shouldEmitWidgetComponent(componentType, comp.data)) {
      return null;
    }

    if (componentType === 'text') {
      const part = String(comp.data.content || '');
      if (!part) {
        return null;
      }

      const nextContent = sanitizeWidgetTextContent(widgetTextAggregate + part);

      return {
        action: 'update',
        component: {
          id: WIDGET_PRIMARY_TEXT_ID,
          type: 'text',
          data: { content: nextContent },
        },
      };
    }

    if (componentType === 'sources') {
      return {
        action: chunkEvent.action === 'add' ? 'add' : 'update',
        component: {
          id: comp.id,
          type: 'sources',
          data: { ...normalizeWidgetSourcesData(comp.data) },
        },
      };
    }

    return chunkEvent as { action: string; component: { id: string; type: string; data?: Record<string, unknown> } };
  }

  /** Resolves the widget's single agent for RunSingleAgent (no manager/delegation). */
  private async resolveWidgetGrpcAgent(
    ownerUserId: string,
    widgetAgentId: string,
    fallbackModelId: string | undefined,
    sessionId: string,
  ): Promise<IGrpcAgent | null> {
    const agents = await this.agentService.buildGrpcAgentsForPlaybook(
      ownerUserId,
      [widgetAgentId],
      fallbackModelId,
      sessionId,
    );
    return agents.find((a) => a.id === widgetAgentId) ?? agents[0] ?? null;
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
