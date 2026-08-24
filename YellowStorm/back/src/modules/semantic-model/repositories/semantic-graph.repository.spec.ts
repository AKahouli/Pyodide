import { PoolClient } from 'pg';
import { SemanticGraphRepository } from './semantic-graph.repository';

describe('SemanticGraphRepository draft persistence', () => {
  const repository = new SemanticGraphRepository({} as never);

  function clientWithRow(row: Record<string, unknown>) {
    return {
      query: jest.fn(async (text: string) => ({
        rows: text.startsWith('SELECT') ? [row] : [],
        rowCount: text.startsWith('SELECT') ? 1 : 0,
      })),
    } as unknown as PoolClient;
  }

  it('updates a draft node without projecting it to AGE', async () => {
    const client = clientWithRow({
      id: 'party', key: 'party', label: 'Party', description: '', category: 'business_object',
      recordPolicy: 'optional', systemKey: null, aliases: [], attributes: [], position: { x: 0, y: 0 },
    });

    await repository.apply(client, 'model-1', 'version-1', {
      type: 'node_type.update', id: 'party', changes: { label: 'Organization' },
    });

    expect(jest.mocked(client.query).mock.calls.some(([text]) => String(text).includes('ag_catalog.cypher'))).toBe(false);
  });

  it('updates a draft relation without projecting it to AGE', async () => {
    const client = clientWithRow({
      id: 'owns', key: 'owns', label: 'Owns', inverseLabel: '', description: '',
      sourceNodeTypeId: 'party', targetNodeTypeId: 'asset', cardinality: 'one_to_many',
      traversable: true, filterable: true, attributes: [],
    });

    await repository.apply(client, 'model-1', 'version-1', {
      type: 'relation_type.update', id: 'owns', changes: { targetNodeTypeId: 'property' },
    });

    expect(jest.mocked(client.query).mock.calls.some(([text]) => String(text).includes('ag_catalog.cypher'))).toBe(false);
  });
});
