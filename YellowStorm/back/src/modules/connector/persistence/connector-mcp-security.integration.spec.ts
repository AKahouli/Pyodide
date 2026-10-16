import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { describeIntegration, makeTestDb } from '../../postgres/testing/pg-integration';
import { integrationsConnectors } from '../../postgres/schema';
import { PgConnectorStore } from './pg-connector.store';

describeIntegration('connector MCP security revision CAS (isolated POSTGRES_TEST_DB required)', () => {
  const database = makeTestDb();
  const store = new PgConnectorStore(database.db);
  const connectorId = randomBytes(12).toString('hex');
  let isolated = false;
  beforeAll(async () => {
    const result = await database.pool.query('select current_database() as name');
    const name = result.rows[0].name;
    if (name !== process.env.POSTGRES_TEST_DB?.trim() || name === process.env.POSTGRES_DB?.trim() || name === 'agentstore') {
      throw new Error('Isolated POSTGRES_TEST_DB required');
    }
    isolated = true;
    // Reuse the owning migration only in the verified isolated test database,
    // matching connector-worker-policy.integration.spec.ts's setup convention.
    const columns = await database.pool.query("select column_name from information_schema.columns where table_schema = 'integrations' and table_name = 'connectors' and column_name = 'mcp_security_policy'");
    if (columns.rowCount === 0) {
      const client = await database.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(readFileSync(resolve('drizzle/0049_connector_mcp_security.sql'), 'utf8'));
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    }
    await database.db.insert(integrationsConnectors).values({ id: connectorId, slug: connectorId,
      name: 'MCP security CAS fixture', description: '', createdBy: randomBytes(12).toString('hex'),
      mcpServerUrl: 'https://example.test/mcp',
      mcpSecurityPolicy: { version: 1, profile: 'configured', actorDelegation: 'none', allowPrivateNetwork: true, requiredPermissions: [] },
    });
  });
  afterAll(async () => {
    try {
      if (isolated) await database.db.delete(integrationsConnectors).where(eq(integrationsConnectors.id, connectorId));
    } finally { await database.close(); }
  });

  it('allows only one concurrent writer at the same revision and preserves grants during metadata edits', async () => {
    const results = await Promise.allSettled([
      store.update(connectorId, { mcpServerUrl: 'https://first.example/mcp' }, 1),
      store.update(connectorId, { mcpServerUrl: 'https://second.example/mcp' }, 1),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toEqual([
      expect.objectContaining({ reason: expect.objectContaining({ message: expect.stringContaining('reload before saving') }) }),
    ]);
    const current = await store.findById(connectorId);
    expect(current?.securityRevision).toBe(2);
    await expect(store.update(connectorId, { mcpServerUrl: 'https://stale.example/mcp' }, 1)).rejects.toThrow('reload before saving');
    await expect(store.update(connectorId, { mcpServerUrl: 'https://unfenced.example/mcp' })).rejects.toThrow('authorized revision');
    const renamed = await store.update(connectorId, { name: 'Renamed CAS fixture' });
    expect(renamed?.securityRevision).toBe(2);
    expect(renamed?.mcpSecurityPolicy).toEqual(current?.mcpSecurityPolicy);
    expect(renamed?.mcpServerUrl).toBe(current?.mcpServerUrl);
  });
});
