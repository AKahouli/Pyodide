import { inArray } from 'drizzle-orm';
import { Types } from 'mongoose';
import * as schema from '@modules/postgres/schema';
import { describeIntegration, makeTestDb } from '../../postgres/testing/pg-integration';
import { PgAgentTypeStore } from './pg-agent-type.store';
import { PgConnectorStore } from '@modules/connector/persistence/pg-connector.store';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

/**
 * R-12 escapeLike coverage for the two catalog stores without dedicated specs:
 * the user-supplied search term must match literally — % and _ are not
 * wildcards.
 */
describeIntegration('agent-type/connector list search escaping (integration)', () => {
  const oid = (): string => new Types.ObjectId().toString();
  const { db, close } = makeTestDb();
  const agentTypes = new PgAgentTypeStore(db as NodePgDatabase<typeof schema>);
  const connectors = new PgConnectorStore(db as NodePgDatabase<typeof schema>);
  const createdAgentTypes: string[] = [];
  const createdConnectors: string[] = [];

  afterEach(async () => {
    const ats = createdAgentTypes.splice(0);
    if (ats.length) await db.delete(schema.catalogAgentTypes).where(inArray(schema.catalogAgentTypes.id, ats));
    const cs = createdConnectors.splice(0);
    if (cs.length) await db.delete(schema.integrationsConnectors).where(inArray(schema.integrationsConnectors.id, cs));
  });
  afterAll(async () => { await close(); });

  it('agent-type list treats % and _ literally', async () => {
    const withPct = oid();
    const plain = oid();
    await db.insert(schema.catalogAgentTypes).values([
      { id: withPct, name: `spec-100%type-${oid().slice(-4)}`, slug: `spec-100-type-${oid().slice(-4)}`, isActive: true },
      { id: plain, name: `spec-plain-${oid().slice(-6)}`, slug: `spec-plain-${oid().slice(-6)}`, isActive: true },
    ]);
    createdAgentTypes.push(withPct, plain);

    const hits = await agentTypes.list({ search: '100%type', page: 1, limit: 50 });
    expect(hits.rows.map((r) => r.id)).toContain(withPct);
    const wildcard = await agentTypes.list({ search: '%', page: 1, limit: 50 });
    expect(wildcard.rows.map((r) => r.id)).not.toContain(plain);
  });

  it('connector list treats % and _ literally', async () => {
    const marker = oid().slice(-6);
    const withPct = oid();
    const plain = oid();
    await db.insert(schema.integrationsConnectors).values([
      { id: withPct, slug: `spec-100pct-conn-${marker}`, name: `spec-100%conn-${marker}`, description: 'spec', mcpServerUrl: 'https://mcp.example.test', createdBy: '000000000000000000000000', isActive: true, actions: [] },
      { id: plain, slug: `spec-plain-conn-${marker}`, name: `spec-plain-conn-${marker}`, description: 'spec', mcpServerUrl: 'https://mcp.example.test', createdBy: '000000000000000000000000', isActive: true, actions: [] },
    ] as never);
    createdConnectors.push(withPct, plain);

    const hits = await connectors.list({ search: `100%conn-${marker}`, page: 1, limit: 50 });
    expect(hits.rows.map((r) => r.id)).toContain(withPct);
    const wildcard = await connectors.list({ search: '%', page: 1, limit: 50 });
    expect(wildcard.rows.map((r) => r.id)).not.toContain(plain);
  });
});
