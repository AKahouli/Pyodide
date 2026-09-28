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
   * Returns null on any failure — the caller should fall back to keeping the
   * existing (likely empty) title. Resolves the model in this order:
   * caller-supplied → admin default.
   */
  async generate(query: string, preferredModelId?: string): Promise<string | null> {
    try {
      const modelId = await this.resolveModelId(preferredModelId);
      if (!modelId) {
        this.logger.warn('No model available for name generation');
        return null;
      }
      const raw = await this.chatCompletion.completeText(query, {
        modelId,
        systemPrompt: TITLE_SYSTEM_PROMPT,
        temperature: 0.3,
      });
      const cleaned = this.sanitize(raw);
      return cleaned.length > 0 ? cleaned : null;
    } catch (err) {
      this.logger.warn(`Name generation failed: ${(err as Error).message}`);
      return null;
    }
  }

  private async resolveModelId(preferredModelId?: string): Promise<string | null> {
    if (preferredModelId) {
      const m = await this.modelsService.findById(preferredModelId).catch(() => null);
      if (m?.id) return m.id;
    }
    const def = await this.modelsService.getDefaultModel().catch(() => null);
    return def?.id ?? null;
  }

  private sanitize(raw: string): string {
    // Strip surrounding quotes/whitespace and clamp length to keep DB tidy.
    const trimmed = raw.trim().replace(/^['"`]+|['"`]+$/g, '').trim();
    const oneLine = trimmed.split(/\r?\n/)[0].trim();
    return oneLine.length > 120 ? oneLine.slice(0, 120).trim() : oneLine;
  }
}
