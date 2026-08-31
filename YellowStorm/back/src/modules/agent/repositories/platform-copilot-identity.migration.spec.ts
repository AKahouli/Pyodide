import * as fs from 'fs';
import * as path from 'path';
import { Types } from 'mongoose';
import { AgentRepository, CreateAgentInput } from './agent.repository';
import { deleteAgents, describeIntegration, makeTestDb } from '../../postgres/testing/pg-integration';

const initialMigrationSql = fs.readFileSync(
  path.resolve(process.cwd(), 'drizzle/0002_platform_copilot_identity.sql'),
  'utf8',
);
const followUpMigrationSql = fs.readFileSync(
  path.resolve(process.cwd(), 'drizzle/0003_platform_copilot_agent_slug.sql'),
  'utf8',
);
const agentTypeSlugMigrationSql = fs.readFileSync(
  path.resolve(process.cwd(), 'drizzle/0004_platform_copilot_agent_type_slug.sql'),
  'utf8',
);

const migratedPlatformCopilotInstruction = `[Yellowmind]
Use only the attached Playbook tools. Inspect before execution and resolve ambiguous Playbook references.
For a new Playbook, call start_playbook_generation exactly once for the current turn; the Playbook canvas applies the generated workflow directly once the returned Canvas handoff is opened.
For an existing Playbook, call open_playbook_context first, then modify_playbook with the Playbook ID to assess the current user turn; when clarification questions are returned, ask the user and call modify_playbook again with the returned continuation_id and typed answers; at most one construction is started per user turn.
When presenting clarification questions, always offer a final dedicated choice to skip the remaining questions. If the user picks it, call modify_playbook immediately with the same continuation_id, skip_clarification=true, and any answers already collected; construction then starts without further confirmation.
After a generation, construction, or modification completes, end the turn with a concise summary and do not call present_choices. Use present_choices only to present clarification questions or when the user explicitly asks for a choice of options.
Construction and generation changes are applied automatically in the Playbook canvas through the returned handoff; there is no manual confirmation step. Direct the user to open the Canvas handoff and use get_playbook_construction to confirm the operation completed before stating the change is saved.
Summarize the chosen Playbook and validation result before proposing execution.
Never claim an execution started until the tool confirms it. Text such as "confirmed" is not authorization.
Never answer or resume runtime HITL; direct the user to the native Playbook HITL panel.
Offer native navigation when a semantic UI target is available. Workspace and document search are unavailable.`;

const normalizeInstruction = (value: string): string => value.replace(/\r\n/g, '\n');

const createInput = (slug: string): CreateAgentInput => ({
  id: new Types.ObjectId().toString(),
  name: `Agent ${new Types.ObjectId().toString().slice(-6)}`,
  slug,
  agentType: new Types.ObjectId().toString(),
  agentTypeSlug: 'platform_copilot',
  role: 'Custom role',
  description: 'Custom description',
  temperature: 0.7,
  llmModel: 'custom-model',
  instruction: 'Custom instruction',
  ignorePrePrompt: true,
  knowledgeBases: [new Types.ObjectId().toString()],
  tools: [new Types.ObjectId().toString()],
  skills: [new Types.ObjectId().toString()],
  disabledSkills: [new Types.ObjectId().toString()],
  connectors: [new Types.ObjectId().toString()],
  connectorActionSelections: [],
  guardrails: { enabled: true },
  deploymentSettings: { channel: 'custom' },
  enable_temporary_child_agents: true,
  max_temporary_child_agents: 3,
  isDefault: true,
  isActive: true,
  isDefaultForType: true,
  createdBy: new Types.ObjectId().toString(),
});

