/**
 * Graph search settings an administrator sets for every model (Admin > Semantic models), and the
 * per-field overrides a concept field definition may carry. The built-in values are the runtime's
 * defaults (semantic-model-runtime app/graph_search/settings.py); the runtime checks the same bounds.
 *
 * Index settings shape the text that is indexed: changing them builds new search indexes on the next
 * search. Search settings apply to each request and never rebuild anything.
 */

export interface SearchIndexSettings {
  cardValueChars: number;
  cardTextChars: number;
  /** A field longer than this is also split into passages; the card value cap when not set. */
  longFieldChars: number;
  passageTargetChars: number;
  passageMinChars: number;
  passageMaxChars: number;
  passageOverlapChars: number;
  maxPassagesPerField: number;
  maxPassagesPerRecord: number;
  passageHeader: boolean;
}

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

/** A concept field's own passage settings (stored on the attribute as `searchIndex`); empty uses the global ones. */
export interface FieldSearchIndexSettings {
  passages?: boolean;
  longFieldChars?: number;
  passageTargetChars?: number;
  passageMinChars?: number;
  passageMaxChars?: number;
  passageOverlapChars?: number;
  maxPassagesPerField?: number;
}

type NumberKey<T> = { [K in keyof T]: T[K] extends number ? K : never }[keyof T];

export const DEFAULT_SEARCH_INDEX_SETTINGS: SearchIndexSettings = {
  cardValueChars: 300, cardTextChars: 2000, longFieldChars: 300,
  passageTargetChars: 1000, passageMinChars: 700, passageMaxChars: 1200, passageOverlapChars: 150,
  maxPassagesPerField: 20, maxPassagesPerRecord: 50, passageHeader: true,
};

export const SEARCH_INDEX_RANGES: Record<NumberKey<SearchIndexSettings>, readonly [number, number]> = {
  cardValueChars: [100, 2000], cardTextChars: [500, 10000], longFieldChars: [50, 2000],
  passageTargetChars: [200, 4000], passageMinChars: [100, 4000], passageMaxChars: [200, 6000],
  passageOverlapChars: [0, 1000], maxPassagesPerField: [1, 200], maxPassagesPerRecord: [1, 500],
};

export const DEFAULT_SEARCH_QUERY_SETTINGS: SearchQuerySettings = {
  lexicalCandidates: 50, vectorCandidates: 50, minSimilarity: 0.4, rrfK: 60, defaultLimit: 10, maxLimit: 25,
  passagesPerRecord: 2, excerptChars: 400, snippetChars: 400, stopWords: true, extraStopWords: [], maxQueryTerms: 16,
};

export const SEARCH_QUERY_RANGES: Record<NumberKey<SearchQuerySettings>, readonly [number, number]> = {
  lexicalCandidates: [5, 500], vectorCandidates: [5, 500], minSimilarity: [0, 1], rrfK: [1, 1000],
  defaultLimit: [1, 100], maxLimit: [1, 100], passagesPerRecord: [0, 10], excerptChars: [100, 4000],
  snippetChars: [100, 4000], maxQueryTerms: [1, 64],
};

export const FIELD_SEARCH_INDEX_KEYS = ['longFieldChars', 'passageTargetChars', 'passageMinChars', 'passageMaxChars',
  'passageOverlapChars', 'maxPassagesPerField'] as const;

export const MAX_EXTRA_STOP_WORDS = 500;
export const MAX_STOP_WORD_LENGTH = 40;

/** Decimal settings; every other number is a whole number. */
const DECIMAL = new Set<string>(['minSimilarity']);

function record(input: unknown): Record<string, unknown> | null {
  return input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : null;
}

function pickNumbers<T extends object>(input: Record<string, unknown>, ranges: Record<string, readonly [number, number]>, into: Partial<T>): void {
  for (const [key, [low, high]] of Object.entries(ranges)) {
    const value = input[key];
    const valid = typeof value === 'number' && Number.isFinite(value) && (DECIMAL.has(key) || Number.isInteger(value));
    if (valid && value >= low && value <= high) (into as Record<string, unknown>)[key] = value;
  }
}

/** Only the index settings that were set and are in range; anything else is dropped. */
export function pickSearchIndexSettings(input: unknown): Partial<SearchIndexSettings> {
  const source = record(input);
  if (!source) return {};
  const picked: Partial<SearchIndexSettings> = {};
  pickNumbers(source, SEARCH_INDEX_RANGES, picked);
  if (typeof source.passageHeader === 'boolean') picked.passageHeader = source.passageHeader;
  return picked;
}

/** Distinct words, trimmed, of 1 to 40 characters, at most 500. */
export function cleanStopWords(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const words: string[] = [];
  for (const item of input) {
    if (typeof item !== 'string') continue;
    const word = item.trim();
    const key = word.toLocaleLowerCase();
    if (!word || word.length > MAX_STOP_WORD_LENGTH || seen.has(key)) continue;
    seen.add(key);
    words.push(word);
    if (words.length >= MAX_EXTRA_STOP_WORDS) break;
  }
  return words;
}

/** Only the search settings that were set and are in range; anything else is dropped. */
export function pickSearchQuerySettings(input: unknown): Partial<SearchQuerySettings> {
  const source = record(input);
  if (!source) return {};
  const picked: Partial<SearchQuerySettings> = {};
  pickNumbers(source, SEARCH_QUERY_RANGES, picked);
  if (typeof source.stopWords === 'boolean') picked.stopWords = source.stopWords;
  if (Array.isArray(source.extraStopWords)) picked.extraStopWords = cleanStopWords(source.extraStopWords);
  return picked;
}

