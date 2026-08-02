import { PoolClient } from 'pg';
import { SemanticModelDatabaseService } from '../infrastructure/semantic-model-database.service';
import { SemanticGraphRepository } from './semantic-graph.repository';

describe('SemanticGraphRepository AGE projection', () => {
  const database = { graphName: () => 'semantic_model_graph' } as SemanticModelDatabaseService;
  const repository = new SemanticGraphRepository(database);

  function clientWithRow(row: Record<string, unknown>) {
    return {
      query: jest.fn(async (text: string) => ({
        rows: text.startsWith('SELECT') ? [row] : [],
        rowCount: text.startsWith('SELECT') ? 1 : 0,
      })),
    } as unknown as PoolClient;
  }

  it('projects the complete node after a partial update', async () => {
    const client = clientWithRow({
      id: 'party', key: 'party', label: 'Party', description: '', category: 'business_object',
      recordPolicy: 'optional', systemKey: null, aliases: [], attributes: [], position: { x: 0, y: 0 },
    });

    await repository.apply(client, 'model-1', 'version-1', {
      type: 'node_type.update', id: 'party', changes: { label: 'Organization' },
    });

    const ageCall = jest.mocked(client.query).mock.calls.find(([text]) => String(text).includes('SET entity.payload'));
    const parameters = JSON.parse(String(ageCall?.[1]?.[0]));
    expect(JSON.parse(parameters.payload)).toMatchObject({
      id: 'party', key: 'party', label: 'Organization', modelId: 'model-1', versionId: 'version-1',
    });
  });

  it('includes model identity when recreating a relation edge', async () => {
    const client = clientWithRow({
      id: 'owns', key: 'owns', label: 'Owns', inverseLabel: '', description: '',
      sourceNodeTypeId: 'party', targetNodeTypeId: 'asset', cardinality: 'one_to_many',
      traversable: true, filterable: true, attributes: [],
    });

    await repository.apply(client, 'model-1', 'version-1', {
      type: 'relation_type.update', id: 'owns', changes: { targetNodeTypeId: 'property' },
    });

    const createCall = jest.mocked(client.query).mock.calls.find(([text]) => String(text).includes('CREATE (source)-[edge'));
    const parameters = JSON.parse(String(createCall?.[1]?.[0]));
    expect(parameters).toMatchObject({ modelId: 'model-1', versionId: 'version-1', targetId: 'property' });
    expect(JSON.parse(parameters.payload)).toMatchObject({ id: 'owns', modelId: 'model-1', versionId: 'version-1' });
  });
});
