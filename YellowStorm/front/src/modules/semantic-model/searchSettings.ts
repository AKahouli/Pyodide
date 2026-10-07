import { apiClient } from '@/lib/api/client';
import type { ApiResponse } from '@/lib/api/client';
import { API_ENDPOINTS } from '@/lib/api/config';
import type { AttributeDefinition, FieldSearchIndex } from './types';

export type { FieldSearchIndex };

/** How records are indexed for search: their card, and the passages long text fields are cut into. */
export interface SearchIndexSettings {
  cardValueChars: number;
  cardTextChars: number;
  longFieldChars: number;
  passageTargetChars: number;
  passageMinChars: number;
  passageMaxChars: number;
  passageOverlapChars: number;
  maxPassagesPerField: number;
  maxPassagesPerRecord: number;
  passageHeader: boolean;
}

/** How a search runs: candidates, fusion, results and stop words. */
export interface SearchQuerySettings {
  lexicalCandidates: number;
  vectorCandidates: number;
  minSimilarity: number;
  rrfK: number;
  defaultLimit: number;
  maxLimit: number;
  passagesPerRecord: number;
  excerptChars: number;
  snippetChars: number;
  stopWords: boolean;
  extraStopWords: string[];
  maxQueryTerms: number;
}

/** What the admin endpoints answer: the effective values, what was set, and the built-ins. */
export interface SettingsResponse<T> {
  settings: T;
  configured: Partial<T>;
  defaults: T;
}

/** The effective values every model reader can see. */
export interface EffectiveSearchSettings {
  index: SearchIndexSettings;
  search: SearchQuerySettings;
}

export type NumericKeys<T> = { [K in keyof T]: T[K] extends number ? K : never }[keyof T];

export interface NumberFieldSpec<K extends string> {
  key: K;
  builtIn: number;
  min: number;
  max: number;
  /** Decimal fields; integer when absent. */
  step?: number;
}

export type SearchIndexNumberKey = NumericKeys<SearchIndexSettings>;
export type SearchQueryNumberKey = NumericKeys<SearchQuerySettings>;
export type FieldOverrideNumberKey = Exclude<keyof FieldSearchIndex, 'passages'>;

/** Built-in index values and the ranges the back end accepts. longFieldChars is capped by the effective card value size. */
export const SEARCH_INDEX_FIELDS: ReadonlyArray<NumberFieldSpec<SearchIndexNumberKey>> = [
  { key: 'cardValueChars', builtIn: 300, min: 100, max: 2000 },
  { key: 'cardTextChars', builtIn: 2000, min: 500, max: 10000 },
  { key: 'longFieldChars', builtIn: 300, min: 50, max: 2000 },
  { key: 'passageTargetChars', builtIn: 1000, min: 200, max: 4000 },
  { key: 'passageMinChars', builtIn: 700, min: 100, max: 4000 },
  { key: 'passageMaxChars', builtIn: 1200, min: 200, max: 6000 },
  { key: 'passageOverlapChars', builtIn: 150, min: 0, max: 1000 },
  { key: 'maxPassagesPerField', builtIn: 20, min: 1, max: 200 },
  { key: 'maxPassagesPerRecord', builtIn: 50, min: 1, max: 500 },
];

export const SEARCH_QUERY_FIELDS: ReadonlyArray<NumberFieldSpec<SearchQueryNumberKey>> = [
  { key: 'lexicalCandidates', builtIn: 50, min: 5, max: 500 },
  { key: 'vectorCandidates', builtIn: 50, min: 5, max: 500 },
  { key: 'minSimilarity', builtIn: 0.4, min: 0, max: 1, step: 0.01 },
  { key: 'rrfK', builtIn: 60, min: 1, max: 1000 },
  { key: 'defaultLimit', builtIn: 10, min: 1, max: 100 },
  { key: 'maxLimit', builtIn: 25, min: 1, max: 100 },
  { key: 'passagesPerRecord', builtIn: 2, min: 0, max: 10 },
  { key: 'excerptChars', builtIn: 400, min: 100, max: 4000 },
  { key: 'snippetChars', builtIn: 400, min: 100, max: 4000 },
  { key: 'maxQueryTerms', builtIn: 16, min: 1, max: 64 },
];

