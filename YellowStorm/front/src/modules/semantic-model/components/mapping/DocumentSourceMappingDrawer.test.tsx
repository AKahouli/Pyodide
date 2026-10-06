import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSemanticModelEditorStore } from '../../store';
import type { SemanticGraph } from '../../types';
import { DocumentSourceMappingDrawer } from './DocumentSourceMappingDrawer';

const api = vi.hoisted(() => ({
  listSourceAssets: vi.fn(),
  listSourceMappings: vi.fn(),
  previewSourceMapping: vi.fn(),
  createSourceMapping: vi.fn(),
  createBulkDocumentSourceMappings: vi.fn(),
  createWorkspaceSourceMapping: vi.fn(),
  getDocumentLabels: vi.fn(),
}));
const workspaceApi = vi.hoisted(() => ({ getDocuments: vi.fn(), getFolderContents: vi.fn(), getDocument: vi.fn() }));

vi.mock('../../api', () => ({ semanticModelApi: api }));
vi.mock('@/modules/workspace/api', () => workspaceApi);
vi.mock('@/modules/agent', () => ({ useAgents: () => [], useAgentStore: { getState: () => ({ isInitialized: true, isLoading: false, fetchAgents: vi.fn() }) } }));
// The real viewer loads the file; here it only shows where it was asked to go.
vi.mock('@/modules/file-viewer/components/DocumentPreviewViewer', () => ({
  DocumentPreviewViewer: ({ fileName, navigation }: { fileName: string; navigation?: { page?: number; highlightText?: string } | null }) =>
    <div data-testid='viewer'>{fileName}|{navigation?.page ?? ''}|{navigation?.highlightText ?? ''}</div>,
}));

const graph: SemanticGraph = {
  modelId: 'model-1', versionId: 'version-1', revision: 0, relations: [], records: [], recordRelations: [],
  nodes: [{ id: 'concept-1', key: 'contract', label: 'Contract', description: '', category: 'business_object', recordPolicy: 'none', systemKey: null, aliases: [], attributes: [
    { key: 'contract_number', label: 'Contract number', type: 'text', required: true },
    { key: 'amendment_number', label: 'Amendment number', type: 'text', required: true },
  ], position: { x: 0, y: 0 } }],
};

