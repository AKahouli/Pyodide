import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConversationService } from './conversation.service';
import { LoggerService } from '../../logger';
import { StreamGatewayService } from './stream-gateway.service';
import { ModelsService } from '../../models/models.service';
import { createGrpcMetadata } from '../../../common/grpc/grpc-security.util';
import { ConversationSettingsService } from '../../system/conversation-settings.service';

/**
 * Generates conversation titles asynchronously and pushes them to the user
 * over SSE. Extracted from StreamService; the chatbot gRPC client stays owned
 * by StreamService and is passed in per call.
 */
@Injectable()
export class ConversationNameService {
  constructor(
    private readonly configService: ConfigService,
    private readonly conversationService: ConversationService,
    private readonly streamGateway: StreamGatewayService,
    private readonly logger: LoggerService,
    private readonly modelsService: ModelsService,
    private readonly conversationSettings: ConversationSettingsService,
  ) {}

  /**
   * Generates a conversation name asynchronously (fire-and-forget).
   * Sends the result via SSE to the user.
   */
  generateConversationNameAsync(userId: string, conversationId: string, query: string, username: string | undefined, chatbotClient: any): void {
    // Fire and forget - don't await at call site
    this.generateConversationName(userId, conversationId, query, username, chatbotClient).catch((err) => {
      this.logger.error('Failed to generate conversation name', {
        conversationId,
        error: (err as Error).message,
      });
    });
  }

  private async generateConversationName(userId: string, conversationId: string, query: string, username: string | undefined, chatbotClient: any): Promise<void> {
    try {
      // Naming model is admin-configurable (Paramètres de conversation). Use the
      // chosen model when set; otherwise fall back to the platform default.
      // An empty model makes the gRPC name generation fail and the conversation
      // keeps its default title.
      const { conversationName } = await this.conversationSettings.getSettings();
      const chosen = conversationName.modelId ? await this.modelsService.findById(conversationName.modelId).catch(() => null) : null;

      // Chosen models are served by the LiteLLM proxy, so route via the proxy
      // alias ("litellm_proxy/<model_name>"). Their stored litellmModel is a
      // provider-prefixed target (e.g. "ollama/gemma3:4b") that would bypass the
      // proxy and fail. The platform default keeps its litellmModel (unchanged).
      const litellmModel = chosen ? `litellm_proxy/${chosen.id}` : (await this.modelsService.getDefaultModel())?.litellmModel || '';

      const response = await this.callGenerateNameGrpc(chatbotClient, query, litellmModel, username);
      const generatedName = response.conversation_name || 'New Conversation';

      // Update conversation title in database
      await this.conversationService.updateConversationInternal(conversationId, {
        title: generatedName,
      });

      // Send SSE event to user
      this.streamGateway.sendToUser(userId, {
        type: 'conversation_name_generated',
        data: {
          conversationId,
          name: generatedName,
        },
      });

      this.logger.debug('Conversation name generated', {
        conversationId,
        name: generatedName,
      });
    } catch (error) {
      // Fallback: keep existing title, log warning
      this.logger.warn('Name generation failed, keeping default title', {
        conversationId,
        error: (error as Error).message,
      });
    }
  }

  private callGenerateNameGrpc(chatbotClient: any, query: string, modelId?: string, username?: string): Promise<{ conversation_name: string }> {
    return new Promise((resolve, reject) => {
      if (!chatbotClient) {
        reject(new Error('gRPC client not initialized'));
        return;
      }

      // Create metadata with user header for LiteLLM logging + shared API key
      const metadata = createGrpcMetadata(this.configService);
      const userHeader = username || 'SYSTEM'; // Use 'SYSTEM' for non-user requests
      metadata.set('user', userHeader);

      const deadline = new Date(Date.now() + 60000); // 60s timeout
      chatbotClient.GenerateConversationName({ query, model: modelId || '' }, metadata, { deadline }, (err: Error | null, response: { conversation_name: string }) => {
        if (err) reject(err);
        else resolve(response);
      });
    });
  }
}
