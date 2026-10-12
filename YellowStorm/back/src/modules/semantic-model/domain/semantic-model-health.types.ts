import type { ReviewQueueItem } from '../services/semantic-review-queue.service';

/** How serious a concept's problem is; `healthy` is a concept with none. */
export type HealthStatus = 'blocked' | 'warning' | 'info' | 'healthy';
export type HealthSeverity = Exclude<HealthStatus, 'healthy'>;

/** Who can change what is wrong: the model's design, a limit an admin set, the source or its mapping, or the values read. */
export type HealthCause = 'design' | 'limit' | 'mapping' | 'values';

export type HealthIssueKind =
  | 'identity_too_coarse'
  | 'rows_without_key'
  | 'ai_row_limit'
  | 'archive_reading'
  | 'values_disagree'
  | 'missing_values'
  | 'links_unmatched'
  | 'documents_not_read'
  | 'extraction_failed'
  | 'reading_limit'
  | 'inherited'
  | 'other_gap';

/** Where a person goes to act; applying one opens an existing editor, it never changes the model by itself. */
export type HealthAction =
  | { kind: 'choose_unique_field'; conceptId: string; suggestedFields?: string[] }
  | { kind: 'raise_ai_limit'; currentLimit: number; suggestedLimit?: number }
  | { kind: 'open_run_limits' }
  | { kind: 'open_sources'; conceptId: string }
  | { kind: 'fix_values'; conceptId: string; attribute: string }
  | { kind: 'check_links'; relationId: string }
  | { kind: 'go_to_concept'; conceptId: string }
  | { kind: 'view_records'; conceptId: string };

/** Where a row came from: the file, its sheet and the row (or the record it was made from). */
export interface HealthExample {
  source?: string;
  sheet?: string;
  row?: number | string;
  record?: string;
  /** Field label to the value read, a few fields at most. */
  values: Record<string, string>;
}

export interface HealthBreakdown {
  /** `key_values`: how many rows each value of the key holds. `ai_cost`: AI calls at each limit. `reading`: how many
   *  files of a mail table ended in each outcome (the label is the outcome's id, worded by the reader of the card). */
  kind: 'key_values' | 'ai_cost' | 'reading';
  items: { label: string; value: number; current?: boolean }[];
}

export interface HealthIssue {
  /** Stable for lists and for the person to come back to; never shown. */
  id: string;
  conceptId: string;
  kind: HealthIssueKind;
  cause: HealthCause;
  severity: HealthSeverity;
  /** Business words to fill the explanation (labels, names), never ids. */
  params: Record<string, string | number>;
  /** Figures the card quotes: rows concerned, of how many, values thrown away. */
  impact: { rows?: number; of?: number; values?: number };
  breakdown?: HealthBreakdown;
  examples: HealthExample[];
  /** Records the model would make with the suggested fix, an estimate from a sample of the rows. */
  forecast?: { records: number; estimated: boolean };
  /** The concept an inherited problem comes from. */
  upstreamConceptId?: string;
  fix?: HealthAction;
  secondary?: HealthAction;
}

export interface HealthJourney {
  /** `rows` of a sheet, `records` of another concept for a concept made from it. */
  unit: 'rows' | 'records';
  rowsAvailable: number | null;
  rowsRead: number | null;
  /** Rows the AI read, with the admin's limit; absent when no field is read with AI. */
  ai?: { read: number; limit: number; limited: number };
  recordsMade: number;
  dropped: { reason: 'missing_identity' | 'ai_limit' | 'same_key' | 'run_cap'; rows: number; field?: string }[];
}

export interface HealthConcept {
  conceptId: string;
  label: string;
  status: HealthStatus;
  /** Where its records come from: file names, or the concept it is made from. */
  origin: { kind: 'sheet' | 'document' | 'derived' | 'manual'; sources: string[]; fromConceptId?: string };
  keyFields: { key: string; label: string }[];
  journey: HealthJourney;
  /** Records made over rows read, for the bar; absent when the run did not count rows. */
  keepRatio: number | null;
  issues: HealthIssue[];
}

export interface ModelHealth {
  /** `no_data`: nothing has been prepared yet, only the setup items below apply. */
  state: 'ready' | 'no_data';
  dataRevisionId: string | null;
  /** The problem that explains the run best; absent when nothing needs a person. */
  verdict: { conceptId: string; issueId: string; kind: HealthIssueKind; params: Record<string, string | number> } | null;
  summary: {
    concepts: number;
    healthy: number;
    rowsRead: number;
    recordsKept: number;
    /** Problems a person has to fix (inherited ones are fixed upstream and not counted). */
    fixesNeeded: number;
    /** Choices an admin made (limits) that left data out. */
    limits: number;
    setupItems: number;
  };
  concepts: HealthConcept[];
  /** What stops or weakens the next run before any data is read: sources, unique fields, links, open decisions. */
  setup: ReviewQueueItem[];
}
