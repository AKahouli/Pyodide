import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { describeIntegration, makeTestDb } from '../../postgres/testing/pg-integration';
import { agents, agentConnectors, integrationsConnectors, catalogAgentTypes } from '../../postgres/schema';
import { PgConnectorStore } from './pg-connector.store';

describeIntegration('connector worker policy persistence', () => {
  const database = makeTestDb();
  const store = new PgConnectorStore(database.db);
  const id = () => randomBytes(12).toString('hex');
  const connectorId = id(), agentId = id(), typeId = id();
  beforeAll(async () => {
    const client = await database.pool.connect();
    try {
      const { rows } = await client.query('select current_database() as name');
      if (rows[0].name !== process.env.POSTGRES_TEST_DB || rows[0].name === process.env.POSTGRES_DB) throw new Error('Isolated database required');
      await client.query('BEGIN');
      await client.query(readFileSync(resolve('drizzle/0047_connector_worker_policy.sql'), 'utf8'));
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  });
  afterAll(async () => {
    await database.db.delete(agents).where(eq(agents.id, agentId));
    await database.db.delete(integrationsConnectors).where(eq(integrationsConnectors.id, connectorId));
    await database.db.delete(catalogAgentTypes).where(eq(catalogAgentTypes.id, typeId));
    await database.close();
  });
  it('defaults ON and atomically fences attached agent definitions when policy changes', async () => {
    await database.db.insert(integrationsConnectors).values({ id: connectorId, slug: connectorId,
      name: 'Qualification search', description: '', mcpServerUrl: 'https://example.test', createdBy: id() });
    await database.db.insert(catalogAgentTypes).values({ id: typeId, name: typeId, slug: typeId });
    await database.db.insert(agents).values({ id: agentId, name: 'Qualification worker', role: '', agentTypeId: typeId,
      createdBy: id(), updatedAt: new Date('2020-01-01') });
    await database.db.insert(agentConnectors).values({ agentId, connectorId });
    expect((await store.findById(connectorId))?.workerPolicy).toEqual({ enabled: true, defaultExecutionKind: 'leaf', agentLaunchEnabled: false });
    const updated = await store.update(connectorId, { workerPolicy: { enabled: false, defaultExecutionKind: 'unknown', agentLaunchEnabled: false } });
    expect(updated?.workerPolicy?.enabled).toBe(false);
    const [agent] = await database.db.select().from(agents).where(eq(agents.id, agentId));
    expect(agent.updatedAt.getTime()).toBeGreaterThan(new Date('2020-01-01').getTime());
    expect((await store.findById(connectorId))?.workerPolicy).toEqual(updated?.workerPolicy);
    await store.update(connectorId, { workerPolicy: updated!.workerPolicy });
    const [unchanged] = await database.db.select().from(agents).where(eq(agents.id, agentId));
    expect(unchanged.updatedAt).toEqual(agent.updatedAt);
  });
});
