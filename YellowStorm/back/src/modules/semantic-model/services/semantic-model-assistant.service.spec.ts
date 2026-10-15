import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { SemanticModelValidationService } from './semantic-model-validation.service';
import { businessKey, SemanticModelAssistantService } from './semantic-model-assistant.service';
import type { SemanticGraph } from '../domain/semantic-model.types';

const customer = {
  id: '00000000-0000-4000-8000-000000000001', key: 'customer', label: 'Customer', description: '', category: 'business_object' as const,
  recordPolicy: 'optional' as const, systemKey: null, aliases: [], position: { x: 100, y: 100 },
  attributes: [{ key: 'customer_number', label: 'Customer number', type: 'text' as const, required: true }],
};
const documents = { ...customer, id: '00000000-0000-4000-8000-000000000009', key: 'documents', label: 'Documents', systemKey: 'workspace_documents', attributes: [] };
const recordProvenance = [
  { workspaceId: 'ws-1', documentId: 'doc-1', assetId: 'doc-1', filename: 'contract-one.pdf' },
  { workspaceId: 'ws-2', documentId: 'doc-2', assetId: 'doc-2', filename: 'contract-two.pdf' },
];

type Deps = Partial<Record<'sourceMappings' | 'population' | 'workspaces' | 'workspaceShares' | 'documents' | 'graphSearch' | 'modelWorkspaces', unknown>>;

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
    (deps.sourceMappings ?? {}) as never, (deps.modelWorkspaces ?? {}) as never, (deps.population ?? {}) as never, {} as never, (deps.workspaces ?? {}) as never,
    (deps.workspaceShares ?? {}) as never, (deps.documents ?? {}) as never, (deps.graphSearch ?? {}) as never,
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

  it('says which parts of an existing field an edit changed', async () => {
    const { service } = setup();
    const result = await service.applyChanges(actor, 'model-1', {
      concepts: [{ concept: 'Customer', fields: [{ key: 'customer_number', label: 'Customer number', description: 'As printed on invoices' }] }],
    }, true);
    expect(result.summary.changed).toEqual(['Customer: changed field Customer number (description)']);
    const unchanged = await service.applyChanges(actor, 'model-1', {
      concepts: [{ concept: 'Customer', fields: [{ key: 'customer_number', label: 'Customer number' }] }],
    }, true);
    expect(unchanged.summary.changed).toEqual([]);
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
    const undo = JSON.parse(params[7] as string) as { type: string; id?: string }[];
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

  it('finds records in the published data and says honestly when the index is not ready', async () => {
    const graphSearch = {
      search: jest.fn().mockResolvedValue({
        status: 'index_not_ready', modeUsed: 'lexical_only', index: { state: 'indexing' },
        concepts: [{ conceptId: 'c-1', key: 'customer', label: 'Customer' }], unknownConcepts: [],
        seeds: [{ entityId: 'e-1', conceptId: 'c-1', conceptLabel: 'Customer', label: 'Acme', keyFields: { customer_number: 'C1' },
          snippet: 'Acme, Paris', matchClass: 'lexical', rank: 1, diagnostics: { score: 0.4 }, provenance: recordProvenance }],
        coverage: { expectedCount: 10, indexedCount: 4, exactOnlyCount: 0 },
      }),
    };
    const { service } = setup(undefined, { graphSearch });
    const result = await service.findRecords('user-1', 'model-1', { query: 'acme', concepts: ['Customer'] });
    // No limit asked: the admin's default number of results applies (the runtime fills it in).
    expect(graphSearch.search).toHaveBeenCalledWith('user-1', 'model-1', { environment: 'production', query: 'acme', concepts: ['Customer'], limit: undefined });
    expect(result).toMatchObject({
      model: { id: 'model-1', name: 'Billing' }, data: 'published', status: 'index_not_ready', searchMode: 'lexical_only', indexState: 'indexing',
      concepts: ['Customer'],
      records: [{ entityId: 'e-1', concept: 'Customer', name: 'Acme', keyFields: { customer_number: 'C1' }, match: 'lexical', sourceCount: 2, provenance: recordProvenance }],
    });
    expect(result.records[0].provenance).toEqual(recordProvenance);
    expect(result.records[0]).not.toHaveProperty('diagnostics');
    expect(result.notes.join(' ')).toMatch(/not ready.*4 of 10/);
    expect(result.notes.join(' ')).toMatch(/Search by meaning was unavailable/);
  });

  it('quotes the matching passage of a long field and uses it as the snippet when the match came from it', async () => {
    const seed = (entityId: string, matchedIn: 'record' | 'passage', passages?: unknown[]) => ({
      entityId, conceptId: 'c-1', conceptLabel: 'E-mail', label: `Mail ${entityId}`, keyFields: {}, snippet: 'Type: E-mail\nName: Mail',
      matchClass: 'hybrid', matchedIn, rank: 1, diagnostics: {}, provenance: [], ...(passages ? { passages } : {}),
    });
    const graphSearch = {
      search: jest.fn().mockResolvedValue({
        status: 'found', modeUsed: 'hybrid', index: { state: 'ready' }, concepts: [], unknownConcepts: [],
        seeds: [
          seed('e-1', 'passage', [{ fieldKey: 'corps', field: 'Corps', start: 850, end: 1850, text: '…the rack keys are at the front desk…' },
            { fieldKey: 'corps', field: 'Corps', start: 0, end: 1000, text: 'Hello team' }]),
          seed('e-2', 'record', [{ fieldKey: 'corps', field: 'Corps', start: 0, end: 900, text: 'keys' }]),
          seed('e-3', 'record'),
        ],
        coverage: { expectedCount: 3, indexedCount: 3, exactOnlyCount: 0, passageCount: 12, passageIndexedCount: 12, passageTruncatedCount: 1 },
      }),
    };
    const { service } = setup(undefined, { graphSearch });
    const result = await service.findRecords('user-1', 'model-1', { query: 'where are the rack keys' });
    expect(result.records[0]).toEqual({
      entityId: 'e-1', concept: 'E-mail', name: 'Mail e-1', keyFields: {}, snippet: 'Corps: …the rack keys are at the front desk…',
      match: 'hybrid', matchedIn: 'passage', sourceCount: 0,
      passages: [{ field: 'Corps', fieldKey: 'corps', text: '…the rack keys are at the front desk…' }, { field: 'Corps', fieldKey: 'corps', text: 'Hello team' }],
    });
    expect(result.records[1]).toMatchObject({ snippet: 'Type: E-mail\nName: Mail', matchedIn: 'record', passages: [{ field: 'Corps', text: 'keys' }] });
    expect(result.records[2]).not.toHaveProperty('passages');
    expect(result.notes.join(' ')).toMatch(/quote them as evidence.*query_records/);
    expect(result.notes.join(' ')).toMatch(/1 records have fields too long/);
  });

  it('says which record the search named, and through which links each record was found', async () => {
    const graphSearch = {
      search: jest.fn().mockResolvedValue({
        status: 'found', modeUsed: 'hybrid', index: { state: 'queued', fallback: { indexId: 'old', sameData: false } },
        concepts: [{ conceptId: 'c-k', key: 'contract', label: 'Contract' }], unknownConcepts: [],
        anchors: [{ entityId: 'cust-1', label: 'Carrefour', conceptLabel: 'Customer', linkedCount: 40 }],
        seeds: [{ entityId: 'k-1', conceptId: 'c-k', conceptLabel: 'Contract', label: 'CT003', keyFields: {}, snippet: 'Type: Contract',
          matchClass: 'linked', matchedIn: 'link', rank: 1, diagnostics: {}, provenance: [],
          via: { entityId: 'cust-1', label: 'Carrefour', conceptLabel: 'Customer', links: 1, path: [{ relation: 'has_contract', direction: 'outgoing' }] } }],
        hasMore: true, coverage: { expectedCount: 10, indexedCount: 10, exactOnlyCount: 0 },
      }),
    };
    const { service } = setup(undefined, { graphSearch });
    const result = await service.findRecords('user-1', 'model-1', { query: 'contrats de Carrefour', concepts: ['Contract'] });
    expect(result).toMatchObject({
      foundThrough: [{ entityId: 'cust-1', concept: 'Customer', name: 'Carrefour', linkedRecords: 40 }],
      records: [{ entityId: 'k-1', match: 'linked', matchedIn: 'link',
        via: { entityId: 'cust-1', concept: 'Customer', name: 'Carrefour', links: 1, path: [{ relation: 'has_contract', direction: 'outgoing' }] } }],
      completeness: { complete: false, reasons: ['more_results', 'index_not_ready'] },
    });
    const notes = result.notes.join(' ');
    expect(notes).toMatch(/Found through Customer "Carrefour".*40 record\(s\).*linked_to=\[\{relation, record_ids: \["cust-1"\]\}\]/);
    expect(notes).toMatch(/index of earlier data was searched/);
  });

  it('reports concepts the model does not hold as not represented', async () => {
    const graphSearch = {
      search: jest.fn().mockResolvedValue({
        status: 'not_represented', modeUsed: 'hybrid', index: { state: 'ready' }, concepts: [], unknownConcepts: ['Supplier'], seeds: [],
        coverage: { expectedCount: 10, indexedCount: 10, exactOnlyCount: 0 },
      }),
    };
    const { service } = setup(undefined, { graphSearch });
    const result = await service.findRecords('user-1', 'model-1', { query: 'x', concepts: ['Supplier'], data: 'draft', limit: 3 });
    expect(graphSearch.search).toHaveBeenCalledWith('user-1', 'model-1', expect.objectContaining({ environment: 'draft', limit: 3 }));
    expect(result.notes).toEqual(['The model has no concept named "Supplier": this information is not in the model.']);
  });

  it('follows links in two steps, filtering concepts on the last one only', async () => {
    const graphSearch = {
      expand: jest.fn().mockResolvedValue({
        status: 'found', truncated: true, hiddenSeeds: 1,
        nodes: [
          { entityId: 'e-1', conceptId: 'c-1', conceptLabel: 'Contract', label: 'K-1', keyFields: {}, inclusionReason: 'seed', path: [], provenance: [] },
          { entityId: 'e-3', conceptId: 'c-3', conceptLabel: 'Invoice', label: 'F-9', keyFields: { number: 'F-9' }, inclusionReason: 'relationship', provenance: recordProvenance,
            path: [{ fromEntityId: 'e-1', relationId: 'r-1', relationKey: 'signed_by', direction: 'outgoing', toEntityId: 'e-2' },
              { fromEntityId: 'e-2', relationId: 'r-2', relationKey: 'billed', direction: 'outgoing', toEntityId: 'e-3' }] },
        ],
        edges: [{ relationId: 'r-2', relationKey: 'billed', sourceEntityId: 'e-2', targetEntityId: 'e-3' }],
      }),
    };
    const { service } = setup(undefined, { graphSearch });
    const result = await service.relatedRecords('user-1', 'model-1', {
      recordIds: ['e-1'], relations: ['signed_by'], thenRelations: ['billed'], direction: 'outgoing', concepts: ['Invoice'],
    });
    expect(graphSearch.expand).toHaveBeenCalledWith('user-1', 'model-1', {
      environment: 'production', seedEntityIds: ['e-1'], maxNodes: 50,
      steps: [{ relations: ['signed_by'], direction: 'outgoing' }, { relations: ['billed'], direction: 'outgoing', concepts: ['Invoice'] }],
    });
    expect(result.records[1]).toEqual({
      entityId: 'e-3', concept: 'Invoice', name: 'F-9', keyFields: { number: 'F-9' }, includedBecause: 'linked',
      provenance: recordProvenance,
      path: [{ from: 'e-1', relation: 'signed_by', direction: 'outgoing', to: 'e-2' }, { from: 'e-2', relation: 'billed', direction: 'outgoing', to: 'e-3' }],
    });
    expect(result.records[0].includedBecause).toBe('asked_for');
    expect(result.links).toEqual([{ relation: 'billed', from: 'e-2', to: 'e-3' }]);
    expect(result.notes.join(' ')).toMatch(/stopped at 2 records/);
    expect(result.notes.join(' ')).toMatch(/1 of the records asked for/);
  });

  it('lists records of a concept with how the query was read and what was left out', async () => {
    const graphSearch = {
      queryRecords: jest.fn().mockResolvedValue({
        status: 'ok', modelVersionId: 'v-1', definitionsVersionId: 'v-1', dataRevisionId: 'dr-1',
        concept: { conceptId: 'c-1', key: 'invoice', label: 'Invoice' }, total: 120, hiddenRecords: 3, unparsable: { issued: 2 },
        appliedQuery: { filters: [{ field: 'issued', fieldLabel: 'Issue date', type: 'date', op: 'between', value: 'last_3_months',
          range: { from: '2026-07-04T00:00:00Z', to: '2026-10-04T00:00:00Z' } }] },
        records: [{ entityId: 'e-1', name: 'F-1', keyFields: { number: 'F-1' }, values: { notes: 'x…' }, provenance: recordProvenance, truncated: true, truncatedFields: ['notes'] }],
        returned: 1, offset: 0, nextOffset: 1, pageCutShort: false,
      }),
    };
    const { service } = setup(undefined, { graphSearch });
    const result = await service.queryRecords('user-1', 'model-1', {
      concept: 'Invoice', filters: [{ field: 'issued', op: 'between', value: 'last_3_months' }], limit: 1,
    });
    expect(graphSearch.queryRecords).toHaveBeenCalledWith('user-1', 'model-1', {
      environment: 'production', concept: 'Invoice', filters: [{ field: 'issued', op: 'between', value: 'last_3_months' }], limit: 1,
    });
    expect(result).toMatchObject({
      model: { id: 'model-1', name: 'Billing' }, data: 'published', status: 'ok', concept: 'Invoice', total: 120,
      unparsable: { issued: 2 }, offset: 0, nextOffset: 1, truncated: true,
      records: [{ entityId: 'e-1', name: 'F-1', values: { notes: 'x…' }, truncated: true }],
    });
    expect(result.appliedQuery.filters?.[0]).toMatchObject({ range: { from: '2026-07-04T00:00:00Z' } });
    expect(result).toMatchObject({ records: [{ provenance: recordProvenance }] });
    const notes = result.notes.join(' ');
    expect(notes).toMatch(/2 values of "Issue date" could not be read as dates/);
    expect(notes).toMatch(/3 records of this concept come from sources the user cannot open/);
    expect(notes).toMatch(/Records 1 to 1 of 120 .* offset=1/);
    expect(notes).toMatch(/cut at 1500 characters/);
  });

  it('returns groups, and says when only part of them came back', async () => {
    const graphSearch = {
      queryRecords: jest.fn().mockResolvedValue({
        status: 'ok', modelVersionId: 'v-2', definitionsVersionId: 'v-1', concept: { label: 'Invoice' }, total: 900, hiddenRecords: 0,
        unparsable: {}, appliedQuery: { groupBy: [{ name: 'issued:month', field: 'issued', label: 'Issue date', type: 'date', bucket: 'month' }] },
        buckets: [{ 'issued:month': '2026-07', count: 12 }], bucketsTruncated: true,
      }),
    };
    const { service } = setup(undefined, { graphSearch });
    const result = await service.queryRecords('user-1', 'model-1', { concept: 'Invoice', groupBy: [{ field: 'issued', bucket: 'month' }], data: 'draft' });
    expect(graphSearch.queryRecords).toHaveBeenCalledWith('user-1', 'model-1', expect.objectContaining({ environment: 'draft' }));
    expect(result).toMatchObject({ data: 'draft', total: 900, groups: [{ 'issued:month': '2026-07', count: 12 }], truncated: true });
    expect(result).not.toHaveProperty('records');
    expect(result).not.toHaveProperty('unparsable');
    expect(result.notes.join(' ')).toMatch(/Only the first 1 groups/);
    expect(result.notes.join(' ')).toMatch(/another version of the model/);
  });

  it('preserves source provenance on records returned by a traverse', async () => {
    const graphSearch = {
      traverseRecords: jest.fn().mockResolvedValue({
        status: 'ok', dataRevisionId: 'dr-1', modelVersionId: 'v-1', definitionsVersionId: 'v-1',
        concept: { conceptId: 'c-fact', key: 'fact', label: 'Fact' }, total: 1, hiddenRecords: 0,
        appliedQuery: {}, records: [{ entityId: 'fact-1', name: 'Fact 1', keyFields: {}, values: { text: 'Source-backed' }, provenance: recordProvenance }],
        returned: 1, offset: 0, nextOffset: null,
      }),
    };
    const { service } = setup(undefined, { graphSearch });

    const result = await service.traverseRecords('user-1', 'model-1', {
      start: { concept: 'Customer', recordIds: ['customer-1'] }, steps: [{ relation: 'has_fact' }],
    });

    expect(result).toMatchObject({ records: [{ provenance: recordProvenance }] });
  });

  it('reads the records linked to a record with their values, and says how many exist in all', async () => {
    const graphSearch = {
      expand: jest.fn().mockResolvedValue({
        status: 'partial', truncated: true, hiddenSeeds: 0, dataRevisionId: 'dr-1',
        nodes: [
          { entityId: 'mail', conceptId: 'c-mail', conceptLabel: 'Message', label: 'Relance', keyFields: {}, inclusionReason: 'seed', path: [], provenance: [] },
          { entityId: 'f-1', conceptId: 'c-fact', conceptLabel: 'Fait', label: 'F1', keyFields: {}, inclusionReason: 'relationship', provenance: [],
            values: { statement: 'Le contrat expire en juin' }, path: [{ fromEntityId: 'mail', relationId: 'r', relationKey: 'enonce', direction: 'outgoing', toEntityId: 'f-1' }] },
        ],
        edges: [], unknownFields: ['colour'],
        linkCounts: [{ relationId: 'r', relationKey: 'enonce', direction: 'outgoing', conceptId: 'c-fact', conceptLabel: 'Fait', count: 60, hidden: 2 }],
      }),
    };
    const { service } = setup(undefined, { graphSearch });
    const result = await service.relatedRecords('user-1', 'model-1', {
      recordIds: ['mail'], relations: ['énonce'], direction: 'outgoing', fields: ['statement', 'colour'], maxRecords: 1,
    });
    expect(graphSearch.expand).toHaveBeenCalledWith('user-1', 'model-1', expect.objectContaining({ fields: ['statement', 'colour'], maxNodes: 1 }));
    expect(result.records[1]).toMatchObject({ name: 'F1', values: { statement: 'Le contrat expire en juin' } });
    expect(result.linkCounts).toEqual([{ relation: 'enonce', direction: 'outgoing', concept: 'Fait', count: 60, hidden: 2 }]);
    expect(result.completeness).toMatchObject({ complete: false, returned: 1, total: 60, hasMore: true, hiddenRecords: 2 });
    const notes = result.notes.join(' ');
    expect(notes).toMatch(/1 of the 60 linked records are returned/);
    expect(notes).toMatch(/linked_to/);
    expect(notes).toMatch(/counted in linkCounts as hidden/);
    expect(notes).toMatch(/fields "colour"/);
  });

  it('explains an empty result: which condition left nothing, and the stored values a word may have meant', async () => {
    const graphSearch = {
      queryRecords: jest.fn().mockResolvedValue({
        status: 'ok', modelVersionId: 'v-1', definitionsVersionId: 'v-1', dataRevisionId: 'dr-1', concept: { label: 'Invoice' },
        total: 0, hiddenRecords: 0, unparsable: {}, appliedQuery: {}, records: [], returned: 0, offset: 0, nextOffset: null,
        diagnostics: { readableRecords: 6, checks: [
          { part: 'filters[0]', field: 'Status', op: 'eq', matches: 0, didYouMean: ['Payée', 'payee'] },
          { part: 'filters[1]', field: 'Amount', op: 'gt', matches: 3 }] },
      }),
    };
    const { service } = setup(undefined, { graphSearch });
    const result = await service.queryRecords('user-1', 'model-1', { concept: 'Invoice', filters: [{ field: 'status', op: 'eq', value: 'payed' }] });
    expect(result).toMatchObject({ total: 0, completeness: { complete: true, total: 0 }, diagnostics: { readableRecords: 6 } });
    const notes = result.notes.join(' ');
    expect(notes).toMatch(/out of 6 readable records/);
    expect(notes).toMatch(/filters\[0\] \(Status eq\) 0; filters\[1\] \(Amount gt\) 3/);
    expect(notes).toMatch(/"Payée", "payee"/);
  });

  it('walks several links: groups by start record overlap, and an empty walk says whether its start matched', async () => {
    const graphSearch = {
      traverseRecords: jest.fn()
        .mockResolvedValueOnce({
          status: 'ok', modelVersionId: 'v-1', definitionsVersionId: 'v-1', dataRevisionId: 'dr-1', concept: { label: 'Fait' },
          total: 4, hiddenRecords: 0, unparsable: {}, appliedQuery: {}, groupsOverlap: true, bucketsTruncated: false,
          buckets: [{ 'start.name': 'Alice', entityIds: { 'start.name': 'corr:alice' }, count: 3 }, { 'start.name': 'Bob', entityIds: { 'start.name': 'corr:bob' }, count: 3 }],
        })
        .mockResolvedValueOnce({
          status: 'ok', modelVersionId: 'v-1', definitionsVersionId: 'v-1', dataRevisionId: 'dr-1', concept: { label: 'Fait' },
          total: 0, hiddenRecords: 0, unparsable: {}, appliedQuery: {}, records: [], returned: 0, offset: 0, nextOffset: null,
          diagnostics: { readableRecords: 4, checks: [{ part: 'path', field: 'path', op: 'reached_by', matches: 0 }], startRecords: 0,
            start: { readableRecords: 4, checks: [{ part: 'filters[0]', field: 'Domaine', op: 'eq', matches: 0, didYouMean: ['acme.com'] }] } },
        }),
    };
    const { service } = setup(undefined, { graphSearch });
    const grouped = await service.traverseRecords('user-1', 'model-1', {
      start: { concept: 'Correspondant' }, steps: [{ relation: 'désigne' }, { relation: 'a pour participant' }, { relation: 'énonce' }],
      groupBy: [{ field: 'name', step: 0 }],
    });
    expect(graphSearch.traverseRecords).toHaveBeenCalledWith('user-1', 'model-1', expect.objectContaining({ environment: 'production', groupBy: [{ field: 'name', step: 0 }] }));
    expect(grouped).toMatchObject({ total: 4, groups: [{ count: 3 }, { count: 3 }], completeness: { complete: true } });
    expect(grouped.notes.join(' ')).toMatch(/counts in each of their groups/);
    const empty = await service.traverseRecords('user-1', 'model-1', {
      start: { concept: 'Correspondant', filters: [{ field: 'Domaine', op: 'eq', value: 'acme.cmo' }] }, steps: [{ relation: 'désigne' }],
    });
    const notes = empty.notes.join(' ');
    expect(notes).toMatch(/No start record matches/);
    expect(notes).toMatch(/"acme.com"/);
  });

  it('connects two records by their shortest chains, and says when "not connected" is not a proof', async () => {
    const graphSearch = {
      connectRecords: jest.fn()
        .mockResolvedValueOnce({
          status: 'connected', links: 2, maxLinks: 4, searchedLinks: 2, truncated: false, dataRevisionId: 'dr-1',
          paths: [{ records: ['a', 'p', 'm'], steps: [
            { fromEntityId: 'a', relationId: 'r-des', relationKey: 'designates', direction: 'incoming', toEntityId: 'p' },
            { fromEntityId: 'p', relationId: 'r-part', relationKey: 'has_participant', direction: 'incoming', toEntityId: 'm' }] }],
          records: [{ entityId: 'a', conceptId: 'c', conceptLabel: 'Correspondant', label: 'Alice', keyFields: {} },
            { entityId: 'p', conceptId: 'p', conceptLabel: 'Participation', label: 'M1 Alice', keyFields: {} },
            { entityId: 'm', conceptId: 'm', conceptLabel: 'Message', label: 'Contrat', keyFields: {}, provenance: recordProvenance }],
        })
        .mockResolvedValueOnce({ status: 'not_connected', maxLinks: 4, searchedLinks: 4, truncated: true, dataRevisionId: 'dr-1', paths: [], records: [] })
        .mockResolvedValueOnce({ status: 'not_connected', maxLinks: 4, searchedLinks: 4, truncated: false, dataRevisionId: 'dr-1', paths: [], records: [] }),
    };
    const { service } = setup(undefined, { graphSearch });
    const linked = await service.connectRecords('user-1', 'model-1', { fromRecordId: 'a', toRecordId: 'm' });
    expect(graphSearch.connectRecords).toHaveBeenCalledWith('user-1', 'model-1', { fromEntityId: 'a', toEntityId: 'm', environment: 'production' });
    expect(linked).toMatchObject({ status: 'connected', links: 2, completeness: { complete: true },
      paths: [{ records: [{ name: 'Alice' }, { name: 'M1 Alice' }, { name: 'Contrat', concept: 'Message' }],
        steps: [{ relation: 'designates', direction: 'incoming' }, { relation: 'has_participant' }] }] });
    expect(linked.paths[0].records[2].provenance).toEqual(recordProvenance);
    const cut = await service.connectRecords('user-1', 'model-1', { fromRecordId: 'a', toRecordId: 'z' });
    expect(cut.completeness).toMatchObject({ complete: false, reasons: ['search_cut'] });
    expect(cut.notes[0]).toMatch(/a connection may exist/);
    const none = await service.connectRecords('user-1', 'model-1', { fromRecordId: 'a', toRecordId: 'z' });
    expect(none.completeness.complete).toBe(true);
    expect(none.notes[0]).toMatch(/No chain of at most 4 links .* higher max_links/);
  });

  it('hands back what is wrong in a query so the assistant can fix it', async () => {
    const errors = [{ code: 'invalid_query', part: 'filters[0].field', reason: 'unknown_field', message: 'Invoice has no field "colour"', available: ['Amount'] }];
    const graphSearch = { queryRecords: jest.fn()
      .mockResolvedValueOnce({ status: 'invalid_query', errors, appliedQuery: { filters: [{ field: 'colour', op: 'eq' }] } })
      .mockResolvedValueOnce({ status: 'not_represented', errors: [{ ...errors[0], part: 'concept', reason: 'unknown_concept', available: ['Invoice', 'Customer'] }], appliedQuery: {} }) };
    const { service } = setup(undefined, { graphSearch });
    const invalid = await service.queryRecords('user-1', 'model-1', { concept: 'Invoice', filters: [{ field: 'colour', op: 'eq', value: 'red' }] });
    expect(invalid).toMatchObject({ status: 'invalid_query', errors, appliedQuery: { filters: [{ field: 'colour' }] } });
    expect(invalid.notes[0]).toMatch(/fix the parts listed in errors/);
    const missing = await service.queryRecords('user-1', 'model-1', { concept: 'Supplier' });
    expect(missing.notes[0]).toBe('The model has no concept "Supplier": this information is not in the model. Its concepts: Invoice, Customer.');
  });

  it('describes the data to query: fields with types, key fields, relationships and record counts', async () => {
    const invoice = { ...customer, id: 'n-inv', key: 'invoice', label: 'Invoice', description: 'A bill', aliases: ['Bill'],
      attributes: [
        { key: 'number', label: 'Invoice number', type: 'text' as const, required: true },
        { key: 'status', label: 'Status', type: 'enum' as const, required: false, options: ['paid', 'sent'], description: 'Where it stands' },
        { key: 'later', label: 'Added later', type: 'date' as const, required: false, aliases: ['New'] },
      ] };
    const graph = { modelId: 'model-1', versionId: 'v-1', revision: 0, records: [], recordRelations: [], nodes: [invoice, customer, documents],
      relations: [{ id: 'r-1', key: 'billed_to', label: 'billed to', inverseLabel: 'receives', description: '', sourceNodeTypeId: 'n-inv',
        targetNodeTypeId: customer.id, cardinality: 'many_to_one' as const, traversable: true, filterable: true, attributes: [] }] };
    const graphSearch = {
      dataOverview: jest.fn().mockResolvedValue({
        versionId: 'v-1', graph,
        overview: { modelVersionId: 'v-1', dataRevisionId: 'dr-1', relations: [],
          concepts: [{ conceptId: 'c-1', key: 'invoice', label: 'Invoice', keyFields: ['number'], fields: ['number', 'status'], recordCount: 42, hiddenRecords: 2 }] },
      }),
    };
    const { service } = setup(undefined, { graphSearch });
    const result = await service.describeData('user-1', 'model-1');
    expect(graphSearch.dataOverview).toHaveBeenCalledWith('user-1', 'model-1', 'production');
    expect(result.concepts[0]).toEqual({
      key: 'invoice', label: 'Invoice', description: 'A bill', aliases: ['Bill'], recordCount: 42, keyFields: ['number'],
      fields: [
        { key: 'number', label: 'Invoice number', type: 'text' },
        { key: 'status', label: 'Status', type: 'enum', options: ['paid', 'sent'], description: 'Where it stands' },
        { key: 'later', label: 'Added later', type: 'date', aliases: ['New'], inData: false },
      ],
    });
    expect(result.concepts[1]).toMatchObject({ key: 'customer', recordCount: 0, keyFields: [] });
    expect(result.concepts.map((concept) => concept.key)).not.toContain('documents');
    expect(result.relations).toEqual([{ key: 'billed_to', label: 'billed to', inverseLabel: 'receives', from: 'invoice', to: 'customer', cardinality: 'many_to_one' }]);
    expect(result.howToQuery).toMatch(/query_records/);
    const notes = result.notes.join(' ');
    expect(notes).toMatch(/"Customer" has no data yet/);
    expect(notes).toMatch(/2 records of "Invoice" come from sources the user cannot open/);
    expect(notes).toMatch(/inData: false/);
  });

  it('follows every relationship of the records in one step when none is named', async () => {
    const graphSearch = { expand: jest.fn().mockResolvedValue({ status: 'no_match', truncated: false, hiddenSeeds: 0, nodes: [], edges: [] }) };
    const { service } = setup(undefined, { graphSearch });
    const result = await service.relatedRecords('user-1', 'model-1', { recordIds: ['e-1'], concepts: ['Invoice'], data: 'draft', maxRecords: 5 });
    expect(graphSearch.expand).toHaveBeenCalledWith('user-1', 'model-1', {
      environment: 'draft', seedEntityIds: ['e-1'], maxNodes: 5, steps: [{ direction: 'both', concepts: ['Invoice'] }],
    });
    expect(result.notes).toEqual(['These records have no links of the kind asked for.']);
  });
});

