import { Injectable } from '@nestjs/common';
import { SemanticModelDatabaseService } from '../infrastructure/semantic-model-database.service';
import {
  DEFAULT_AI_EXTRACTION_SETTINGS, DEFAULT_RUN_LIMITS, MAPPING_READ_LIMIT_KEYS, RUN_LIMIT_RANGES,
  type AiExtractionSettings, type RunLimits,
} from '../domain/semantic-source-mapping.types';

// parallelCalls has no built-in value here: left out, the runtime uses its own (and no mapping changes fingerprint).
const KEYS = [...Object.keys(DEFAULT_AI_EXTRACTION_SETTINGS), 'parallelCalls', ...MAPPING_READ_LIMIT_KEYS] as Array<Exclude<keyof AiExtractionSettings, 'manyRecords'>>;

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
  const { manyRecords: _ignored, ...shared } = withoutReadLimits(pickAiSettings(defaults));
  return { ...DEFAULT_AI_EXTRACTION_SETTINGS, ...shared, ...withoutReadLimits(pickAiSettings(override)) };
}

/** A mapping's reading limits travel on their own, so changing them never changes how the AI reads. */
function withoutReadLimits(settings: Partial<AiExtractionSettings>): Partial<AiExtractionSettings> {
  const { maxRecords: _records, maxFiles: _files, ...rest } = settings;
  return rest;
}

/** The mapping's own record limit, never above the admin's records per source; absent when it sets none. */
export function mappingRecordCap(settings: unknown, maxRecordsPerSource: number): number | undefined {
  const own = pickAiSettings(settings).maxRecords;
  return own === undefined ? undefined : Math.min(own, maxRecordsPerSource);
}

/** How many of a workspace mapping's files a run reads: its own choice, never above the admin's. */
export function mappingFileCap(settings: unknown, maxRunSources: number): number {
  return Math.min(pickAiSettings(settings).maxFiles ?? maxRunSources, maxRunSources);
}

/**
 * How much of a document the AI reads, as an admin set it for every model. A document mapping can
 * override any of these limits; the runtime enforces the same bounds.
 */
@Injectable()
export class SemanticExtractionSettingsService {
  constructor(private readonly database: SemanticModelDatabaseService) { }

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

  /** What a mapping starts from: the admin's AI limits, and the most records and files a mapping may choose. */
  async getMappingDefaults() {
    const [defaults, { runLimits }] = await Promise.all([this.getDefaults(), this.getRunLimits()]);
    return { ...defaults, sourceCeilings: { maxRecordsPerSource: runLimits.maxRecordsPerSource, maxRunSources: runLimits.maxRunSources } };
  }

  async updateDefaults(userId: string, input: Partial<AiExtractionSettings>) {
    const aiSettings = withoutReadLimits(pickAiSettings(input));
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
