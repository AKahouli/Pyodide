import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isObjectId, newObjectId, normalizeObjectId, stripNul, withTransaction } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import type { FlowToolTraceItem } from '../interfaces/playbook-flow-observability.interface';
import {
  FlowReplayValidationMode,
  FlowReplayValidationStatus,
  serializeReplayMode,
  type FlowReplayConfig,
  type FlowReplayToolCall,
  type FlowValidatedReplay,
} from '../interfaces/playbook-flow-validated-replay.interface';

const r = schema.playbookValidatedReplays;
type ReplayRow = typeof r.$inferSelect;
type Json = Record<string, unknown>;

/** A playbook.validated_replays row as the module's replay document, plus its id and timestamps. */
export type FlowValidatedReplayRecord = FlowValidatedReplay & { id: string; createdAt: Date; updatedAt: Date };

/** A new baseline; `validationVersion` is allocated by createNextVersion. */
export type NewValidatedReplay = Partial<Omit<FlowValidatedReplay, 'toolCalls' | 'validationVersion'>>
  & Pick<FlowValidatedReplay, 'flowId' | 'taskId' | 'iteration' | 'taskTitle' | 'createdBy' | 'referenceExecutionId' | 'referenceExecutionNumber'>
  & { toolCalls?: Array<FlowReplayToolCall | FlowToolTraceItem> };

/** Whole-field overwrites (Mongo's `$set` of top-level keys); `replayConfig` is merged key by key. */
export type ValidatedReplayPatch = Partial<Omit<FlowValidatedReplay, 'replayConfig'
  | 'flowId' | 'taskId' | 'iteration' | 'validationVersion' | 'createdBy' | 'referenceExecutionId' | 'referenceExecutionNumber'>>
  & { replayConfig?: Partial<FlowReplayConfig> };

export interface ReplayIdentity {
  id: string;
  flowId: string;
  taskId: string;
  validationVersion: number;
}

const REPLAY_CONFIG_DEFAULT: FlowReplayConfig = { replayOutputFormat: false, replayToolTrace: false, replayReasoningChain: true };

/** The Mongoose defaults of the `doc` fields: written on insert, and filled in by the JSON view like a hydrated document. */
function docDefaults(): Json {
  return {
    referenceTaskDescription: '',
    referenceWorkspaceIds: [],
    agentName: '',
    toolCalls: [],
    reasoningChain: [],
    preserveOutputFormat: false,
    formatGuideStatus: 'disabled',
    llmPromptTrace: [],
    fingerprints: null,
    behaviorBaseline: null,
    toolPolicy: null,
    outputContract: null,
    intentKey: null,
    intentLabel: '',
    reasoningOutline: [],
    stableReasoningRules: [],
    contextVariableSchema: [],
    toolTraceTemplate: [],
    driftPolicy: null,
    acceptedExamples: [],
    semanticChecklist: [],
    hitlMemorySnapshots: [],
    referenceUsage: null,
    referenceSemanticMatch: null,
    traceMetadata: {},
    referenceNodeSnapshot: null,
    staleReasons: [],
    replayConfig: { ...REPLAY_CONFIG_DEFAULT },
  };
}

/** `doc` fields without a default: stored only once set. */
const OPTIONAL_DOC_KEYS = ['referenceAssignedAgentId', 'referenceOutput', 'outputFormatGuide', 'formatGuideError', 'referenceFlowRevision'];
/** Every `doc` field of the schema; anything else is dropped on write, as Mongoose's strict mode did. */
const VALIDATED_REPLAY_DOC_KEYS: ReadonlySet<string> = new Set([...Object.keys(docDefaults()), ...OPTIONAL_DOC_KEYS]);

const TOOL_CALL_KEYS = ['callIndex', 'toolName', 'args', 'outputSummary', 'status', 'durationMs', 'error'] as const;

/** The FlowReplayToolCall subdocument cast: its keys only, with their defaults (a tool trace item also carries `purpose`). */
function castToolCall(call: FlowReplayToolCall | FlowToolTraceItem): Json {
  const source = call as unknown as Json;
  const out: Json = { args: {}, status: null, durationMs: null, error: null };
  for (const key of TOOL_CALL_KEYS) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

function pickDoc(fields: Json): Json {
  const out: Json = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || !VALIDATED_REPLAY_DOC_KEYS.has(key)) continue;
    out[key] = key === 'toolCalls' && Array.isArray(value) ? value.map((call) => castToolCall(call as FlowReplayToolCall)) : value;
  }
  return stripNul(out);
}

function replayConfigOf(value: unknown): FlowReplayConfig {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...REPLAY_CONFIG_DEFAULT, ...(value as Partial<FlowReplayConfig>) }
    : { ...REPLAY_CONFIG_DEFAULT };
}

/**
 * The row as the replay document, like a lean read: `doc` as stored (a legacy document may miss the
 * fields added since), the promoted columns on top.
 */