describe('SemanticModelAssistantService deleteModel', () => {
  it('refuses unless the exact model name is repeated', async () => {
    const { service, models } = setup();
    Object.assign(models, { deletePermanently: jest.fn() });
    await expect(service.deleteModel('user-1', 'model-1', 'billing')).rejects.toMatchObject({ status: 400 });
    await expect(service.deleteModel('user-1', 'model-1', undefined)).rejects.toMatchObject({ status: 400 });
    expect((models as unknown as { deletePermanently: jest.Mock }).deletePermanently).not.toHaveBeenCalled();
  });

  it('deletes the model when the name matches', async () => {
    const { service, models } = setup();
    const deletePermanently = jest.fn().mockResolvedValue(undefined);
    Object.assign(models, { deletePermanently });
    await expect(service.deleteModel('user-1', 'model-1', 'Billing')).resolves.toEqual({ deleted: true, modelId: 'model-1', name: 'Billing' });
    expect(deletePermanently).toHaveBeenCalledWith('user-1', 'model-1');
  });
});

describe('SemanticModelAssistantService cloneModel', () => {
  it('names the copy after the source and passes the include options', async () => {
    const { service, models } = setup();
    const clone = jest.fn().mockResolvedValue({ id: 'copy-1', name: 'Billing (copy)', status: 'draft', role: 'owner', dataCopy: { status: 'copied', records: 5 } });
    Object.assign(models, { clone });
    const result = await service.cloneModel(actor, 'model-1', { includeData: true });
    // WP04.2: explicit data still carries its sources; the MCP default is structure-only.
    expect(clone).toHaveBeenCalledWith('user-1', 'model-1', 'Billing (copy)', { sources: false, data: true, shares: false });
    expect(result).toMatchObject({ modelId: 'copy-1', sourceModelId: 'model-1', dataCopy: { status: 'copied' } });
  });

  it('clones the structure only unless sources are explicitly requested (WP04.2)', async () => {
    const { service, models } = setup();
    const clone = jest.fn().mockResolvedValue({ id: 'copy-3', name: 'Billing (copy)', status: 'draft', role: 'owner', dataCopy: { status: 'skipped' } });
    Object.assign(models, { clone });
    await service.cloneModel(actor, 'model-1', {});
    expect(clone).toHaveBeenCalledWith('user-1', 'model-1', 'Billing (copy)', { sources: false, data: false, shares: false });
  });

  it('keeps a given name and leaves out what is not asked', async () => {
    const { service, models } = setup();
    const clone = jest.fn().mockResolvedValue({ id: 'copy-2', name: 'Lean', status: 'draft', role: 'owner', dataCopy: { status: 'skipped' } });
    Object.assign(models, { clone });
    await service.cloneModel(actor, 'model-1', { name: ' Lean ', includeSources: false });
    expect(clone).toHaveBeenCalledWith('user-1', 'model-1', 'Lean', { sources: false, data: false, shares: false });
  });
});

