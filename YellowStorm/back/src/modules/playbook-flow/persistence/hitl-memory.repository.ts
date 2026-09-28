import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isObjectId, newObjectId, normalizeObjectId, stripNul } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';

const hm = schema.playbookHitlMemories;

/** One playbook.hitl_memories row: user-approved HITL guidance injected into later runs of a flow. */
export type HitlMemoryRecord = typeof hm.$inferSelect;

/** The fields a memory is created with; the enums take the Mongoose defaults when absent. */
export interface NewHitlMemory {
  ownerId: string;
  flowId: string;
  nodeId?: string | null;
  memoryType?: string;
  source?: string;
  title: string;
  content: string;
  normalizedInstruction: string;
  appliesTo?: string;
  status?: string;
  sensitivity?: string;
  createdFromExecutionId?: string | null;
  createdFromInterruptId?: string | null;
}

export type HitlMemoryPatch = Partial<Omit<NewHitlMemory, 'ownerId' | 'flowId'>>;

/** The JSON the Mongo document's toJSON() produced: `id`, no key for an origin that was never set. */
export interface HitlMemoryJson {
  id: string;
  ownerId: string;
  flowId: string;
  nodeId: string | null;
  memoryType: string;
  source: string;
  title: string;
  content: string;
  normalizedInstruction: string;
  appliesTo: string;
  status: string;
  sensitivity: string;
  createdFromExecutionId?: string;
  createdFromInterruptId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export function toHitlMemoryJson(record: HitlMemoryRecord): HitlMemoryJson {
  const { createdFromExecutionId, createdFromInterruptId, ...fields } = record;
  return {
    ...fields,
    ...(createdFromExecutionId !== null ? { createdFromExecutionId } : {}),
    ...(createdFromInterruptId !== null ? { createdFromInterruptId } : {}),
  };
}

const text = (value: string): string => stripNul(value);
const textOrNull = (value: string | null | undefined): string | null => (value == null ? null : stripNul(value));

/**
 * The patch as columns. A null written to a NOT NULL column (the DTO lets a PATCH send one) is
 * ignored: Postgres cannot store it and the column keeps its value.
 */
function toColumns(patch: HitlMemoryPatch): Partial<typeof hm.$inferInsert> {
  const out: Partial<typeof hm.$inferInsert> = {};
  if (patch.nodeId !== undefined) out.nodeId = textOrNull(patch.nodeId);
  if (patch.memoryType != null) out.memoryType = patch.memoryType;
  if (patch.source != null) out.source = patch.source;
  if (patch.title != null) out.title = text(patch.title);
  if (patch.content != null) out.content = text(patch.content);
  if (patch.normalizedInstruction != null) out.normalizedInstruction = text(patch.normalizedInstruction);
  if (patch.appliesTo != null) out.appliesTo = patch.appliesTo;
  if (patch.status != null) out.status = patch.status;
  if (patch.sensitivity != null) out.sensitivity = patch.sensitivity;
  if (patch.createdFromExecutionId !== undefined) out.createdFromExecutionId = textOrNull(patch.createdFromExecutionId);
  if (patch.createdFromInterruptId !== undefined) out.createdFromInterruptId = textOrNull(patch.createdFromInterruptId);
  return out;
}

/** Memories that apply to the whole workflow (no node) or to one of `nodeIds`. */
function forNodes(nodeIds: readonly string[]) {
  return nodeIds.length > 0 ? or(isNull(hm.nodeId), inArray(hm.nodeId, [...nodeIds])) : isNull(hm.nodeId);
}

/** PostgreSQL playbook.hitl_memories repository (roadmap P5). A memory goes with its flow. */
@Injectable()
export class HitlMemoryRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  private owned(id: string, flowId: string, ownerId: string) {
    return and(eq(hm.id, normalizeObjectId(id)), eq(hm.flowId, normalizeObjectId(flowId)), eq(hm.ownerId, normalizeObjectId(ownerId)));
  }

  /** Inserts a memory; a flow or owner that does not exist surfaces as a foreign-key violation. */
  async create(input: NewHitlMemory): Promise<HitlMemoryRecord> {
    if (!isObjectId(input.ownerId) || !isObjectId(input.flowId)) throw new Error('HITL memory ownerId and flowId must be 24-char hex ids');
    const now = new Date();
    const [row] = await this.q
      .insert(hm)
      .values({
        memoryType: 'procedural',
        source: 'hitl_feedback',
        appliesTo: 'workflow',
        status: 'draft',
        sensitivity: 'normal',
        ...toColumns(input),
        id: newObjectId(),
        ownerId: normalizeObjectId(input.ownerId),
        flowId: normalizeObjectId(input.flowId),
        title: text(input.title),
        content: text(input.content),
        normalizedInstruction: text(input.normalizedInstruction),
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return row;
  }

  /** The owner's memories of a flow, most recently updated first. */
  async listForFlow(flowId: string, ownerId: string): Promise<HitlMemoryRecord[]> {
    if (!isObjectId(flowId) || !isObjectId(ownerId)) return [];
    return this.q
      .select()
      .from(hm)
      .where(and(eq(hm.flowId, normalizeObjectId(flowId)), eq(hm.ownerId, normalizeObjectId(ownerId))))
      .orderBy(desc(hm.updatedAt), asc(hm.id));
  }

  /** Writes the patch to the owner's memory of the flow; null when there is none. */
  async update(id: string, flowId: string, ownerId: string, patch: HitlMemoryPatch): Promise<HitlMemoryRecord | null> {
    if (!isObjectId(id) || !isObjectId(flowId) || !isObjectId(ownerId)) return null;
    const [row] = await this.q
      .update(hm)
      .set({ ...toColumns(patch), updatedAt: new Date() })
      .where(this.owned(id, flowId, ownerId))
      .returning();
    return row ?? null;
  }

  async delete(id: string, flowId: string, ownerId: string): Promise<boolean> {
    if (!isObjectId(id) || !isObjectId(flowId) || !isObjectId(ownerId)) return false;
    const rows = await this.q.delete(hm).where(this.owned(id, flowId, ownerId)).returning({ id: hm.id });
    return rows.length > 0;
  }

  /** The flow's active memories for the workflow or for one of `nodeIds` (every owner), oldest first. */
  async listActiveForNodes(flowId: string, nodeIds: readonly string[]): Promise<HitlMemoryRecord[]> {
    if (!isObjectId(flowId)) return [];
    return this.q
      .select()
      .from(hm)
      .where(and(eq(hm.flowId, normalizeObjectId(flowId)), eq(hm.status, 'active'), forNodes(nodeIds)))
      .orderBy(asc(hm.createdAt), asc(hm.id));
  }

  /** How many active memories of the flow, for the workflow or for `nodeId`, came from `executionId`. */
  async countActiveFromExecution(flowId: string, nodeId: string, executionId: string): Promise<number> {
    if (!isObjectId(flowId)) return 0;
    const [{ count }] = await this.q
      .select({ count: sql<number>`count(*)::int` })
      .from(hm)
      .where(and(
        eq(hm.flowId, normalizeObjectId(flowId)),
        eq(hm.status, 'active'),
        eq(hm.createdFromExecutionId, executionId),
        forNodes([nodeId]),
      ));
    return count;
  }
}
