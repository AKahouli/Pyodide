import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, exists, ilike, inArray, like, or, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { escapeLike, isObjectId, newObjectId, normalizeObjectId, stripNul, withTransaction } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import type {
  AdvisorScoringMode,
  ControlEdge,
  DataBinding,
  FlowNode,
  FlowSettings,
  FlowTriggerConfig,
} from '../models/playbook-flow.model';
import { DEFAULT_HITL_POLICY, type HitlBlockerRule, type HitlPolicy } from '../models/playbook-flow-hitl.model';
import {
  DEFAULT_DESIGN_SETTINGS,
  DEFAULT_FLOW_SETTINGS,
  castControlEdges,
  castDataBindings,
  castFlowNodes,
  castFlowSettings,
  castHitlBlockers,
  castHitlPolicy,
  castMixedObject,
  castTriggerConfig,
} from './flow-cast';

const f = schema.playbookFlows;
const fw = schema.playbookFlowWorkspaces;
const ex = schema.playbookExecutions;

type FlowRow = typeof f.$inferSelect;

/** The graph arrays of a flow, typed with the module's node / edge / binding shapes. */
export type FlowNodes = FlowNode[];
export type FlowControlEdges = ControlEdge[];
export type FlowDataBindings = DataBinding[];

export interface FlowGenerationProvenance {
  source: 'conversation_handoff';
  handoffVersion: 1;
  sourceConversationId: string;
  sourceTargetMessageId: string;
  displayedAnswerVersion: string;
  canonicalPathFingerprint: string;
  contextFingerprint: string;
  assistantRequestId: string;
  acceptedBy: string;
  /** A Date when written, its ISO string when read back from jsonb. */
  acceptedAt: Date | string;
  confirmedWorkspaceIds: string[];
}

/**
 * A playbook flow (roadmap P5). `workspaces` comes from playbook.flow_workspaces in the user's
 * order; the document-shaped fields are exactly what Mongoose stored (see flow-cast.ts).
 */
export interface FlowRecord {
  id: string;
  ownerId: string;
  assistantOperationId: string | null;
  generationProvenance: FlowGenerationProvenance | null;
  schemaVersion: number;
  definitionRevision: number;
  name: string;
  description: string | null;
  triggerConfig: FlowTriggerConfig | null;
  settings: FlowSettings;
  hitlPolicy: HitlPolicy;
  hitlBlockers: HitlBlockerRule[];
  nodes: FlowNodes;
  controlEdges: FlowControlEdges;
  dataBindings: FlowDataBindings;
  workspaces: string[];
  designSettings: Record<string, unknown> | null;
  isFavorite: boolean;
  reflectionEnabled: boolean;
  advisorScoringMode: AdvisorScoringMode;
  advisorAutopilotEnabled: boolean;
  advisorAutopilotTargetScore: number | null;
  advisorAutopilotMaxTurns: number | null;
  createdAt: Date;
  updatedAt: Date;
}

/** The columns a caller may set; `updatedAt` is always bumped. Graph fields are cast like Mongoose did. */
export type FlowPatch = Partial<Pick<FlowRecord,
  | 'assistantOperationId' | 'generationProvenance' | 'schemaVersion' | 'name' | 'description' | 'triggerConfig' | 'settings'
  | 'hitlPolicy' | 'hitlBlockers' | 'nodes' | 'controlEdges' | 'dataBindings' | 'workspaces' | 'designSettings' | 'isFavorite'
  | 'reflectionEnabled' | 'advisorScoringMode' | 'advisorAutopilotEnabled' | 'advisorAutopilotTargetScore' | 'advisorAutopilotMaxTurns'
>>;

export type NewFlow = FlowPatch & Pick<FlowRecord, 'ownerId' | 'name'> & { id?: string };

export interface FlowUpdateOptions {
  /** Increment `definitionRevision` by one. */
  incrementRevision?: boolean;
  /** Only update while `definitionRevision` still has this value: null means another writer won. */
  expectedRevision?: number;
  /** Only update while `updatedAt` still is this instant (millisecond precision). */
  expectedUpdatedAt?: Date;
  /** Only update the flow of this owner. */
  ownerId?: string;
}

