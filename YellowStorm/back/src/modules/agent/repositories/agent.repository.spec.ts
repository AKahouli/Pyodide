import { Types } from 'mongoose';
import { sql as sqlTag } from 'drizzle-orm';
import { AgentRepository, CreateAgentInput } from './agent.repository';
import type { AgentRecord } from './agent-record.mapper';
import { describeIntegration, makeTestDb, deleteAgents } from '../../postgres/testing/pg-integration';

// Remote Postgres → allow generous timeouts for network round-trips in hooks/tests.
jest.setTimeout(60000);

const oid = () => new Types.ObjectId().toString();

/** Create many agents concurrently and register their ids for cleanup. */
async function seed(repo: AgentRepository, sink: string[], db: { execute: (q: ReturnType<typeof sqlTag>) => Promise<unknown> }, inputs: CreateAgentInput[]): Promise<void> {
  sink.push(...inputs.map((i) => i.id));
  for (const input of inputs) await createAgent(repo, db, input);
}

/** fk_agents_agent_type requires the type row; seed it, then create the agent. */
async function createAgent(repo: AgentRepository, db: { execute: (q: ReturnType<typeof sqlTag>) => Promise<unknown> }, input: CreateAgentInput): Promise<AgentRecord> {
  // The 1B.4 FKs require referenced catalog rows to exist; seed them.
  await db.execute(
    sqlTag`INSERT INTO catalog.agent_types (id, name, slug, default_prompt) VALUES (${input.agentType}, ${'type-' + input.agentType}, ${'type-' + input.agentType}, '') ON CONFLICT DO NOTHING`,
  );
  for (const toolId of input.tools ?? []) {
    await db.execute(sqlTag`INSERT INTO catalog.tools (id, name, description) VALUES (${toolId}, ${'tool-' + toolId}, '') ON CONFLICT DO NOTHING`);
  }
  for (const skillId of [...(input.skills ?? []), ...(input.disabledSkills ?? [])]) {
    await db.execute(sqlTag`INSERT INTO catalog.skills (id, slug, name, description, created_by) VALUES (${skillId}, ${'skill-' + skillId}, ${'skill-' + skillId}, '', '000000000000000000000000') ON CONFLICT DO NOTHING`);
  }
  return repo.create(input);
}

function createInput(over: Partial<CreateAgentInput> = {}): CreateAgentInput {
  return {
    id: oid(),
    name: `Agent ${oid().slice(-6)}`,
    slug: `agent-${oid().slice(-6)}`,
    agentType: oid(),
    agentTypeSlug: 'mono-agent',
    role: 'role text',
    description: '',
    temperature: 0,
    instruction: '',
    ignorePrePrompt: false,
    knowledgeBases: [],
    tools: [],
    skills: [],
    disabledSkills: [],
    connectors: [],
    connectorActionSelections: [],
    guardrails: {},
    deploymentSettings: {},
    enable_temporary_child_agents: false,
    max_temporary_child_agents: 4,
    isDefault: false,
    isActive: true,
    isDefaultForType: false,
    createdBy: oid(),
    ...over,
  };
}

describeIntegration('AgentRepository create/findById (integration)', () => {
  const { db, close } = makeTestDb();
  const repo = new AgentRepository(db as never);
  const created: string[] = [];
  afterEach(async () => { await deleteAgents(db, created.splice(0)); });
  afterAll(async () => { await close(); });

  it('creates an agent with junctions and reads it back in lean-doc shape', async () => {
    const toolId = oid(); const skillId = oid(); const connectorId = oid(); const wsId = oid();
    const input = createInput({
      tools: [toolId], skills: [skillId], connectors: [connectorId], knowledgeBases: [wsId],
      connectorActionSelections: [{ connectorId, actionKeys: ['send', 'list'] }],
      guardrails: { promptInjection: { inputGuardrailEnabled: true } },
    });
    created.push(input.id);

    const rec = await createAgent(repo, db, input);
    expect(rec._id).toBe(input.id);
    expect(rec.tools).toEqual([toolId]);
    expect(rec.connectorActionSelections).toEqual([{ connector: connectorId, actionKeys: ['send', 'list'] }]);

    const fetched = await repo.findById(input.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.agentType).toBe(input.agentType);
    expect(fetched!.skills).toEqual([skillId]);
    expect(fetched!.knowledgeBases).toEqual([wsId]);
    expect(fetched!.guardrails).toEqual({ promptInjection: { inputGuardrailEnabled: true } });
  });

  it('findById returns null for a missing id', async () => {
    expect(await repo.findById(oid())).toBeNull();
  });
});

