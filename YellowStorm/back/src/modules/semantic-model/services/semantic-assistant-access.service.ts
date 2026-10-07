import { Injectable, Logger } from '@nestjs/common';
import { SemanticModelDatabaseService } from '../infrastructure/semantic-model-database.service';

export interface AssistantAccessSettings {
  /** The person an agent acts for needs the semantic_models permissions (the default). */
  enforcePermissions: boolean;
}

export const DEFAULT_ASSISTANT_ACCESS: AssistantAccessSettings = { enforcePermissions: true };

/** How long a read value is kept: a change reaches every call within this time. */
const CACHE_MS = 5_000;

/**
 * Who may use the semantic model tools of an agent, as an admin sets it (Admin > Semantic models).
 * Stored next to the other settings (semantic_model.extraction_settings.assistant_settings). Anything
 * unreadable counts as the default, so a failure never lowers the protection.
 */
@Injectable()
export class SemanticAssistantAccessService {
  private readonly logger = new Logger(SemanticAssistantAccessService.name);
  private cached: { at: number; value: AssistantAccessSettings } | null = null;

  constructor(private readonly database: SemanticModelDatabaseService) {}

  async get(): Promise<AssistantAccessSettings> {
    if (this.cached && Date.now() - this.cached.at < CACHE_MS) return this.cached.value;
    const stored = await this.database.query<{ value: unknown }>(
      `SELECT assistant_settings AS "value" FROM semantic_model.extraction_settings WHERE singleton`,
    ).then((result) => result.rows[0]?.value).catch(() => undefined);
    const value = { enforcePermissions: (stored as Partial<AssistantAccessSettings> | undefined)?.enforcePermissions !== false };
    this.cached = { at: Date.now(), value };
    return value;
  }

  async update(userId: string, input: Partial<AssistantAccessSettings>): Promise<AssistantAccessSettings> {
    const value: AssistantAccessSettings = { enforcePermissions: input.enforcePermissions !== false };
    await this.database.query(
      `INSERT INTO semantic_model.extraction_settings (singleton, assistant_settings, updated_by, updated_at)
       VALUES (true, $1::jsonb, $2, now())
       ON CONFLICT (singleton) DO UPDATE SET assistant_settings = EXCLUDED.assistant_settings,
         updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [JSON.stringify(value), userId],
    );
    this.cached = { at: Date.now(), value };
    this.logger.warn(`Semantic assistant permission checks ${value.enforcePermissions ? 'enabled' : 'DISABLED'} by ${userId}`);
    return value;
  }
}
