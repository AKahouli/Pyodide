import { Types } from 'mongoose';
import { sql as sqlTag } from 'drizzle-orm';
import { AgentRepository, CreateAgentInput } from './agent.repository';
import { describeIntegration, makeTestDb, deleteAgents } from '../../postgres/testing/pg-integration';

// Remote Postgres → allow generous timeouts for network round-trips in hooks/tests.
jest.setTimeout(60000);

const oid = () => new Types.ObjectId().toString();

/** Create many agents concurrently and register their ids for cleanup. */
async function seed(repo: AgentRepository, sink: string[], inputs: CreateAgentInput[]): Promise<void> {
  sink.push(...inputs.map((i) => i.id));
  await Promise.all(inputs.map((i) => repo.create(i)));
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

    const rec = await repo.create(input);
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
    await seed(repo, created, [mine, def, otherUser, inactiveMine]);

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
    await seed(repo, created, [a, b]);
    const page = await repo.listUserAgents({ userId, search: 'alpha', page: 1, limit: 10 });
    expect(page.total).toBe(1);
    expect(page.items[0]._id).toBe(b.id);
  });

  it('findByNameAndOwner and findBySlug honor owner scoping and excludeId', async () => {
    const userId = oid();
    const slug = `slug-${oid().slice(-6)}`;
    const a = createInput({ createdBy: userId, slug, isDefault: false });
    created.push(a.id); await repo.create(a);
    expect((await repo.findByNameAndOwner(a.name, userId))!._id).toBe(a.id);
    expect(await repo.findByNameAndOwner(a.name, oid())).toBeNull();
    expect((await repo.findBySlug({ slug, isDefault: false, userId }))!._id).toBe(a.id);
    expect(await repo.findBySlug({ slug, isDefault: false, userId, excludeId: a.id })).toBeNull();
  });

  it('countByAgentType counts all agents of a type', async () => {
    const typeId = oid();
    const a = createInput({ agentType: typeId }); const b = createInput({ agentType: typeId });
    await seed(repo, created, [a, b]);
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
    created.push(input.id); await repo.create(input);

    const updated = await repo.updateById(input.id, { description: 'new', tools: [t2] });
    expect(updated!.description).toBe('new');
    expect(updated!.tools).toEqual([t2]); // replaced, not merged
  });

  it('updateById leaves junctions untouched when the array is omitted', async () => {
    const t1 = oid();
    const input = createInput({ tools: [t1] });
    created.push(input.id); await repo.create(input);
    const updated = await repo.updateById(input.id, { description: 'x' });
    expect(updated!.tools).toEqual([t1]);
  });

  it('updateById persists new guardrails and deploymentSettings jsonb', async () => {
    const input = createInput({ guardrails: {}, deploymentSettings: {} });
    created.push(input.id); await repo.create(input);
    const updated = await repo.updateById(input.id, {
      guardrails: { promptInjection: { inputGuardrailEnabled: true } },
      deploymentSettings: { embedEnabled: true, restEnabled: false, widget: null },
    });
    expect(updated!.guardrails).toEqual({ promptInjection: { inputGuardrailEnabled: true } });
    expect(updated!.deploymentSettings).toEqual({ embedEnabled: true, restEnabled: false, widget: null });
  });

  it('deleteById removes the agent and cascades junctions', async () => {
    const input = createInput({ tools: [oid()] });
    created.push(input.id); await repo.create(input);
    await repo.deleteById(input.id);
    expect(await repo.findById(input.id)).toBeNull();
  });

  it('clearDefaultForType unsets the flag for the matching personal scope', async () => {
    const userId = oid(); const typeId = oid();
    const a = createInput({ createdBy: userId, agentType: typeId, isDefault: false, isDefaultForType: true });
    created.push(a.id); await repo.create(a);
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
    created.push(a.id); await repo.create(a);
    await repo.deleteByIdAndOwner(a.id, oid()); // wrong owner -> no-op
    expect(await repo.findById(a.id)).not.toBeNull();
    await repo.deleteByIdAndOwner(a.id, owner);
    expect(await repo.findById(a.id)).toBeNull();
  });

  it('findActiveDefaultsByType returns up to limit active defaults of a type', async () => {
    const typeId = oid();
    const a = createInput({ agentType: typeId, isDefault: true, isActive: true });
    const b = createInput({ agentType: typeId, isDefault: true, isActive: true });
    await seed(repo, created, [a, b]);
    const found = await repo.findActiveDefaultsByType(typeId, 2);
    expect(found).toHaveLength(2);
  });

  it('pullConnectorFromAllExcept removes the connector from all agents but the excepted one', async () => {
    const connectorId = oid();
    const keep = createInput({ connectors: [connectorId], connectorActionSelections: [{ connectorId, actionKeys: ['x'] }] });
    const strip = createInput({ connectors: [connectorId], connectorActionSelections: [{ connectorId, actionKeys: ['x'] }] });
    await seed(repo, created, [keep, strip]);
    await repo.pullConnectorFromAllExcept(connectorId, keep.id);
    expect((await repo.findById(keep.id))!.connectors).toEqual([connectorId]);
    expect((await repo.findById(strip.id))!.connectors).toEqual([]);
    expect((await repo.findById(strip.id))!.connectorActionSelections).toEqual([]);
  });

  it('setRoleEmbedding stores a 3072-dim halfvec on the agent', async () => {
    const input = createInput({});
    created.push(input.id); await repo.create(input);
    const vec = Array.from({ length: 3072 }, (_, i) => (i % 7) / 10);
    await repo.setRoleEmbedding(input.id, vec);
    const rows = await (db as never as { execute: (q: unknown) => Promise<{ rows: Array<{ has: boolean }> }> })
      .execute(sqlTag`SELECT role_embedding IS NOT NULL AS has FROM agents WHERE id = ${input.id}`);
    expect(rows.rows[0].has).toBe(true);
  });

  it('findIdsByInstructionLike matches by ILIKE and excludes the given id', async () => {
    const tag = `[Playbook MCP ${oid().slice(-6)}]`;
    const a = createInput({ instruction: `hello ${tag} world` });
    const b = createInput({ instruction: `hello ${tag} world` });
    await seed(repo, created, [a, b]);
    const found = await repo.findIdsByInstructionLike(`%${tag}%`, a.id);
    expect(found.map((r) => r.id)).toEqual([b.id]);
    expect(found[0].instruction).toContain(tag);
  });
});

describeIntegration('AgentRepository pull ops (integration)', () => {
  const { db, close } = makeTestDb();
  const repo = new AgentRepository(db as never);
  const created: string[] = [];
  afterEach(async () => { await deleteAgents(db, created.splice(0)); });
  afterAll(async () => { await close(); });

  it('pullToolFromAll removes the tool from every agent', async () => {
    const toolId = oid();
    const a = createInput({ tools: [toolId, oid()] });
    const b = createInput({ tools: [toolId] });
    await seed(repo, created, [a, b]);
    await repo.pullToolFromAll(toolId);
    expect((await repo.findById(a.id))!.tools).not.toContain(toolId);
    expect((await repo.findById(b.id))!.tools).toEqual([]);
  });

  it('pullSkillFromAll and pullDisabledSkillFromAll remove from both tables', async () => {
    const skillId = oid();
    const a = createInput({ skills: [skillId], disabledSkills: [skillId] });
    created.push(a.id); await repo.create(a);
    await repo.pullSkillFromAll(skillId);
    await repo.pullDisabledSkillFromAll(skillId);
    const rec = await repo.findById(a.id);
    expect(rec!.skills).toEqual([]);
    expect(rec!.disabledSkills).toEqual([]);
  });
});
