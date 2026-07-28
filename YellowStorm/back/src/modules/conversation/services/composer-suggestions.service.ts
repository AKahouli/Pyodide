import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import { LoggerService } from '../../logger';
import { ModelsService } from '../../models/models.service';
import { AgentService } from '../../agent/agent.service';
import { AgentTypeService } from '../../agent-type/agent-type.service';
import type { IAgentResponse } from '../../agent/interfaces/agent.interface';
import { ConversationSettingsService } from '../../system/conversation-settings.service';
import { BadRequestException, ErrorCode, ForbiddenException } from '../../exceptions';

/** Same LiteLLM/OpenAI identifier shape as playbooks and other backend callers. */
const resolveAdkModelName = (defaultModel: Awaited<ReturnType<ModelsService['getDefaultModel']>>) =>
  defaultModel?.litellmModel?.trim() || defaultModel?.id?.trim() || '';

export interface ComposerSuggestionsAdkResult {
  content: string;
}

@Injectable()
export class ComposerSuggestionsService {
  /** Cache agent prompts to avoid DB queries on every keystroke. */
  private agentPromptCache: { agentId: string; prompt: string; expiresAt: number } | null = null;
  private static readonly AGENT_PROMPT_CACHE_MS = 5 * 60 * 1000; // 5 minutes

  constructor(
    private readonly configService: ConfigService,
    private readonly modelsService: ModelsService,
    private readonly logger: LoggerService,
    private readonly agentService: AgentService,
    private readonly agentTypeService: AgentTypeService,
    private readonly conversationSettings: ConversationSettingsService,
  ) {
    this.logger.setContext(ComposerSuggestionsService.name);
  }

  private getAdkApiKey(): string {
    const key = (this.configService.get<string>('indexing.adkApiKey') || '').trim();
    if (!key) {
      this.logger.error('ADK_API_KEY is not configured');
      throw new BadGatewayException(
        'ADK credentials not configured. Set ADK_API_KEY to authenticate with the ADK.',
      );
    }
    return key;
  }

  /**
   * Get the agent to use for composer suggestions.
   * Priority: 1) configured agent, 2) agent named "Suggestions", 3) composer-suggestions default agent, 4) any default agent
   */
  private async getAgentForComposer(agentId: string | null): Promise<IAgentResponse> {
    if (agentId) {
      await this.agentService.assertActiveDefaultAgent(agentId);
      return this.agentService.findDefaultAgentById(agentId);
    }

    // Try to find agent named "Suggestions" (case-insensitive)
    this.logger.warn('Looking for agent named "Suggestions"');
    const suggestionsAgent = await this.agentService.findDefaultAgentByName('Suggestions');
    if (suggestionsAgent) {
      this.logger.warn('Found agent named "Suggestions"', {
        agentId: suggestionsAgent.id,
        agentName: suggestionsAgent.name,
        agentTypeName: suggestionsAgent.agentType.name,
      });
      return suggestionsAgent;
    }

    // Try to find default composer-suggestions agent (by type slug)
    this.logger.warn('Looking for default composer-suggestions agent type');
    const composerAgentType = await this.agentTypeService.findBySlug('composer-suggestions');
    if (composerAgentType) {
      const composerAgent = await this.agentService.findDefaultByAgentType(composerAgentType.id);
      if (composerAgent) {
        this.logger.warn('Found default composer-suggestions agent by type', {
          agentId: composerAgent.id,
          agentName: composerAgent.name,
          agentTypeId: composerAgentType.id,
        });
        return composerAgent;
      }
    }

    this.logger.warn('No specific agent found, using fallback to any default agent');
    // Fallback: any active default agent
    const defaultAgents = await this.agentService.findDefaultAgents({ isActive: true, limit: 1 });
    if (defaultAgents.data && defaultAgents.data.length > 0) {
      const fallbackAgent = defaultAgents.data[0];
      this.logger.warn('Using fallback agent', {
        agentId: fallbackAgent.id,
        agentName: fallbackAgent.name,
      });
      return fallbackAgent;
    }

    throw new BadGatewayException('No agent available for composer suggestions');
  }

  /**
   * Build the prompt from the agent's configuration.
   * Caches the result for 5 minutes.
   */
  private async buildAgentPrompt(agent: IAgentResponse): Promise<string> {
    // Check cache first
    if (this.agentPromptCache?.agentId === agent.id && this.agentPromptCache.expiresAt > Date.now()) {
      return this.agentPromptCache.prompt;
    }

    // Build prompt from agent type + role
    const agentType = await this.agentTypeService.findById(agent.agentType.id);
    const prompt = agent.ignorePrePrompt
      ? agent.role
      : `${agentType?.defaultPrompt || ''}\n\n${agent.role}`;

    // Cache the result
    this.agentPromptCache = {
      agentId: agent.id,
      prompt,
      expiresAt: Date.now() + ComposerSuggestionsService.AGENT_PROMPT_CACHE_MS,
    };

    return prompt;
  }