/** A field's own settings, or undefined when it sets nothing. */
export function pickFieldSearchIndex(input: unknown): FieldSearchIndexSettings | undefined {
  const source = record(input);
  if (!source) return undefined;
  const picked: FieldSearchIndexSettings = {};
  pickNumbers(source, Object.fromEntries(FIELD_SEARCH_INDEX_KEYS.map((key) => [key, SEARCH_INDEX_RANGES[key]])), picked);
  if (typeof source.passages === 'boolean') picked.passages = source.passages;
  return Object.keys(picked).length ? picked : undefined;
}

export function effectiveSearchIndexSettings(configured: Partial<SearchIndexSettings>): SearchIndexSettings {
  const merged = { ...DEFAULT_SEARCH_INDEX_SETTINGS, ...configured };
  // The threshold follows the card value cap unless it was set.
  if (configured.longFieldChars === undefined) merged.longFieldChars = merged.cardValueChars;
  return merged;
}

export function effectiveSearchQuerySettings(configured: Partial<SearchQuerySettings>): SearchQuerySettings {
  return { ...DEFAULT_SEARCH_QUERY_SETTINGS, ...configured };
}

function passageProblems(value: { passageMinChars: number; passageTargetChars: number; passageMaxChars: number; passageOverlapChars: number }, where = ''): string[] {
  const problems: string[] = [];
  if (!(value.passageMinChars < value.passageTargetChars && value.passageTargetChars < value.passageMaxChars)) {
    problems.push(`${where}passage sizes must be min < target < max`);
  }
  if (value.passageOverlapChars >= value.passageMinChars) problems.push(`${where}passageOverlapChars must be below passageMinChars`);
  return problems;
}

function rangeProblems(input: Record<string, unknown>, ranges: Record<string, readonly [number, number]>, booleans: string[], extra: string[] = []): string[] {
  const problems: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    if (booleans.includes(key)) {
      if (typeof value !== 'boolean') problems.push(`${key} must be true or false`);
      continue;
    }
    if (extra.includes(key)) continue;
    const range = ranges[key];
    if (!range) { problems.push(`${key} is not a setting`); continue; }
    const whole = !DECIMAL.has(key);
    if (typeof value !== 'number' || !Number.isFinite(value) || (whole && !Number.isInteger(value)) || value < range[0] || value > range[1]) {
      problems.push(`${key} must be ${whole ? 'a whole number' : 'a number'} from ${range[0]} to ${range[1]}`);
    }
  }
  return problems;
}

/** Why the index settings an admin sent cannot be saved (bounds, then consistency of the result); empty when they can. */
export function searchIndexProblems(input: unknown): string[] {
  const source = record(input);
  if (!source) return ['settings must be an object'];
  const problems = rangeProblems(source, SEARCH_INDEX_RANGES, ['passageHeader']);
  if (problems.length) return problems;
  const value = effectiveSearchIndexSettings(pickSearchIndexSettings(source));
  if (value.cardTextChars < value.cardValueChars) problems.push('cardTextChars must be at least cardValueChars');
  if (value.longFieldChars > value.cardValueChars) problems.push('longFieldChars must be at most cardValueChars');
  if (value.maxPassagesPerRecord < value.maxPassagesPerField) problems.push('maxPassagesPerRecord must be at least maxPassagesPerField');
  return [...problems, ...passageProblems(value)];
}

/** Why the search settings an admin sent cannot be saved; empty when they can. */
export function searchQueryProblems(input: unknown): string[] {
  const source = record(input);
  if (!source) return ['settings must be an object'];
  const problems = rangeProblems(source, SEARCH_QUERY_RANGES, ['stopWords'], ['extraStopWords']);
  if (source.extraStopWords !== undefined) {
    const words = source.extraStopWords;
    if (!Array.isArray(words) || words.length > MAX_EXTRA_STOP_WORDS
      || words.some((word) => typeof word !== 'string' || !word.trim() || word.trim().length > MAX_STOP_WORD_LENGTH)) {
      problems.push(`extraStopWords must be at most ${MAX_EXTRA_STOP_WORDS} words of 1 to ${MAX_STOP_WORD_LENGTH} characters`);
    }
  }
  if (problems.length) return problems;
  const value = effectiveSearchQuerySettings(pickSearchQuerySettings(source));
  if (value.defaultLimit > value.maxLimit) problems.push('defaultLimit must be at most maxLimit');
  return problems;
}

/** Why a field's own settings cannot be kept, merged over the global ones; empty when they can. */
export function fieldSearchIndexProblems(input: unknown, global: SearchIndexSettings = DEFAULT_SEARCH_INDEX_SETTINGS, where = 'searchIndex: '): string[] {
  const source = record(input);
  if (!source) return [`${where}must be an object`];
  const ranges = Object.fromEntries(FIELD_SEARCH_INDEX_KEYS.map((key) => [key, SEARCH_INDEX_RANGES[key]]));
  const problems = rangeProblems(source, ranges, ['passages']).map((problem) => where + problem);
  if (problems.length) return problems;
  const own = pickFieldSearchIndex(source) ?? {};
  return passageProblems({ ...global, ...own }, where);
}

/** What the runtime receives: the values an admin set (the runtime fills in its defaults), and each field's own settings. */
export interface RuntimeSearchSettingsPayload {
  index: Partial<SearchIndexSettings> & { fields?: Record<string, Record<string, FieldSearchIndexSettings>> };
  search: Partial<SearchQuerySettings>;
}
