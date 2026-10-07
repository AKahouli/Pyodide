import { Injectable, Logger } from '@nestjs/common';
import { BadRequestException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { SemanticModelDatabaseService } from '../infrastructure/semantic-model-database.service';
import type { SemanticGraph } from '../domain/semantic-model.types';
import {
  DEFAULT_SEARCH_INDEX_SETTINGS, DEFAULT_SEARCH_QUERY_SETTINGS, effectiveSearchIndexSettings, effectiveSearchQuerySettings,
  fieldSearchIndexProblems, pickFieldSearchIndex, pickSearchIndexSettings, pickSearchQuerySettings, searchIndexProblems,
  searchQueryProblems,
  type FieldSearchIndexSettings, type RuntimeSearchSettingsPayload, type SearchIndexSettings, type SearchQuerySettings,
} from '../domain/semantic-search-settings.types';

export interface SettingsView<T> {
  /** Every setting filled in: the admin's where set, else the built-in value. */
  settings: T;
  /** Only what the admin set. */
  configured: Partial<T>;
  defaults: T;
}

/**
 * Graph search settings for every model, as an admin set them (Admin > Semantic models). They are stored
 * next to the AI reading limits (semantic_model.extraction_settings) and sent to the runtime with each
 * search and index request; the runtime's own defaults (and its environment) apply to anything not set.
 */
@Injectable()
export class SemanticSearchSettingsService {
  private readonly logger = new Logger(SemanticSearchSettingsService.name);

  constructor(private readonly database: SemanticModelDatabaseService) {}

  async getIndexSettings(): Promise<SettingsView<SearchIndexSettings>> {
    const configured = pickSearchIndexSettings(await this.read('index_settings'));
    return { settings: effectiveSearchIndexSettings(configured), configured, defaults: DEFAULT_SEARCH_INDEX_SETTINGS };
  }

  async getQuerySettings(): Promise<SettingsView<SearchQuerySettings>> {
    const configured = pickSearchQuerySettings(await this.read('search_settings'));
    return { settings: effectiveSearchQuerySettings(configured), configured, defaults: DEFAULT_SEARCH_QUERY_SETTINGS };
  }

  /** The effective values, for people who edit a model (a field's settings are shown over them). */
  async getEffective(): Promise<{ index: SearchIndexSettings; search: SearchQuerySettings }> {
    const [index, search] = await Promise.all([this.getIndexSettings(), this.getQuerySettings()]);
    return { index: index.settings, search: search.settings };
  }

  async updateIndexSettings(userId: string, input: unknown): Promise<SettingsView<SearchIndexSettings>> {
    const problems = searchIndexProblems(stripUndefined(input));
    if (problems.length) throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, problems.join('; '));
    await this.write('index_settings', pickSearchIndexSettings(input), userId);
    return this.getIndexSettings();
  }

  async updateQuerySettings(userId: string, input: unknown): Promise<SettingsView<SearchQuerySettings>> {
    const problems = searchQueryProblems(stripUndefined(input));
    if (problems.length) throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, problems.join('; '));
    await this.write('search_settings', pickSearchQuerySettings(input), userId);
    return this.getQuerySettings();
  }

  /**
   * What a search or index request carries: the admin's values and the own settings of the fields of the
   * version whose data is searched, by concept key and field key. A field's settings that no longer fit
   * the global ones (the admin changed them since) are left out, so they never fail a search.
   */
  async runtimePayload(graph: SemanticGraph | null): Promise<RuntimeSearchSettingsPayload> {
    const [index, search] = await Promise.all([this.getIndexSettings(), this.getQuerySettings()]);
    const fields: Record<string, Record<string, FieldSearchIndexSettings>> = {};
    for (const node of graph?.nodes ?? []) {
      for (const attribute of node.attributes ?? []) {
        const own = pickFieldSearchIndex((attribute as { searchIndex?: unknown }).searchIndex);
        if (!own) continue;
        if (fieldSearchIndexProblems(own, index.settings).length) {
          this.logger.warn(`Search settings of ${node.key}.${attribute.key} do not fit the global ones; left out`);
          continue;
        }
        (fields[node.key] ??= {})[attribute.key] = own;
      }
    }
    return {
      index: { ...index.configured, ...(Object.keys(fields).length ? { fields } : {}) },
      search: search.configured,
    };
  }

  private async read(column: 'index_settings' | 'search_settings'): Promise<unknown> {
    return this.database.query<{ value: unknown }>(
      `SELECT ${column} AS "value" FROM semantic_model.extraction_settings WHERE singleton`,
    ).then((result) => result.rows[0]?.value).catch(() => undefined);
  }

  private async write(column: 'index_settings' | 'search_settings', value: object, userId: string): Promise<void> {
    await this.database.query(
      `INSERT INTO semantic_model.extraction_settings (singleton, ${column}, updated_by, updated_at)
       VALUES (true, $1::jsonb, $2, now())
       ON CONFLICT (singleton) DO UPDATE SET ${column} = EXCLUDED.${column},
         updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [JSON.stringify(value), userId],
    );
  }
}

/** A DTO instance carries the keys it did not receive as undefined: they are not settings. */
function stripUndefined(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}