export function toValidatedReplayRecord(row: ReplayRow): FlowValidatedReplayRecord {
  const doc = (row.doc ?? {}) as Json;
  const record = {
    ...doc,
    id: row.id,
    flowId: row.flowId,
    taskId: row.taskId,
    iteration: row.iteration,
    taskTitle: row.taskTitle,
    createdBy: row.createdBy,
    referenceExecutionId: row.referenceExecutionId,
    referenceExecutionNumber: row.referenceExecutionNumber,
    validationVersion: row.validationVersion,
    status: row.status as FlowReplayValidationStatus,
    mode: row.mode as FlowReplayValidationMode,
    isStale: row.isStale,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  } as FlowValidatedReplayRecord;
  // Mongo had no key until a label was set.
  if (row.label !== null) record.label = row.label;
  return record;
}

/**
 * What a hydrated Mongo document showed, and its toJSON() returned: the schema defaults for the fields a
 * stored document misses, and the legacy `strict_replay` mode serialised as `replay_strict`.
 */
export function toValidatedReplayJson(record: FlowValidatedReplayRecord): FlowValidatedReplayRecord {
  return {
    ...docDefaults(),
    ...record,
    replayConfig: replayConfigOf(record.replayConfig),
    mode: serializeReplayMode(record.mode),
  } as FlowValidatedReplayRecord;
}

/** A soft reference: kept as given, lower-cased when it is an ObjectId. */
function softRef(value: string): string {
  return isObjectId(value) ? normalizeObjectId(value) : value;
}

/**
 * PostgreSQL playbook.validated_replays repository (roadmap P5). The template body lives in `doc`; the
 * columns are what the replay services filter and sort on. `reference_execution_id` is a soft reference:
 * a baseline outlives the run it was validated from.
 */
