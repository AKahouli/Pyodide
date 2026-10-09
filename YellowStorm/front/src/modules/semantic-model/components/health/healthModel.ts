import type { HealthAction, HealthCause, HealthConcept, HealthExample, HealthIssue, HealthStatus } from '../../types';

export type Translate = (key: string, options?: Record<string, unknown>) => string;

export const CAUSES: HealthCause[] = ['design', 'limit', 'mapping', 'values'];

/** What the rail and the card say about a concept: a concept with only inherited problems reads "Inherited". */
export type HealthBadge = HealthStatus | 'inherited';

export function badgeOf(concept: HealthConcept): HealthBadge {
  const urgent = concept.issues.filter((issue) => issue.severity !== 'info');
  return urgent.length > 0 && urgent.every((issue) => issue.kind === 'inherited') ? 'inherited' : concept.status;
}

/** Tailwind classes for each status, from the app's semantic and status colors. */
export const STATUS_CLASSES: Record<HealthBadge, { dot: string; badge: string; ring: string; bar: string }> = {
  blocked: { dot: 'bg-destructive', badge: 'border-destructive/50 text-destructive', ring: 'border-destructive', bar: 'bg-destructive' },
  warning: { dot: 'bg-amber-500', badge: 'border-amber-500/50 text-amber-700 dark:text-amber-400', ring: 'border-amber-500', bar: 'bg-amber-500' },
  inherited: { dot: 'bg-amber-500', badge: 'border-amber-500/50 text-amber-700 dark:text-amber-400', ring: 'border-amber-500', bar: 'bg-amber-500' },
  info: { dot: 'bg-sky-500', badge: 'border-sky-500/50 text-sky-700 dark:text-sky-400', ring: 'border-sky-500', bar: 'bg-sky-500' },
  healthy: { dot: 'bg-emerald-500', badge: 'border-emerald-500/50 text-emerald-700 dark:text-emerald-400', ring: 'border-emerald-500', bar: 'bg-emerald-500' },
};

export const CAUSE_CLASSES: Record<HealthCause, string> = {
  design: 'bg-red-500/10 text-red-700 dark:text-red-300',
  limit: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  mapping: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  values: 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
};

export const formatNumber = (value: number) => value.toLocaleString();

/** Numbers read with thousands separators in every sentence; text is left as it is. */
export function readable(params: Record<string, string | number>): Record<string, string> {
  return Object.fromEntries(Object.entries(params).map(([key, value]) => [key, typeof value === 'number' ? formatNumber(value) : value]));
}

/** "99,900 rows → 3 records": the line under a concept in the list. */
export function flowLine(concept: HealthConcept, translate: Translate): string {
  const { journey } = concept;
  if (journey.rowsRead === null) return translate('health.flow.records', { records: formatNumber(journey.recordsMade) });
  const rows = formatNumber(journey.rowsAvailable ?? journey.rowsRead);
  const records = formatNumber(journey.recordsMade);
  if (journey.ai && journey.ai.limited > 0) return translate('health.flow.aiToRecords', { rows, ai: formatNumber(journey.ai.read), records });
  return translate(journey.unit === 'records' ? 'health.flow.recordsToRecords' : 'health.flow.rowsToRecords', { rows, records });
}

/** Where an example row came from: "participants · row 2", or the record it was made from. */
export function exampleWhere(example: HealthExample, translate: Translate): string {
  const place = example.sheet ?? example.source ?? '';
  const row = example.row === undefined ? '' : translate('health.example.row', { row: String(example.row) });
  const record = example.record ? translate('health.example.record', { record: example.record }) : '';
  return [place, row || record].filter(Boolean).join(' · ');
}

export function exampleWhat(example: HealthExample): string {
  return Object.entries(example.values).map(([label, value]) => `${label}: ${value}`).join(' · ');
}

export interface IssueTexts {
  title: string;
  why: string;
  impact: string;
  forecast?: string;
  fix: string;
  primary?: string;
  secondary?: string;
  breakdownTitle?: string;
  examplesTitle?: string;
}

export function actionLabel(action: HealthAction, translate: Translate, concepts: HealthConcept[], suggested: boolean): string {
  if (action.kind === 'go_to_concept') {
    return translate('health.action.go_to_concept', { concept: concepts.find((concept) => concept.conceptId === action.conceptId)?.label ?? '' });
  }
  return translate(action.kind === 'choose_unique_field' && suggested ? 'health.action.choose_unique_field_suggested' : `health.action.${action.kind}`);
}

/** Every sentence of an issue card, from its kind and the business words the back end filled in. */
export function issueTexts(issue: HealthIssue, translate: Translate, concepts: HealthConcept[]): IssueTexts {
  const params = readable(issue.params);
  const base = `health.issue.${issue.kind}`;
  const whyKey = issue.kind === 'rows_without_key' ? `${base}.${issue.params.ai === 1 ? 'whyAi' : 'whyMapping'}`
    : issue.kind === 'missing_values' ? `${base}.${issue.params.required === 1 ? 'whyRequired' : 'whyOptional'}` : `${base}.why`;
  const suggested = Boolean(issue.fix?.kind === 'choose_unique_field' && issue.fix.suggestedFields?.length);
  const upstream = issue.upstreamConceptId ? concepts.find((concept) => concept.conceptId === issue.upstreamConceptId)?.label ?? '' : '';
  const fixParams = { ...params, concept: upstream || params.concept };
  const fix = issue.fix ? translate(issue.fix.kind === 'choose_unique_field' && suggested ? 'health.fix.choose_unique_field_suggested' : `health.fix.${issue.fix.kind}`, fixParams) : '';
  const forecast = issue.kind === 'inherited' ? translate('health.forecast.inherited')
    : issue.forecast ? translate('health.forecast.records', { records: formatNumber(issue.forecast.records) })
      : issue.kind === 'ai_row_limit' ? translate('health.forecast.aiCalls', { calls: params.left }) : undefined;
  return {
    title: translate(`${base}.title`, params),
    why: translate(whyKey, { ...params, concept: params.concept || upstream, upstream }),
    impact: translate(`${base}.impact`, { ...params, ...readable(Object.fromEntries(Object.entries(issue.impact).filter(([, value]) => value !== undefined)) as Record<string, number>), upstream }),
    forecast,
    fix,
    primary: issue.fix ? actionLabel(issue.fix, translate, concepts, suggested) : undefined,
    secondary: issue.secondary ? actionLabel(issue.secondary, translate, concepts, false) : undefined,
    breakdownTitle: issue.breakdown ? translate(`${base}.breakdown`, params) : undefined,
    examplesTitle: issue.examples.length > 0 ? translate(`${base}.examples`, params) : undefined,
  };
}
