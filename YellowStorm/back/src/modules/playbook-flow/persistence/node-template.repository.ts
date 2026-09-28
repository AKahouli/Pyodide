import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, ne, notInArray, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isObjectId, newObjectId, normalizeObjectId, stripNul, withTransaction } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import type {
  FlowNodeTemplateHumanApprovalConfig,
  FlowNodeTemplateIteratorConfig,
  FlowNodeTemplatePort,
  FlowNodeTemplateResponse,
  FlowNodeTemplateRetryPolicy,
  FlowNodeTemplateRouterConfig,
} from '../interfaces/playbook-flow-node-template.interface';
import {
  castHumanApprovalConfig,
  castInputPorts,
  castIteratorConfig,
  castOutputPorts,
  castRetryPolicy,
  castRouterConfig,
} from './template-cast';

const nt = schema.playbookNodeTemplates;
type NodeTemplateRow = typeof nt.$inferSelect;

export type NodeTemplateNodeType = FlowNodeTemplateResponse['nodeType'];

/** One playbook.node_templates row, its configs cast like the Mongoose subdocuments. */
export interface NodeTemplateRecord {
  id: string;
  key: string;
  nodeType: NodeTemplateNodeType;
  title: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  category: string;
  inputPorts: FlowNodeTemplatePort[];
  outputPorts: FlowNodeTemplatePort[];
  promptTemplate: string;
  recommendedAgentTypeSlug: string | null;
  requiredToolNames: string[];
  assignedAgentId: string | null;
  selectedAction: string | null;
  iteratorConfig: FlowNodeTemplateIteratorConfig | null;
  enabled: boolean;
  routerConfig: FlowNodeTemplateRouterConfig | null;
  humanApprovalConfig: FlowNodeTemplateHumanApprovalConfig | null;
  retryPolicy: FlowNodeTemplateRetryPolicy | null;
  modelId: string | null;
  version: number;
  isBuiltIn: boolean;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** The columns a caller may write; `updatedAt` is always bumped. */
export type NodeTemplateFields = Partial<Omit<NodeTemplateRecord, 'id' | 'version' | 'createdAt' | 'updatedAt'>>;

export type NewNodeTemplate = NodeTemplateFields & Pick<NodeTemplateRecord, 'key' | 'nodeType' | 'title' | 'category'> & { version?: number };

function toRecord(row: NodeTemplateRow): NodeTemplateRecord {
  return {
    ...row,
    nodeType: row.nodeType as NodeTemplateNodeType,
    inputPorts: row.inputPorts as unknown as FlowNodeTemplatePort[],
    outputPorts: row.outputPorts as unknown as FlowNodeTemplatePort[],
    iteratorConfig: row.iteratorConfig as unknown as FlowNodeTemplateIteratorConfig | null,
    routerConfig: row.routerConfig as unknown as FlowNodeTemplateRouterConfig | null,
    humanApprovalConfig: row.humanApprovalConfig as unknown as FlowNodeTemplateHumanApprovalConfig | null,
    retryPolicy: row.retryPolicy as unknown as FlowNodeTemplateRetryPolicy | null,
  };
}

const trimOrNull = (value: string | null | undefined): string | null => (value == null ? null : stripNul(String(value).trim()));
const idOrNull = (value: string | null | undefined): string | null => (value && isObjectId(value) ? normalizeObjectId(value) : null);

/**
 * The fields as column values, cast like the Mongoose schema: the trimmed strings trimmed, the configs
 * cast, and a null written to a NOT NULL column taking what a read of the Mongo null gave back (no node
 * type read as `agent`, a missing flag as not enabled, missing ports and tools as empty).
 */
function toColumns(fields: NodeTemplateFields): Partial<typeof nt.$inferInsert> {
  const out: Partial<typeof nt.$inferInsert> = {};
  if (fields.key !== undefined) out.key = stripNul(String(fields.key ?? '').trim());
  if (fields.nodeType !== undefined) out.nodeType = fields.nodeType ? fields.nodeType.trim() : 'agent';
  if (fields.title !== undefined) out.title = stripNul(String(fields.title ?? '').trim());
  if (fields.description !== undefined) out.description = trimOrNull(fields.description);
  if (fields.icon !== undefined) out.icon = trimOrNull(fields.icon);
  if (fields.color !== undefined) out.color = trimOrNull(fields.color);
  if (fields.category !== undefined) out.category = stripNul(String(fields.category ?? '').trim());
  if (fields.inputPorts !== undefined) out.inputPorts = castInputPorts(fields.inputPorts);
  if (fields.outputPorts !== undefined) out.outputPorts = castOutputPorts(fields.outputPorts);
  if (fields.promptTemplate !== undefined) out.promptTemplate = stripNul(fields.promptTemplate ?? '');
  if (fields.recommendedAgentTypeSlug !== undefined) out.recommendedAgentTypeSlug = trimOrNull(fields.recommendedAgentTypeSlug);
  if (fields.requiredToolNames !== undefined) out.requiredToolNames = (fields.requiredToolNames ?? []).map((name) => stripNul(String(name)));
  if (fields.assignedAgentId !== undefined) out.assignedAgentId = trimOrNull(fields.assignedAgentId);
  if (fields.selectedAction !== undefined) out.selectedAction = trimOrNull(fields.selectedAction);
  if (fields.iteratorConfig !== undefined) out.iteratorConfig = castIteratorConfig(fields.iteratorConfig);
  if (fields.enabled !== undefined) out.enabled = fields.enabled === true;
  if (fields.routerConfig !== undefined) out.routerConfig = castRouterConfig(fields.routerConfig);
  if (fields.humanApprovalConfig !== undefined) out.humanApprovalConfig = castHumanApprovalConfig(fields.humanApprovalConfig);
  if (fields.retryPolicy !== undefined) out.retryPolicy = castRetryPolicy(fields.retryPolicy);
  if (fields.modelId !== undefined) out.modelId = trimOrNull(fields.modelId);
  if (fields.isBuiltIn !== undefined) out.isBuiltIn = fields.isBuiltIn === true;
  if (fields.createdBy !== undefined) out.createdBy = idOrNull(fields.createdBy);
  if (fields.updatedBy !== undefined) out.updatedBy = idOrNull(fields.updatedBy);
  return out;
}

/** The whole row of a new template, with the Mongoose defaults for what the caller left out. */
function toInsert(input: NewNodeTemplate, now: Date): typeof nt.$inferInsert {
  return {
    description: null,
    icon: null,
    color: null,
    promptTemplate: '',
    recommendedAgentTypeSlug: null,
    requiredToolNames: [],
    assignedAgentId: null,
    selectedAction: null,
    iteratorConfig: null,
    enabled: true,
    routerConfig: null,
    humanApprovalConfig: null,
    retryPolicy: null,
    modelId: null,
    isBuiltIn: false,
    createdBy: null,
    updatedBy: null,
    inputPorts: [],
    outputPorts: [],
    ...toColumns(input),
    id: newObjectId(),
    key: stripNul(input.key.trim()),
    nodeType: input.nodeType ? input.nodeType.trim() : 'agent',
    title: stripNul(input.title.trim()),
    category: stripNul(input.category.trim()),
    version: input.version ?? 1,
    createdAt: now,
    updatedAt: now,
  };
}

/** Mongo sorted strings byte-wise. */
const BY_CATEGORY_TITLE: SQL[] = [sql`${nt.category} COLLATE "C"`, sql`${nt.title} COLLATE "C"`, asc(nt.id)];

/** PostgreSQL playbook.node_templates repository (roadmap P5). `key` is unique. */
@Injectable()
export class NodeTemplateRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  /** Every template (or only the enabled ones), by category then title. */
  async list(options: { enabledOnly?: boolean } = {}): Promise<NodeTemplateRecord[]> {
    const rows = await this.q
      .select()
      .from(nt)
      .where(options.enabledOnly ? eq(nt.enabled, true) : undefined)
      .orderBy(...BY_CATEGORY_TITLE);
    return rows.map(toRecord);
  }

