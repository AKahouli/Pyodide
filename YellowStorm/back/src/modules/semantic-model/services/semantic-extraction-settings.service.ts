import { Injectable } from '@nestjs/common';
import { SemanticModelDatabaseService } from '../infrastructure/semantic-model-database.service';
import { DEFAULT_AI_EXTRACTION_SETTINGS, type AiExtractionSettings } from '../domain/semantic-source-mapping.types';

const KEYS = Object.keys(DEFAULT_AI_EXTRACTION_SETTINGS) as Array<keyof AiExtractionSettings>;

/** Only the limits that were set, as whole numbers; anything else is dropped. */
export function pickAiSettings(input: unknown): Partial<AiExtractionSettings> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const picked: Partial<AiExtractionSettings> = {};
  for (const key of KEYS) {
    const value = (input as Record<string, unknown>)[key];
    if (typeof value === 'number' && Number.isInteger(value)) picked[key] = value;
  }
  return picked;
}

/** The limits a document is read with: the mapping's own, else the admin's, else the built-in ones. */
export function effectiveAiSettings(defaults: Partial<AiExtractionSettings>, override?: unknown): AiExtractionSettings {
  return { ...DEFAULT_AI_EXTRACTION_SETTINGS, ...pickAiSettings(defaults), ...pickAiSettings(override) };
}

/**
 * How much of a document the AI reads, as an admin set it for every model. A document mapping can
 * override any of these limits; the runtime enforces the same bounds.
 */
@Injectable()
export class SemanticExtractionSettingsService {
  constructor(private readonly database: SemanticModelDatabaseService) {}

  /** The admin's defaults with every limit filled in, and which ones the admin set. */
  async getDefaults(): Promise<{ aiSettings: AiExtractionSettings; configured: Partial<AiExtractionSettings> }> {
    const configured = await this.database.query<{ aiSettings: unknown }>(
      'SELECT ai_settings AS "aiSettings" FROM semantic_model.extraction_settings WHERE singleton',
    ).then((result) => pickAiSettings(result.rows[0]?.aiSettings))
      .catch(() => ({}));
    return { aiSettings: effectiveAiSettings(configured), configured };
  }

  async updateDefaults(userId: string, input: Partial<AiExtractionSettings>) {
    const aiSettings = pickAiSettings(input);
    await this.database.query(
      `INSERT INTO semantic_model.extraction_settings (singleton, ai_settings, updated_by, updated_at)
       VALUES (true, $1::jsonb, $2, now())
       ON CONFLICT (singleton) DO UPDATE SET ai_settings = EXCLUDED.ai_settings,
         updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [JSON.stringify(aiSettings), userId],
    );
    return this.getDefaults();
  }
}
