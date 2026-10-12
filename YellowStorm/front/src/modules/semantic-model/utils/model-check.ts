import type { ModelCheck, ModelCheckIssue } from '../types';

type Translate = (key: string | string[], options?: Record<string, unknown>) => string;

export type CheckSeverity = ModelCheckIssue['severity'];
export type CheckTargetKind = 'concept' | 'relation' | 'mapping' | 'source' | 'model';

/** Where an issue is fixed: a link or a derived source when it names one, else the relation, else the concept. */
export function checkTarget(issue: ModelCheckIssue): { kind: CheckTargetKind; id: string } {
  if (issue.mappingId) return { kind: 'mapping', id: issue.mappingId };
  if (issue.sourceId) return { kind: 'source', id: issue.sourceId };
  if (issue.relationId) return { kind: 'relation', id: issue.relationId };
  if (issue.conceptId) return { kind: 'concept', id: issue.conceptId };
  return { kind: 'model', id: '' };
}

const rank = (severity: CheckSeverity) => (severity === 'error' ? 0 : 1);

/** Errors before warnings; the order the model check returned them in is kept inside each. */
export const sortIssues = (issues: readonly ModelCheckIssue[]): ModelCheckIssue[] =>
  issues.map((issue, index) => ({ issue, index })).sort((a, b) => rank(a.issue.severity) - rank(b.issue.severity) || a.index - b.index).map(({ issue }) => issue);

export const worstSeverity = (issues: readonly ModelCheckIssue[]): CheckSeverity | null =>
  issues.length ? (issues.some((issue) => issue.severity === 'error') ? 'error' : 'warning') : null;

export interface CheckGroup {
  kind: CheckTargetKind;
  id: string;
  severity: CheckSeverity;
  issues: ModelCheckIssue[];
}

const KIND_ORDER: CheckTargetKind[] = ['concept', 'relation', 'mapping', 'source', 'model'];

/** Issues grouped by the element they are fixed on, groups holding an error first. */
export function groupModelCheck(issues: readonly ModelCheckIssue[]): CheckGroup[] {
  const groups = new Map<string, CheckGroup>();
  for (const issue of sortIssues(issues)) {
    const { kind, id } = checkTarget(issue);
    const key = `${kind}:${id}`;
    const group = groups.get(key);
    if (group) group.issues.push(issue);
    else groups.set(key, { kind, id, severity: issue.severity, issues: [issue] });
  }
  return [...groups.values()].sort((a, b) => rank(a.severity) - rank(b.severity) || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
}

export interface ModelCheckIndex {
  /** Everything about a concept, its fields included, even when the issue is fixed on a link. */
  concepts: Record<string, ModelCheckIssue[]>;
  relations: Record<string, ModelCheckIssue[]>;
  /** By source link (mapping). */
  mappings: Record<string, ModelCheckIssue[]>;
  /** By derived source. */
  sources: Record<string, ModelCheckIssue[]>;
}

/** Issues by the id of each element they name, for badges drawn on the canvas. */
export function indexModelCheck(issues: readonly ModelCheckIssue[] | undefined): ModelCheckIndex {
  const index: ModelCheckIndex = { concepts: {}, relations: {}, mappings: {}, sources: {} };
  const add = (bucket: Record<string, ModelCheckIssue[]>, id: string | undefined, issue: ModelCheckIssue) => { if (id) (bucket[id] ??= []).push(issue); };
  for (const issue of sortIssues(issues ?? [])) {
    add(index.concepts, issue.conceptId, issue);
    add(index.relations, issue.relationId, issue);
    add(index.mappings, issue.mappingId, issue);
    add(index.sources, issue.sourceId, issue);
  }
  return index;
}

/** The sentence for an issue: the message of its code (refined by its reason), else the English text the server sent. */
export function issueText(t: Translate, issue: ModelCheckIssue): string {
  const keys = issue.reason ? [`check.${issue.code}.${issue.reason}`, `check.${issue.code}`] : [`check.${issue.code}`];
  // A missing value reads as nothing, not as a placeholder.
  return String(t(keys, { field: '', concept: '', detail: '', ...issue.params, defaultValue: issue.message })).trim();
}

/** Why Preview, Run and Publish are held back, or null when they are free; warnings never hold them back. */
export function checkBlockReason(check: ModelCheck | undefined, t: Translate): string | null {
  if (!check || check.errorCount <= 0) return null;
  const first = check.issues.find((issue) => issue.severity === 'error');
  const head = t('check.blocked', { count: check.errorCount });
  return first ? `${head} ${issueText(t, first)}` : head;
}
