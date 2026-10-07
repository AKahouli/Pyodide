import { Injectable, Logger } from '@nestjs/common';
import { ChatCompletionService } from '@modules/chat-completion';
import { ModelsService } from '@modules/models/models.service';

const TITLE_SYSTEM_PROMPT = `You generate a short, descriptive conversation title from the user's first message.

Rules:
- 3 to 7 words maximum.
- No quotes, no surrounding punctuation, no trailing period.
- Title Case (capitalize main words).
- Same language as the user's message.
- Do NOT answer the question — only output the title.

Output only the title, nothing else.`;

@Injectable()
export class ConversationV2NameGeneratorService {
  private readonly logger = new Logger(ConversationV2NameGeneratorService.name);

  constructor(
    private readonly chatCompletion: ChatCompletionService,
    private readonly modelsService: ModelsService,
  ) {}

  /**
   * Generate a short title from the first user message via LiteLLM.
   * Always returns a non-empty string when `query` has content: LLM output when
   * available, otherwise a clipped heuristic from the message. Resolves the
   * model as: preferred (modelId or litellmModel) → conversation-v2 default →
   * global default.
   */
  async generate(query: string, preferredModelId?: string): Promise<string | null> {
    const fallback = this.fallbackFromQuery(query);
    try {
      const modelId = await this.resolveModelId(preferredModelId);
      if (!modelId) {
        this.logger.warn('No model available for name generation; using message fallback');
        return fallback;
      }
      const raw = await this.chatCompletion.completeText(query, {
        modelId,
        systemPrompt: TITLE_SYSTEM_PROMPT,
        temperature: 0.3,
      });
      const cleaned = this.sanitize(raw);
      return cleaned.length > 0 ? cleaned : fallback;
    } catch (err) {
      this.logger.warn(`Name generation failed: ${(err as Error).message}`);
      return fallback;
    }
  }

  private async resolveModelId(preferredModelId?: string): Promise<string | null> {
    if (preferredModelId) {
      // Stream passes getModelIdentifier() (often litellmModel), not only modelId.
      const m = await this.modelsService
        .findByIdOrLitellmModel(preferredModelId)
        .catch(() => null);
      if (m?.id) return m.id;
    }
    const conversationV2Default = await this.modelsService
      .getConversationV2DefaultModel()
      .catch(() => null);
    if (conversationV2Default?.id) return conversationV2Default.id;
    const def = await this.modelsService.getDefaultModel().catch(() => null);
    return def?.id ?? null;
  }

  private sanitize(raw: string): string {
    // Strip surrounding quotes/whitespace and clamp length to keep DB tidy.
    const trimmed = raw.trim().replace(/^['"`]+|['"`]+$/g, '').trim();
    const oneLine = trimmed.split(/\r?\n/)[0]?.trim() ?? '';
    return oneLine.length > 120 ? oneLine.slice(0, 120).trim() : oneLine;
  }

  /** Deterministic title when the LLM is unavailable — never leave apps untitled. */
  private fallbackFromQuery(query: string): string | null {
    const oneLine = query.trim().split(/\r?\n/)[0]?.trim() ?? '';
    if (!oneLine) return null;
    const clipped = oneLine.split(/\s+/).slice(0, 7).join(' ');
    return clipped.length > 80 ? `${clipped.slice(0, 77).trim()}…` : clipped;
  }
}
