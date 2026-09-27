import { SemanticModelValidationService } from './semantic-model-validation.service';
import { businessKey, SemanticModelAssistantService } from './semantic-model-assistant.service';
import type { SemanticGraph } from '../domain/semantic-model.types';

const customer = {
  id: '00000000-0000-4000-8000-000000000001', key: 'customer', label: 'Customer', description: '', category: 'business_object' as const,
  recordPolicy: 'optional' as const, systemKey: null, aliases: [], position: { x: 100, y: 100 },
  attributes: [{ key: 'customer_number', label: 'Customer number', type: 'text' as const, required: true }],
};
const documents = { ...customer, id: '00000000-0000-4000-8000-000000000009', key: 'documents', label: 'Documents', systemKey: 'workspace_documents', attributes: [] };

function setup(graph: SemanticGraph = { modelId: 'model-1', versionId: 'version-1', revision: 3, nodes: [customer, documents], relations: [], records: [], recordRelations: [] }) {
  const database = { query: jest.fn(async (sql: string, _params?: unknown[]) => sql.includes('INSERT INTO semantic_model.assistant_change_sets') ? { rows: [{ id: 'change-1' }] } : { rows: [] }) };
  const models = {
    requireActiveRole: jest.fn().mockResolvedValue({ id: 'model-1', currentDraftVersionId: 'version-1', revision: 7 }),
    get: jest.fn().mockResolvedValue({ id: 'model-1', currentDraftVersionId: 'version-1', revision: 7 }),
  };
  const graphService = { getGraph: jest.fn().mockResolvedValue(graph), apply: jest.fn().mockResolvedValue({ revision: 4 }) };
  const crossSource = { listIdentityRules: jest.fn().mockResolvedValue([]), saveIdentityRule: jest.fn().mockResolvedValue({ revision: 8 }) };
  const service = new SemanticModelAssistantService(
    database as never, models as never, graphService as never, new SemanticModelValidationService(), crossSource as never,
    {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
  );
  return { service, database, graphService, crossSource };
}

const actor = { userId: 'user-1', agentId: 'agent-1', conversationId: 'conversation-1' };

describe('SemanticModelAssistantService', () => {
  it('turns business names into keys', () => {
    expect(businessKey('Invoice line')).toBe('invoice_line');
    expect(businessKey('Échéance de paiement')).toBe('echeance_de_paiement');
    expect(businessKey('2024 total', 'field')).toBe('field_2024_total');
  });

  it('previews a whole model design without saving anything', async () => {
    const { service, graphService, database } = setup();
    const result = await service.applyChanges(actor, 'model-1', {
      concepts: [
        { label: 'Contract', fields: [{ label: 'Contract number' }, { label: 'Start date', type: 'date' }], keyFields: ['contract number'] },
        { label: 'Invoice', fields: [{ label: 'Invoice number' }, { label: 'Amount', type: 'number' }] },
      ],
      relations: [
        { from: 'Customer', to: 'Contract', label: 'signs' },
        { from: 'contract', to: 'invoice', label: 'is billed by', cardinality: 'one_to_many' },
      ],
    }, true);
    expect(result).toMatchObject({ applied: false, dryRun: true });
    expect(result.summary.added).toEqual(expect.arrayContaining(['concept Contract (2 fields)', 'concept Invoice (2 fields)', 'relationship Customer signs Contract']));
    expect(graphService.apply).not.toHaveBeenCalled();
    expect(database.query).not.toHaveBeenCalled();
  });

  it('applies the design as one graph change, saves key fields, and records how to undo it', async () => {
    const { service, graphService, crossSource, database } = setup();
    const result = await service.applyChanges(actor, 'model-1', {
      concepts: [
        { label: 'Contract', fields: [{ label: 'Contract number' }], keyFields: ['Contract number'] },
        { concept: 'customer', fields: [{ label: 'Country' }], removeFields: ['customer number'] },
      ],
      relations: [{ from: 'Customer', to: 'Contract', label: 'signs' }],
    });
    expect(result).toMatchObject({ applied: true, changeId: 'change-1' });
    const [, , dto] = graphService.apply.mock.calls[0];
    expect(dto.expectedRevision).toBe(3);
    expect(dto.operations.map((operation: { type: string }) => operation.type)).toEqual(['node_type.create', 'relation_type.create', 'node_type.update']);
    const created = dto.operations[0].entity;
    expect(created).toMatchObject({ key: 'contract', label: 'Contract', systemKey: null, attributes: [{ key: 'contract_number', label: 'Contract number', type: 'text', required: false }] });
    expect(dto.operations[2].changes.attributes.map((field: { key: string }) => field.key)).toEqual(['country']);
    expect(crossSource.saveIdentityRule).toHaveBeenCalledWith('user-1', 'model-1', created.id, { expectedRevision: 7, fields: ['contract_number'] });
    const insert = database.query.mock.calls.find(([sql]) => String(sql).includes('assistant_change_sets'))!;
    const params = (insert as unknown as [string, unknown[]])[1];
    const undo = JSON.parse(params[7] as string) as Array<{ type: string; id?: string }>;
    expect(undo.map((operation) => operation.type)).toEqual(['relation_type.delete', 'node_type.delete', 'node_type.update']);
    expect(params[3]).toBe('agent-1');
  });

  it('refuses to change built-in concepts and names what it cannot find', async () => {
    const { service } = setup();
    await expect(service.applyChanges(actor, 'model-1', { removeConcepts: ['Documents'] })).rejects.toThrow('built in');
    await expect(service.applyChanges(actor, 'model-1', { relations: [{ from: 'Customer', to: 'Supplier', label: 'buys from' }] })).rejects.toThrow('no concept "Supplier"');
    await expect(service.applyChanges(actor, 'model-1', { concepts: [{ concept: 'customer', removeFields: ['vat'] }] })).rejects.toThrow('has no field "vat"');
  });

  it('removes a concept with its relationships, and does nothing when nothing changes', async () => {
    const contract = { ...customer, id: '00000000-0000-4000-8000-000000000002', key: 'contract', label: 'Contract' };
    const relation = { id: '00000000-0000-4000-8000-000000000003', key: 'signs', label: 'signs', inverseLabel: '', description: '', sourceNodeTypeId: customer.id, targetNodeTypeId: contract.id, cardinality: 'one_to_many' as const, traversable: true, filterable: true, attributes: [] };
    const { service, graphService } = setup({ modelId: 'model-1', versionId: 'version-1', revision: 3, nodes: [customer, contract], relations: [relation], records: [], recordRelations: [] });
    await service.applyChanges(actor, 'model-1', { removeConcepts: ['contract'] });
    expect(graphService.apply.mock.calls[0][2].operations).toEqual([
      { type: 'relation_type.delete', id: relation.id },
      { type: 'node_type.delete', id: contract.id },
    ]);
    graphService.apply.mockClear();
    const same = await service.applyChanges(actor, 'model-1', { concepts: [{ concept: 'Customer', fields: [{ label: 'Customer number', required: true }] }] });
    expect(same).toMatchObject({ applied: false });
    expect(graphService.apply).not.toHaveBeenCalled();
  });
});
