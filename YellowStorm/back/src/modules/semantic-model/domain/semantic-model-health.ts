import type { ReviewQueueItem } from '../services/semantic-review-queue.service';
import type {
  RuntimeBoundRecords, RuntimeConceptHealth, RuntimeHealthExample, RuntimeHealthFinding,
} from '../services/semantic-runtime-client.service';
import type {
  HealthBreakdown, HealthConcept, HealthExample, HealthIssue, HealthJourney, HealthStatus, ModelHealth,
} from './semantic-model-health.types';

export interface HealthModelConcept {
  id: string;
  label: string;
  attributes: { key: string; label?: string; required?: boolean }[];
}

export interface HealthBuildInput {
  records: Pick<RuntimeBoundRecords, 'dataRevisionId' | 'specification' | 'conceptCounts' | 'gaps' | 'health'>;
  concepts: HealthModelConcept[];
  relations: { id: string; sourceConceptId: string }[];
  /** Concepts made from another concept's records. */
  derived: { conceptId: string; sourceConceptId: string }[];
  /** File names behind a concept, and the kind of source when the run did not count rows (documents, typed records). */
  sources: Map<string, { names: string[]; kind: 'document' | 'manual' }>;
  setup: ReviewQueueItem[];
}

/** A field the reader could not find in a document: the same fact as the empty value it leaves. */
const FIELD_NOT_FOUND = new Set(['unresolved_document_field', 'ai_extraction_unresolved']);
/** Whole documents that could not be read. */
const DOCUMENT_NOT_READ = new Set(['source_unavailable', 'index_unavailable', 'index_ambiguous', 'index_not_found', 'unresolved_identity']);
/** A limit stopped the build before every row or document was read. */
const READING_LIMIT = new Set(['materialization_cap', 'assertion_cap', 'relationship_cap', 'enumeration_capped', 'budget_exhausted']);
const RANK: Record<HealthStatus, number> = { blocked: 0, warning: 1, info: 2, healthy: 3 };
/** A key that left this share of the rows (or less) as records has lost the data, not tidied it. */
const BLOCKING_KEEP_RATIO = 0.01;
const BLOCKING_MISSING_SHARE = 0.5;
const MAX_VALUES_SHOWN = 6;

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * The model's health from what the last run learned: each concept's row journey, then the problems a
 * person can act on, each with its cause, what it costs, real examples and one suggested fix.
 * Pure: the service only gathers the inputs.
 */
