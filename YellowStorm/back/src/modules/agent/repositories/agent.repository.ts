import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, or, desc, asc, ilike, sql, count } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '../../postgres/postgres.constants';
import * as schema from '../../postgres/schema';
import { AgentRecord, AgentJunctions, rowToRecord, trim24 } from './agent-record.mapper';

const {
  agents, agentTools, agentSkills, agentDisabledSkills,
  agentConnectors, agentKnowledgeBases, agentConnectorActions,
} = schema;

export interface CreateAgentInput {
  id: string;
  name: string;
  slug: string;
  agentType: string;
  agentTypeSlug: string;
  role: string;
  description: string;
  temperature: number;
  llmModel?: string;
  email?: string;
  instruction: string;
  ignorePrePrompt: boolean;
  knowledgeBases: string[];
  tools: string[];
  skills: string[];
  disabledSkills: string[];
  connectors: string[];
  connectorActionSelections: Array<{ connectorId: string; actionKeys: string[] }>;
  guardrails: Record<string, unknown>;
  deploymentSettings: Record<string, unknown>;
  enable_temporary_child_agents: boolean;
  max_temporary_child_agents: number;
  isDefault: boolean;
  isActive: boolean;
  isDefaultForType: boolean;
  createdBy: string;
  a2aPublished?: boolean;
  a2aAgentId?: string | null;
  a2aAgentCardUrl?: string | null;
  a2aApiKeyHeader?: string | null;
  a2aPublishedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UpdateAgentInput {
  name?: string; slug?: string; agentType?: string; agentTypeSlug?: string; role?: string;
  description?: string; temperature?: number; llmModel?: string | null; email?: string | null;
  instruction?: string; ignorePrePrompt?: boolean;
  enable_temporary_child_agents?: boolean; max_temporary_child_agents?: number;
  isDefault?: boolean; isActive?: boolean; isDefaultForType?: boolean;
  guardrails?: Record<string, unknown>; deploymentSettings?: Record<string, unknown>;
  a2aPublished?: boolean; a2aAgentId?: string | null; a2aAgentCardUrl?: string | null;
  a2aApiKeyHeader?: string | null; a2aPublishedAt?: Date | null;
  tools?: string[]; skills?: string[]; disabledSkills?: string[]; connectors?: string[];
  knowledgeBases?: string[]; connectorActionSelections?: Array<{ connectorId: string; actionKeys: string[] }>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

@Injectable()
export class AgentRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  async create(input: CreateAgentInput): Promise<AgentRecord> {
    await this.db.transaction(async (tx: Tx) => {
      await tx.insert(agents).values({
        id: input.id,
        name: input.name,
        slug: input.slug,
        role: input.role,
        description: input.description,
        temperature: input.temperature,
        llmModel: input.llmModel ?? null,
        email: input.email ?? null,
        instruction: input.instruction,
        ignorePrePrompt: input.ignorePrePrompt,
        agentTypeId: input.agentType,
        agentTypeSlug: input.agentTypeSlug,
        enableTemporaryChildAgents: input.enable_temporary_child_agents,
        maxTemporaryChildAgents: input.max_temporary_child_agents,
        isDefault: input.isDefault,
        isActive: input.isActive,
        isDefaultForType: input.isDefaultForType,
        createdBy: input.createdBy,
        guardrails: input.guardrails,
        deploymentSettings: input.deploymentSettings,
        a2aPublished: input.a2aPublished ?? false,
        a2aAgentId: input.a2aAgentId ?? null,
        a2aAgentCardUrl: input.a2aAgentCardUrl ?? null,
        a2aApiKeyHeader: input.a2aApiKeyHeader ?? null,
        a2aPublishedAt: input.a2aPublishedAt ?? null,
        ...(input.createdAt ? { createdAt: input.createdAt } : {}),
        ...(input.updatedAt ? { updatedAt: input.updatedAt } : {}),
      });
      await this.insertJunctions(tx, input.id, input);
    });
    const rec = await this.findById(input.id);
    if (!rec) throw new Error(`AgentRepository.create: row ${input.id} not found after insert`);
    return rec;
  }

  async findById(id: string): Promise<AgentRecord | null> {
    return this.one(eq(agents.id, id));
  }

  async listUserAgents(p: { userId: string; search?: string; agentType?: string; isActive?: boolean; page: number; limit: number }) {
    const conds = [eq(agents.createdBy, p.userId), eq(agents.isDefault, false)];
    if (p.search) conds.push(ilike(agents.name, `%${p.search}%`));
    if (p.agentType) conds.push(eq(agents.agentTypeId, p.agentType));
    if (p.isActive !== undefined) conds.push(eq(agents.isActive, p.isActive));
    return this.paginate(and(...conds)!, p.page, p.limit);
  }

  async listDefaultAgents(p: { search?: string; agentType?: string; isActive?: boolean; page: number; limit: number }) {
    const conds = [eq(agents.isDefault, true)];
    if (p.search) conds.push(ilike(agents.name, `%${p.search}%`));
    if (p.agentType) conds.push(eq(agents.agentTypeId, p.agentType));
    if (p.isActive !== undefined) conds.push(eq(agents.isActive, p.isActive));
    return this.paginate(and(...conds)!, p.page, p.limit);
  }

  async listHumainPublic(p: { agentTypeId: string; name?: string; role?: string; description?: string; page: number; limit: number }) {
    const conds = [eq(agents.agentTypeId, p.agentTypeId)];
    if (p.name) conds.push(ilike(agents.name, `%${p.name}%`));
    if (p.role) conds.push(ilike(agents.role, `%${p.role}%`));
    if (p.description) conds.push(ilike(agents.description, `%${p.description}%`));
    return this.paginate(and(...conds)!, p.page, p.limit);
  }

  async findForUser(userId: string): Promise<AgentRecord[]> {
    const rows = await this.db.select().from(agents)
      .where(and(eq(agents.isActive, true), or(and(eq(agents.createdBy, userId), eq(agents.isDefault, false)), eq(agents.isDefault, true))))
      .orderBy(desc(agents.isDefault), desc(agents.createdAt));
    return this.assemble(rows);
  }

  async findByIdsForUser(ids: string[], userId: string): Promise<AgentRecord[]> {
    if (ids.length === 0) return [];
    const rows = await this.db.select().from(agents)
      .where(and(inArray(agents.id, ids), eq(agents.isActive, true),
        or(and(eq(agents.createdBy, userId), eq(agents.isDefault, false)), eq(agents.isDefault, true))));
    return this.assemble(rows);
  }

  async findByIds(ids: string[], opts?: { activeOnly?: boolean }): Promise<AgentRecord[]> {
    if (ids.length === 0) return [];
    const conds = [inArray(agents.id, ids)];
    if (opts?.activeOnly) conds.push(eq(agents.isActive, true));
    const rows = await this.db.select().from(agents).where(and(...conds));
    return this.assemble(rows);
  }

  async findByIdDefault(id: string): Promise<AgentRecord | null> {
    return this.one(and(eq(agents.id, id), eq(agents.isDefault, true))!);
  }

  async findDefaultByType(agentTypeId: string): Promise<AgentRecord | null> {
    return this.one(and(eq(agents.agentTypeId, agentTypeId), eq(agents.isDefault, true), eq(agents.isActive, true))!);
  }

  async findDefaultByNameActive(name: string): Promise<AgentRecord | null> {
    return this.one(and(sql`lower(${agents.name}) = lower(${name})`, eq(agents.isDefault, true), eq(agents.isActive, true))!);
  }

  async findActiveDefaults(): Promise<AgentRecord[]> {
    const rows = await this.db.select().from(agents)
      .where(and(eq(agents.isDefault, true), eq(agents.isActive, true))).orderBy(asc(agents.name));
    return this.assemble(rows);
  }

  async existsActiveDefault(id: string): Promise<boolean> {
    const rows = await this.db.select({ id: agents.id }).from(agents)
      .where(and(eq(agents.id, id), eq(agents.isDefault, true), eq(agents.isActive, true))).limit(1);
    return rows.length > 0;
  }

  async findActiveDefaultIdBySlug(slug: string): Promise<string | null> {
    const rows = await this.db.select({ id: agents.id }).from(agents)
      .where(and(eq(agents.slug, slug), eq(agents.isDefault, true), eq(agents.isActive, true))).limit(1);
    return rows.length ? trim24(rows[0].id) : null;
  }

  async countByAgentType(agentTypeId: string): Promise<number> {
    const rows = await this.db.select({ c: count() }).from(agents).where(eq(agents.agentTypeId, agentTypeId));
    return Number(rows[0].c);
  }

  async findByNameAndOwner(name: string, userId: string): Promise<AgentRecord | null> {
    return this.one(and(eq(agents.name, name), eq(agents.createdBy, userId))!);
  }

  async findByNameDefault(name: string): Promise<AgentRecord | null> {
    return this.one(and(eq(agents.name, name), eq(agents.isDefault, true))!);
  }

  async findBySlug(p: { slug: string; isDefault: boolean; userId?: string; excludeId?: string }): Promise<AgentRecord | null> {
    const conds = [eq(agents.slug, p.slug), eq(agents.isDefault, p.isDefault)];
    if (!p.isDefault && p.userId) conds.push(eq(agents.createdBy, p.userId));
    if (p.excludeId) conds.push(sql`${agents.id} <> ${p.excludeId}`);
    return this.one(and(...conds)!);
  }

  async findByOwnerAndType(userId: string, agentTypeId: string): Promise<AgentRecord | null> {
    return this.one(and(eq(agents.createdBy, userId), eq(agents.agentTypeId, agentTypeId))!);
  }

  async updateById(id: string, patch: UpdateAgentInput): Promise<AgentRecord | null> {
    const exists = await this.db.select({ id: agents.id }).from(agents).where(eq(agents.id, id)).limit(1);
    if (exists.length === 0) return null;

    await this.db.transaction(async (tx: Tx) => {
      const set: Record<string, unknown> = { updatedAt: new Date() };
      const scalarMap: Array<[keyof UpdateAgentInput, string]> = [
        ['name', 'name'], ['slug', 'slug'], ['agentType', 'agentTypeId'], ['agentTypeSlug', 'agentTypeSlug'],
        ['role', 'role'], ['description', 'description'], ['temperature', 'temperature'], ['llmModel', 'llmModel'],
        ['email', 'email'], ['instruction', 'instruction'], ['ignorePrePrompt', 'ignorePrePrompt'],
        ['enable_temporary_child_agents', 'enableTemporaryChildAgents'], ['max_temporary_child_agents', 'maxTemporaryChildAgents'],
        ['isDefault', 'isDefault'], ['isActive', 'isActive'], ['isDefaultForType', 'isDefaultForType'],
        ['guardrails', 'guardrails'], ['deploymentSettings', 'deploymentSettings'],
        ['a2aPublished', 'a2aPublished'], ['a2aAgentId', 'a2aAgentId'], ['a2aAgentCardUrl', 'a2aAgentCardUrl'],
        ['a2aApiKeyHeader', 'a2aApiKeyHeader'], ['a2aPublishedAt', 'a2aPublishedAt'],
      ];
      for (const [inKey, col] of scalarMap) {
        if (patch[inKey] !== undefined) set[col] = patch[inKey];
      }
      await tx.update(agents).set(set).where(eq(agents.id, id));
      await this.replaceJunction(tx, id, patch);
    });
    return this.findById(id);
  }

  async deleteById(id: string): Promise<void> {
    await this.db.delete(agents).where(eq(agents.id, id));
  }

  async clearDefaultForType(p: { agentTypeId: string; isPersonal: boolean; userId?: string; excludeId?: string }): Promise<void> {
    const conds = [eq(agents.agentTypeId, p.agentTypeId), eq(agents.isDefaultForType, true)];
    if (p.isPersonal) { conds.push(eq(agents.isDefault, false)); if (p.userId) conds.push(eq(agents.createdBy, p.userId)); }
    else { conds.push(eq(agents.isDefault, true)); }
    if (p.excludeId) conds.push(sql`${agents.id} <> ${p.excludeId}`);
    await this.db.update(agents).set({ isDefaultForType: false }).where(and(...conds));
  }

  async pullToolFromAll(toolId: string): Promise<void> {
    await this.db.delete(agentTools).where(eq(agentTools.toolId, toolId));
  }
  async pullSkillFromAll(skillId: string): Promise<void> {
    await this.db.delete(agentSkills).where(eq(agentSkills.skillId, skillId));
  }
  async pullDisabledSkillFromAll(skillId: string): Promise<void> {
    await this.db.delete(agentDisabledSkills).where(eq(agentDisabledSkills.skillId, skillId));
  }
  async pullKnowledgeBaseFromAll(workspaceId: string): Promise<void> {
    await this.db.delete(agentKnowledgeBases).where(eq(agentKnowledgeBases.workspaceId, workspaceId));
  }
  async pullConnectorFromAll(connectorId: string): Promise<void> {
    await this.db.transaction(async (tx: Tx) => {
      await tx.delete(agentConnectors).where(eq(agentConnectors.connectorId, connectorId));
      await tx.delete(agentConnectorActions).where(eq(agentConnectorActions.connectorId, connectorId));
    });
  }

  async deleteByIdAndOwner(id: string, ownerId: string): Promise<void> {
    await this.db.delete(agents).where(and(eq(agents.id, id), eq(agents.createdBy, ownerId)));
  }

  async findActiveDefaultsByType(agentTypeId: string, limit: number): Promise<AgentRecord[]> {
    const rows = await this.db.select().from(agents)
      .where(and(eq(agents.agentTypeId, agentTypeId), eq(agents.isDefault, true), eq(agents.isActive, true)))
      .limit(limit);
    return this.assemble(rows);
  }

  async pullConnectorFromAllExcept(connectorId: string, exceptAgentId: string): Promise<void> {
    await this.db.transaction(async (tx: Tx) => {
      await tx.delete(agentConnectors).where(and(eq(agentConnectors.connectorId, connectorId), sql`${agentConnectors.agentId} <> ${exceptAgentId}`));
      await tx.delete(agentConnectorActions).where(and(eq(agentConnectorActions.connectorId, connectorId), sql`${agentConnectorActions.agentId} <> ${exceptAgentId}`));
    });
  }

  async findIdsByInstructionLike(pattern: string, exceptAgentId: string): Promise<Array<{ id: string; instruction: string }>> {
    const rows = await this.db.select({ id: agents.id, instruction: agents.instruction }).from(agents)
      .where(and(ilike(agents.instruction, pattern), sql`${agents.id} <> ${exceptAgentId}`));
    return rows.map((r) => ({ id: trim24(r.id), instruction: r.instruction }));
  }

  // ---- internals ----

  private async insertJunctions(
    tx: Tx,
    agentId: string,
    j: Pick<CreateAgentInput, 'tools' | 'skills' | 'disabledSkills' | 'connectors' | 'knowledgeBases' | 'connectorActionSelections'>,
  ): Promise<void> {
    if (j.tools.length) await tx.insert(agentTools).values(dedupe(j.tools).map((toolId) => ({ agentId, toolId })));
    if (j.skills.length) await tx.insert(agentSkills).values(dedupe(j.skills).map((skillId) => ({ agentId, skillId })));
    if (j.disabledSkills.length) await tx.insert(agentDisabledSkills).values(dedupe(j.disabledSkills).map((skillId) => ({ agentId, skillId })));
    if (j.connectors.length) await tx.insert(agentConnectors).values(dedupe(j.connectors).map((connectorId) => ({ agentId, connectorId })));
    if (j.knowledgeBases.length) await tx.insert(agentKnowledgeBases).values(dedupe(j.knowledgeBases).map((workspaceId) => ({ agentId, workspaceId })));
    const actions = (j.connectorActionSelections || []).filter((a) => a.connectorId && a.actionKeys?.length);
    if (actions.length) {
      await tx.insert(agentConnectorActions).values(actions.map((a) => ({ agentId, connectorId: a.connectorId, actionKeys: a.actionKeys })));
    }
  }

  private async replaceJunction(tx: Tx, agentId: string, patch: UpdateAgentInput): Promise<void> {
    if (patch.tools !== undefined) {
      await tx.delete(agentTools).where(eq(agentTools.agentId, agentId));
      if (patch.tools.length) await tx.insert(agentTools).values(dedupe(patch.tools).map((toolId) => ({ agentId, toolId })));
    }
    if (patch.skills !== undefined) {
      await tx.delete(agentSkills).where(eq(agentSkills.agentId, agentId));
      if (patch.skills.length) await tx.insert(agentSkills).values(dedupe(patch.skills).map((skillId) => ({ agentId, skillId })));
    }
    if (patch.disabledSkills !== undefined) {
      await tx.delete(agentDisabledSkills).where(eq(agentDisabledSkills.agentId, agentId));
      if (patch.disabledSkills.length) await tx.insert(agentDisabledSkills).values(dedupe(patch.disabledSkills).map((skillId) => ({ agentId, skillId })));
    }
    if (patch.connectors !== undefined) {
      await tx.delete(agentConnectors).where(eq(agentConnectors.agentId, agentId));
      if (patch.connectors.length) await tx.insert(agentConnectors).values(dedupe(patch.connectors).map((connectorId) => ({ agentId, connectorId })));
    }
    if (patch.knowledgeBases !== undefined) {
      await tx.delete(agentKnowledgeBases).where(eq(agentKnowledgeBases.agentId, agentId));
      if (patch.knowledgeBases.length) await tx.insert(agentKnowledgeBases).values(dedupe(patch.knowledgeBases).map((workspaceId) => ({ agentId, workspaceId })));
    }
    if (patch.connectorActionSelections !== undefined) {
      await tx.delete(agentConnectorActions).where(eq(agentConnectorActions.agentId, agentId));
      const actions = patch.connectorActionSelections.filter((a) => a.connectorId && a.actionKeys?.length);
      if (actions.length) await tx.insert(agentConnectorActions).values(actions.map((a) => ({ agentId, connectorId: a.connectorId, actionKeys: a.actionKeys })));
    }
  }

  private async one(where: NonNullable<ReturnType<typeof and>>): Promise<AgentRecord | null> {
    const rows = await this.db.select().from(agents).where(where).limit(1);
    if (rows.length === 0) return null;
    const [rec] = await this.assemble(rows);
    return rec;
  }

  private async paginate(where: NonNullable<ReturnType<typeof and>>, page: number, limit: number): Promise<{ items: AgentRecord[]; total: number }> {
    const offset = (page - 1) * limit;
    const [rows, totalRows] = await Promise.all([
      this.db.select().from(agents).where(where).orderBy(desc(agents.createdAt)).limit(limit).offset(offset),
      this.db.select({ c: count() }).from(agents).where(where),
    ]);
    return { items: await this.assemble(rows), total: Number(totalRows[0].c) };
  }

  private async assemble(rows: (typeof agents.$inferSelect)[]): Promise<AgentRecord[]> {
    const ids = rows.map((r) => trim24(r.id));
    const junctions = await this.loadJunctions(ids);
    return rows.map((r) => rowToRecord(r, junctions.get(trim24(r.id)) ?? emptyJunctions()));
  }

  private async loadJunctions(ids: string[]): Promise<Map<string, AgentJunctions>> {
    const map = new Map<string, AgentJunctions>();
    ids.forEach((id) => map.set(id, emptyJunctions()));
    if (ids.length === 0) return map;

    const [tools, skills, disabled, connectors, kbs, actions] = await Promise.all([
      this.db.select().from(agentTools).where(inArray(agentTools.agentId, ids)),
      this.db.select().from(agentSkills).where(inArray(agentSkills.agentId, ids)),
      this.db.select().from(agentDisabledSkills).where(inArray(agentDisabledSkills.agentId, ids)),
      this.db.select().from(agentConnectors).where(inArray(agentConnectors.agentId, ids)),
      this.db.select().from(agentKnowledgeBases).where(inArray(agentKnowledgeBases.agentId, ids)),
      this.db.select().from(agentConnectorActions).where(inArray(agentConnectorActions.agentId, ids)),
    ]);
    for (const t of tools) map.get(trim24(t.agentId))!.tools.push(trim24(t.toolId));
    for (const s of skills) map.get(trim24(s.agentId))!.skills.push(trim24(s.skillId));
    for (const d of disabled) map.get(trim24(d.agentId))!.disabledSkills.push(trim24(d.skillId));
    for (const c of connectors) map.get(trim24(c.agentId))!.connectors.push(trim24(c.connectorId));
    for (const w of kbs) map.get(trim24(w.agentId))!.knowledgeBases.push(trim24(w.workspaceId));
    for (const a of actions) map.get(trim24(a.agentId))!.connectorActions.push({ connectorId: trim24(a.connectorId), actionKeys: a.actionKeys });
    return map;
  }
}

function emptyJunctions(): AgentJunctions {
  return { tools: [], skills: [], disabledSkills: [], connectors: [], knowledgeBases: [], connectorActions: [] };
}
function dedupe(v: string[]): string[] {
  return [...new Set(v)];
}
