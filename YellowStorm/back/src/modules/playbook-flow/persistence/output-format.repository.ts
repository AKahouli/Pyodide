import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isObjectId, newObjectId, normalizeObjectId, stripNul, withTransaction } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';

const of = schema.playbookOutputFormats;
type OutputFormatRow = typeof of.$inferSelect;

export type OutputFormatStatus = 'active' | 'inactive' | 'archived';
export type OutputFormatGenerationStatus = 'pending' | 'ready' | 'failed';

export interface OutputFormatPromptTraceItem {
  stage: string;
  model: string;
  prompt: string;
  generatedOutput?: string | null;
}

/** One playbook.output_formats row: a node's output template captured from a run (a soft reference). */
export type OutputFormatRecord = Omit<OutputFormatRow, 'status' | 'generationStatus' | 'llmPromptTrace'> & {
  status: OutputFormatStatus;
  generationStatus: OutputFormatGenerationStatus;
  llmPromptTrace: OutputFormatPromptTraceItem[];
};

export interface NewOutputFormat {
  flowId: string;
  nodeId: string;
  createdBy: string;
  sourceExecutionId: string;
  sourceExecutionNumber: number;
  sourceOutput: string | null;
}

export interface OutputFormatGeneration {
  formatGuide: string | null;
  generationStatus: OutputFormatGenerationStatus;
  generationError: string | null;
}

function toRecord(row: OutputFormatRow): OutputFormatRecord {
  return {
    ...row,
    status: row.status as OutputFormatStatus,
    generationStatus: row.generationStatus as OutputFormatGenerationStatus,
    llmPromptTrace: row.llmPromptTrace as unknown as OutputFormatPromptTraceItem[],
  };
}

const textOrNull = (value: string | null): string | null => (value === null ? null : stripNul(value));

/** PostgreSQL playbook.output_formats repository (roadmap P5). */
@Injectable()
export class OutputFormatRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  private node(flowId: string, nodeId: string): SQL {
    return and(eq(of.flowId, normalizeObjectId(flowId)), eq(of.nodeId, nodeId)) as SQL;
  }

  /** The id of the node's active template; the oldest when a legacy node has several. */
  private activeId(flowId: string, nodeId: string): SQL {
    return sql`(${this.q
      .select({ id: of.id })
      .from(of)
      .where(and(this.node(flowId, nodeId), eq(of.status, 'active')))
      .orderBy(asc(of.createdAt), asc(of.id))
      .limit(1)})`;
  }

  /**
   * Captures a new active template for the node: version = the node's template count + 1, and every
   * other active or inactive template of the node becomes inactive (archived ones stay archived).
   * Captures of one node are serialised by a transaction-scoped advisory lock, so two concurrent
   * captures never share a version or both stay active.
   */
  async capture(input: NewOutputFormat): Promise<OutputFormatRecord> {
    if (![input.flowId, input.createdBy, input.sourceExecutionId].every(isObjectId)) {
      throw new Error('Output format flowId, createdBy and sourceExecutionId must be 24-char hex ids');
    }
    const flowId = normalizeObjectId(input.flowId);
    return withTransaction(this.db, async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`playbook.output-format:${flowId}:${input.nodeId}`}, 0))`);
      const [{ count }] = await this.q.select({ count: sql<number>`count(*)::int` }).from(of).where(this.node(flowId, input.nodeId));
      await this.q
        .update(of)
        .set({ status: 'inactive', updatedAt: new Date() })
        .where(and(this.node(flowId, input.nodeId), inArray(of.status, ['active', 'inactive'])));
      const now = new Date();
      const [row] = await this.q
        .insert(of)
        .values({
          id: newObjectId(),
          flowId,
          nodeId: input.nodeId,
          createdBy: normalizeObjectId(input.createdBy),
          sourceExecutionId: normalizeObjectId(input.sourceExecutionId),
          sourceExecutionNumber: input.sourceExecutionNumber,
          templateVersion: count + 1,
          status: 'active',
          generationStatus: 'pending',
          generationError: null,
          sourceOutput: textOrNull(input.sourceOutput),
          formatGuide: null,
          llmPromptTrace: [],
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      return toRecord(row);
    });
  }

  async findById(id: string): Promise<OutputFormatRecord | null> {
    if (!isObjectId(id)) return null;
    const [row] = await this.q.select().from(of).where(eq(of.id, normalizeObjectId(id))).limit(1);
    return row ? toRecord(row) : null;
  }

  /** The node's active template (the oldest when a legacy node has several). */
  async findActive(flowId: string, nodeId: string): Promise<OutputFormatRecord | null> {
    if (!isObjectId(flowId)) return null;
    const [row] = await this.q
      .select()
      .from(of)
      .where(and(this.node(flowId, nodeId), eq(of.status, 'active')))
      .orderBy(asc(of.createdAt), asc(of.id))
      .limit(1);
    return row ? toRecord(row) : null;
  }

  /** The active templates of the given nodes, oldest first. */
  async listActive(flowId: string, nodeIds: readonly string[]): Promise<OutputFormatRecord[]> {
    if (!isObjectId(flowId) || nodeIds.length === 0) return [];
    const rows = await this.q
      .select()
      .from(of)
      .where(and(eq(of.flowId, normalizeObjectId(flowId)), inArray(of.nodeId, [...nodeIds]), eq(of.status, 'active')))
      .orderBy(asc(of.createdAt), asc(of.id));
    return rows.map(toRecord);
  }

  /** Edits the node's active template (only `updatedAt` moves when `formatGuide` is undefined); null when it has none. */
  async updateActive(flowId: string, nodeId: string, patch: { formatGuide?: string | null }): Promise<OutputFormatRecord | null> {
    if (!isObjectId(flowId)) return null;
    const [row] = await this.q
      .update(of)
      .set({
        ...(patch.formatGuide !== undefined ? { formatGuide: textOrNull(patch.formatGuide) } : {}),
        updatedAt: new Date(),
      })
      .where(eq(of.id, this.activeId(flowId, nodeId)))
      .returning();
    return row ? toRecord(row) : null;
  }

  /** Archives the node's active template; false when it has none. */
  async archiveActive(flowId: string, nodeId: string): Promise<boolean> {
    if (!isObjectId(flowId)) return false;
    const rows = await this.q
      .update(of)
      .set({ status: 'archived', updatedAt: new Date() })
      .where(eq(of.id, this.activeId(flowId, nodeId)))
      .returning({ id: of.id });
    return rows.length > 0;
  }

  /** Stores the outcome of the background guide generation; null when the template is gone. */
  async setGeneration(id: string, generation: OutputFormatGeneration): Promise<OutputFormatRecord | null> {
    if (!isObjectId(id)) return null;
    const [row] = await this.q
      .update(of)
      .set({
        formatGuide: textOrNull(generation.formatGuide),
        generationStatus: generation.generationStatus,
        generationError: textOrNull(generation.generationError),
        updatedAt: new Date(),
      })
      .where(eq(of.id, normalizeObjectId(id)))
      .returning();
    return row ? toRecord(row) : null;
  }
}