describeIntegration('AgentRepository reads (integration)', () => {
  const { db, close } = makeTestDb();
  const repo = new AgentRepository(db as never);
  const created: string[] = [];
  afterEach(async () => { await deleteAgents(db, created.splice(0)); });
  afterAll(async () => { await close(); });

  it("findForUser returns the user's non-default active agents plus active defaults", async () => {
    const userId = oid();
    const mine = createInput({ createdBy: userId, isDefault: false, isActive: true, name: `mine-${oid().slice(-6)}` });
    const def = createInput({ isDefault: true, isActive: true, name: `def-${oid().slice(-6)}` });
    const otherUser = createInput({ createdBy: oid(), isDefault: false, isActive: true, name: `other-${oid().slice(-6)}` });
    const inactiveMine = createInput({ createdBy: userId, isDefault: false, isActive: false, name: `inact-${oid().slice(-6)}` });
    await seed(repo, created, db, [mine, def, otherUser, inactiveMine]);

    const result = await repo.findForUser(userId);
    const ids = result.map((r) => r._id);
    expect(ids).toContain(mine.id);
    expect(ids).toContain(def.id);
    expect(ids).not.toContain(otherUser.id);
    expect(ids).not.toContain(inactiveMine.id);
  });

  it('listUserAgents paginates and filters by case-insensitive name search', async () => {
    const userId = oid();
    const a = createInput({ createdBy: userId, name: `Zeta-${oid().slice(-6)}` });
    const b = createInput({ createdBy: userId, name: `Alpha-${oid().slice(-6)}` });
    await seed(repo, created, db, [a, b]);
    const page = await repo.listUserAgents({ userId, search: 'alpha', page: 1, limit: 10 });
    expect(page.total).toBe(1);
    expect(page.items[0]._id).toBe(b.id);
  });

  it('findByNameAndOwner and findBySlug honor owner scoping and excludeId', async () => {
    const userId = oid();
    const slug = `slug-${oid().slice(-6)}`;
    const a = createInput({ createdBy: userId, slug, isDefault: false });
    created.push(a.id); await createAgent(repo, db, a);
    expect((await repo.findByNameAndOwner(a.name, userId))!._id).toBe(a.id);
    expect(await repo.findByNameAndOwner(a.name, oid())).toBeNull();
    expect((await repo.findBySlug({ slug, isDefault: false, userId }))!._id).toBe(a.id);
    expect(await repo.findBySlug({ slug, isDefault: false, userId, excludeId: a.id })).toBeNull();
  });

  it('countByAgentType counts all agents of a type', async () => {
    const typeId = oid();
    const a = createInput({ agentType: typeId }); const b = createInput({ agentType: typeId });
    await seed(repo, created, db, [a, b]);
    expect(await repo.countByAgentType(typeId)).toBe(2);
  });
});