/** The index settings a text field can change for itself. */
export const FIELD_OVERRIDE_FIELDS: ReadonlyArray<FieldOverrideNumberKey> = [
  'longFieldChars', 'passageTargetChars', 'passageMinChars', 'passageMaxChars', 'passageOverlapChars', 'maxPassagesPerField',
];

/** The i18n key of a settings problem. */
export type SearchSettingsProblem = `searchSettings.problems.${'range' | 'longField' | 'cardText' | 'passageOrder' | 'overlap' | 'passagesPerRecord' | 'limit' | 'stopWords'}`;

export const MAX_EXTRA_STOP_WORDS = 500;
export const MAX_STOP_WORD_LENGTH = 40;

const builtIns = <K extends string>(fields: ReadonlyArray<NumberFieldSpec<K>>) =>
  Object.fromEntries(fields.map(({ key, builtIn }) => [key, builtIn])) as Record<K, number>;

export const SEARCH_INDEX_DEFAULTS: SearchIndexSettings = { ...builtIns(SEARCH_INDEX_FIELDS), passageHeader: true };
export const SEARCH_QUERY_DEFAULTS: SearchQuerySettings = { ...builtIns(SEARCH_QUERY_FIELDS), stopWords: true, extraStopWords: [] };

/** Configured values over the defaults; the long field size follows the card value size unless set. */
export function effectiveIndex(configured: Partial<SearchIndexSettings>, defaults: SearchIndexSettings = SEARCH_INDEX_DEFAULTS): SearchIndexSettings {
  const merged = { ...defaults, ...configured };
  if (configured.longFieldChars === undefined) merged.longFieldChars = merged.cardValueChars;
  return merged;
}

export function effectiveQuery(configured: Partial<SearchQuerySettings>, defaults: SearchQuerySettings = SEARCH_QUERY_DEFAULTS): SearchQuerySettings {
  return { ...defaults, ...configured };
}

/** The range a number accepts; the long field size cannot exceed the card value size. */
export function indexRange(key: SearchIndexNumberKey, effective: Pick<SearchIndexSettings, 'cardValueChars'>): { min: number; max: number } {
  const spec = SEARCH_INDEX_FIELDS.find((field) => field.key === key)!;
  return key === 'longFieldChars' ? { min: spec.min, max: effective.cardValueChars } : { min: spec.min, max: spec.max };
}

export function outOfRange(value: number | undefined, range: { min: number; max: number }, decimal = false): boolean {
  return value !== undefined && (!Number.isFinite(value) || (!decimal && !Number.isInteger(value)) || value < range.min || value > range.max);
}

/** Passage sizes that agree: min < target < max, overlap < min. */
function passageProblem(values: Pick<SearchIndexSettings, 'passageMinChars' | 'passageTargetChars' | 'passageMaxChars' | 'passageOverlapChars'>): SearchSettingsProblem | null {
  if (!(values.passageMinChars < values.passageTargetChars && values.passageTargetChars < values.passageMaxChars)) return 'searchSettings.problems.passageOrder';
  if (values.passageOverlapChars >= values.passageMinChars) return 'searchSettings.problems.overlap';
  return null;
}

/** The first problem of the index settings, as an i18n key, checked on the effective values. */
export function searchIndexProblems(configured: Partial<SearchIndexSettings>, defaults: SearchIndexSettings = SEARCH_INDEX_DEFAULTS): SearchSettingsProblem | null {
  const effective = effectiveIndex(configured, defaults);
  if (SEARCH_INDEX_FIELDS.some(({ key }) => outOfRange(configured[key], indexRange(key, effective)))) return 'searchSettings.problems.range';
  if (effective.longFieldChars > effective.cardValueChars) return 'searchSettings.problems.longField';
  if (effective.cardTextChars < effective.cardValueChars) return 'searchSettings.problems.cardText';
  const passages = passageProblem(effective);
  if (passages) return passages;
  if (effective.maxPassagesPerRecord < effective.maxPassagesPerField) return 'searchSettings.problems.passagesPerRecord';
  return null;
}

export function stopWordsProblem(words: string[] | undefined): boolean {
  return words !== undefined && (words.length > MAX_EXTRA_STOP_WORDS || words.some((word) => word.length < 1 || word.length > MAX_STOP_WORD_LENGTH));
}