@Injectable()
export class ValidatedReplayRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  private inTask(flowId: string, taskId: string): SQL {
    return and(eq(r.flowId, normalizeObjectId(flowId)), eq(r.taskId, taskId)) as SQL;
  }

  /**
   * Validates a new baseline for (flow, task): allocates the next validation version, inserts the replay
   * active and marks the previously latest version inactive, in one transaction serialised per task so two
   * validations never draw the same version.
   */
  async createNextVersion(input: NewValidatedReplay): Promise<FlowValidatedReplayRecord> {
    if (!isObjectId(input.flowId)) throw new Error('Validated replay flowId must be a 24-char hex id');
    const flowId = normalizeObjectId(input.flowId);
    const { flowId: _flowId, taskId, iteration, taskTitle, createdBy, referenceExecutionId, referenceExecutionNumber, status, mode, isStale, label, ...fields } = input;
    return withTransaction(this.db, async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`playbook.validated-replay:${flowId}:${taskId}`}, 0))`);
      const [last] = await tx
        .select({ id: r.id, validationVersion: r.validationVersion })
        .from(r)
        .where(this.inTask(flowId, taskId))
        .orderBy(desc(r.validationVersion), desc(r.createdAt), asc(r.id))
        .limit(1);
      const [row] = await tx
        .insert(r)
        .values({
          id: newObjectId(),
          flowId,
          taskId,
          iteration: Math.trunc(iteration),
          taskTitle: stripNul(taskTitle),
          createdBy: softRef(createdBy),
          referenceExecutionId: softRef(referenceExecutionId),
          referenceExecutionNumber: Math.trunc(referenceExecutionNumber),
          validationVersion: (last?.validationVersion ?? 0) + 1,
          status: status ?? FlowReplayValidationStatus.ACTIVE,
          mode: mode ?? FlowReplayValidationMode.STRICT,
          isStale: isStale ?? false,
          label: label == null ? null : stripNul(label),
          doc: { ...docDefaults(), ...pickDoc(fields as Json) },
        })
        .returning();
      if (last) {
        await tx.update(r).set({ status: FlowReplayValidationStatus.INACTIVE, updatedAt: new Date() }).where(eq(r.id, last.id));
      }
      return toValidatedReplayRecord(row);
    });
  }

  /** The task's baselines, latest version first. */
  async listByTask(flowId: string, taskId: string): Promise<FlowValidatedReplayRecord[]> {
    if (!isObjectId(flowId)) return [];
    const rows = await this.q.select().from(r).where(this.inTask(flowId, taskId)).orderBy(desc(r.validationVersion), desc(r.createdAt), asc(r.id));
    return rows.map(toValidatedReplayRecord);
  }

  async findInTask(id: string, flowId: string, taskId: string): Promise<FlowValidatedReplayRecord | null> {
    if (!isObjectId(id) || !isObjectId(flowId)) return null;
    const [row] = await this.q.select().from(r).where(and(eq(r.id, normalizeObjectId(id)), this.inTask(flowId, taskId))).limit(1);
    return row ? toValidatedReplayRecord(row) : null;
  }

  /** A baseline by the identity a replay report recorded, whatever its status now. */
  async findByIdentity(identity: ReplayIdentity): Promise<FlowValidatedReplayRecord | null> {
    if (!isObjectId(identity.id) || !isObjectId(identity.flowId)) return null;
    const [row] = await this.q
      .select()
      .from(r)
      .where(and(
        eq(r.id, normalizeObjectId(identity.id)),
        this.inTask(identity.flowId, identity.taskId),
        eq(r.validationVersion, Math.trunc(identity.validationVersion)),
      ))
      .limit(1);
    return row ? toValidatedReplayRecord(row) : null;
  }

  /** The task's active baseline (the oldest one if several are active, as Mongo's natural order returned). */
  async findActive(flowId: string, taskId: string): Promise<FlowValidatedReplayRecord | null> {
    if (!isObjectId(flowId)) return null;
    const [row] = await this.q
      .select()
      .from(r)
      .where(and(this.inTask(flowId, taskId), eq(r.status, FlowReplayValidationStatus.ACTIVE)))
      .orderBy(asc(r.createdAt), asc(r.id))
      .limit(1);
    return row ? toValidatedReplayRecord(row) : null;
  }

  /** The active baselines of the given tasks, oldest first (a caller keying them by task keeps the newest). */
  async listActiveForTasks(flowId: string, taskIds: readonly string[]): Promise<FlowValidatedReplayRecord[]> {
    if (!isObjectId(flowId) || taskIds.length === 0) return [];
    const rows = await this.q
      .select()
      .from(r)
      .where(and(eq(r.flowId, normalizeObjectId(flowId)), inArray(r.taskId, [...taskIds]), eq(r.status, FlowReplayValidationStatus.ACTIVE)))
      .orderBy(asc(r.createdAt), asc(r.id));
    return rows.map(toValidatedReplayRecord);
  }

  /**
   * Makes `id` the task's only active baseline in one statement. Null (and nothing changed) when the
   * baseline is not one of the task's.
   */
  async activate(id: string, flowId: string, taskId: string): Promise<FlowValidatedReplayRecord | null> {
    if (!isObjectId(id) || !isObjectId(flowId)) return null;
    const target = normalizeObjectId(id);
    const flow = normalizeObjectId(flowId);
    const rows = await this.q
      .update(r)
      .set({
        status: sql`CASE WHEN ${r.id} = ${target} THEN 'active' ELSE 'inactive' END`,
        updatedAt: new Date(),
      })
      .where(and(
        this.inTask(flow, taskId),
        or(eq(r.id, target), eq(r.status, FlowReplayValidationStatus.ACTIVE)),
        sql`EXISTS (SELECT 1 FROM playbook.validated_replays AS target WHERE target.id = ${target} AND target.flow_id = ${flow} AND target.task_id = ${taskId})`,
      ))
      .returning();
    const updated = rows.find((row) => row.id === target);
    return updated ? toValidatedReplayRecord(updated) : null;
  }

  /** Overwrites the given fields of one of the task's baselines. Null when it is not one of the task's. */
  async update(id: string, flowId: string, taskId: string, patch: ValidatedReplayPatch): Promise<FlowValidatedReplayRecord | null> {
    if (!isObjectId(id) || !isObjectId(flowId)) return null;
    const { status, mode, isStale, label, taskTitle, replayConfig, ...fields } = patch;
    const docFields = pickDoc(fields as Json);
    let doc: SQL | undefined;
    if (Object.keys(docFields).length > 0) doc = sql`${r.doc} || ${JSON.stringify(docFields)}::jsonb`;
    if (replayConfig && Object.keys(replayConfig).length > 0) {
      const current = sql`CASE WHEN jsonb_typeof(${r.doc} -> 'replayConfig') = 'object' THEN ${JSON.stringify(REPLAY_CONFIG_DEFAULT)}::jsonb || (${r.doc} -> 'replayConfig') ELSE ${JSON.stringify(REPLAY_CONFIG_DEFAULT)}::jsonb END`;
      doc = sql`${doc ?? r.doc} || jsonb_build_object('replayConfig', ${current} || ${JSON.stringify(stripNul(replayConfig))}::jsonb)`;
    }
    const [row] = await this.q
      .update(r)
      .set({
        ...(status !== undefined ? { status } : {}),
        ...(mode !== undefined ? { mode } : {}),
        ...(isStale !== undefined ? { isStale } : {}),
        ...(label !== undefined ? { label: label === null ? null : stripNul(label) } : {}),
        ...(taskTitle !== undefined ? { taskTitle: stripNul(taskTitle) } : {}),
        ...(doc ? { doc } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(r.id, normalizeObjectId(id)), this.inTask(flowId, taskId)))
      .returning();
    return row ? toValidatedReplayRecord(row) : null;
  }

  /** Deletes one of the task's baselines; returns the status it had, or null when there was none. */
  async deleteInTask(id: string, flowId: string, taskId: string): Promise<{ status: FlowReplayValidationStatus } | null> {
    if (!isObjectId(id) || !isObjectId(flowId)) return null;
    const [row] = await this.q
      .delete(r)
      .where(and(eq(r.id, normalizeObjectId(id)), this.inTask(flowId, taskId)))
      .returning({ status: r.status });
    return row ? { status: row.status as FlowReplayValidationStatus } : null;
  }
}