describeIntegration('AgentRepository update/delete (integration)', () => {
  const { db, close } = makeTestDb();
  const repo = new AgentRepository(db as never);
  const created: string[] = [];
  afterEach(async () => { await deleteAgents(db, created.splice(0)); });
  afterAll(async () => { await close(); });

  it('updateById replaces provided junctions and updates scalars', async () => {
    const t1 = oid(), t2 = oid();
    const input = createInput({ tools: [t1], description: 'old' });
    created.push(input.id); await createAgent(repo, db, input);
    await db.execute(sqlTag`INSERT INTO catalog.tools (id, name, description) VALUES (${t2}, ${'tool-' + t2}, '') ON CONFLICT DO NOTHING`);

    const updated = await repo.updateById(input.id, { description: 'new', tools: [t2] });
    expect(updated!.description).toBe('new');
    expect(updated!.tools).toEqual([t2]); // replaced, not merged
  });

  it('updateById leaves junctions untouched when the array is omitted', async () => {
    const t1 = oid();
    const input = createInput({ tools: [t1] });
    created.push(input.id); await createAgent(repo, db, input);
    const updated = await repo.updateById(input.id, { description: 'x' });
    expect(updated!.tools).toEqual([t1]);
  });

  it('updateById persists new guardrails and deploymentSettings jsonb', async () => {
    const input = createInput({ guardrails: {}, deploymentSettings: {} });
    created.push(input.id); await createAgent(repo, db, input);
    const updated = await repo.updateById(input.id, {
      guardrails: { promptInjection: { inputGuardrailEnabled: true } },
      deploymentSettings: { embedEnabled: true, restEnabled: false, widget: null },
    });
    expect(updated!.guardrails).toEqual({ promptInjection: { inputGuardrailEnabled: true } });
    expect(updated!.deploymentSettings).toEqual({ embedEnabled: true, restEnabled: false, widget: null });
  });

  it('deleteById removes the agent and cascades junctions', async () => {
    const input = createInput({ tools: [oid()] });
    created.push(input.id); await createAgent(repo, db, input);
    await repo.deleteById(input.id);
    expect(await repo.findById(input.id)).toBeNull();
  });

  it('clearDefaultForType unsets the flag for the matching personal scope', async () => {
    const userId = oid(); const typeId = oid();
    const a = createInput({ createdBy: userId, agentType: typeId, isDefault: false, isDefaultForType: true });
    created.push(a.id); await createAgent(repo, db, a);
    await repo.clearDefaultForType({ agentTypeId: typeId, isPersonal: true, userId });
    expect((await repo.findById(a.id))!.isDefaultForType).toBe(false);
  });
});