/** The first problem of the search settings, as an i18n key, checked on the effective values. */
export function searchQueryProblems(configured: Partial<SearchQuerySettings>, defaults: SearchQuerySettings = SEARCH_QUERY_DEFAULTS): SearchSettingsProblem | null {
  if (SEARCH_QUERY_FIELDS.some(({ key, min, max, step }) => outOfRange(configured[key], { min, max }, step !== undefined))) return 'searchSettings.problems.range';
  if (stopWordsProblem(configured.extraStopWords)) return 'searchSettings.problems.stopWords';
  const effective = effectiveQuery(configured, defaults);
  if (effective.defaultLimit > effective.maxLimit) return 'searchSettings.problems.limit';
  return null;
}

/** The field's settings over the global ones. */
export function effectiveFieldIndex(override: FieldSearchIndex | undefined, globalIndex: SearchIndexSettings): SearchIndexSettings {
  const merged = { ...globalIndex };
  for (const key of FIELD_OVERRIDE_FIELDS) if (override?.[key] !== undefined) merged[key] = override[key]!;
  return merged;
}

/** The first problem of a field's own settings, as an i18n key, checked over the global effective values. */
export function fieldOverrideProblems(override: FieldSearchIndex | undefined, globalIndex: SearchIndexSettings): SearchSettingsProblem | null {
  if (!override) return null;
  const effective = effectiveFieldIndex(override, globalIndex);
  if (FIELD_OVERRIDE_FIELDS.some((key) => outOfRange(override[key], indexRange(key, globalIndex)))) return 'searchSettings.problems.range';
  return passageProblem(effective);
}

/** A field's settings without the empty keys; undefined when nothing is left. */
export function cleanFieldIndex(value: FieldSearchIndex | undefined): FieldSearchIndex | undefined {
  if (!value) return undefined;
  const entries = Object.entries(value).filter(([, item]) => item !== undefined);
  return entries.length ? Object.fromEntries(entries) as FieldSearchIndex : undefined;
}

/** The field with its own search index settings, or without the key when none is left. */
export function withSearchIndex(attribute: AttributeDefinition, searchIndex: FieldSearchIndex | undefined): AttributeDefinition {
  const { searchIndex: _previous, ...rest } = attribute;
  const next = cleanFieldIndex(searchIndex);
  return next ? { ...rest, searchIndex: next } : rest;
}

const ADMIN_BASE = API_ENDPOINTS.adminSemanticModelSettings.base;
export const SEARCH_SETTINGS_ENDPOINTS = {
  adminIndex: `${ADMIN_BASE}/search-index`,
  adminSearch: `${ADMIN_BASE}/search`,
  effective: '/semantic-model-settings/search',
} as const;

const unwrap = <T>(response: { data: ApiResponse<T> }): T => response.data.data;

export const searchSettingsApi = {
  async getAdminIndex(): Promise<SettingsResponse<SearchIndexSettings>> {
    return unwrap(await apiClient.get<ApiResponse<SettingsResponse<SearchIndexSettings>>>(SEARCH_SETTINGS_ENDPOINTS.adminIndex));
  },
  async updateAdminIndex(configured: Partial<SearchIndexSettings>): Promise<SettingsResponse<SearchIndexSettings>> {
    return unwrap(await apiClient.put<ApiResponse<SettingsResponse<SearchIndexSettings>>>(SEARCH_SETTINGS_ENDPOINTS.adminIndex, configured));
  },
  async getAdminSearch(): Promise<SettingsResponse<SearchQuerySettings>> {
    return unwrap(await apiClient.get<ApiResponse<SettingsResponse<SearchQuerySettings>>>(SEARCH_SETTINGS_ENDPOINTS.adminSearch));
  },
  async updateAdminSearch(configured: Partial<SearchQuerySettings>): Promise<SettingsResponse<SearchQuerySettings>> {
    return unwrap(await apiClient.put<ApiResponse<SettingsResponse<SearchQuerySettings>>>(SEARCH_SETTINGS_ENDPOINTS.adminSearch, configured));
  },
  async getEffective(): Promise<EffectiveSearchSettings> {
    return unwrap(await apiClient.get<ApiResponse<EffectiveSearchSettings>>(SEARCH_SETTINGS_ENDPOINTS.effective));
  },
};

export const SEARCH_SETTINGS_QUERY_KEY = ['semantic-models', 'search-settings'] as const;
