import * as fs from 'fs';
import * as path from 'path';
import { Types } from 'mongoose';
import { AgentRepository, CreateAgentInput } from './agent.repository';
import { PLATFORM_COPILOT_DEFAULT_INSTRUCTION } from '../constants/platform-copilot.constants';
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

  afterEach(async () => deleteAgents(db, created.splice(0)));
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
      instruction: PLATFORM_COPILOT_DEFAULT_INSTRUCTION,
    });
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
      instruction: PLATFORM_COPILOT_DEFAULT_INSTRUCTION,
    });
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
