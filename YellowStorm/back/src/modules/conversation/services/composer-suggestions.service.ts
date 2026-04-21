import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import { LoggerService } from '../../logger';
import { ModelsService } from '../../models/models.service';

const COMPOSER_SUGGESTIONS_PROMPT_PREFIX = `Tu es un assistant intelligent spécialisé dans l'amélioration de texte.
Ton objectif est d'analyser le message écrit par l'utilisateur et de proposer des améliorations pertinentes.

Pour chaque message utilisateur, tu dois :
- Corriger les fautes (orthographe, grammaire, conjugaison).
- Améliorer la clarté et la fluidité sans changer le sens.
- Proposer plusieurs suggestions reformulées (au moins 3), très proches du message original.
- Garder le même ton et intention que l'utilisateur (informel, professionnel, etc.).
- Si le message est en mélange de langues (ex: arabe dialecte + français), proposer une version corrigée naturelle.

Ne pas trop transformer le message. Rester fidèle à l'idée originale. Proposer des phrases naturelles et utilisées dans la vraie vie.

Réponds UNIQUEMENT avec le format suivant (respecte les libellés et les sauts de ligne) :
- Aucun texte avant la ligne commençant par ✅.
- La version corrigée peut tenir sur une ou plusieurs lignes, puis une ligne vide.
- Après ✨, écris exactement 3 lignes : une phrase complète par ligne (pas de numérotation du type "Suggestion 1", pas de tiret).

✅ Version corrigée
[ta version corrigée ici]

✨ Suggestions similaires :
[phrase 1]
[phrase 2]
[phrase 3]

Message de l'utilisateur :
`;

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

  constructor(
    private readonly configService: ConfigService,
    private readonly modelsService: ModelsService,
    private readonly logger: LoggerService,
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

  async fetchSuggestions(partialText: string): Promise<ComposerSuggestionsAdkResult> {
    const adkUrl = (this.configService.get<string>('indexing.apiAdk') || 'http://localhost:8001').replace(
      /\/$/,
      '',
    );
    const model = resolveAdkModelName(await this.modelsService.getDefaultModel());
    if (!model) {
      throw new BadGatewayException('Composer suggestions model is not configured');
    }

    const bearer = `Bearer ${await this.getAdkAccessToken(adkUrl)}`;
    const message = `${COMPOSER_SUGGESTIONS_PROMPT_PREFIX}${partialText}`;

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