describe('SemanticModelAssistantService already-linked workspace access (SEC-04 / WP03.6)', () => {
  const linkedModelWorkspaces = {
    list: jest.fn().mockResolvedValue([
      { workspaceId: 'ws-1', enabled: true, role: 'origin' },
    ]),
  };

  it('rechecks current workspace access even when the workspace is already linked', async () => {
    const sourceMappings = { profileAsset: jest.fn().mockResolvedValue({ fields: [] }) };
    const { service } = setup(undefined, {
      sourceMappings,
      modelWorkspaces: linkedModelWorkspaces,
      workspaceShares: { hasAccess: jest.fn().mockResolvedValue(false) },
      documents: {},
    });
    await expect(service.profileSpreadsheet(actor, 'model-1', 'ws-1', 'doc-1'))
      .rejects.toMatchObject({ code: ErrorCode.SEMANTIC_MODEL_WORKSPACE_INVALID });
    expect(sourceMappings.profileAsset).not.toHaveBeenCalled();
  });

  it('profiles an already-linked workspace the actor can still read', async () => {
    const sourceMappings = { profileAsset: jest.fn().mockResolvedValue({ sheets: [], fields: [], sampleRows: [] }) };
    const { service } = setup(undefined, {
      sourceMappings,
      modelWorkspaces: linkedModelWorkspaces,
      workspaceShares: { hasAccess: jest.fn().mockResolvedValue(true) },
      documents: {},
    });
    await expect(service.profileSpreadsheet(actor, 'model-1', 'ws-1', 'doc-1')).resolves.toBeDefined();
    expect(sourceMappings.profileAsset).toHaveBeenCalledWith(actor.userId, 'model-1', 'ws-1', 'doc-1', { workspaceId: 'ws-1' });
  });
});
