import { SemanticModelValidationService } from './semantic-model-validation.service';
import { businessKey, SemanticModelAssistantService } from './semantic-model-assistant.service';
import type { SemanticGraph } from '../domain/semantic-model.types';

const customer = {
  id: '00000000-0000-4000-8000-000000000001', key: 'customer', label: 'Customer', description: '', category: 'business_object' as const,
  recordPolicy: 'optional' as const, systemKey: null, aliases: [], position: { x: 100, y: 100 },
  attributes: [{ key: 'customer_number', label: 'Customer number', type: 'text' as const, required: true }],
};
const documents = { ...customer, id: '00000000-0000-4000-8000-000000000009', key: 'documents', label: 'Documents', systemKey: 'workspace_documents', attributes: [] };

type Deps = Partial<Record<'sourceMappings' | 'population' | 'workspaces' | 'workspaceShares' | 'documents', unknown>>;

function setup(graph: SemanticGraph = { modelId: 'model-1', versionId: 'version-1', revision: 3, nodes: [customer, documents], relations: [], records: [], recordRelations: [] }, deps: Deps = {}) {
  const database = { query: jest.fn(async (sql: string, _params?: unknown[]) => sql.includes('INSERT INTO semantic_model.assistant_change_sets') ? { rows: [{ id: 'change-1' }] } : { rows: [] }) };
  const models = {
    requireActiveRole: jest.fn().mockResolvedValue({ id: 'model-1', name: 'Billing', currentDraftVersionId: 'version-1', revision: 7 }),
    get: jest.fn().mockResolvedValue({ id: 'model-1', name: 'Billing', currentDraftVersionId: 'version-1', revision: 7 }),
    list: jest.fn().mockResolvedValue({ items: [] }),
  };
  const graphService = { getGraph: jest.fn().mockResolvedValue(graph), apply: jest.fn().mockResolvedValue({ revision: 4 }) };
  const crossSource = { listIdentityRules: jest.fn().mockResolvedValue([]), saveIdentityRule: jest.fn().mockResolvedValue({ revision: 8 }) };
  const service = new SemanticModelAssistantService(
    database as never, models as never, graphService as never, new SemanticModelValidationService(), crossSource as never,
    (deps.sourceMappings ?? {}) as never, {} as never, (deps.population ?? {}) as never, {} as never, (deps.workspaces ?? {}) as never,
    (deps.workspaceShares ?? {}) as never, (deps.documents ?? {}) as never,
  );
  return { service, database, graphService, crossSource, models };
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

  it('names the model and offers a button to open it after a change', async () => {
    const { service } = setup();
    const result = await service.applyChanges(actor, 'model-1', { concepts: [{ label: 'Contract', fields: [{ label: 'Contract number' }] }] });
    expect(result).toMatchObject({ model: { id: 'model-1', name: 'Billing' }, uiTarget: { surface: 'semanticModel.editor', params: { modelId: 'model-1', modelName: 'Billing' } } });
  });

  it('finds a model by its exact name, and says so when the name is missing or shared', async () => {
    const { service, models } = setup();
    await expect(service.resolveModelId('user-1', '00000000-0000-4000-8000-00000000abcd')).resolves.toBe('00000000-0000-4000-8000-00000000abcd');
    models.list.mockResolvedValue({ items: [{ id: 'm-1', name: 'Billing & Contracts' }, { id: 'm-2', name: 'Billing & Contracts v2' }] });
    await expect(service.resolveModelId('user-1', 'billing & contracts')).resolves.toBe('m-1');
    await expect(service.resolveModelId('user-1', 'Payroll')).rejects.toThrow('no model named "Payroll"');
    models.list.mockResolvedValue({ items: [{ id: 'm-1', name: 'Billing' }, { id: 'm-3', name: 'billing' }] });
    await expect(service.resolveModelId('user-1', 'Billing')).rejects.toThrow('Several models');
  });

  it('records suggested sources with names and file counts, without connecting anything', async () => {
    const files = [
      { id: 'folder-1', isFolder: true, folderName: '2024', originalName: '2024', mimeType: '' },
      { id: 'sheet-1', isFolder: false, originalName: 'customers.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    ];
    const sourceMappings = {
      workspaceFiles: jest.fn().mockResolvedValue({ readable: new Array(1240).fill({}), waiting: [{}] }),
      list: jest.fn().mockResolvedValue([]), create: jest.fn(), createWorkspace: jest.fn(),
    };
    const { service, database } = setup(undefined, {
      sourceMappings,
      workspaces: { findById: jest.fn().mockResolvedValue({ id: 'ws-1', name: 'Legal' }) },
      workspaceShares: { hasAccess: jest.fn().mockResolvedValue(true) },
      documents: { listAllInWorkspace: jest.fn().mockResolvedValue(files) },
    });
    await service.suggestSources(actor, 'model-1', [{ concept: 'customer', options: [
      { workspaceId: 'ws-1', folderIds: ['folder-1'], reason: 'contracts of 2024' },
      { workspaceId: 'ws-1', documentIds: ['sheet-1'], sheetName: 'Clients' },
      { workspaceId: 'ws-1' },
    ] }]);
    const insert = database.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO semantic_model.assistant_source_suggestions'))!;
    const params = (insert as unknown as [string, unknown[]])[1];
    expect(params.slice(0, 3)).toEqual(['model-1', customer.id, 'customer']);
    const options = JSON.parse(params[3] as string);
    expect(options[0]).toMatchObject({ workspaceName: 'Legal', kind: 'documents', folders: ['2024'], fileCount: 1240, stillIndexing: 1, reason: 'contracts of 2024' });
    expect(options[1]).toMatchObject({ kind: 'spreadsheet', documents: ['customers.xlsx'], sheetName: 'Clients', fileCount: 1 });
    expect(options[2]).toMatchObject({ kind: 'workspace', folderIds: [], documentIds: [] });
    expect(sourceMappings.workspaceFiles).toHaveBeenNthCalledWith(1, 'ws-1', { folderIds: ['folder-1'], documentIds: [] });
    expect(sourceMappings.workspaceFiles).toHaveBeenNthCalledWith(2, 'ws-1', null);
    expect(sourceMappings.create).not.toHaveBeenCalled();
    expect(sourceMappings.createWorkspace).not.toHaveBeenCalled();
  });

  it('lists a concept with no suggestion, so the person picks its files themselves', async () => {
    const { service, database } = setup(undefined, { documents: { listAllInWorkspace: jest.fn() } });
    await service.suggestSources(actor, 'model-1', [{ concept: 'Customer' }]);
    const insert = database.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO semantic_model.assistant_source_suggestions'))!;
    expect(JSON.parse((insert as unknown as [string, unknown[]])[1][3] as string)).toEqual([]);
  });

  it('finds files by name in every workspace the person can open, with where each one sits', async () => {
    const documents = {
      findByMultipleWorkspaces: jest.fn().mockResolvedValue({
        documents: [
          { id: 'f-1', isFolder: false, originalName: 'CV Ines.pdf', mimeType: 'application/pdf', workspaceId: 'ws-1', parentId: 'folder-1' },
          { id: 'folder-2', isFolder: true, originalName: 'CVs', mimeType: '', workspaceId: 'ws-2' },
          { id: 'f-2', isFolder: false, originalName: 'cv_export.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', workspaceId: 'ws-2', parentId: null },
        ],
        pagination: { page: 1, totalPages: 1 },
      }),
      findById: jest.fn().mockResolvedValue({ folderName: '2024', originalName: '2024' }),
    };
    const { service } = setup(undefined, {
      documents,
      workspaces: { findAllByUser: jest.fn().mockResolvedValue({ workspaces: [{ id: 'ws-1', name: 'Recruiting' }] }) },
      workspaceShares: { findSharedWithUser: jest.fn().mockResolvedValue({ workspaces: [{ id: 'ws-2', name: 'HR shared' }] }) },
    });
    const result = await service.searchSourceFiles('user-1', ' cv ');
    expect(documents.findByMultipleWorkspaces).toHaveBeenCalledWith(['ws-1', 'ws-2'], expect.objectContaining({ search: 'cv' }));
    expect(result.files).toEqual([
      { id: 'f-1', name: 'CV Ines.pdf', mimeType: 'application/pdf', kind: 'document', workspaceId: 'ws-1', workspaceName: 'Recruiting', folderName: '2024' },
      { id: 'f-2', name: 'cv_export.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kind: 'spreadsheet', workspaceId: 'ws-2', workspaceName: 'HR shared', folderName: null },
    ]);
    expect(await service.searchSourceFiles('user-1', 'c')).toEqual({ files: [], page: 1, totalPages: 1 });
  });

  it('refuses a suggestion for a workspace the person cannot open', async () => {
    const { service, database } = setup(undefined, {
      workspaceShares: { hasAccess: jest.fn().mockResolvedValue(false) },
      documents: { listAllInWorkspace: jest.fn() },
    });
    await expect(service.suggestSources(actor, 'model-1', [{ concept: 'Customer', options: [{ workspaceId: 'ws-9' }] }])).rejects.toThrow();
    expect(database.query.mock.calls.some(([sql]) => String(sql).includes('assistant_source_suggestions'))).toBe(false);
  });

  it('shows a suggestion as connected once the concept has a source', async () => {
    const { service, database } = setup(undefined, { sourceMappings: { list: jest.fn().mockResolvedValue([{ id: 's-1', conceptId: customer.id }]) } });
    database.query.mockImplementation(async (sql: string) => (String(sql).includes('FROM semantic_model.assistant_source_suggestions')
      ? { rows: [{ id: 'x', conceptId: customer.id, conceptKey: 'customer', options: [], note: '', status: 'pending', createdAt: '', updatedAt: '' }] }
      : { rows: [] }) as never);
    const listed = await service.listSuggestions('user-1', 'model-1');
    expect(listed).toMatchObject({ model: { name: 'Billing' }, suggestions: [{ conceptLabel: 'Customer', status: 'connected' }] });
  });

  it('stops the running data update, or says there is none', async () => {
    const population = {
      activeJob: jest.fn().mockResolvedValueOnce({ jobId: 'job-1', state: 'running' }).mockResolvedValueOnce(null),
      stopJob: jest.fn().mockResolvedValue({ jobId: 'job-1', state: 'cancel_requested' }),
    };
    const { service } = setup(undefined, { population });
    await expect(service.stopRun('user-1', 'model-1')).resolves.toMatchObject({ jobId: 'job-1', stopped: true, state: 'cancel_requested' });
    expect(population.stopJob).toHaveBeenCalledWith('user-1', 'model-1', 'job-1');
    await expect(service.stopRun('user-1', 'model-1')).resolves.toMatchObject({ stopped: false, state: 'none' });
  });
});