export function buildModelHealth(input: HealthBuildInput): ModelHealth {
  const { records, setup } = input;
  const byId = new Map(input.concepts.map((concept) => [concept.id, concept]));
  const fieldLabel = (conceptId: string, key: string) => {
    const label = byId.get(conceptId)?.attributes.find((attribute) => attribute.key === key)?.label;
    return (label === '' ? undefined : label) ?? key.replaceAll('_', ' ');
  };
  const derivedFrom = new Map(input.derived.map((item) => [item.conceptId, item.sourceConceptId]));
  const relationSource = new Map(input.relations.map((relation) => [relation.id, relation.sourceConceptId]));
  const relationLabels = new Map(records.specification.relations.map((relation) => [relation.relationId, relation.label]));
  const reports: Record<string, RuntimeConceptHealth | undefined> = records.health?.concepts ?? {};
  const counts: Record<string, number | undefined> = records.conceptCounts ?? {};
  const issues = new Map<string, HealthIssue[]>();
  const add = (issue: HealthIssue) => issues.set(issue.conceptId, [...(issues.get(issue.conceptId) ?? []), issue]);
  const examplesOf = (conceptId: string, items: RuntimeHealthExample[]): HealthExample[] => items.map((item) => ({
    ...(item.source ? { source: item.source } : {}),
    ...(item.sheet ? { sheet: item.sheet } : {}),
    ...(item.row != null ? { row: item.row } : {}),
    ...(item.record ? { record: item.record } : {}),
    values: Object.fromEntries(Object.entries(item.values).map(([key, value]) => [fieldLabel(conceptId, key), String(value)])),
  }));
  const labels = (conceptId: string, keys: string[]) => keys.map((key) => fieldLabel(conceptId, key)).join(', ');

  for (const concept of records.specification.concepts) {
    const report = reports[concept.conceptId];
    const findings = report?.findings ?? [];
    const coarse = findings.find((finding): finding is Extract<RuntimeHealthFinding, { kind: 'identity_too_coarse' }> => finding.kind === 'identity_too_coarse');
    for (const finding of findings) {
      const conceptId = concept.conceptId;
      if (finding.kind === 'identity_too_coarse') {
        const kept = finding.entities / Math.max(1, finding.rows);
        const suggested = finding.suggestedKey;
        const cardinality = finding.keyFields.length === 1 ? finding.keyCardinality?.[finding.keyFields[0]] : undefined;
        add({
          id: `${conceptId}:identity_too_coarse`, conceptId, kind: 'identity_too_coarse', cause: 'design',
          severity: kept <= BLOCKING_KEEP_RATIO ? 'blocked' : 'warning',
          params: { concept: concept.label, keyFields: labels(conceptId, finding.keyFields), keyValues: cardinality ?? finding.entities,
            rows: finding.rows, records: finding.entities, lostPercent: round((1 - kept) * 100),
            ...(suggested ? { suggested: suggested.fields.map((key) => fieldLabel(conceptId, key)).join(' + ') } : {}) },
          impact: { rows: finding.rows - finding.entities, of: finding.rows, values: finding.discardedValues },
          breakdown: {
            kind: 'key_values',
            items: finding.topKeyValues.slice(0, MAX_VALUES_SHOWN).map((top) => ({ label: Object.values(top.values).join(' · '), value: top.rows })),
          },
          examples: examplesOf(conceptId, finding.examples),
          ...(suggested ? { forecast: { records: suggested.estimatedRecords, estimated: true } } : {}),
          fix: { kind: 'choose_unique_field', conceptId, ...(suggested ? { suggestedFields: suggested.fields } : {}) },
          secondary: { kind: 'choose_unique_field', conceptId },
        });
      } else if (finding.kind === 'missing_identity') {
        const read = report?.rowsRead ?? 0;
        const share = finding.rows / Math.max(1, read);
        add({
          id: `${conceptId}:missing_identity:${finding.field}`, conceptId, kind: 'rows_without_key',
          // A key the AI had to find is a matter of values; an empty column is a matter of the source.
          cause: finding.aiRead ? 'values' : 'mapping', severity: share >= BLOCKING_MISSING_SHARE ? 'blocked' : 'warning',
          params: { concept: concept.label, field: fieldLabel(conceptId, finding.field), rows: finding.rows, of: read, ai: finding.aiRead ? 1 : 0 },
          impact: { rows: finding.rows, of: read }, examples: examplesOf(conceptId, finding.examples),
          fix: { kind: 'open_sources', conceptId }, secondary: { kind: 'choose_unique_field', conceptId },
        });
      } else if (finding.kind === 'conflicting_values' && !coarse) {
        // With a key too coarse these are its symptom, counted there as discarded values.
        add({
          id: `${conceptId}:conflicting_values:${finding.field}`, conceptId, kind: 'values_disagree', cause: 'values', severity: 'warning',
          params: { concept: concept.label, field: fieldLabel(conceptId, finding.field), rows: finding.rows, distinct: finding.distinctValues },
          impact: { rows: finding.rows }, examples: examplesOf(conceptId, finding.examples),
          fix: { kind: 'choose_unique_field', conceptId }, secondary: { kind: 'view_records', conceptId },
        });
      } else if (finding.kind === 'ai_row_limit') {
        const eligible = finding.rowsRead + finding.rowsLimited;
        const steps = [finding.rowsRead, Math.min(eligible, finding.rowsRead * 10), eligible]
          .filter((value, index, all) => all.indexOf(value) === index);
        const breakdown: HealthBreakdown = { kind: 'ai_cost', items: steps.map((value) => ({ label: String(value), value, current: value === finding.rowsRead })) };
        add({
          id: `${conceptId}:ai_row_limit`, conceptId, kind: 'ai_row_limit', cause: 'limit', severity: 'info',
          params: { concept: concept.label, limit: finding.limit, read: finding.rowsRead, left: finding.rowsLimited },
          impact: { rows: finding.rowsLimited, of: eligible }, breakdown, examples: [],
          fix: { kind: 'raise_ai_limit', currentLimit: finding.limit, suggestedLimit: eligible }, secondary: { kind: 'view_records', conceptId },
        });
      }
    }
  }

  const conceptIds = new Set(records.specification.concepts.map((concept) => concept.conceptId));
  const gaps = records.gaps ?? { missingValues: [], unresolvedLinks: [], other: [] };
  const keys = (conceptId: string) => new Set(reports[conceptId]?.keyFields ?? []);
  for (const gap of gaps.missingValues) {
    if (!conceptIds.has(gap.conceptId) || keys(gap.conceptId).has(gap.attribute)) continue;
    const required = byId.get(gap.conceptId)?.attributes.find((attribute) => attribute.key === gap.attribute)?.required;
    add({
      id: `${gap.conceptId}:missing_values:${gap.attribute}`, conceptId: gap.conceptId, kind: 'missing_values', cause: 'values',
      severity: required ? 'warning' : 'info',
      params: { concept: byId.get(gap.conceptId)?.label ?? '', field: fieldLabel(gap.conceptId, gap.attribute), missing: gap.missing, total: gap.total, required: required ? 1 : 0 },
      impact: { rows: gap.missing, of: gap.total }, examples: [],
      fix: { kind: 'fix_values', conceptId: gap.conceptId, attribute: gap.attribute }, secondary: { kind: 'view_records', conceptId: gap.conceptId },
    });
  }
  for (const gap of gaps.unresolvedLinks) {
    const conceptId = relationSource.get(gap.relationId);
    if (!conceptId || !conceptIds.has(conceptId)) continue;
    add({
      id: `${conceptId}:links:${gap.relationId}`, conceptId, kind: 'links_unmatched', cause: 'mapping', severity: 'warning',
      params: { concept: byId.get(conceptId)?.label ?? '', relationship: relationLabels.get(gap.relationId) ?? '', count: gap.count },
      impact: { rows: gap.count }, examples: [],
      fix: { kind: 'check_links', relationId: gap.relationId }, secondary: { kind: 'view_records', conceptId },
    });
  }
  // A concept whose rows the run counted reports these itself (with examples); the AI limit is told once, as that limit.
  const explainedByRun = (conceptId: string, kind: string) => {
    const report = reports[conceptId];
    if (!report) return false;
    if (kind === 'budget_exhausted') return report.findings.some((finding) => finding.kind === 'ai_row_limit');
    return ['missing_identity', 'identity_too_coarse', 'conflicting_values'].includes(kind);
  };
  for (const gap of gaps.other) {
    const conceptId = gap.conceptId;
    if (!conceptId || !conceptIds.has(conceptId) || FIELD_NOT_FOUND.has(gap.kind) || explainedByRun(conceptId, gap.kind)) continue;
    const concept = byId.get(conceptId)?.label ?? '';
    const base = { conceptId, params: { concept, count: gap.count }, impact: { rows: gap.count }, examples: [] as HealthExample[] };
    const id = `${conceptId}:${gap.kind}`;
    if (gap.kind === 'missing_identity') {
      add({ ...base, id, kind: 'rows_without_key', cause: 'mapping', severity: 'warning', fix: { kind: 'open_sources', conceptId }, secondary: { kind: 'view_records', conceptId } });
    } else if (gap.kind === 'conflicting_values') {
      add({ ...base, id, kind: 'values_disagree', cause: 'values', severity: 'warning', fix: { kind: 'choose_unique_field', conceptId }, secondary: { kind: 'view_records', conceptId } });
    } else if (gap.kind === 'ai_extraction_unavailable') {
      add({ ...base, id, kind: 'extraction_failed', cause: 'mapping', severity: 'warning', fix: { kind: 'open_sources', conceptId } });
    } else if (DOCUMENT_NOT_READ.has(gap.kind)) {
      add({ ...base, id, kind: 'documents_not_read', cause: 'mapping', severity: 'blocked', fix: { kind: 'open_sources', conceptId } });
    } else if (READING_LIMIT.has(gap.kind)) {
      add({ ...base, id, kind: 'reading_limit', cause: 'limit', severity: 'warning', fix: { kind: 'open_run_limits' }, secondary: { kind: 'view_records', conceptId } });
    } else if (gap.kind !== 'identity_too_coarse') {
      add({ ...base, id, kind: 'other_gap', cause: 'values', severity: 'info', secondary: { kind: 'view_records', conceptId } });
    }
  }

  // A concept made from a broken one can only be as good as its source: the problem is fixed upstream.
  const own = new Map([...issues].map(([conceptId, list]) => [conceptId, list.filter((issue) => issue.severity !== 'info')]));
  for (const concept of records.specification.concepts) {
    let upstream = derivedFrom.get(concept.conceptId);
    for (let depth = 0; upstream && depth < input.derived.length; depth += 1) {
      if (own.get(upstream)?.length) break;
      upstream = derivedFrom.get(upstream);
    }
    if (!upstream || !own.get(upstream)?.length) continue;
    const root = byId.get(upstream)?.label ?? '';
    add({
      id: `${concept.conceptId}:inherited`, conceptId: concept.conceptId, kind: 'inherited', cause: 'design', severity: 'warning',
      params: { concept: concept.label, upstream: root }, impact: {}, examples: [], upstreamConceptId: upstream,
      fix: { kind: 'go_to_concept', conceptId: upstream }, secondary: { kind: 'view_records', conceptId: concept.conceptId },
    });
  }

  const concepts = records.specification.concepts.map((concept): HealthConcept => {
    const list = (issues.get(concept.conceptId) ?? []).sort((left, right) => RANK[left.severity] - RANK[right.severity]);
    const report = reports[concept.conceptId];
    const sources = input.sources.get(concept.conceptId);
    const parent = derivedFrom.get(concept.conceptId);
    const made = counts[concept.conceptId] ?? report?.recordsMade ?? 0;
    const status: HealthStatus = list[0]?.severity ?? 'healthy';
    const journey = journeyOf(report, made, Boolean(parent));
    return {
      conceptId: concept.conceptId, label: concept.label, status,
      origin: parent ? { kind: 'derived', sources: [], fromConceptId: parent }
        : { kind: report ? 'sheet' : sources?.kind ?? 'document', sources: unique([...(report?.sources.map((source) => source.sheet ? `${source.name ?? ''} › ${source.sheet}` : source.name ?? '') ?? []), ...(sources?.names ?? [])]) },
      keyFields: (report?.keyFields ?? []).map((key) => ({ key, label: fieldLabel(concept.conceptId, key) })),
      journey,
      keepRatio: journey.rowsRead ? Math.min(1, made / journey.rowsRead) : null,
      issues: list,
    };
  }).sort((left, right) => RANK[left.status] - RANK[right.status] || left.label.localeCompare(right.label));

  const all = concepts.flatMap((concept) => concept.issues);
  const lead: HealthIssue | undefined = [...all].filter((issue) => issue.kind !== 'inherited').sort((left, right) =>
    RANK[left.severity] - RANK[right.severity] || (right.impact.rows ?? 0) - (left.impact.rows ?? 0)).at(0);
  const sheetConcepts = concepts.filter((concept) => concept.origin.kind === 'sheet');
  return {
    state: 'ready',
    dataRevisionId: records.dataRevisionId,
    verdict: lead ? { conceptId: lead.conceptId, issueId: lead.id, kind: lead.kind, params: lead.params } : null,
    summary: {
      concepts: concepts.length,
      healthy: concepts.filter((concept) => concept.status === 'healthy').length,
      rowsRead: sheetConcepts.reduce((total, concept) => total + (concept.journey.rowsRead ?? 0), 0),
      recordsKept: concepts.reduce((total, concept) => total + concept.journey.recordsMade, 0),
      fixesNeeded: all.filter((issue) => issue.severity !== 'info' && issue.kind !== 'inherited').length,
      limits: all.filter((issue) => issue.cause === 'limit').length,
      setupItems: setup.length,
    },
    concepts,
    setup,
  };
}

/** A model with no data to read yet: only the setup items apply. */
export function emptyModelHealth(setup: ReviewQueueItem[]): ModelHealth {
  return {
    state: 'no_data', dataRevisionId: null, verdict: null, concepts: [], setup,
    summary: { concepts: 0, healthy: 0, rowsRead: 0, recordsKept: 0, fixesNeeded: 0, limits: 0, setupItems: setup.length },
  };
}

function journeyOf(report: RuntimeConceptHealth | undefined, made: number, derived: boolean): HealthJourney {
  if (!report) return { unit: 'rows', rowsAvailable: null, rowsRead: null, recordsMade: made, dropped: [] };
  const dropped = report.dropped.filter((item): item is HealthJourney['dropped'][number] =>
    ['missing_identity', 'ai_limit', 'same_key', 'run_cap'].includes(item.reason) && item.rows > 0);
  return {
    unit: derived ? 'records' : 'rows', rowsAvailable: report.rowsAvailable, rowsRead: report.rowsRead, recordsMade: made, dropped,
    ...(report.ai ? { ai: { read: report.ai.rowsRead, limit: report.ai.limit, limited: report.ai.rowsLimited } } : {}),
  };
}

function unique(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}