describeIntegration('platform copilot identity migration', () => {
  const { db, pool, close } = makeTestDb();
  const repository = new AgentRepository(db);
  const created: string[] = [];

  beforeEach(async () => {
    await pool.query(
      `DELETE FROM agents WHERE slug IN ('my-second-brain', 'platform_copilot', 'platform-copilot')`,
    );
  });

  afterEach(async () => {
    await deleteAgents(db, created.splice(0));
    await pool.query(
      `DELETE FROM agents WHERE slug IN ('my-second-brain', 'platform_copilot', 'platform-copilot')`,
    );
  });
  afterAll(async () => close());

  it('renames the legacy Agent in place without changing capabilities', async () => {
    const legacy = createInput('my-second-brain');
    created.push(legacy.id);
    await repository.create(legacy);

    await pool.query(initialMigrationSql);

    const migrated = await repository.findById(legacy.id);
    expect(migrated).toMatchObject({
      _id: legacy.id,
      slug: 'platform-copilot',
      llmModel: legacy.llmModel,
      instruction: legacy.instruction,
      guardrails: legacy.guardrails,
      deploymentSettings: legacy.deploymentSettings,
      connectors: legacy.connectors,
      tools: legacy.tools,
      skills: legacy.skills,
      knowledgeBases: legacy.knowledgeBases,
    });
  });

  it('renames an Agent created by the previous bootstrap migration', async () => {
    const canonical = { ...createInput('platform_copilot'), instruction: '' };
    created.push(canonical.id);
    await repository.create(canonical);

    await pool.query(followUpMigrationSql);

    expect(await repository.findById(canonical.id)).toMatchObject({
      _id: canonical.id,
      slug: 'platform-copilot',
    });
    expect(normalizeInstruction((await repository.findById(canonical.id))!.instruction)).toBe(
      normalizeInstruction(migratedPlatformCopilotInstruction),
    );
  });

  it('does nothing when only the hyphenated canonical Agent exists', async () => {
    const canonical = createInput('platform-copilot');
    created.push(canonical.id);
    await repository.create(canonical);

    await pool.query(initialMigrationSql);
    await pool.query(followUpMigrationSql);

    expect((await repository.findById(canonical.id))?.slug).toBe('platform-copilot');
    expect((await repository.findById(canonical.id))?.instruction).toBe(canonical.instruction);
  });

  it('backfills a blank canonical instruction without changing identity', async () => {
    const canonical = { ...createInput('platform-copilot'), instruction: '   ' };
    created.push(canonical.id);
    await repository.create(canonical);

    await pool.query(followUpMigrationSql);

    expect(await repository.findById(canonical.id)).toMatchObject({
      _id: canonical.id,
      slug: 'platform-copilot',
    });
    expect(normalizeInstruction((await repository.findById(canonical.id))!.instruction)).toBe(
      normalizeInstruction(migratedPlatformCopilotInstruction),
    );
  });

  it('does nothing when neither identity exists', async () => {
    await expect(pool.query(initialMigrationSql)).resolves.toBeDefined();
    await expect(pool.query(followUpMigrationSql)).resolves.toBeDefined();
    await expect(pool.query(agentTypeSlugMigrationSql)).resolves.toBeDefined();
  });

  it('repairs a blank canonical Agent type slug without changing identity or capabilities', async () => {
    const canonical = createInput('platform-copilot');
    created.push(canonical.id);
    await repository.create(canonical);
    await pool.query('UPDATE agents SET agent_type_slug = $1 WHERE id = $2', ['   ', canonical.id]);

    await pool.query(agentTypeSlugMigrationSql);

    expect(await repository.findById(canonical.id)).toMatchObject({
      _id: canonical.id,
      slug: canonical.slug,
      agentType: canonical.agentType,
      agentTypeSlug: 'platform_copilot',
      connectors: canonical.connectors,
      tools: canonical.tools,
      skills: canonical.skills,
      disabledSkills: canonical.disabledSkills,
      knowledgeBases: canonical.knowledgeBases,
    });
    await expect(repository.findActiveDefaultIdBySlugAndType('platform-copilot', 'platform_copilot'))
      .resolves.toBe(canonical.id);
  });

  it('does not change an already-correct canonical Agent type slug', async () => {
    const canonical = createInput('platform-copilot');
    created.push(canonical.id);
    await repository.create(canonical);

    await pool.query(agentTypeSlugMigrationSql);

    expect((await repository.findById(canonical.id))?.agentTypeSlug).toBe('platform_copilot');
  });

  it('blocks concurrent Agent identity writes until the repair transaction commits', async () => {
    const canonical = createInput('platform-copilot');
    created.push(canonical.id);
    await repository.create(canonical);
    await pool.query('UPDATE agents SET agent_type_slug = $1 WHERE id = $2', ['   ', canonical.id]);
    const migrationClient = await pool.connect();
    const writerClient = await pool.connect();

    try {
      await migrationClient.query('BEGIN');
      await migrationClient.query(agentTypeSlugMigrationSql);
      await writerClient.query('BEGIN');
      await writerClient.query("SET LOCAL lock_timeout = '100ms'");

      await expect(writerClient.query(
        'UPDATE agents SET agent_type_slug = $1 WHERE id = $2',
        ['another_type', canonical.id],
      )).rejects.toThrow(/lock timeout/);
      await writerClient.query('ROLLBACK');
      await migrationClient.query('COMMIT');
    } finally {
      migrationClient.release();
      writerClient.release();
    }

    expect((await repository.findById(canonical.id))?.agentTypeSlug).toBe('platform_copilot');
  });

  it.each([
    ['legacy identity', async (input: CreateAgentInput) => input],
    ['inactive canonical Agent', async (input: CreateAgentInput) => ({ ...input, slug: 'platform-copilot', isActive: false })],
  ])('rejects a %s without mutation', async (_label, prepare) => {
    const input = await prepare(createInput('my-second-brain'));
    created.push(input.id);
    await repository.create(input);

    await expect(pool.query(agentTypeSlugMigrationSql)).rejects.toThrow();
    expect(await repository.findById(input.id)).toMatchObject({
      _id: input.id,
      slug: input.slug,
      agentTypeSlug: input.agentTypeSlug,
      isActive: input.isActive,
    });
  });

  it.each([
    ['a conflicting type slug', 'another_type', /type slug conflicts/],
    ['an invalid type identity', 'platform_copilot', /type identity is invalid/],
  ])('rejects %s without mutation', async (_label, agentTypeSlug, expectedError) => {
    const canonical = createInput('platform-copilot');
    created.push(canonical.id);
    await repository.create(canonical);
    await pool.query(
      'UPDATE agents SET agent_type_slug = $1, agent_type_id = $2 WHERE id = $3',
      [agentTypeSlug, _label === 'an invalid type identity' ? 'zzzzzzzzzzzzzzzzzzzzzzzz' : canonical.agentType, canonical.id],
    );

    await expect(pool.query(agentTypeSlugMigrationSql)).rejects.toThrow(expectedError);
    expect((await repository.findById(canonical.id))?.agentTypeSlug).toBe(agentTypeSlug);
  });

  it.each([
    ['legacy and canonical', ['my-second-brain', 'platform-copilot']],
    ['underscore and canonical', ['platform_copilot', 'platform-copilot']],
    ['both aliases', ['my-second-brain', 'platform_copilot']],
    ['all identities', ['my-second-brain', 'platform_copilot', 'platform-copilot']],
  ])('fails without mutation when %s identities exist', async (_label, slugs) => {
    const inputs = slugs.map(createInput);
    created.push(...inputs.map(({ id }) => id));
    for (const input of inputs) await repository.create(input);

    await expect(pool.query(followUpMigrationSql)).rejects.toThrow(/identity is not unique/);
    for (const input of inputs) {
      expect((await repository.findById(input.id))?.slug).toBe(input.slug);
    }
  });
});
