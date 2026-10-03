import type { AttributeDefinition } from './semantic-model.types';

export type SourceAssetKind = 'excel_sheet' | 'csv' | 'document';
export type SourceFieldMappingMode = 'direct' | 'extract' | 'metadata' | 'constant' | 'computed' | 'ignore';
// How an `extract` mapping resolves its value. Deterministic is the default so
// existing mappings keep their current behaviour without a migration.
// `rules_then_ai` reads a field by its rules and asks the AI only when they find nothing.
export type SourceExtractionStrategy = 'deterministic' | 'ai' | 'rules_then_ai';

/** Where a document value is and what it looks like; without rules, `Label: value` or a table row. */
export interface ExtractionRules {
  labels?: string[];
  location?: 'auto' | 'same_line' | 'next_line' | 'table' | 'heading' | 'anywhere' | 'after_label' | 'before_label' | 'pages';
  pattern?: string;
  transform?: 'none' | 'trim' | 'no_spaces' | 'upper' | 'lower' | 'date_iso';
  occurrence?: 'unique' | 'first';
  firstPageOnly?: boolean;
  /** Where a passage stops (after a label) or starts (before one); the section edge without any. */
  boundaryLabels?: string[];
  /** The pages read whole when `location` is `pages`. */
  pages?: { from: number; to?: number };
  /** Keep only the first or last characters, words or lines of what was found, like LEFT(value, n). */
  take?: { from?: 'start' | 'end'; count: number; unit?: 'characters' | 'words' | 'lines' };
}

/**
 * A field's recipe: take it from somewhere, cut it, keep a part, match a shape, clean it up (the runtime
 * applies it). A document's computed field, or a spreadsheet's direct field that is transformed.
 */
export interface ComputedFieldSpec {
  // kind 'file' reads 'document_name' (documents); kind 'field' reads another mapping's targetAttribute
  // (not itself taken from a field); kind 'column' reads a column of the row (spreadsheets).
  input: { kind: 'file' | 'field' | 'column'; name: string };
  // 'whole' keeps the input as it is (no cut).
  method: 'whole' | 'split' | 'between' | 'regex';
  delimiter?: string;
  part?: number;
  after?: string;
  before?: string;
  pattern?: string;
  template?: string;
  stripExtension?: boolean;
  /** After the cut: keep only the first or last characters, words or lines (as the reading rules' take). */
  take?: { from?: 'start' | 'end'; count: number; unit?: 'characters' | 'words' | 'lines' };
  /** After the take: what the value looks like; its first group is kept when it has one. `pattern` is the cut's own. */
  valuePattern?: string;
  transform?: 'none' | 'trim' | 'no_spaces' | 'upper' | 'lower' | 'date_iso' | 'year' | 'number';
}

export interface SourceFieldMapping {
  sourceField: string | null;
  targetAttribute: string;
  mode: SourceFieldMappingMode;
  constantValue?: unknown;
  extractionStrategy?: SourceExtractionStrategy;
  /** AI reading only: what the value means and what to look for; empty uses the attribute's description. */
  semanticDefinition?: string;
  /** AI reading only: the agent asked to read the field; absent means the platform's extraction agent. */
  agentId?: string;
  rules?: ExtractionRules;
  /** mode 'computed' (documents) or 'direct' (spreadsheets: the column's value is transformed). */
  computed?: ComputedFieldSpec;
}

/** How much of a document the AI reads. */
export interface AiExtractionSettings {
  /** Most blocks sent for one document. */
  maxBlocks: number;
  /** Most characters sent for one document. */
  maxCharacters: number;
  /** Above this many characters, only the blocks about each field are sent. */
  longDocumentCharacters: number;
  /** Blocks kept per field in a long document. */
  blocksPerField: number;
  /** One document gives several records (one per item the AI finds), e.g. each line of a table. Mapping only. */
  manyRecords?: boolean;
}

/** How much one population run may read and keep. The runtime applies the same ranges. */
export interface RunLimits {
  /** Most files (or sheets) one run reads; also the most files one workspace source covers. */
  maxRunSources: number;
  /** Most records one source (a sheet, an archive table) gives. */
  maxRecordsPerSource: number;
  /** Most records one run keeps, all concepts together. */
  maxRecordsPerRun: number;
  /** Most field values one run keeps, all records together. */
  maxValuesPerRun: number;
}

export const DEFAULT_RUN_LIMITS: RunLimits = {
  maxRunSources: 5000,
  maxRecordsPerSource: 5000,
  maxRecordsPerRun: 10000,
  maxValuesPerRun: 50000,
};

export const RUN_LIMIT_RANGES: Record<keyof RunLimits, readonly [number, number]> = {
  maxRunSources: [1, 50000],
  maxRecordsPerSource: [100, 200000],
  maxRecordsPerRun: [100, 200000],
  maxValuesPerRun: [1000, 2000000],
};

