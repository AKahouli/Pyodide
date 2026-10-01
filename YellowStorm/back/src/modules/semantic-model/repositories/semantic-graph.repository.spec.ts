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

describe('SemanticGraphRepository concept fields and document sources', () => {
  const repository = new SemanticGraphRepository({} as never);
  const attribute = (key: string) => ({ key, label: key, type: 'text', required: false });

  function client(fieldMappings: unknown[]) {
    return {
      query: jest.fn(async (text: string) => {
        if (text.includes('FROM semantic_model.node_types')) {
          return { rows: [{ id: 'contract', key: 'contract', label: 'Contract', attributes: [attribute('number'), attribute('status')] }] };
        }
        if (text.includes('FROM semantic_model.source_mappings')) return { rows: [{ id: 'm-1', fieldMappings }] };
        return { rows: [], rowCount: 1 };
      }),
    } as unknown as PoolClient;
  }
  const updates = (target: PoolClient) => jest.mocked(target.query).mock.calls
    .filter(([text]) => String(text).startsWith('UPDATE semantic_model.source_mappings'));

  it('reads a new field and stops reading a removed one without saving the mapping again', async () => {
    const target = client([
      { sourceField: null, targetAttribute: 'number', mode: 'extract', extractionStrategy: 'ai' },
      { sourceField: null, targetAttribute: 'status', mode: 'extract', extractionStrategy: 'ai' },
    ]);
    await repository.apply(target, 'model-1', 'version-1', {
      type: 'node_type.update', id: 'contract',
      changes: { attributes: [attribute('number'), attribute('document_status'), attribute('source_document')] as never },
    });
    const [[, params]] = updates(target);
    expect(JSON.parse((params as string[])[1])).toEqual([
      { sourceField: null, targetAttribute: 'number', mode: 'extract', extractionStrategy: 'ai' },
      { sourceField: null, targetAttribute: 'document_status', mode: 'extract', extractionStrategy: 'ai' },
      { sourceField: 'document_name', targetAttribute: 'source_document', mode: 'metadata' },
    ]);
  });

  it('leaves the mapping alone when the same fields are read', async () => {
    const target = client([
      { sourceField: null, targetAttribute: 'status', mode: 'ignore' },
      { sourceField: null, targetAttribute: 'number', mode: 'extract' },
    ]);
    await repository.apply(target, 'model-1', 'version-1', {
      type: 'node_type.update', id: 'contract', changes: { attributes: [attribute('number'), attribute('status')] as never },
    });
    expect(updates(target)).toEqual([]);
    const labelOnly = client([]);
    await repository.apply(labelOnly, 'model-1', 'version-1', { type: 'node_type.update', id: 'contract', changes: { label: 'Deal' } });
    expect(jest.mocked(labelOnly.query).mock.calls.some(([text]) => String(text).includes('source_mappings'))).toBe(false);
  });
});
