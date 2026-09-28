import { eq, inArray } from 'drizzle-orm';
import { newObjectId } from '@common/postgres';
import * as schema from '@modules/postgres/schema';
import { describeIntegration, makeTestDb } from '../../postgres/testing/pg-integration';
import { ConnectorPlaybookBindingSyncService, rewriteConnectorBindings } from './connector-playbook-binding-sync.service';

const logger = () => ({ setContext: jest.fn(), log: jest.fn() });
const closedSchema = (...keys: string[]) => ({ properties: Object.fromEntries(keys.map((key) => [key, {}])), additionalProperties: false });

describe('ConnectorPlaybookBindingSyncService', () => {
  it('does not touch the database when action keys and schemas are unchanged', async () => {
    const db = { transaction: jest.fn() };
    const log = logger();
    const service = new ConnectorPlaybookBindingSyncService(db as never, log as never);
    const actions = [{ key: 'search', parameterSchema: { properties: { query: {} } } }];

    await service.syncConnectorActions('connector-1', actions, actions);

    expect(db.transaction).not.toHaveBeenCalled();
    expect(log.log).not.toHaveBeenCalled();
  });

  describe('rewriteConnectorBindings', () => {
    const actions = [{ actionKey: 'search', isEnabled: true }];

    it('replaces the actions and keeps only the allowed fixed parameters of the connector bindings', () => {
      const nodes = [{
        id: 'n1',
        kind: 'step',
        metadata: {
          other: 1,
          toolBindings: [
            { connectorId: 'c1', actions: [{ actionKey: 'old', isEnabled: false }], fixedParams: { oldArg: 1, newArg: 2 }, label: 'kept' },
            { connectorId: 'c2', actions: [{ actionKey: 'x', isEnabled: true }], fixedParams: { oldArg: 1 } },
          ],
        },
      }];

      expect(rewriteConnectorBindings(nodes, 'c1', actions, ['newArg'])).toEqual([{
        id: 'n1',
        kind: 'step',
        metadata: {
          other: 1,
          toolBindings: [
            { connectorId: 'c1', actions, fixedParams: { newArg: 2 }, label: 'kept' },
            { connectorId: 'c2', actions: [{ actionKey: 'x', isEnabled: true }], fixedParams: { oldArg: 1 } },
          ],
        },
      }]);
      // The input is not mutated.
      expect(nodes[0].metadata.toolBindings[0].fixedParams).toEqual({ oldArg: 1, newArg: 2 });
    });

    it('leaves fixed parameters alone for an open schema and turns a non-object into {} for a closed one', () => {
      const nodes = [{ id: 'n1', metadata: { toolBindings: [{ connectorId: 'c1', fixedParams: { any: 1 } }, { connectorId: 'c1', fixedParams: 'bad' }] } }];
      expect(rewriteConnectorBindings(nodes, 'c1', actions, null)).toEqual([
        { id: 'n1', metadata: { toolBindings: [{ connectorId: 'c1', fixedParams: { any: 1 }, actions }, { connectorId: 'c1', fixedParams: 'bad', actions }] } },
      ]);
      expect(rewriteConnectorBindings(nodes, 'c1', actions, [])).toEqual([
        { id: 'n1', metadata: { toolBindings: [{ connectorId: 'c1', fixedParams: {}, actions }, { connectorId: 'c1', fixedParams: {}, actions }] } },
      ]);
    });

    it('leaves nodes without tool bindings as they are', () => {
      const nodes = [{ id: 'n1' }, { id: 'n2', metadata: { toolBindings: 'none' } }, null];
      expect(rewriteConnectorBindings(nodes, 'c1', actions, [])).toEqual(nodes);
    });
  });
});

describeIntegration('ConnectorPlaybookBindingSyncService (integration)', () => {
  const { db, close } = makeTestDb();
  const ownerId = newObjectId();
  const connectorId = `connector-${newObjectId()}`;
  const log = logger();
  const service = new ConnectorPlaybookBindingSyncService(db as never, log as never);

  const insertFlow = async (nodes: Record<string, unknown>[]): Promise<string> => {
    const id = newObjectId();
    await db.insert(schema.playbookFlows).values({ id, ownerId, name: `sync ${id}`, nodes, updatedAt: new Date('2025-01-01T00:00:00Z') });
    return id;
  };
  const nodesOf = async (id: string) => (await db.select({ nodes: schema.playbookFlows.nodes, updatedAt: schema.playbookFlows.updatedAt, revision: schema.playbookFlows.definitionRevision }).from(schema.playbookFlows).where(eq(schema.playbookFlows.id, id)))[0];

  beforeAll(async () => {
    await db.insert(schema.identityUsers).values({ id: ownerId, email: `cpbs-${ownerId.slice(-8)}@example.com`, passwordHash: 'hash', emailVerified: true, status: 'active' });
  });

  afterAll(async () => {
    await db.delete(schema.playbookFlows).where(eq(schema.playbookFlows.ownerId, ownerId));
    await db.delete(schema.identityUsers).where(inArray(schema.identityUsers.id, [ownerId]));
    await close();
  });

  it('rewrites the bindings of the matching flows only, and counts matched and modified flows', async () => {
    const matching = await insertFlow([
      { id: 'n1', kind: 'step', metadata: { toolBindings: [{ connectorId, actions: [{ actionKey: 'search', isEnabled: true }], fixedParams: { oldArg: 1, newArg: 2 } }] } },
      { id: 'n2', kind: 'step', metadata: { toolBindings: [{ connectorId: 'other', actions: [], fixedParams: { oldArg: 1 } }] } },
    ]);
    const unrelated = await insertFlow([{ id: 'n1', kind: 'step', metadata: { toolBindings: [{ connectorId: 'other', fixedParams: { oldArg: 1 } }] } }]);
    const unchanged = await insertFlow([{ id: 'n1', kind: 'step', metadata: { toolBindings: [{ connectorId, fixedParams: { newArg: 3 }, actions: [{ isEnabled: true, actionKey: 'search' }] }] } }]);

    await service.syncConnectorActions(
      connectorId,
      [{ key: 'search', parameterSchema: closedSchema('oldArg', 'newArg') }],
      [{ key: 'search', parameterSchema: closedSchema('newArg') }],
    );

    const after = await nodesOf(matching);
    expect(after.nodes).toEqual([
      { id: 'n1', kind: 'step', metadata: { toolBindings: [{ connectorId, actions: [{ actionKey: 'search', isEnabled: true }], fixedParams: { newArg: 2 } }] } },
      { id: 'n2', kind: 'step', metadata: { toolBindings: [{ connectorId: 'other', actions: [], fixedParams: { oldArg: 1 } }] } },
    ]);
    expect(after.updatedAt).toEqual(new Date('2025-01-01T00:00:00Z'));
    expect(after.revision).toBe(0);
    expect((await nodesOf(unrelated)).nodes).toEqual([{ id: 'n1', kind: 'step', metadata: { toolBindings: [{ connectorId: 'other', fixedParams: { oldArg: 1 } }] } }]);
    expect(log.log).toHaveBeenCalledWith('Synchronized playbook connector action bindings', {
      connectorId,
      matchedFlowCount: 2,
      modifiedFlowCount: 1,
      currentActionKeys: ['search'],
    });
    expect((await nodesOf(unchanged)).nodes).toEqual([{ id: 'n1', kind: 'step', metadata: { toolBindings: [{ connectorId, fixedParams: { newArg: 3 }, actions: [{ actionKey: 'search', isEnabled: true }] }] } }]);
  });
});
