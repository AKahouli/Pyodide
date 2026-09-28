import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isObjectId, newObjectId, normalizeObjectId, stripNul } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import type {
  FlowReplayPostRunEvaluation,
  FlowReplayRunReport,
  ReplayRunVerdict,
} from '../interfaces/playbook-flow-replay-run-report.interface';
import type { ReplayMode } from '../interfaces/playbook-flow-validated-replay.interface';

const t = schema.playbookReplayRunReports;
type ReportRow = typeof t.$inferSelect;
type Json = Record<string, unknown>;

/**
 * A playbook.replay_run_reports row as the module's report document, plus its id and timestamps. Keys a
 * legacy document stored outside the schema (the removed eligibility gate) come back as they are.
 */
export type FlowReplayRunReportRecord = FlowReplayRunReport & { id: string; createdAt: Date; updatedAt: Date };

export type NewReplayRunReport = Partial<FlowReplayRunReport>
  & Pick<FlowReplayRunReport, 'executionId' | 'flowId' | 'taskId' | 'replayId' | 'validationVersion' | 'mode'>;

/** Top-level fields overwritten as a whole (Mongo's `$set`). */
export type ReplayRunReportPatch = Partial<FlowReplayRunReport>;

export interface ReplayRunReportLookupFilter {
  executionId: string;
  taskId: string;
  iteration?: number;
  replayId?: string;
  validationVersion?: number;
}

export interface ReplayRunReportListQuery {
  flowId: string;
  taskId: string;
  executionId?: string;
  iteration?: number;
  limit: number;
  offset: number;
}

const PENDING_SIGNAL = { status: 'not_evaluated', reason: 'evaluation_pending' } as const;

/** The Mongoose defaults of the `doc` fields: written on insert, and filled in by the JSON view like a hydrated document. */
function docDefaults(): Json {
  return {
    outputContractEvaluated: false,
    outputContractPassed: false,
    structuralDriftScore: null,
    toolPolicyScore: null,
    verdictReasons: [],
    structuralDriftReasons: [],
    semanticMatch: null,
    matchedBaselineId: null,
    matchedBaselineVersion: null,
    intentKey: null,
    replayConfidence: null,
    toolSequenceMatch: null,
    argumentShapeMatch: null,
    reasoningMatch: null,
    outputFormatMatch: null,
    contextDrift: null,
    dataDrift: null,
    driftFindings: [],
    blockedBy: [],
    expectedToolSteps: [],
    observedToolCalls: [],
    toolCallComparisons: [],
    instantiatedSemanticChecklist: [],
    intentStatus: { ...PENDING_SIGNAL },
    reasoningStatus: { ...PENDING_SIGNAL },
    toolSequenceStatus: { ...PENDING_SIGNAL },
    argumentShapeStatus: { ...PENDING_SIGNAL },
    outputContractStatus: { ...PENDING_SIGNAL },
    semanticStatus: { ...PENDING_SIGNAL },
    contextSubstitutionStatus: { ...PENDING_SIGNAL },
    postRunEvaluation: null,
    hitlSummary: null,
  };
}

/** Every `doc` field of the schema; anything else is dropped on write, as Mongoose's strict mode did. */
const REPLAY_RUN_REPORT_DOC_KEYS: ReadonlySet<string> = new Set(Object.keys(docDefaults()));

function pickDoc(fields: Json): Json {
  const out: Json = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && REPLAY_RUN_REPORT_DOC_KEYS.has(key)) out[key] = value;
  }
  return stripNul(out);
}

function reviveDate(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date;
}

/** jsonb keeps `postRunEvaluation.evaluatedAt` as an ISO string; the document had a Date. */
function revivePostRunEvaluation(value: unknown): FlowReplayPostRunEvaluation | null {
  if (!value || typeof value !== 'object') return null;
  const evaluation = value as FlowReplayPostRunEvaluation;
  return { ...evaluation, evaluatedAt: reviveDate(evaluation.evaluatedAt) as Date };
}

