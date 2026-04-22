import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import { LoggerService } from '../../logger';
import { ModelsService } from '../../models/models.service';
import { AgentService } from '../../agent/agent.service';
import { AgentTypeService } from '../../agent-type/agent-type.service';
import type { IAgentResponse } from '../../agent/interfaces/agent.interface';

/** Same LiteLLM/OpenAI identifier shape as playbooks and other backend callers. */
const resolveAdkModelName = (defaultModel: Awaited<ReturnType<ModelsService['getDefaultModel']>>) =>
  defaultModel?.litellmModel?.trim() || defaultModel?.id?.trim() || '';

export interface ComposerSuggestionsAdkResult {
  content: string;
}

@Injectable()
export class ComposerSuggestionsService {
  /** Reuse ADK token briefly; ADK access tokens are ~30m — refresh before expiry to avoid /token on every keystroke. */
  private adkTokenCache: { token: string; expiresAtMs: number } | null = null;
  private static readonly ADK_TOKEN_CACHE_MS = 25 * 60 * 1000;

  /** Cache agent prompts to avoid DB queries on every keystroke. */
  private agentPromptCache: { agentId: string; prompt: string; expiresAt: number } | null = null;
  private static readonly AGENT_PROMPT_CACHE_MS = 5 * 60 * 1000; // 5 minutes

  constructor(
    private readonly configService: ConfigService,
    private readonly modelsService: ModelsService,
    private readonly logger: LoggerService,
    private readonly agentService: AgentService,
    private readonly agentTypeService: AgentTypeService,
  ) {
    this.logger.setContext(ComposerSuggestionsService.name);
  }

  /**
   * ADK validates JWTs issued by POST /token (Redis users), not YellowStorm user JWTs.
   * Use the same service credentials as document indexing (INDEXING_API_USERNAME/PASSWORD).
   */
  private async getAdkAccessToken(adkBaseUrl: string): Promise<string> {
    const now = Date.now();
    if (
      this.adkTokenCache &&
      this.adkTokenCache.expiresAtMs > now + 30_000
    ) {
      return this.adkTokenCache.token;
    }

    const username = this.configService.get<string>('indexing.username') || '';
    const password = this.configService.get<string>('indexing.password') || '';
    if (!username.trim() || !password.trim()) {
      this.logger.error('ADK /token credentials missing (indexing.username/password)');
      throw new BadGatewayException(
        'ADK credentials not configured. Set INDEXING_API_USERNAME and INDEXING_API_PASSWORD (ADK /token user, same as indexing).',
      );
    }

    const params = new URLSearchParams();
    params.append('username', username);
    params.append('password', password);

    try {
      const response = await axios.post<{ access_token?: string }>(`${adkBaseUrl}/token`, params, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15000,
      });
      const token = response.data?.access_token;
      if (!token?.trim()) {
        this.logger.error('ADK /token returned no access_token');
        throw new BadGatewayException('ADK authentication response invalid');
      }
      const trimmed = token.trim();
      this.adkTokenCache = {
        token: trimmed,
        expiresAtMs: now + ComposerSuggestionsService.ADK_TOKEN_CACHE_MS,
      };
      return trimmed;
    } catch (err) {
      this.adkTokenCache = null;
      if (axios.isAxiosError(err)) {
        const ax = err as AxiosError<{ detail?: string }>;
        this.logger.error('ADK /token failed', {
          status: ax.response?.status,
          message: ax.response?.data?.detail || ax.message,
        });
        throw new BadGatewayException('Could not authenticate with ADK (check INDEXING_API_* credentials)');
      }
      throw err;
    }
  }

  /**
   * Get the agent to use for composer suggestions.
   * Priority: 1) specific agentId, 2) agent named "Suggestions", 3) composer-suggestions default agent, 4) any default agent
   */
  private async getAgentForComposer(agentId?: string): Promise<IAgentResponse> {
    // If agentId provided, fetch specific agent
    if (agentId) {
      this.logger.warn('Using provided agentId for composer suggestions', { agentId });
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
  private async resolveModel(agent: IAgentResponse): Promise<string> {
    // Use agent's model if configured
    if (agent.model) {
      this.logger.debug('Using agent-configured model for composer suggestions', {
        agentId: agent.id,
        agentName: agent.name,
        agentModel: agent.model,
      });
      return agent.model;
    }

    // Fallback to default model
    const defaultModel = await this.modelsService.getDefaultModel();
    const modelName = resolveAdkModelName(defaultModel);
    this.logger.debug('Using default model for composer suggestions (agent has no model override)', {
      agentId: agent.id,
      agentName: agent.name,
      defaultModel: modelName,
    });
    return modelName;
  }

  async fetchSuggestions(partialText: string, agentId?: string): Promise<ComposerSuggestionsAdkResult> {
    this.logger.warn('fetchSuggestions called', {
      partialTextLength: partialText.length,
      partialTextPreview: partialText.substring(0, 50),
      agentId,
      hasAgentId: !!agentId,
    });

    const adkUrl = (this.configService.get<string>('indexing.apiAdk') || 'http://localhost:8001').replace(
      /\/$/,
      '',
    );

    // Get agent and build prompt
    const agent = await this.getAgentForComposer(agentId);
    const agentPrompt = await this.buildAgentPrompt(agent);
    const model = await this.resolveModel(agent);

    if (!model) {
      throw new BadGatewayException('Composer suggestions model is not configured');
    }

    const bearer = `Bearer ${await this.getAdkAccessToken(adkUrl)}`;

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
        { message, model, temperature: 0.4, max_tokens: 768 },
        {
          headers: { 'Content-Type': 'application/json', Authorization: bearer },
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
      if (ax.response?.status === 401) {
        this.adkTokenCache = null;
      }

      const status = ax.response?.status;
      if (status) {
        const suffix =
          status === 401
            ? ' (ADK rejected the token; ensure INDEXING_API_USERNAME/PASSWORD match an ADK Redis user)'
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
