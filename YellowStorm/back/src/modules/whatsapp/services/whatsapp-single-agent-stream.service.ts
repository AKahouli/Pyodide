import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, isAxiosError } from 'axios';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { AgentService } from '@modules/agent/agent.service';
import { MessageComponent } from '@modules/conversation/interfaces/message.interface';
import { MessageService } from '@modules/conversation/services/message.service';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { ServiceUnavailableException } from '@modules/exceptions';
import { LoggerService } from '@modules/logger';
import { ModelsService } from '@modules/models/models.service';
import { WhatsAppMetricsService } from './whatsapp-metrics.service';
import { mapGrpcAgentToAdkSingleAgent } from '../utils/whatsapp-adk-agent.mapper';
import { extractTextFromAdkSseEvent } from '../utils/whatsapp-reply-text.util';
import {
  applyAdkSseEventToBuffer,
  ensureTextComponentFromAccumulated,
} from '../utils/whatsapp-stream-buffer.util';

export interface WhatsAppSingleAgentStreamParams {
  userId: string;
  conversationId: string;
  messageId: string;
  linkedAgentId: string;
  integrationId: string;
  remoteJid: string;
  query: string;
  requestId?: string;
}

@Injectable()
export class WhatsAppSingleAgentStreamService {
  private adkTokenCache: { token: string; expiresAtMs: number } | null = null;
  private pendingTokenFetch: Promise<string> | null = null;
  private static readonly ADK_TOKEN_CACHE_MS = 25 * 60 * 1000;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
    private readonly agentService: AgentService,
    private readonly modelsService: ModelsService,
    private readonly messageService: MessageService,
    private readonly metrics: WhatsAppMetricsService,
  ) {
    this.logger.setContext(WhatsAppSingleAgentStreamService.name);
  }

  /**
   * Streams a reply from ADK POST /agentic/run_single_agent (no manager orchestration).
   */
  async runSingleAgentStream(params: WhatsAppSingleAgentStreamParams): Promise<void> {
    const {
      userId,
      conversationId,
      messageId,
      linkedAgentId,
      integrationId,
      remoteJid,
      query,
      requestId,
    } = params;

    const adkUrl = this.resolveAdkUrl();
    const fallbackModelId = await this.resolveInferenceModelId();
    const grpcAgents = await this.agentService.buildGrpcAgentsForPlaybook(
      userId,
      [linkedAgentId],
      fallbackModelId,
      conversationId,
    );
    if (grpcAgents.length === 0) {
      throw new ServiceUnavailableException(
        ErrorCode.AGENT_NOT_FOUND,
        'Linked WhatsApp agent not found',
      );
    }

    const grpcAgent = grpcAgents[0];
    const litellmModel = await this.resolveLitellmModel(
      grpcAgent.chatbot.model || fallbackModelId,
      fallbackModelId,
    );
    const agent = mapGrpcAgentToAdkSingleAgent(grpcAgent, litellmModel);
    if (!agent.model) {
      throw new ServiceUnavailableException(
        ErrorCode.AI_SERVICE_ERROR,
        'WhatsApp agent has no model configured and default model resolution failed',
      );
    }
    const token = await this.getAdkAccessToken(adkUrl);
    const timeoutMs = this.configService.get<number>('whatsapp.adkStreamTimeoutMs', 120000);
    const sessionId = `whatsapp-${conversationId}-${messageId}`;

    this.logger.log('WhatsApp ADK single-agent stream starting', {
      integrationId,
      conversationId,
      messageId,
      linkedAgentId,
      remoteJid,
      sessionId,
      agentName: grpcAgent.name,
      adkAgentName: agent.name,
      agentType: agent.agent_type,
      model: agent.model,
      litellmModel: agent.chatbot_name.provider,
      toolCount: agent.tools.length,
      toolNames: agent.tools.map((tool) => tool.name),
      hasAgentParams: Boolean(agent.agent_params),
      hasConnectorBindings: Boolean(agent.agent_params?.connector_bindings_json),
      adkEndpoint: '/agentic/run_single_agent',
      managerOrchestration: false,
      requestId,
    });

    const buffer = await this.consumeAdkSseStream({
      adkUrl,
      token,
      timeoutMs,
      body: {
        user_id: userId,
        session_id: sessionId,
        message: query,
        agent,
      },
      integrationId,
      messageId,
      linkedAgentId,
      requestId,
    });

    ensureTextComponentFromAccumulated(buffer.components, buffer.accumulatedText);

    if (buffer.eventCount > 0 && buffer.components.size === 0) {
      this.logger.warn('WhatsApp ADK stream ended with events but no reply components', {
        integrationId,
        messageId,
        linkedAgentId,
        eventCount: buffer.eventCount,
        accumulatedTextLength: buffer.accumulatedText.length,
        lastEvents: buffer.lastEvents,
        requestId,
      });
    }

    await this.messageService.completeAIMessage({
      messageId,
      components: Array.from(buffer.components.values()),
      durationMs: buffer.durationMs,
    });

    this.logger.log('WhatsApp ADK single-agent stream completed', {
      integrationId,
      conversationId,
      messageId,
      linkedAgentId,
      eventCount: buffer.eventCount,
      componentCount: buffer.components.size,
      accumulatedTextLength: buffer.accumulatedText.length,
      durationMs: buffer.durationMs,
      managerOrchestration: false,
      requestId,
    });

    this.metrics.recordHistogram('adk.stream.duration_ms', buffer.durationMs);
  }

  private async resolveLitellmModel(
    modelId: string,
    fallbackModelId: string,
  ): Promise<string> {
    let modelRecord = modelId ? await this.modelsService.findById(modelId) : null;
    if (!modelRecord && fallbackModelId && fallbackModelId !== modelId) {
      modelRecord = await this.modelsService.findById(fallbackModelId);
    }

    const identifier = this.modelsService.getModelIdentifier(modelRecord);
    if (identifier) {
      return identifier;
    }
    return modelId.trim() || fallbackModelId;
  }

  private async resolveInferenceModelId(): Promise<string> {
    const defaultModel = await this.modelsService.getDefaultModel();
    const identifier = this.modelsService.getModelIdentifier(defaultModel);
    if (!identifier) {
      throw new ServiceUnavailableException(
        ErrorCode.AI_SERVICE_ERROR,
        'No default model configured. Assign a model to the agent or set a system default model.',
      );
    }
    return identifier;
  }

  private resolveAdkUrl(): string {
    const adkUrl = this.configService.get<string>('whatsapp.adkUrl', '').trim();
    if (!adkUrl) {
      throw new ServiceUnavailableException(
        ErrorCode.CHAT_GRPC_UNAVAILABLE,
        'API_ADK_URL is not configured for WhatsApp single-agent streaming',
      );
    }
    return adkUrl.replace(/\/$/, '');
  }

  private async getAdkAccessToken(adkBaseUrl: string): Promise<string> {
    const now = Date.now();
    if (this.adkTokenCache && this.adkTokenCache.expiresAtMs > now + 30_000) {
      return this.adkTokenCache.token;
    }

    if (this.pendingTokenFetch) {
      return this.pendingTokenFetch;
    }

    this.pendingTokenFetch = this.fetchAdkToken(adkBaseUrl);
    try {
      return await this.pendingTokenFetch;
    } finally {
      this.pendingTokenFetch = null;
    }
  }

  private async fetchAdkToken(adkBaseUrl: string): Promise<string> {
    const username = this.configService.get<string>('whatsapp.adkUsername', '').trim();
    const password = this.configService.get<string>('whatsapp.adkPassword', '').trim();
    if (!username || !password) {
      throw new ServiceUnavailableException(
        ErrorCode.CHAT_GRPC_UNAVAILABLE,
        'ADK credentials missing (INDEXING_API_USERNAME / INDEXING_API_PASSWORD)',
      );
    }

    const params = new URLSearchParams();
    params.append('username', username);
    params.append('password', password);

    const response = await axios.post<{ access_token?: string }>(`${adkBaseUrl}/token`, params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15_000,
    });

    const token = response.data?.access_token?.trim();
    if (!token) {
      throw new ServiceUnavailableException(
        ErrorCode.CHAT_GRPC_UNAVAILABLE,
        'ADK /token returned no access_token',
      );
    }

    this.adkTokenCache = {
      token,
      expiresAtMs: Date.now() + WhatsAppSingleAgentStreamService.ADK_TOKEN_CACHE_MS,
    };
    return token;
  }

  private async consumeAdkSseStream(params: {
    adkUrl: string;
    token: string;
    timeoutMs: number;
    body: Record<string, unknown>;
    integrationId: string;
    messageId: string;
    linkedAgentId: string;
    requestId?: string;
  }): Promise<{
    components: Map<string, MessageComponent>;
    eventCount: number;
    durationMs: number;
    accumulatedText: string;
    lastEvents: Record<string, unknown>[];
  }> {
    const {
      adkUrl,
      token,
      timeoutMs,
      body,
      integrationId,
      messageId,
      linkedAgentId,
      requestId,
    } = params;

    const components = new Map<string, MessageComponent>();
    const startTime = Date.now();
    let eventCount = 0;
    let accumulatedText = '';
    const lastEvents: Record<string, unknown>[] = [];

    try {
      const response = await axios.post(`${adkUrl}/agentic/run_single_agent`, body, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        responseType: 'stream',
        timeout: timeoutMs,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });

      const stream = response.data as Readable;
      const rl = createInterface({ input: stream, crlfDelay: Infinity });

      for await (const line of rl) {
        if (!line.startsWith('data: ')) {
          continue;
        }
        const payloadRaw = line.slice(6).trim();
        if (!payloadRaw) {
          continue;
        }

        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(payloadRaw) as Record<string, unknown>;
        } catch (parseError) {
          this.logger.warn('WhatsApp ADK SSE JSON parse failed', {
            integrationId,
            messageId,
            linkedAgentId,
            payloadPreview: payloadRaw.slice(0, 200),
            error: (parseError as Error).message,
            requestId,
          });
          continue;
        }

        eventCount++;
        accumulatedText += extractTextFromAdkSseEvent(payload);
        applyAdkSseEventToBuffer(components, payload);

        lastEvents.push({
          action: payload.action,
          contentType: payload.content_type,
          componentType: (payload.component as { type?: string } | undefined)?.type,
        });
        if (lastEvents.length > 5) {
          lastEvents.shift();
        }

        if (eventCount === 1 || eventCount % 25 === 0) {
          this.logger.debug('WhatsApp ADK SSE event received', {
            integrationId,
            messageId,
            linkedAgentId,
            eventCount,
            action: payload.action,
            contentType: payload.content_type,
            bufferSize: components.size,
            accumulatedTextLength: accumulatedText.length,
            requestId,
          });
        }
      }
    } catch (error) {
      await this.handleStreamFailure(messageId, error, {
        integrationId,
        linkedAgentId,
        requestId,
      });
      throw error;
    }

    return {
      components,
      eventCount,
      durationMs: Date.now() - startTime,
      accumulatedText,
      lastEvents,
    };
  }

  private async handleStreamFailure(
    messageId: string,
    error: unknown,
    context: { integrationId: string; linkedAgentId: string; requestId?: string },
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const status = isAxiosError(error) ? (error as AxiosError).response?.status : undefined;

    this.logger.error('WhatsApp ADK single-agent stream failed', {
      ...context,
      status,
      error: message,
      adkEndpoint: '/agentic/run_single_agent',
    });

    this.metrics.incrementCounter('adk.stream.errors', {
      integrationId: context.integrationId,
      statusCode: status?.toString() ?? 'unknown',
    });

    try {
      await this.messageService.markStreamFailed(messageId);
    } catch (markError) {
      this.logger.error('Failed to mark WhatsApp ADK stream as failed', {
        messageId,
        error: (markError as Error).message,
      });
    }
  }
}