export const DEFAULT_AI_EXTRACTION_SETTINGS: AiExtractionSettings = {
  maxBlocks: 400,
  maxCharacters: 60000,
  longDocumentCharacters: 30000,
  blocksPerField: 8,
};

export function usesAiExtraction(mappings: SourceFieldMapping[] | null | undefined): boolean {
  return (mappings ?? []).some((field) => field.mode === 'extract'
    && (field.extractionStrategy === 'ai' || field.extractionStrategy === 'rules_then_ai'));
}

export interface SheetFieldProfile {
  name: string;
  type: 'text' | 'number' | 'boolean' | 'date';
  sample: string;
  populatedRatio: number;
  uniqueRatio: number;
}

export interface ResolvedEntity {
  entityKey: string;
  label: string;
  values: Record<string, unknown>;
  provenance: {
    rowNumber?: number;
    fields?: Record<string, {
      method: 'direct_mapping' | 'semantic_extraction' | 'document_metadata' | 'fixed_value' | 'computed_field';
      page?: string;
      quote?: string;
      reference?: string;
      confidence?: number;
    }>;
  };
}

export interface ResolutionStats {
  scannedRows: number;
  resolvedEntities: number;
  duplicateKeysSkipped: number;
  nullIdentitySkipped: number;
}

export interface ConceptResolutionInput {
  userId: string;
  modelId: string;
  workspaceId: string;
  documentId: string;
  documentName: string;
  concept: {
    id: string;
    label: string;
    attributes: AttributeDefinition[];
  };
  fieldMappings: SourceFieldMapping[];
  identityFields: string[];
  limit?: number;
}

export interface ConceptResolutionResult {
  entities: ResolvedEntity[];
  stats: ResolutionStats;
  identityEvidence: SheetFieldProfile[];
  warnings: string[];
  complete: boolean;
}

export interface ConceptResolver {
  readonly kind: SourceAssetKind;
  preview(input: ConceptResolutionInput): Promise<ConceptResolutionResult>;
}

// ponytail: preview scans at most 5k rows per call; stream in chunks if larger sheets stall previews
export const PREVIEW_ROW_SCAN_LIMIT = 5_000;
export const PROFILE_SAMPLE_ROW_LIMIT = 200;

export function normalizeIdentityValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim().toLowerCase();
}

export function identityKeyOf(row: Record<string, unknown>, identityFields: string[]): string {
  return identityFields.map((field) => normalizeIdentityValue(row[field])).join('\u0000');
}

function inferType(value: unknown): SheetFieldProfile['type'] {
  if (typeof value === 'number' || typeof value === 'bigint') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (value instanceof Date) return 'date';
  return 'text';
}

// Reserved objectRows key carrying the source worksheet row number for provenance.
export const SHEET_ROW_KEY = '__sheetRow';