describeIntegration('AgentRepository plan-4 methods (integration)', () => {
  const { db, close } = makeTestDb();
  const repo = new AgentRepository(db as never);
  const created: string[] = [];
  afterEach(async () => { await deleteAgents(db, created.splice(0)); });
  afterAll(async () => { await close(); });

  it('deleteByIdAndOwner deletes only when the owner matches', async () => {
    const owner = oid();
    const a = createInput({ createdBy: owner });
    created.push(a.id); await createAgent(repo, db, a);
    await repo.deleteByIdAndOwner(a.id, oid()); // wrong owner -> no-op
    expect(await repo.findById(a.id)).not.toBeNull();
    await repo.deleteByIdAndOwner(a.id, owner);
    expect(await repo.findById(a.id)).toBeNull();
  });

  it('findActiveDefaultsByType returns up to limit active defaults of a type', async () => {
    const typeId = oid();
    const a = createInput({ agentType: typeId, isDefault: true, isActive: true });
    const b = createInput({ agentType: typeId, isDefault: true, isActive: true });
    await seed(repo, created, db, [a, b]);
    const found = await repo.findActiveDefaultsByType(typeId, 2);
    expect(found).toHaveLength(2);
  });

  it('createDefaultSystemAgentIfMissing reuses an existing slug regardless of default status', async () => {
    const slug = `system-${oid().slice(-6)}`;
    const existing = createInput({
      slug,
      isDefault: false,
      instruction: 'custom instruction',
      llmModel: 'custom-model',
      guardrails: { custom: true },
      connectors: [oid()],
      connectorActionSelections: [],
      skills: [oid()],
      knowledgeBases: [oid()],
    });
    created.push(existing.id);
    await createAgent(repo, db, existing);

    const result = await repo.createDefaultSystemAgentIfMissing({
      ...createInput({ slug, isDefault: true }),
      id: oid(),
      name: existing.name,
      createdBy: existing.createdBy,
      instruction: '',
      llmModel: undefined,
      connectors: [],
      skills: [],
      knowledgeBases: [],
    });

    expect(result).toMatchObject({
      _id: existing.id,
      instruction: existing.instruction,
      llmModel: existing.llmModel,
      guardrails: existing.guardrails,
      connectors: existing.connectors,
      skills: existing.skills,
      knowledgeBases: existing.knowledgeBases,
    });
  });

  it('createDefaultSystemAgentIfMissing converges concurrent startup inserts', async () => {
    const slug = `system-${oid().slice(-6)}`;
    const first = createInput({ id: oid(), slug, isDefault: true });
    const second = { ...first, id: oid() };
    created.push(first.id, second.id);

    await db.execute(
      sqlTag`INSERT INTO catalog.agent_types (id, name, slug, default_prompt) VALUES (${first.agentType}, ${'type-' + first.agentType}, ${'type-' + first.agentType}, '') ON CONFLICT DO NOTHING`,
    );
    const [a, b] = await Promise.all([
      repo.createDefaultSystemAgentIfMissing(first),
      repo.createDefaultSystemAgentIfMissing(second),
    ]);

    expect(a._id).toBe(b._id);
    expect(a.slug).toBe(slug);
  });

  it('setRoleEmbedding stores a 2560-dim halfvec on the agent', async () => {
    const input = createInput({});
    created.push(input.id); await createAgent(repo, db, input);
    const vec = Array.from({ length: 2560 }, (_, i) => (i % 7) / 10);
    await repo.setRoleEmbedding(input.id, vec);
    const rows = await (db as never as { execute: (q: unknown) => Promise<{ rows: Array<{ has: boolean }> }> })
      .execute(sqlTag`SELECT role_embedding IS NOT NULL AS has FROM agents WHERE id = ${input.id}`);
    expect(rows.rows[0].has).toBe(true);
  });

});

describeIntegration('AgentRepository catalog junction cascades (integration)', () => {
  // Since 1B.4.8 the agent junctions cascade from catalog.tools / catalog.skills
  // via validated FKs — deleting the catalog row cleans every agent's junction.
  const { db, close } = makeTestDb();
  const repo = new AgentRepository(db as never);
  const created: string[] = [];
  const catalogIds: string[] = [];
  afterEach(async () => { await deleteAgents(db, created.splice(0)); });
  afterAll(async () => { await close(); });

  it('deleting a catalog tool cascades agent_tools rows away', async () => {
    const toolId = oid();
    await db.execute(sqlTag`INSERT INTO catalog.tools (id, name, description) VALUES (${toolId}, ${'cascade-tool-' + toolId}, '')`);
    catalogIds.push(toolId);
    const a = createInput({ tools: [toolId, oid()] });
    await seed(repo, created, db, [a]);

    await db.execute(sqlTag`DELETE FROM catalog.tools WHERE id = ${toolId}`);

    const rec = await repo.findById(a.id)!;
    expect(rec!.tools).not.toContain(toolId);
    expect(rec!.tools).toHaveLength(1);
  });

  it('deleting a catalog skill cascades agent_skills and agent_disabled_skills', async () => {
    const skillId = oid();
    await db.execute(sqlTag`INSERT INTO catalog.skills (id, slug, name, description, created_by) VALUES (${skillId}, ${'cascade-skill-' + skillId}, ${'cascade-skill-' + skillId}, '', '000000000000000000000000')`);
    catalogIds.push(skillId);
    const a = createInput({ skills: [skillId], disabledSkills: [skillId] });
    created.push(a.id); await createAgent(repo, db, a);

    await db.execute(sqlTag`DELETE FROM catalog.skills WHERE id = ${skillId}`);

    const rec = await repo.findById(a.id);
    expect(rec!.skills).toEqual([]);
    expect(rec!.disabledSkills).toEqual([]);
  });
});
