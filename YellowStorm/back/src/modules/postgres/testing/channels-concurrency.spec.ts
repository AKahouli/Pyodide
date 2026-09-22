import { eq, inArray } from 'drizzle-orm';
import { newObjectId } from '@common/postgres';
import * as schema from '../schema';
import { describeIntegration, makeTestDb, deleteAgents } from './pg-integration';
import { AgentRepository } from '../../agent/repositories/agent.repository';
import type { CreateAgentInput } from '../../agent/repositories/agent.repository';
import { PgWidgetSessionStore, PgWidgetTokenStore } from '../../widget-chat/persistence/pg-widget.store';
import { PgUserStore } from '../../user/persistence/pg-user.store';
import { PgTelegramIntegrationStore } from '../../telegram/persistence/pg-telegram.store';

jest.setTimeout(60000);

/** Plan 6.3: real-PG concurrency + FK cascade coverage for the channels schema. */
describeIntegration('channels concurrency and agent-delete teardown (integration)', () => {
  const { db, close } = makeTestDb();
  const repo = new AgentRepository(db as never);
  const sessions = new PgWidgetSessionStore(db as never);
  const tokens = new PgWidgetTokenStore(db as never);
  const telegram = new PgTelegramIntegrationStore(db as never);
  const agentIds: string[] = [];
  const typeIds: string[] = [];
  const connectorIds: string[] = [];
  let userId: string;

  beforeAll(async () => {
    const user = await new PgUserStore(db as never).create({
      email: 'spec-channels-' + newObjectId() + '@example.com', passwordHash: 'h', emailVerified: true, status: 'active',
    } as never);
    userId = user.id;
  });

  async function makeAgent(connectors: string[] = []): Promise<string> {
    const typeId = newObjectId();
    typeIds.push(typeId);
    await db.execute(
      `INSERT INTO catalog.agent_types (id, name, slug, default_prompt)
       VALUES ('${typeId}', 'spec-type-${typeId}', 'spec-type-${typeId}', '')`,
    );
    const input: CreateAgentInput = {
      id: newObjectId(), name: `spec-agent-${newObjectId().slice(-8)}`, slug: `spec-agent-${newObjectId().slice(-8)}`,
      agentType: typeId, agentTypeSlug: 'mono-agent', role: 'r', description: '', temperature: 0, instruction: '',
      ignorePrePrompt: false, knowledgeBases: [], tools: [], skills: [], disabledSkills: [], connectors,
      connectorActionSelections: [], guardrails: {}, deploymentSettings: {},
      enable_temporary_child_agents: false, max_temporary_child_agents: 4,
      isDefault: false, isActive: true, isDefaultForType: false, createdBy: newObjectId(),
    };
    agentIds.push(input.id);
    await repo.create(input);
    return input.id;
  }

  const sessionRow = (agentId: string, tokenHash: string, visitorId: string) => ({
    tokenHash, agentId, visitorId, metadata: {}, clientContext: {}, appSource: {}, geo: {},
  });

  afterEach(async () => {
    await deleteAgents(db, agentIds.splice(0));
    if (connectorIds.length) {
      await db.delete(schema.integrationsConnectors).where(inArray(schema.integrationsConnectors.id, connectorIds.splice(0)));
    }
    if (typeIds.length) {
      await db.delete(schema.catalogAgentTypes).where(inArray(schema.catalogAgentTypes.id, typeIds.splice(0)));
    }
  });
  afterAll(async () => {
    await db.execute(`DELETE FROM identity.users WHERE id = '${userId}'`);
    await close();
  });

  it('10 parallel createOrGetSession for one (token, visitor) yield exactly one active session', async () => {
    const agentId = await makeAgent();
    const tokenHash = `spec-${newObjectId()}`;
    const visitor = 'spec-visitor';
    const results = await Promise.all(
      Array.from({ length: 10 }, () => sessions.createOrGetSession(sessionRow(agentId, tokenHash, visitor))),
    );
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.session.id)).size).toBe(1);
    const rows = await db.select().from(schema.channelsWidgetSessions)
      .where(eq(schema.channelsWidgetSessions.tokenHash, tokenHash));
    expect(rows.filter((r) => r.status === 'active')).toHaveLength(1);
    expect(rows).toHaveLength(1);
  });

  it('telegram markWebhookUpdate skips duplicate and older update ids', async () => {
    const agentId = await makeAgent();
    const integ = await telegram.insert({
      userId, agentId, encryptedBotToken: 'enc', botUsername: null,
      webhookSecret: `spec-${newObjectId()}`, enabled: true, status: 'active',
    });
    expect(await telegram.markWebhookUpdate(integ.id, 100)).toBe(true);
    expect(await telegram.markWebhookUpdate(integ.id, 100)).toBe(false);
    expect(await telegram.markWebhookUpdate(integ.id, 99)).toBe(false);
    expect(await telegram.markWebhookUpdate(integ.id, 101)).toBe(true);
    expect((await telegram.findById(integ.id))!.lastUpdateId).toBe(101);
  });

  it('parallel identical telegram updates: exactly one wins', async () => {
    const agentId = await makeAgent();
    const integ = await telegram.insert({
      userId, agentId, encryptedBotToken: 'enc', botUsername: null,
      webhookSecret: `spec-${newObjectId()}`, enabled: true, status: 'active',
    });
    const wins = await Promise.all(Array.from({ length: 8 }, () => telegram.markWebhookUpdate(integ.id, 500)));
    expect(wins.filter(Boolean)).toHaveLength(1);
  });

  it('deleting an agent cascades telegram integration, widget tokens/sessions and connector junctions', async () => {
    const connectorId = newObjectId();
    connectorIds.push(connectorId);
    await db.execute(
      `INSERT INTO integrations.connectors (id, slug, name, description, mcp_server_url, created_by)
       VALUES ('${connectorId}', 'spec-${connectorId}', 'spec-${connectorId}', '', '', '${newObjectId()}')`,
    );
    const agentId = await makeAgent([connectorId]);
    const tokenHash = `spec-${newObjectId()}`;
    const integ = await telegram.insert({
      userId, agentId, encryptedBotToken: 'enc', botUsername: null,
      webhookSecret: `spec-${newObjectId()}`, enabled: true, status: 'active',
    });
    await tokens.insert({
      tokenHash, agentId, label: null, allowedOrigins: [], isActive: true, expiresAt: null, createdBy: userId,
    });
    await sessions.createOrGetSession(sessionRow(agentId, tokenHash, 'v'));

    expect(await db.select().from(schema.agentConnectors).where(eq(schema.agentConnectors.agentId, agentId))).toHaveLength(1);

    await deleteAgents(db, [agentId]);

    expect(await telegram.findById(integ.id)).toBeNull();
    expect(await db.select().from(schema.channelsWidgetTokens).where(eq(schema.channelsWidgetTokens.agentId, agentId))).toHaveLength(0);
    expect(await db.select().from(schema.channelsWidgetSessions).where(eq(schema.channelsWidgetSessions.agentId, agentId))).toHaveLength(0);
    expect(await db.select().from(schema.agentConnectors).where(eq(schema.agentConnectors.agentId, agentId))).toHaveLength(0);
  });
});