export function computeFieldProfiles(rows: Record<string, unknown>[]): SheetFieldProfile[] {
  const names = [...new Set(rows.flatMap((row) => Object.keys(row)))].filter((name) => !name.startsWith('__'));
  return names.map((name) => {
    const values = rows.map((row) => row[name]);
    const populated = values.filter((value) => value !== null && value !== undefined && String(value) !== '');
    const unique = new Set(populated.map(normalizeIdentityValue));
    const first = populated[0];
    return {
      name,
      type: inferType(first),
      sample: first === undefined ? '' : String(first).slice(0, 80),
      populatedRatio: rows.length ? populated.length / rows.length : 0,
      uniqueRatio: populated.length ? unique.size / populated.length : 0,
    };
  });
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export interface SuggestedFieldMapping extends SourceFieldMapping {
  suggested: boolean;
}

export function suggestFieldMappings(
  fields: string[],
  attributes: AttributeDefinition[],
  existing: SourceFieldMapping[] = [],
): SuggestedFieldMapping[] {
  const byNormalizedTarget = new Map<string, string>();
  for (const attribute of attributes) {
    byNormalizedTarget.set(normalizeName(attribute.key), attribute.key);
    if (!byNormalizedTarget.has(normalizeName(attribute.label))) byNormalizedTarget.set(normalizeName(attribute.label), attribute.key);
  }
  const existingBySource = new Map(existing.filter((mapping) => mapping.sourceField).map((mapping) => [mapping.sourceField!, mapping]));
  return fields.map((field) => {
    const previous = existingBySource.get(field);
    if (previous) return { ...previous, suggested: false };
    const target = byNormalizedTarget.get(normalizeName(field));
    return { sourceField: field, targetAttribute: target ?? '', mode: target ? 'direct' : 'ignore', suggested: Boolean(target) };
  });
}

export function resolveSheetEntities(
  rows: Record<string, unknown>[],
  fieldMappings: SourceFieldMapping[],
  identityFields: string[],
  limit = 50,
): { entities: ResolvedEntity[]; stats: ResolutionStats } {
  const active = fieldMappings.filter((mapping) => mapping.mode !== 'ignore');
  const stats: ResolutionStats = { scannedRows: 0, resolvedEntities: 0, duplicateKeysSkipped: 0, nullIdentitySkipped: 0 };
  const seen = new Set<string>();
  const entities: ResolvedEntity[] = [];
  for (const row of rows) {
    if (entities.length >= limit || stats.scannedRows >= PREVIEW_ROW_SCAN_LIMIT) break;
    stats.scannedRows += 1;
    const values: Record<string, unknown> = {};
    for (const mapping of active) {
      values[mapping.targetAttribute] = mapping.mode === 'constant' ? mapping.constantValue
        : mapping.sourceField ? row[mapping.sourceField] : undefined;
    }
    const key = identityFields.length ? identityKeyOf(values, identityFields) : `row:${stats.scannedRows}`;
    if (identityFields.length && !key.replace(/\u0000/g, '')) {
      stats.nullIdentitySkipped += 1;
      continue;
    }
    if (identityFields.length && seen.has(key)) {
      stats.duplicateKeysSkipped += 1;
      continue;
    }
    if (identityFields.length) seen.add(key);
    const labelField = identityFields.find((field) => normalizeIdentityValue(values[field]) !== '')
      ?? active.find((mapping) => normalizeIdentityValue(values[mapping.targetAttribute]) !== '')?.targetAttribute;
    const fields = Object.fromEntries(active.map((mapping) => [mapping.targetAttribute, {
      method: mapping.mode === 'constant' ? 'fixed_value' as const : 'direct_mapping' as const,
      reference: mapping.sourceField ?? undefined,
    }]));
    entities.push({
      entityKey: key,
      label: labelField ? String(values[labelField] ?? '') : '',
      values,
      provenance: {
        rowNumber: typeof row[SHEET_ROW_KEY] === 'number' ? row[SHEET_ROW_KEY] as number : stats.scannedRows,
        fields,
      },
    });
    stats.resolvedEntities += 1;
  }
  return { entities, stats };
}

/**
 * Version of the AI extraction contract (prompt + response shape). Must equal the ADK's reported
 * extractorVersion; bump both together. A run and a preview bind the agent with it.
 */
export const AI_EXTRACTION_CONTRACT_VERSION = 'ai-attribute-v1';

/**
 * A document mapping kept in step with its concept: one row per concept field, in the concept's
 * order. Saved rows are kept as they are; a field added to the concept gets a row read like most of
 * the other fields, and a row for a field the concept no longer has is dropped. `changed` is false
 * when the same fields are read, so an unrelated edit does not make the next run read again.
 */
export function withConceptFields(saved: SourceFieldMapping[], attributes: ReadonlyArray<{ key: string }>): { mappings: SourceFieldMapping[]; changed: boolean } {
  const byKey = new Map(saved.map((mapping) => [mapping.targetAttribute, mapping]));
  const counts = new Map<SourceExtractionStrategy, number>();
  for (const mapping of saved) {
    if (mapping.mode !== 'extract') continue;
    const strategy = mapping.extractionStrategy ?? 'deterministic';
    counts.set(strategy, (counts.get(strategy) ?? 0) + 1);
  }
  const strategy = [...counts].sort((left, right) => right[1] - left[1])[0]?.[0] ?? 'deterministic';
  const mappings = attributes.map((attribute): SourceFieldMapping => byKey.get(attribute.key)
    ?? (attribute.key === 'source_document'
      ? { sourceField: 'document_name', targetAttribute: attribute.key, mode: 'metadata' }
      : { sourceField: null, targetAttribute: attribute.key, mode: 'extract', extractionStrategy: strategy }));
  const keys = new Set(attributes.map((attribute) => attribute.key));
  const changed = mappings.length !== saved.length || saved.some((mapping) => !keys.has(mapping.targetAttribute));
  return { mappings, changed };
}

/**
 * What the AI is told about a field. The field's own semantic definition wins; without one, the
 * concept attribute's description is used, so rules saved before definitions existed read as before.
 */
export function aiFieldHints(
  attribute: AttributeDefinition,
  field?: Pick<SourceFieldMapping, 'semanticDefinition'>,
): { description?: string; valueType?: string; allowedValues?: string[] } {
  const description = field?.semanticDefinition?.trim() || attribute.description?.trim();
  return {
    ...(description ? { description } : {}),
    ...(attribute.type ? { valueType: attribute.type } : {}),
    ...(attribute.options?.length ? { allowedValues: attribute.options } : {}),
  };
}
