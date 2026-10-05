import { Injectable } from '@nestjs/common';
import { SemanticModelDatabaseService } from '../infrastructure/semantic-model-database.service';
import {
  DEFAULT_AI_EXTRACTION_SETTINGS, DEFAULT_RUN_LIMITS, RUN_LIMIT_RANGES,
  type AiExtractionSettings, type RunLimits,
} from '../domain/semantic-source-mapping.types';

const KEYS = Object.keys(DEFAULT_AI_EXTRACTION_SETTINGS) as Exclude<keyof AiExtractionSettings, 'manyRecords'>[];

/** Only the limits that were set, as whole numbers; anything else is dropped. */
export function pickAiSettings(input: unknown): Partial<AiExtractionSettings> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const picked: Partial<AiExtractionSettings> = {};
  for (const key of KEYS) {
    const value = (input as Record<string, unknown>)[key];
    if (typeof value === 'number' && Number.isInteger(value)) picked[key] = value;
  }
  if ((input as Record<string, unknown>).manyRecords === true) picked.manyRecords = true;
  return picked;
}

/**
 * A document mapping's options for the runtime: the AI's limits when a field is read by AI (they carry
 * "several records per document"), else only that switch, so rules alone can make several records.
 * Nothing when neither applies, so other mappings keep their options (and fingerprint).
 */
export function documentReadOptions(usesAi: boolean, defaults: Partial<AiExtractionSettings>, settings: unknown): { options?: Record<string, unknown> } {
  if (usesAi) return { options: { aiSettings: effectiveAiSettings(defaults, settings) } };
  return pickAiSettings(settings).manyRecords ? { options: { manyRecords: true } } : {};
}

/** Only the run limits that were set and are in range, as whole numbers; anything else is dropped. */
export function pickRunLimits(input: unknown): Partial<RunLimits> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const picked: Partial<RunLimits> = {};
  for (const key of Object.keys(RUN_LIMIT_RANGES) as (keyof RunLimits)[]) {
    const value = (input as Record<string, unknown>)[key];
    const [low, high] = RUN_LIMIT_RANGES[key];
    if (typeof value === 'number' && Number.isInteger(value) && value >= low && value <= high) picked[key] = value;
  }
  return picked;
}

/** The limits a document is read with: the mapping's own, else the admin's, else the built-in ones. */
export function effectiveAiSettings(defaults: Partial<AiExtractionSettings>, override?: unknown): AiExtractionSettings {
  // Several records per document is a choice of each mapping, never an admin default.
  const { manyRecords: _ignored, ...shared } = pickAiSettings(defaults);
  return { ...DEFAULT_AI_EXTRACTION_SETTINGS, ...shared, ...pickAiSettings(override) };
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

  /** The admin's run limits with every limit filled in, and which ones the admin set. */
  async getRunLimits(): Promise<{ runLimits: RunLimits; configured: Partial<RunLimits> }> {
    const configured = await this.database.query<{ runLimits: unknown }>(
      'SELECT run_limits AS "runLimits" FROM semantic_model.extraction_settings WHERE singleton',
    ).then((result) => pickRunLimits(result.rows[0]?.runLimits))
      .catch(() => ({}));
    return { runLimits: { ...DEFAULT_RUN_LIMITS, ...configured }, configured };
  }

  async updateRunLimits(userId: string, input: Partial<RunLimits>) {
    await this.database.query(
      `INSERT INTO semantic_model.extraction_settings (singleton, run_limits, updated_by, updated_at)
       VALUES (true, $1::jsonb, $2, now())
       ON CONFLICT (singleton) DO UPDATE SET run_limits = EXCLUDED.run_limits,
         updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [JSON.stringify(pickRunLimits(input)), userId],
    );
    return this.getRunLimits();
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