export interface FlowTriggerRef {
  id: string;
  ownerId: string;
  triggerConfig: FlowTriggerConfig | null;
  workspaces: string[];
}

/** The latest execution of a flow: highest activity (ended, else started, else created), then lowest id. */
export interface FlowLatestExecution {
  status: 'queued' | 'running' | 'pending_approval' | 'completed' | 'failed' | 'cancelled';
  activityAt: Date;
}

export interface FlowListQuery {
  ownerId: string;
  /** Flows shared with the owner, listed next to their own. */
  sharedFlowIds: string[];
  /** Case-insensitive substring of the name. */
  search?: string;
  /** updatedAt (default), createdAt, name or activityAt. */
  sortBy?: string;
  /** asc, or desc (default). */
  sortOrder?: string;
  page: number;
  limit: number;
}

export interface FlowListItem {
  flow: FlowRecord;
  latestExecution: FlowLatestExecution | null;
}

export type FlowNameMatch = 'exact' | 'prefix' | 'partial';

export interface FlowSearchQuery {
  ownerId: string;
  sharedFlowIds: string[];
  workspaceId?: string;
  /** Case-insensitive match on the name; no name filter without it. */
  name?: { text: string; match: FlowNameMatch };
  limit: number;
}

export interface FlowSearchRow {
  id: string;
  name: string;
  description: string | null;
  definitionRevision: number;
  updatedAt: Date;
}

/** The whitelisted column sort keys; `activityAt` is computed in listAccessible. */
const SORT_COLUMNS: Record<'updatedAt' | 'createdAt' | 'name', SQL> = {
  updatedAt: sql`${f.updatedAt}`,
  createdAt: sql`${f.createdAt}`,
  // Mongo compared names bytewise.
  name: sql`${f.name} COLLATE "C"`,
};

const EXECUTION_ACTIVITY = sql`coalesce(${ex.endedAt}, ${ex.startedAt}, ${ex.createdAt})`;

/**
 * The patch as it will be stored and read back: document-shaped fields cast like Mongoose did
 * (flow-cast.ts), text stripped of U+0000, undefined fields left out. Idempotent, so a caller can
 * compare or hash the result against a later read.
 */
export function castFlowPatch(patch: FlowPatch): FlowPatch {
  const out: FlowPatch = {};
  if (patch.assistantOperationId !== undefined) out.assistantOperationId = patch.assistantOperationId;
  if (patch.generationProvenance !== undefined) out.generationProvenance = castMixedObject(patch.generationProvenance);
  if (patch.schemaVersion !== undefined) out.schemaVersion = patch.schemaVersion;
  if (patch.name !== undefined) out.name = stripNul(patch.name);
  if (patch.description !== undefined) out.description = patch.description === null ? null : stripNul(patch.description);
  if (patch.triggerConfig !== undefined) out.triggerConfig = castTriggerConfig(patch.triggerConfig);
  if (patch.settings !== undefined) out.settings = castFlowSettings(patch.settings);
  if (patch.hitlPolicy !== undefined) out.hitlPolicy = castHitlPolicy(patch.hitlPolicy);
  if (patch.hitlBlockers !== undefined) out.hitlBlockers = castHitlBlockers(patch.hitlBlockers);
  if (patch.nodes !== undefined) out.nodes = castFlowNodes(patch.nodes);
  if (patch.controlEdges !== undefined) out.controlEdges = castControlEdges(patch.controlEdges);
  if (patch.dataBindings !== undefined) out.dataBindings = castDataBindings(patch.dataBindings);
  if (patch.workspaces !== undefined) out.workspaces = [...patch.workspaces];
  if (patch.designSettings !== undefined) out.designSettings = castMixedObject(patch.designSettings);
  if (patch.isFavorite !== undefined) out.isFavorite = patch.isFavorite;
  if (patch.reflectionEnabled !== undefined) out.reflectionEnabled = patch.reflectionEnabled;
  if (patch.advisorScoringMode !== undefined) out.advisorScoringMode = patch.advisorScoringMode;
  if (patch.advisorAutopilotEnabled !== undefined) out.advisorAutopilotEnabled = patch.advisorAutopilotEnabled;
  if (patch.advisorAutopilotTargetScore !== undefined) out.advisorAutopilotTargetScore = patch.advisorAutopilotTargetScore;
  if (patch.advisorAutopilotMaxTurns !== undefined) out.advisorAutopilotMaxTurns = patch.advisorAutopilotMaxTurns;
  return out;
}