describe('DocumentSourceMappingDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // These cases are about the fields alone: the document beside them is hidden.
    localStorage.setItem('semantic-model.document-split', JSON.stringify({ collapsed: true, layout: { document: 55, fields: 45 } }));
    api.getDocumentLabels.mockResolvedValue({ documentsRead: 1, unread: [], labels: [] });
    useSemanticModelEditorStore.getState().hydrate(graph);
    api.listSourceMappings.mockResolvedValue([]);
    api.listSourceAssets.mockResolvedValue({ assets: [
      { workspaceId: 'workspace-1', documentId: 'document-1', name: 'One.pdf', kind: 'document', mimeType: 'application/pdf', path: 'one.pdf' },
      { workspaceId: 'workspace-1', documentId: 'document-2', name: 'Two.pdf', kind: 'document', mimeType: 'application/pdf', path: 'two.pdf' },
    ] });
    api.previewSourceMapping.mockResolvedValue({ entities: [], stats: { scannedRows: 1, resolvedEntities: 0, duplicateKeysSkipped: 0, nullIdentitySkipped: 0 }, identityEvidence: [], warnings: [] });
    api.createBulkDocumentSourceMappings.mockResolvedValue({ revision: 1, mappingCount: 2 });
  });

  it('previews representative documents and saves one bulk mapping', async () => {
    let finishFirst!: (value: object) => void;
    api.previewSourceMapping
      .mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }))
      .mockResolvedValueOnce({ entities: [], stats: { scannedRows: 1, resolvedEntities: 0, duplicateKeysSkipped: 0, nullIdentitySkipped: 0 }, identityEvidence: [], warnings: [] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    render(<QueryClientProvider client={client}><DocumentSourceMappingDrawer modelId='model-1' target={{
      workspaceId: 'workspace-1', documentId: 'document-1', documentName: 'One.pdf', assetKind: 'document', conceptId: 'concept-1', mimeType: 'application/pdf', path: 'one.pdf',
    }} onClose={vi.fn()} /></QueryClientProvider>);

    await screen.findByText('Two.pdf');
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[1]);
    fireEvent.click(checkboxes[2]);
    fireEvent.click(checkboxes[3]);
    fireEvent.click(screen.getByRole('button', { name: 'mapping.previewButton' }));

    await waitFor(() => expect(api.previewSourceMapping).toHaveBeenCalledTimes(1));
    finishFirst({ entities: [], stats: { scannedRows: 1, resolvedEntities: 0, duplicateKeysSkipped: 0, nullIdentitySkipped: 0 }, identityEvidence: [], warnings: [] });
    await waitFor(() => expect(api.previewSourceMapping).toHaveBeenCalledTimes(2));
    expect(api.previewSourceMapping).toHaveBeenCalledWith('model-1', expect.objectContaining({ conceptId: 'concept-1', assetKind: 'document' }));
    fireEvent.click(screen.getByRole('button', { name: 'mapping.save' }));
    await waitFor(() => expect(api.createBulkDocumentSourceMappings).toHaveBeenCalledWith('model-1', expect.objectContaining({ identityFields: ['contract_number', 'amendment_number'], documents: expect.arrayContaining([
      { workspaceId: 'workspace-1', documentId: 'document-1' },
      { workspaceId: 'workspace-1', documentId: 'document-2' },
    ]) })));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['semantic-models', 'data-preview', 'model-1'] });
  });

  it('makes several records per document with rules alone, and previews them as a table', async () => {
    api.createSourceMapping.mockResolvedValue({ revision: 1, mappingCount: 1 });
    api.previewSourceMapping.mockResolvedValue({ entities: [
      { entityKey: 'cnt-7|1', label: 'CNT-7', values: { contract_number: 'CNT-7', amendment_number: '1' }, provenance: { rowNumber: 1 } },
      { entityKey: 'cnt-7|2', label: 'CNT-7', values: { contract_number: 'CNT-7', amendment_number: '2' }, provenance: { rowNumber: 2 } },
    ], stats: { scannedRows: 2, resolvedEntities: 2, duplicateKeysSkipped: 0, nullIdentitySkipped: 0 }, identityEvidence: [], warnings: [] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={client}><DocumentSourceMappingDrawer modelId='model-1' target={{
      workspaceId: 'workspace-1', documentId: 'document-1', documentName: 'One.pdf', assetKind: 'document', conceptId: 'concept-1', mimeType: 'application/pdf', path: 'one.pdf',
    }} onClose={vi.fn()} /></QueryClientProvider>);

    // Every field is read by rules: the switch is offered all the same.
    fireEvent.click(await screen.findByLabelText('mapping.manyRecords.label'));
    fireEvent.click(screen.getByRole('button', { name: 'mapping.previewButton' }));
    await waitFor(() => expect(api.previewSourceMapping).toHaveBeenCalledWith('model-1', expect.objectContaining({ aiSettings: { manyRecords: true } })));
    const table = await screen.findByRole('region', { name: 'mapping.manyRecords.found' });
    expect(table.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(table).toHaveTextContent('CNT-7');
    fireEvent.click(screen.getByRole('button', { name: 'mapping.save' }));
    await waitFor(() => expect(api.createSourceMapping).toHaveBeenCalledWith('model-1', expect.objectContaining({ aiSettings: { manyRecords: true } })));
  });

  it('defaults extracted fields to deterministic and saves an AI choice', async () => {
    api.createSourceMapping.mockResolvedValue({ revision: 1, mappingCount: 1 });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={client}><DocumentSourceMappingDrawer modelId='model-1' target={{
      workspaceId: 'workspace-1', documentId: 'document-1', documentName: 'One.pdf', assetKind: 'document', conceptId: 'concept-1', mimeType: 'application/pdf', path: 'one.pdf',
    }} onClose={vi.fn()} /></QueryClientProvider>);

    // Two extracted fields, so two strategy selectors; the first is the contract number.
    const strategyTriggers = await screen.findAllByRole('combobox', { name: 'mapping.strategyFor' });
    expect(strategyTriggers).toHaveLength(2);

    fireEvent.click(strategyTriggers[0]);
    fireEvent.click(await screen.findByRole('option', { name: 'mapping.strategy.ai' }));

    fireEvent.click(screen.getByRole('button', { name: 'mapping.save' }));
    await waitFor(() => expect(api.createSourceMapping).toHaveBeenCalledWith('model-1', expect.objectContaining({
      fieldMappings: [
        expect.objectContaining({ targetAttribute: 'contract_number', mode: 'extract', extractionStrategy: 'ai' }),
        expect.objectContaining({ targetAttribute: 'amendment_number', mode: 'extract', extractionStrategy: 'deterministic' }),
      ],
    })));
  });

  it('saves the meaning an AI-read field is given, and drops it when rules read the field again', async () => {
    api.createSourceMapping.mockResolvedValue({ revision: 1, mappingCount: 1 });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={client}><DocumentSourceMappingDrawer modelId='model-1' target={{
      workspaceId: 'workspace-1', documentId: 'document-1', documentName: 'One.pdf', assetKind: 'document', conceptId: 'concept-1', mimeType: 'application/pdf', path: 'one.pdf',
    }} onClose={vi.fn()} /></QueryClientProvider>);

    const strategyTriggers = await screen.findAllByRole('combobox', { name: 'mapping.strategyFor' });
    fireEvent.click(strategyTriggers[0]);
    fireEvent.click(await screen.findByRole('option', { name: 'mapping.strategy.ai' }));
    fireEvent.click(strategyTriggers[1]);
    fireEvent.click(await screen.findByRole('option', { name: 'mapping.strategy.ai' }));
    const panes = screen.getAllByRole('button', { name: /mapping\.aiField\.title/ });
    expect(panes).toHaveLength(2);
    fireEvent.click(panes[0]);
    fireEvent.click(screen.getByRole('button', { name: 'mapping.aiField.definition' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'mapping.aiField.definitionFor' }), { target: { value: 'The number on the cover page' } });
    fireEvent.click(panes[1]);
    fireEvent.click(screen.getAllByRole('button', { name: 'mapping.aiField.definition' })[1]);
    fireEvent.change(screen.getAllByRole('textbox', { name: 'mapping.aiField.definitionFor' })[1], { target: { value: 'Dropped' } });
    fireEvent.click(strategyTriggers[1]);
    fireEvent.click(await screen.findByRole('option', { name: 'mapping.strategy.deterministic' }));

    fireEvent.click(screen.getByRole('button', { name: 'mapping.save' }));
    await waitFor(() => expect(api.createSourceMapping).toHaveBeenCalled());
    const [first, second] = api.createSourceMapping.mock.calls[0][1].fieldMappings;
    expect(first).toEqual(expect.objectContaining({ extractionStrategy: 'ai', semanticDefinition: 'The number on the cover page' }));
    expect(first.agentId).toBeUndefined();
    expect(second.semanticDefinition).toBeUndefined();
  });

  it('applies shared extraction and identity settings to more than 50 existing documents', async () => {
    const assets = Array.from({ length: 102 }, (_, index) => ({
      workspaceId: 'workspace-1', documentId: `document-${index}`, name: `Doc-${index}.pdf`,
      kind: 'document' as const, mimeType: 'application/pdf', path: `doc-${index}.pdf`,
    }));
    const mappings = assets.map((asset, index) => ({
      id: `mapping-${index}`, conceptId: 'concept-1', workspaceId: asset.workspaceId,
      documentId: asset.documentId, documentName: asset.name, sheetName: '', assetKind: 'document' as const,
      fieldMappings: graph.nodes[0].attributes.map((attribute) => ({ sourceField: null, targetAttribute: attribute.key, mode: 'extract' as const, extractionStrategy: 'deterministic' as const })),
      identityFields: ['contract_number'], status: 'ready', createdBy: 'user', createdAt: '', updatedAt: '',
    }));
    api.listSourceAssets.mockResolvedValue({ assets });
    api.listSourceMappings.mockResolvedValue(mappings);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const onClose = vi.fn();
    render(<QueryClientProvider client={client}><DocumentSourceMappingDrawer modelId='model-1' target={{
      workspaceId: 'workspace-1', documentId: 'document-0', documentName: 'Doc-0.pdf',
      assetKind: 'document', conceptId: 'concept-1', mapping: mappings[0], bulkEdit: true,
    }} onClose={onClose} /></QueryClientProvider>);

    expect(await screen.findByRole('checkbox', { name: 'Doc-101.pdf' })).toBeChecked();
    fireEvent.click(screen.getAllByRole('combobox', { name: 'mapping.strategyFor' })[0]);
    fireEvent.click(await screen.findByRole('option', { name: 'mapping.strategy.ai' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Amendment number' }));
    fireEvent.click(screen.getByRole('button', { name: 'dataWorkflow.applyToSources' }));

    await waitFor(() => expect(api.createBulkDocumentSourceMappings).toHaveBeenCalledTimes(3));
    expect(api.createBulkDocumentSourceMappings.mock.calls.map(([, payload]) => payload.documents.length)).toEqual([50, 50, 2]);
    for (const [, payload] of api.createBulkDocumentSourceMappings.mock.calls) {
      expect(payload.identityFields).toEqual(['contract_number', 'amendment_number']);
      expect(payload.fieldMappings[0]).toEqual(expect.objectContaining({ targetAttribute: 'contract_number', extractionStrategy: 'ai' }));
    }
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('maps every file of a folder at once, previewing a couple of them', async () => {
    workspaceApi.getFolderContents.mockResolvedValue({ documents: [
      { id: 'sub', originalName: 'Archive', isFolder: true, mimeType: '' },
      { id: 'a', originalName: 'A.pdf', isFolder: false, mimeType: 'application/pdf', path: 'a.pdf' },
      { id: 'sheet', originalName: 'List.xlsx', isFolder: false, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      { id: 'b', originalName: 'B.docx', isFolder: false, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      { id: 'c', originalName: 'C.pdf', isFolder: false, mimeType: 'application/pdf' },
    ], pagination: { page: 1, totalPages: 1 } });
    api.createWorkspaceSourceMapping.mockResolvedValue({ revision: 4, fileCount: 120, waitingCount: 3 });
    workspaceApi.getDocuments.mockResolvedValue({ documents: [{ id: 'folder-1', originalName: 'Contracts', folderName: 'Contracts', isFolder: true, mimeType: '' }], pagination: { page: 1, totalPages: 1 } });
    const onClose = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={client}><DocumentSourceMappingDrawer modelId='model-1' target={{
      workspaceId: 'workspace-1', documentId: 'workspace:workspace-1:folder-1', documentName: 'Legal / Contracts', assetKind: 'document', conceptId: 'concept-1',
      workspace: { workspaceId: 'workspace-1', folderId: 'folder-1', name: 'Legal / Contracts' },
    }} onClose={onClose} /></QueryClientProvider>);

    expect(await screen.findByText('mapping.coverage')).toBeInTheDocument();
    // Opened from a folder, that folder starts picked.
    expect(await screen.findByRole('checkbox', { name: 'mapping.pickFolder' })).toBeChecked();
    // No per-document picker: the whole folder is the source.
    expect(screen.queryByText('mapping.bulkDocuments')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'mapping.previewButton' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'mapping.previewButton' }));
    await waitFor(() => expect(api.previewSourceMapping).toHaveBeenCalledTimes(2));
    expect(api.previewSourceMapping.mock.calls.map(([, draft]) => draft.documentId)).toEqual(['a', 'b']);
    fireEvent.click(screen.getByRole('button', { name: 'mapping.workspaceSave' }));
    await waitFor(() => expect(api.createWorkspaceSourceMapping).toHaveBeenCalledWith('model-1', expect.objectContaining({
      conceptId: 'concept-1', workspaceId: 'workspace-1', folderIds: ['folder-1'], documentIds: [],
    })));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.createBulkDocumentSourceMappings).not.toHaveBeenCalled();
  });

  it('covers the whole workspace or only the folders and files picked, and changes an existing source in place', async () => {
    workspaceApi.getDocuments.mockResolvedValue({ documents: [
      { id: 'f1', originalName: 'Contracts', folderName: 'Contracts', isFolder: true, mimeType: '' },
      { id: 'f2', originalName: 'NDAs', folderName: 'NDAs', isFolder: true, mimeType: '' },
      { id: 'loose', originalName: 'Loose.pdf', isFolder: false, mimeType: 'application/pdf' },
      { id: 'sheet', originalName: 'List.csv', isFolder: false, mimeType: 'text/csv' },
    ], pagination: { page: 1, totalPages: 1 } });
    workspaceApi.getFolderContents.mockResolvedValue({ documents: [{ id: 'inner', originalName: 'Inner.pdf', isFolder: false, mimeType: 'application/pdf' }], pagination: { page: 1, totalPages: 1 } });
    workspaceApi.getDocument.mockResolvedValue({ id: 'loose', originalName: 'Loose.pdf', isFolder: false, mimeType: 'application/pdf' });
    api.createWorkspaceSourceMapping.mockResolvedValue({ revision: 4, fileCount: 3, waitingCount: 0 });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><DocumentSourceMappingDrawer modelId='model-1' target={{
      workspaceId: 'workspace-1', documentId: 'workspace:workspace-1:all', documentName: 'Legal', assetKind: 'document', conceptId: 'concept-1',
      workspace: { workspaceId: 'workspace-1', name: 'Legal', workspaceName: 'Legal' },
    }} onClose={vi.fn()} /></QueryClientProvider>);

    const whole = await screen.findByRole('radio', { name: /mapping.coverWhole/ });
    expect(whole).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: /mapping.coverPicked/ }));
    expect(screen.getByText('mapping.pickNothing')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'mapping.workspaceSave' })).toBeDisabled();
    const folders = await screen.findAllByRole('checkbox', { name: 'mapping.pickFolder' });
    fireEvent.click(folders[1]);
    const files = screen.getAllByRole('checkbox', { name: 'mapping.pickFile' });
    // A spreadsheet cannot be read as a document.
    expect(files[1]).toBeDisabled();
    fireEvent.click(files[0]);
    expect(screen.getByText('mapping.pickedSummary')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'mapping.workspaceSave' }));
    await waitFor(() => expect(api.createWorkspaceSourceMapping).toHaveBeenLastCalledWith('model-1', expect.objectContaining({
      folderIds: ['f2'], documentIds: ['loose'], mappingId: undefined,
    })));

    view.unmount();
    render(<QueryClientProvider client={client}><DocumentSourceMappingDrawer modelId='model-1' target={{
      workspaceId: 'workspace-1', documentId: 'workspace:workspace-1:pick-1', documentName: 'Legal / NDAs, Loose.pdf', assetKind: 'document',
      mapping: { id: 'm-1', conceptId: 'concept-1', workspaceId: 'workspace-1', documentId: 'workspace:workspace-1:pick-1', documentName: 'Legal / NDAs, Loose.pdf', sheetName: '', assetKind: 'document',
        fieldMappings: [{ sourceField: null, targetAttribute: 'contract_number', mode: 'extract', extractionStrategy: 'deterministic' }], status: 'ready', createdBy: '', createdAt: '', updatedAt: '', identityFields: [],
        scope: 'workspace', selection: { folderIds: ['f2'], documentIds: ['loose'] } },
    }} onClose={vi.fn()} /></QueryClientProvider>);
    expect(await screen.findByRole('radio', { name: /mapping.coverPicked/ })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: /mapping.coverWhole/ }));
    fireEvent.click(screen.getByRole('button', { name: 'mapping.save' }));
    await waitFor(() => expect(api.createWorkspaceSourceMapping).toHaveBeenLastCalledWith('model-1', expect.objectContaining({ mappingId: 'm-1' })));
    expect(api.createWorkspaceSourceMapping.mock.lastCall![1]).not.toHaveProperty('folderIds');
  });
});