function num(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function int(value: number | null | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

/** A soft reference: kept as given, lower-cased when it is an ObjectId. */
function softRef(value: string): string {
  return isObjectId(value) ? normalizeObjectId(value) : value;
}

/**
 * The row as the report document, like a lean read: `doc` as stored (legacy keys included), the
 * promoted columns on top.
 */
export function toReplayRunReportRecord(row: ReportRow): FlowReplayRunReportRecord {
  const doc = (row.doc ?? {}) as Json;
  return {
    ...doc,
    ...('postRunEvaluation' in doc ? { postRunEvaluation: revivePostRunEvaluation(doc.postRunEvaluation) } : {}),
    id: row.id,
    executionId: row.executionId,
    flowId: row.flowId,
    taskId: row.taskId,
    iteration: row.iteration,
    replayId: row.replayId,
    validationVersion: row.validationVersion,
    mode: row.mode as ReplayMode,
    verdict: row.verdict as ReplayRunVerdict | null,
    overallScore: row.overallScore,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  } as FlowReplayRunReportRecord;
}

/** What a hydrated Mongo document showed, and its toJSON() returned: the schema defaults for the fields a stored document misses. */
export function toReplayRunReportJson(record: FlowReplayRunReportRecord): FlowReplayRunReportRecord {
  return { ...docDefaults(), ...record } as FlowReplayRunReportRecord;
}

/** The promoted columns a patch writes; the other fields go to `doc`. */
function columnsOf(patch: ReplayRunReportPatch): Partial<typeof t.$inferInsert> {
  const out: Partial<typeof t.$inferInsert> = {};
  if (patch.executionId !== undefined) out.executionId = softRef(patch.executionId);
  if (patch.flowId !== undefined) out.flowId = normalizeObjectId(patch.flowId);
  if (patch.taskId !== undefined) out.taskId = patch.taskId;
  if (patch.iteration !== undefined) out.iteration = int(patch.iteration, 0);
  if (patch.replayId !== undefined) out.replayId = softRef(patch.replayId);
  if (patch.validationVersion !== undefined) out.validationVersion = int(patch.validationVersion, 0);
  if (patch.mode !== undefined) out.mode = patch.mode;
  if (patch.verdict !== undefined) out.verdict = patch.verdict;
  if (patch.overallScore !== undefined) out.overallScore = num(patch.overallScore);
  return out;
}

/**
 * PostgreSQL playbook.replay_run_reports repository (roadmap P5). The report body lives in `doc`; the
 * columns are what reports are looked up and sorted by. `execution_id` and `replay_id` are soft
 * references: a report outlives the run and the baseline it compared.
 */
@Injectable()
export class ReplayRunReportRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  /** Inserts a report with the schema defaults; unknown fields are dropped. The flow must exist. */
  async create(input: NewReplayRunReport): Promise<FlowReplayRunReportRecord> {
    if (!isObjectId(input.flowId)) throw new Error('Replay run report flowId must be a 24-char hex id');
    const [row] = await this.q
      .insert(t)
      .values({
        ...columnsOf(input),
        id: newObjectId(),
        executionId: softRef(input.executionId),
        flowId: normalizeObjectId(input.flowId),
        iteration: int(input.iteration, 0),
        doc: { ...docDefaults(), ...pickDoc(input as Json) },
      } as typeof t.$inferInsert)
      .returning();
    return toReplayRunReportRecord(row);
  }

  async findById(id: string): Promise<FlowReplayRunReportRecord | null> {
    if (!isObjectId(id)) return null;
    const [row] = await this.q.select().from(t).where(eq(t.id, normalizeObjectId(id))).limit(1);
    return row ? toReplayRunReportRecord(row) : null;
  }

  /** The newest report matching the filter (an absent key does not filter). */
  async findLatest(filter: ReplayRunReportLookupFilter): Promise<FlowReplayRunReportRecord | null> {
    const [row] = await this.q
      .select()
      .from(t)
      .where(and(
        eq(t.executionId, softRef(filter.executionId)),
        eq(t.taskId, filter.taskId),
        filter.iteration !== undefined ? eq(t.iteration, int(filter.iteration, 0)) : undefined,
        filter.replayId !== undefined ? eq(t.replayId, softRef(filter.replayId)) : undefined,
        filter.validationVersion !== undefined ? eq(t.validationVersion, int(filter.validationVersion, 0)) : undefined,
      ))
      .orderBy(desc(t.createdAt), desc(t.id))
      .limit(1);
    return row ? toReplayRunReportRecord(row) : null;
  }

  /** A task's reports, newest first. */
  async list(query: ReplayRunReportListQuery): Promise<FlowReplayRunReportRecord[]> {
    if (!isObjectId(query.flowId)) return [];
    const rows = await this.q
      .select()
      .from(t)
      .where(and(
        eq(t.flowId, normalizeObjectId(query.flowId)),
        eq(t.taskId, query.taskId),
        query.executionId !== undefined ? eq(t.executionId, softRef(query.executionId)) : undefined,
        query.iteration !== undefined ? eq(t.iteration, int(query.iteration, 0)) : undefined,
      ))
      .orderBy(desc(t.createdAt), desc(t.id))
      .offset(Math.max(0, Math.trunc(query.offset)))
      .limit(Math.max(0, Math.trunc(query.limit)));
    return rows.map(toReplayRunReportRecord);
  }

  /** For each replay, the overall score of its newest report (absent when that report has none). */
  async latestScoresForReplays(replayIds: readonly string[]): Promise<Map<string, number>> {
    const ids = [...new Set(replayIds.map(softRef))];
    if (ids.length === 0) return new Map();
    const rows = await this.q
      .selectDistinctOn([t.replayId], { replayId: t.replayId, overallScore: t.overallScore })
      .from(t)
      .where(inArray(t.replayId, ids))
      .orderBy(t.replayId, desc(t.createdAt), desc(t.id));
    const scores = new Map<string, number>();
    for (const row of rows) {
      if (typeof row.overallScore === 'number') scores.set(row.replayId, row.overallScore);
    }
    return scores;
  }

  /** Overwrites the given top-level fields. False when the report does not exist. */
  async update(id: string, patch: ReplayRunReportPatch): Promise<boolean> {
    if (!isObjectId(id)) return false;
    const doc = pickDoc(patch as Json);
    const rows = await this.q
      .update(t)
      .set({
        ...columnsOf(patch),
        ...(Object.keys(doc).length > 0 ? { doc: sql`${t.doc} || ${JSON.stringify(doc)}::jsonb` } : {}),
        updatedAt: new Date(),
      })
      .where(eq(t.id, normalizeObjectId(id)))
      .returning({ id: t.id });
    return rows.length > 0;
  }

  /**
   * Stores the post-run evaluation unless the report already has one: the first evaluation wins. False
   * when the report is gone or already evaluated.
   */
  async setPostRunEvaluationIfAbsent(id: string, evaluation: FlowReplayPostRunEvaluation): Promise<boolean> {
    if (!isObjectId(id)) return false;
    const rows = await this.q
      .update(t)
      .set({
        doc: sql`${t.doc} || jsonb_build_object('postRunEvaluation', ${JSON.stringify(stripNul(evaluation))}::jsonb)`,
        updatedAt: new Date(),
      })
      .where(and(eq(t.id, normalizeObjectId(id)), sql`jsonb_typeof(${t.doc} -> 'postRunEvaluation') IS DISTINCT FROM 'object'`) as SQL)
      .returning({ id: t.id });
    return rows.length > 0;
  }
}