function toColumns(patch: FlowPatch): Partial<typeof f.$inferInsert> {
  const { workspaces: _workspaces, ...columns } = castFlowPatch(patch);
  return columns as Partial<typeof f.$inferInsert>;
}

export function toFlowRecord(row: FlowRow, workspaces: string[]): FlowRecord {
  return {
    id: row.id,
    ownerId: row.ownerId,
    assistantOperationId: row.assistantOperationId,
    generationProvenance: row.generationProvenance as FlowGenerationProvenance | null,
    schemaVersion: row.schemaVersion,
    definitionRevision: row.definitionRevision,
    name: row.name,
    description: row.description,
    triggerConfig: row.triggerConfig as FlowTriggerConfig | null,
    settings: row.settings as unknown as FlowSettings,
    hitlPolicy: row.hitlPolicy as unknown as HitlPolicy,
    hitlBlockers: row.hitlBlockers as unknown as HitlBlockerRule[],
    nodes: row.nodes as unknown as FlowNodes,
    controlEdges: row.controlEdges as unknown as FlowControlEdges,
    dataBindings: row.dataBindings as unknown as FlowDataBindings,
    workspaces,
    designSettings: row.designSettings,
    isFavorite: row.isFavorite,
    reflectionEnabled: row.reflectionEnabled,
    advisorScoringMode: row.advisorScoringMode as AdvisorScoringMode,
    advisorAutopilotEnabled: row.advisorAutopilotEnabled,
    advisorAutopilotTargetScore: row.advisorAutopilotTargetScore,
    advisorAutopilotMaxTurns: row.advisorAutopilotMaxTurns,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Valid ids, lower-cased and de-duplicated in their first-seen order. */
function normalizeIds(ids: readonly string[]): string[] {
  return [...new Set(ids.filter((id) => isObjectId(id)).map(normalizeObjectId))];
}

/** PostgreSQL playbook.flows and playbook.flow_workspaces repository (roadmap P5). */
@Injectable()
export class FlowRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  /** The flow's workspace ids in their stored order (correlated on the outer flows row). */
  private workspacesOf(): SQL<string[]> {
    return sql<string[]>`coalesce((SELECT array_agg(${fw.workspaceId}::text ORDER BY ${fw.position}, ${fw.workspaceId}) FROM ${fw} WHERE ${fw.flowId} = ${f.id}), '{}')`;
  }

  private async loadWorkspaces(flowId: string): Promise<string[]> {
    const rows = await this.q
      .select({ workspaceId: fw.workspaceId })
      .from(fw)
      .where(eq(fw.flowId, flowId))
      .orderBy(asc(fw.position), asc(fw.workspaceId));
    return rows.map((row) => row.workspaceId);
  }

  /**
   * Replaces the flow's workspaces, keeping the given order. Ids that are malformed or name no
   * existing workspace are dropped: the foreign key cannot hold them (Mongo kept dangling ids).
   */
  private async replaceWorkspaces(flowId: string, workspaceIds: readonly string[]): Promise<void> {
    await this.q.delete(fw).where(eq(fw.flowId, flowId));
    const ids = normalizeIds(workspaceIds);
    if (ids.length === 0) return;
    const list = sql.join(ids.map((workspaceId) => sql`${workspaceId}`), sql`, `);
    await this.q.execute(sql`
      INSERT INTO ${fw} (flow_id, workspace_id, position)
      SELECT ${flowId}, w.id, (x.ord - 1)::int
      FROM unnest(ARRAY[${list}]::char(24)[]) WITH ORDINALITY AS x(id, ord)
      JOIN ${schema.workspaces} w ON w.id = x.id
      ORDER BY x.ord`);
  }

  private async selectFlows(where: SQL | undefined): Promise<FlowRecord[]> {
    const rows = await this.q.select({ flow: f, workspaces: this.workspacesOf() }).from(f).where(where);
    return rows.map((row) => toFlowRecord(row.flow, row.workspaces));
  }

  // ---------------------------------------------------------------- create / read

  /**
   * Inserts a flow with the defaults Mongoose applied, and its workspaces, together. A duplicate
   * (owner, name) or assistant operation id surfaces as a unique violation
   * (uq_playbook_flows_owner_name / uq_playbook_flows_assistant_operation).
   */
  async create(input: NewFlow): Promise<FlowRecord> {
    if (!isObjectId(input.ownerId)) throw new Error('Flow ownerId must be a 24-char hex id');
    const { id, ownerId, workspaces, ...fields } = input;
    // Mongoose defaults: applied to an undefined field, not to an explicit null.
    fields.settings = fields.settings ?? (DEFAULT_FLOW_SETTINGS as FlowSettings);
    fields.hitlPolicy = fields.hitlPolicy ?? ({ ...DEFAULT_HITL_POLICY } as HitlPolicy);
    if (fields.designSettings === undefined) fields.designSettings = DEFAULT_DESIGN_SETTINGS;
    const now = new Date();
    return withTransaction(this.db, async () => {
      const [row] = await this.q
        .insert(f)
        .values({
          ...toColumns(fields),
          id: id && isObjectId(id) ? normalizeObjectId(id) : newObjectId(),
          ownerId: normalizeObjectId(ownerId),
          name: stripNul(fields.name),
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      await this.replaceWorkspaces(row.id, workspaces ?? []);
      return toFlowRecord(row, await this.loadWorkspaces(row.id));
    });
  }

  async findById(id: string): Promise<FlowRecord | null> {
    if (!isObjectId(id)) return null;
    const [flow] = await this.selectFlows(eq(f.id, normalizeObjectId(id)));
    return flow ?? null;
  }

  /** The flows that exist among `ids`, in no particular order. */
  async findByIds(ids: readonly string[]): Promise<FlowRecord[]> {
    const valid = normalizeIds(ids);
    if (valid.length === 0) return [];
    return this.selectFlows(inArray(f.id, valid));
  }

  /** The flow when `ownerId` owns it, else null. */
  async findOwned(id: string, ownerId: string): Promise<FlowRecord | null> {
    if (!isObjectId(id) || !isObjectId(ownerId)) return null;
    const [flow] = await this.selectFlows(and(eq(f.id, normalizeObjectId(id)), eq(f.ownerId, normalizeObjectId(ownerId))));
    return flow ?? null;
  }

  async findByAssistantOperationId(ownerId: string, assistantOperationId: string): Promise<FlowRecord | null> {
    if (!isObjectId(ownerId) || !assistantOperationId) return null;
    const [flow] = await this.selectFlows(and(eq(f.ownerId, normalizeObjectId(ownerId)), eq(f.assistantOperationId, assistantOperationId)));
    return flow ?? null;
  }

  async exists(id: string): Promise<boolean> {
    if (!isObjectId(id)) return false;
    const rows = await this.q.select({ id: f.id }).from(f).where(eq(f.id, normalizeObjectId(id))).limit(1);
    return rows.length > 0;
  }

  /** Existence and owner, without loading the graph. */
  async findOwnerRef(id: string): Promise<{ id: string; ownerId: string } | null> {
    if (!isObjectId(id)) return null;
    const [row] = await this.q.select({ id: f.id, ownerId: f.ownerId }).from(f).where(eq(f.id, normalizeObjectId(id))).limit(1);
    return row ?? null;
  }

  async listIdsByOwner(ownerId: string): Promise<string[]> {
    if (!isObjectId(ownerId)) return [];
    const rows = await this.q.select({ id: f.id }).from(f).where(eq(f.ownerId, normalizeObjectId(ownerId))).orderBy(asc(f.id));
    return rows.map((row) => row.id);
  }

  /** Whether the owner already has a flow with exactly this name. */
  async nameTaken(ownerId: string, name: string): Promise<boolean> {
    if (!isObjectId(ownerId)) return false;
    const rows = await this.q
      .select({ id: f.id })
      .from(f)
      .where(and(eq(f.ownerId, normalizeObjectId(ownerId)), eq(f.name, name)))
      .limit(1);
    return rows.length > 0;
  }

  /** The owner's flow names that start with `prefix` (case-sensitive). */
  async listNamesWithPrefix(ownerId: string, prefix: string): Promise<string[]> {
    if (!isObjectId(ownerId)) return [];
    const rows = await this.q
      .select({ name: f.name })
      .from(f)
      .where(and(eq(f.ownerId, normalizeObjectId(ownerId)), like(f.name, `${escapeLike(prefix)}%`)));
    return rows.map((row) => row.name);
  }

  /** Flows whose trigger is of `kind` and whose trigger params contain `params` (jsonb containment). */
  async listByTrigger(kind: string, params?: Record<string, unknown>): Promise<FlowTriggerRef[]> {
    const containment = { kind, ...(params ? { params: stripNul(params) } : {}) };
    const rows = await this.q
      .select({ id: f.id, ownerId: f.ownerId, triggerConfig: f.triggerConfig, workspaces: this.workspacesOf() })
      .from(f)
      .where(and(sql`${f.triggerConfig} ->> 'kind' = ${kind}`, sql`${f.triggerConfig} @> ${JSON.stringify(containment)}::jsonb`))
      .orderBy(asc(f.id));
    return rows.map((row) => ({ ...row, triggerConfig: row.triggerConfig as FlowTriggerConfig | null }));
  }

  // ---------------------------------------------------------------- update

  /**
   * Partial update; `updatedAt` is bumped. With `expectedRevision` / `expectedUpdatedAt` / `ownerId`
   * the write is one conditional UPDATE and null means the guard failed (a lost race) or the flow is
   * gone. `workspaces` replaces the junction rows in the same transaction.
   */
  async updateFields(id: string, patch: FlowPatch, options: FlowUpdateOptions = {}): Promise<FlowRecord | null> {
    if (!isObjectId(id)) return null;
    if (options.ownerId !== undefined && !isObjectId(options.ownerId)) return null;
    const flowId = normalizeObjectId(id);
    const where = and(
      eq(f.id, flowId),
      options.ownerId !== undefined ? eq(f.ownerId, normalizeObjectId(options.ownerId)) : undefined,
      options.expectedRevision !== undefined ? eq(f.definitionRevision, options.expectedRevision) : undefined,
      options.expectedUpdatedAt !== undefined
        ? sql`date_trunc('milliseconds', ${f.updatedAt}) = ${options.expectedUpdatedAt.toISOString()}::timestamptz`
        : undefined,
    );
    const set = {
      ...toColumns(patch),
      ...(options.incrementRevision ? { definitionRevision: sql`${f.definitionRevision} + 1` } : {}),
      updatedAt: new Date(),
    };
    const write = async (): Promise<FlowRecord | null> => {
      const [row] = await this.q.update(f).set(set).where(where).returning();
      if (!row) return null;
      if (patch.workspaces !== undefined) await this.replaceWorkspaces(row.id, patch.workspaces);
      return toFlowRecord(row, await this.loadWorkspaces(row.id));
    };
    return patch.workspaces !== undefined ? withTransaction(this.db, write) : write();
  }

  /** Flips the favourite flag in one statement and returns the new value, or null when the flow is gone. */
  async toggleFavorite(id: string): Promise<boolean | null> {
    if (!isObjectId(id)) return null;
    const [row] = await this.q
      .update(f)
      .set({ isFavorite: sql`NOT ${f.isFavorite}`, updatedAt: new Date() })
      .where(eq(f.id, normalizeObjectId(id)))
      .returning({ isFavorite: f.isFavorite });
    return row ? row.isFavorite : null;
  }

  /** Sets one key of `triggerConfig.params`, leaving the rest of the trigger as it is. */
  async setTriggerParam(id: string, key: string, value: unknown): Promise<boolean> {
    if (!isObjectId(id)) return false;
    const entry = JSON.stringify({ [stripNul(key)]: stripNul(value) });
    const rows = await this.q
      .update(f)
      .set({
        triggerConfig: sql`jsonb_set(coalesce(${f.triggerConfig}, '{}'::jsonb), '{params}', coalesce(${f.triggerConfig} -> 'params', '{}'::jsonb) || ${entry}::jsonb)`,
        updatedAt: new Date(),
      })
      .where(eq(f.id, normalizeObjectId(id)))
      .returning({ id: f.id });
    return rows.length > 0;
  }

  /**
   * Writes one node's HITL policy (cast like the Mongoose subdocument) in place, only while the node
   * at `index` still is `nodeId` on the owner's flow. False when the flow or node moved.
   */
  async setNodeHitlPolicy(id: string, ownerId: string, index: number, nodeId: string, policy: HitlPolicy): Promise<boolean> {
    if (!isObjectId(id) || !isObjectId(ownerId) || !Number.isInteger(index) || index < 0) return false;
    const rows = await this.q
      .update(f)
      .set({
        nodes: sql`jsonb_set(${f.nodes}, ARRAY[${String(index)}::text, 'hitlPolicy'], ${JSON.stringify(castHitlPolicy(policy))}::jsonb)`,
        updatedAt: new Date(),
      })
      .where(and(eq(f.id, normalizeObjectId(id)), eq(f.ownerId, normalizeObjectId(ownerId)), sql`${f.nodes} -> ${index}::int ->> 'id' = ${nodeId}`))
      .returning({ id: f.id });
    return rows.length > 0;
  }

  // ---------------------------------------------------------------- delete

  /** Deletes the owner's flow; the foreign keys take its workspaces links, shares and executions with it. */
  async deleteOwned(id: string, ownerId: string): Promise<boolean> {
    if (!isObjectId(id) || !isObjectId(ownerId)) return false;
    const rows = await this.q
      .delete(f)
      .where(and(eq(f.id, normalizeObjectId(id)), eq(f.ownerId, normalizeObjectId(ownerId))))
      .returning({ id: f.id });
    return rows.length > 0;
  }

  /** Deletes those of `ids` the owner owns and returns their ids. */
  async deleteManyOwned(ids: readonly string[], ownerId: string): Promise<string[]> {
    const valid = normalizeIds(ids);
    if (valid.length === 0 || !isObjectId(ownerId)) return [];
    const rows = await this.q
      .delete(f)
      .where(and(inArray(f.id, valid), eq(f.ownerId, normalizeObjectId(ownerId))))
      .returning({ id: f.id });
    return rows.map((row) => row.id);
  }

  /** Deletes an assistant-generated draft only while nobody changed it since `expectedRevision`. */
  async deleteAssistantDraft(ownerId: string, id: string, assistantOperationId: string, expectedRevision: number): Promise<boolean> {
    if (!isObjectId(id) || !isObjectId(ownerId)) return false;
    const rows = await this.q
      .delete(f)
      .where(and(
        eq(f.id, normalizeObjectId(id)),
        eq(f.ownerId, normalizeObjectId(ownerId)),
        eq(f.assistantOperationId, assistantOperationId),
        eq(f.definitionRevision, expectedRevision),
      ))
      .returning({ id: f.id });
    return rows.length > 0;
  }

  /** Detaches a workspace from every flow referencing it. */
  async removeWorkspaceReference(workspaceId: string): Promise<number> {
    if (!isObjectId(workspaceId)) return 0;
    const rows = await this.q.delete(fw).where(eq(fw.workspaceId, normalizeObjectId(workspaceId))).returning({ flowId: fw.flowId });
    return rows.length;
  }

  // ---------------------------------------------------------------- lists

  private accessible(ownerId: string, sharedFlowIds: readonly string[]): SQL {
    const shared = normalizeIds(sharedFlowIds);
    const own = eq(f.ownerId, normalizeObjectId(ownerId));
    return (shared.length > 0 ? or(own, inArray(f.id, shared)) : own) as SQL;
  }

  /**
   * One page of the flows the owner owns or is shared on, each with its latest execution. `activityAt`
   * sorts by the later of the flow's update and its latest execution's activity; the other sort keys
   * are columns. Unknown sort keys fall back to `updatedAt`.
   */
  async listAccessible(query: FlowListQuery): Promise<{ items: FlowListItem[]; total: number }> {
    if (!isObjectId(query.ownerId)) return { items: [], total: 0 };
    const where = and(
      this.accessible(query.ownerId, query.sharedFlowIds),
      query.search ? ilike(f.name, `%${escapeLike(query.search)}%`) : undefined,
    ) as SQL;

    const latest = this.q
      .select({
        status: ex.status,
        activityAt: sql<Date>`${EXECUTION_ACTIVITY}`.mapWith(ex.createdAt).as('activity_at'),
      })
      .from(ex)
      .where(eq(ex.flowId, f.id))
      .orderBy(sql`${EXECUTION_ACTIVITY} DESC`, asc(ex.id))
      .limit(1)
      .as('latest');

    const dir = query.sortOrder === 'asc' ? sql`ASC` : sql`DESC`;
    const key = query.sortBy === 'activityAt'
      ? sql`greatest(${f.updatedAt}, coalesce(${latest.activityAt}, 'epoch'::timestamptz))`
      : SORT_COLUMNS[query.sortBy as keyof typeof SORT_COLUMNS] ?? SORT_COLUMNS.updatedAt;

    const page = Math.max(1, Math.trunc(query.page));
    const limit = Math.max(1, Math.trunc(query.limit));
    const [countRows, rows] = await Promise.all([
      this.q.select({ count: sql<number>`count(*)::int` }).from(f).where(where),
      this.q
        .select({ flow: f, workspaces: this.workspacesOf(), status: latest.status, activityAt: latest.activityAt })
        .from(f)
        .leftJoinLateral(latest, sql`true`)
        .where(where)
        .orderBy(sql`${key} ${dir}`, asc(f.id))
        .limit(limit)
        .offset((page - 1) * limit),
    ]);

    return {
      total: countRows[0]?.count ?? 0,
      items: rows.map((row) => ({
        flow: toFlowRecord(row.flow, row.workspaces),
        latestExecution: row.status && row.activityAt
          ? { status: row.status as FlowLatestExecution['status'], activityAt: row.activityAt }
          : null,
      })),
    };
  }

  /** Name search for the assistant, most recently updated first. */
  async search(query: FlowSearchQuery): Promise<FlowSearchRow[]> {
    if (!isObjectId(query.ownerId)) return [];
    if (query.workspaceId !== undefined && !isObjectId(query.workspaceId)) return [];
    const text = query.name ? escapeLike(query.name.text) : '';
    const pattern = !query.name ? undefined
      : query.name.match === 'exact' ? text
        : query.name.match === 'prefix' ? `${text}%`
          : `%${text}%`;
    const rows = await this.q
      .select({ id: f.id, name: f.name, description: f.description, definitionRevision: f.definitionRevision, updatedAt: f.updatedAt })
      .from(f)
      .where(and(
        this.accessible(query.ownerId, query.sharedFlowIds),
        query.workspaceId !== undefined
          ? exists(this.q.select({ one: sql`1` }).from(fw).where(and(eq(fw.flowId, f.id), eq(fw.workspaceId, normalizeObjectId(query.workspaceId)))))
          : undefined,
        pattern !== undefined ? ilike(f.name, pattern) : undefined,
      ))
      .orderBy(desc(f.updatedAt), asc(f.id))
      .limit(Math.max(1, Math.trunc(query.limit)));
    return rows;
  }

  /** Every accessible flow with the id and label of each node, in node order. */
  async listNodeIndex(ownerId: string, sharedFlowIds: readonly string[]): Promise<Array<{ id: string; name: string; nodes: Array<{ id: string; label: string | null }> }>> {
    if (!isObjectId(ownerId)) return [];
    const rows = await this.q
      .select({
        id: f.id,
        name: f.name,
        nodes: sql<Array<{ id: string; label: string | null }>>`coalesce((
          SELECT jsonb_agg(jsonb_build_object('id', n.node ->> 'id', 'label', n.node ->> 'label') ORDER BY n.ord)
          FROM jsonb_array_elements(${f.nodes}) WITH ORDINALITY AS n(node, ord)), '[]'::jsonb)`,
      })
      .from(f)
      .where(this.accessible(ownerId, sharedFlowIds))
      .orderBy(asc(f.id));
    return rows;
  }
}