  async findById(id: string): Promise<NodeTemplateRecord | null> {
    if (!isObjectId(id)) return null;
    const [row] = await this.q.select().from(nt).where(eq(nt.id, normalizeObjectId(id))).limit(1);
    return row ? toRecord(row) : null;
  }

  /** Whether another template than `exceptId` already has this key. */
  async keyTaken(key: string, exceptId?: string): Promise<boolean> {
    const rows = await this.q
      .select({ id: nt.id })
      .from(nt)
      .where(and(eq(nt.key, key), exceptId && isObjectId(exceptId) ? ne(nt.id, normalizeObjectId(exceptId)) : undefined))
      .limit(1);
    return rows.length > 0;
  }

  /** Inserts a template; a duplicate key surfaces as a unique violation (uq_playbook_node_templates_key). */
  async create(input: NewNodeTemplate): Promise<NodeTemplateRecord> {
    const [row] = await this.q.insert(nt).values(toInsert(input, new Date())).returning();
    return toRecord(row);
  }

  /**
   * Writes the given fields and bumps `version` by one in the same statement. Null when the template
   * is gone; a key already taken surfaces as a unique violation.
   */
  async update(id: string, fields: NodeTemplateFields): Promise<NodeTemplateRecord | null> {
    if (!isObjectId(id)) return null;
    const [row] = await this.q
      .update(nt)
      .set({ ...toColumns(fields), version: sql`${nt.version} + 1`, updatedAt: new Date() })
      .where(eq(nt.id, normalizeObjectId(id)))
      .returning();
    return row ? toRecord(row) : null;
  }

  async delete(id: string): Promise<boolean> {
    if (!isObjectId(id)) return false;
    const rows = await this.q.delete(nt).where(eq(nt.id, normalizeObjectId(id))).returning({ id: nt.id });
    return rows.length > 0;
  }

  /**
   * Replaces the catalogue with `items`, in one transaction: each item overwrites the template of its
   * key (created when absent, keeping its id and creation time otherwise) and every other template is
   * deleted. An empty import deletes them all.
   */
  async replaceAll(items: NewNodeTemplate[]): Promise<void> {
    await withTransaction(this.db, async () => {
      const now = new Date();
      for (const item of items) {
        const row = toInsert(item, now);
        const { id: _id, createdAt: _createdAt, ...set } = row;
        await this.q.insert(nt).values(row).onConflictDoUpdate({ target: nt.key, set });
      }
      const keys = items.map((item) => stripNul(item.key.trim()));
      await this.q.delete(nt).where(keys.length > 0 ? notInArray(nt.key, keys) : undefined);
    });
  }
}