  /**
   * Resolve the model to use for suggestions.
   * Priority: 1) agent's configured model (llmModel), 2) default system model
   */
  private async resolveModel(agent: IAgentResponse): Promise<{ model: string; omitTemperature: boolean }> {
    // Use agent's model if configured
    if (agent.model) {
      this.logger.debug('Using agent-configured model for composer suggestions', {
        agentId: agent.id,
        agentName: agent.name,
        agentModel: agent.model,
      });
      const configuredModel = await this.modelsService.findById(agent.model);
      return {
        model: agent.model,
        omitTemperature: configuredModel?.omitTemperature ?? false,
      };
    }

    // Fallback to default model
    const defaultModel = await this.modelsService.getDefaultModel();
    const modelName = resolveAdkModelName(defaultModel);
    this.logger.debug('Using default model for composer suggestions (agent has no model override)', {
      agentId: agent.id,
      agentName: agent.name,
      defaultModel: modelName,
    });
    return { model: modelName, omitTemperature: defaultModel?.omitTemperature ?? false };
  }

  async fetchSuggestions(partialText: string): Promise<ComposerSuggestionsAdkResult> {
    const settings = (await this.conversationSettings.getSettings()).composerSuggestions;
    if (!settings.enabled) {
      throw new ForbiddenException(ErrorCode.CHAT_FORBIDDEN, 'Composer suggestions are disabled');
    }
    if (partialText.trim().length < settings.minimumDraftLength) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, `Draft must contain at least ${settings.minimumDraftLength} characters`);
    }

    this.logger.debug('Composer suggestions requested', { partialTextLength: partialText.length });

    const adkUrl = (this.configService.get<string>('indexing.apiAdk') || 'http://localhost:8001').replace(
      /\/$/,
      '',
    );

    // Get agent and build prompt
    const agent = await this.getAgentForComposer(settings.agentId);
    const agentPrompt = await this.buildAgentPrompt(agent);
    const resolvedModel = await this.resolveModel(agent);
    const model = resolvedModel.model;

    if (!model) {
      throw new BadGatewayException('Composer suggestions model is not configured');
    }

    const apiKey = this.getAdkApiKey();

    // Log the agent metadata being used
    this.logger.warn('Composer suggestions using agent', {
      agentId: agent.id,
      agentName: agent.name,
      agentTypeName: agent.agentType.name,
      agentTypeSlug: agent.agentType.name,
      agentModel: agent.model || 'default',
      resolvedModel: model,
      isDefault: agent.isDefault,
      ignorePrePrompt: agent.ignorePrePrompt,
      textLength: partialText.length,
      promptCached: this.agentPromptCache?.agentId === agent.id,
    });

    // this.logger.warn("Agent prompt: " + agentPrompt);
    // Build the final message using only the agent's prompt + user text
    const message = `${agentPrompt}\n\n${partialText}`;

    try {
      const { data } = await axios.post<{ status: string; content: string }>(
        `${adkUrl}/chatbots/chat_completion`,
        {
          message,
          model,
          temperature: resolvedModel.omitTemperature ? null : 0,
          max_tokens: settings.maxOutputTokens,
        },
        {
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
          timeout: 60_000,
        },
      );

      const content = data?.content;
      if (typeof content !== 'string' || !content.trim()) {
        throw new BadGatewayException('Invalid response from suggestions service');
      }
      return { content };
    } catch (err) {
      if (!axios.isAxiosError(err)) throw err;

      const ax = err as AxiosError<{ detail?: string }>;
      const status = ax.response?.status;
      if (status) {
        const suffix =
          status === 401
            ? ' (ADK rejected the API key; ensure ADK_API_KEY matches the ADK server configuration)'
            : '';
        throw new BadGatewayException(`Suggestions service error (${status})${suffix}`);
      }

      const unreachable = ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNABORTED'].includes(
        ax.code ?? '',
      );
      throw new BadGatewayException(
        unreachable
          ? `Cannot reach ADK at ${adkUrl}. Set API_ADK_URL to the running yellowstorm-adk HTTP base.`
          : 'Suggestions service unreachable',
      );
    }
  }
}
