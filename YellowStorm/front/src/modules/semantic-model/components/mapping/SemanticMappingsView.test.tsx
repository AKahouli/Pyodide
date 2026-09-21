import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSemanticModelEditorStore } from '../../store';
import { SemanticMappingsView } from './SemanticMappingsView';

vi.mock('../../query/hooks', () => ({
  useSourceMappings: () => ({ isLoading: false, data: [
    { id: 'crm', conceptId: 'organization', documentId: 'crm', documentName: 'CRM Production', sheetName: 'customers', assetKind: 'csv', status: 'ready', fieldMappings: [{ sourceField: 'customer_id', targetAttribute: 'id', mode: 'direct' }], identityFields: ['id'] },
    { id: 'excel', conceptId: 'organization', documentId: 'excel', documentName: 'customers.xlsx', sheetName: 'Customers', assetKind: 'excel_sheet', status: 'ready', fieldMappings: [{ sourceField: 'legal_name', targetAttribute: 'name', mode: 'direct' }], identityFields: ['id'] },
  ] }),
  useRelationResolutionRules: () => ({ isLoading: false, data: [{ relationId: 'customer-of', sourceAttribute: 'id', targetAttribute: 'customerId', strategy: 'exact' }] }),
  useSourceResolutionPolicies: () => ({ isLoading: false, data: [{ conceptId: 'organization', priorities: [{ mappingId: 'crm', rank: 1 }, { mappingId: 'excel', rank: 2 }] }] }),
  useMappingHealth: () => ({ isLoading: false, dataUpdatedAt: 1, data: { items: [
    { id: 'crm', state: 'healthy', conceptLabel: 'Organization', documentName: 'CRM Production', missingFields: [], availableFields: [] },
    { id: 'excel', state: 'changed', conceptLabel: 'Organization', documentName: 'customers.xlsx', missingFields: [], availableFields: [] },
  ], summary: { healthy: 1, changed: 1, unavailable: 0, broken: 0 } } }),
}));
vi.mock('../../data-plane/use-semantic-model-channel', () => ({ useSemanticModelChannel: () => ({ live: false, polling: true }) }));
vi.mock('../../data-plane/use-semantic-model-sources', () => ({ useSemanticModelSources: () => ({ isLoading: false, isError: false, refetch: vi.fn(), data: [{ mapping_id: 'source-1', model_id: 'model', workspace_id: 'workspace', document_id: 'document', sheet_name: 'Live', asset_kind: 'excel_sheet', mapping_status: 'ready', source_revision: 4, event_type: 'workspace.document.indexing_ready.v1', deleted: false, occurred_at: '2026-09-20T12:00:00Z', original_name: 'runtime-source.xlsx', mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', document_status: 'completed', indexing_status: 'ready' }] }) }));

describe('SemanticMappingsView', () => {
  beforeEach(() => useSemanticModelEditorStore.getState().hydrate({
    modelId: 'model', versionId: 'version', revision: 0, records: [], recordRelations: [],
    nodes: [
      { id: 'organization', key: 'organization', label: 'Organization', description: '', category: 'business_object', recordPolicy: 'optional', systemKey: null, aliases: [], attributes: [], position: { x: 0, y: 0 } },
      { id: 'contract', key: 'contract', label: 'Contract', description: '', category: 'business_object', recordPolicy: 'optional', systemKey: null, aliases: [], attributes: [], position: { x: 0, y: 0 } },
    ],
    relations: [{ id: 'customer-of', key: 'customer-of', label: 'customer of', inverseLabel: '', description: '', sourceNodeTypeId: 'organization', targetNodeTypeId: 'contract', cardinality: 'one_to_many', traversable: true, filterable: true, attributes: [] }],
  }));

  it('summarizes mappings, primary source and relationship matching', () => {
    render(<QueryClientProvider client={new QueryClient()}><SemanticMappingsView modelId='model' canEdit /></QueryClientProvider>);
    expect(screen.getByText('CRM Production / customers')).toBeInTheDocument();
    expect(screen.getByText('runtime-source.xlsx / Live')).toBeInTheDocument();
     expect(screen.getByText('id = customerId · cardinality.one_to_many · relationMatching.strategyOption.exact')).toBeInTheDocument();
    expect(screen.getByText('mappingHealth.state.changed')).toBeInTheDocument();
    expect(screen.getByText('customers.xlsx / Customers')).toBeInTheDocument();
    expect(screen.getByText('sourceStatus.state.ready')).toBeInTheDocument();
  });

  it('does not offer source-priority edits to viewers', () => {
    render(<QueryClientProvider client={new QueryClient()}><SemanticMappingsView modelId='model' canEdit={false} /></QueryClientProvider>);
    for (const select of screen.getAllByRole('combobox')) expect(select).toBeDisabled();
  });

  it('offers only mappings confirmed healthy by the current health result', async () => {
    const user = userEvent.setup();
    render(<QueryClientProvider client={new QueryClient()}><SemanticMappingsView modelId='model' canEdit /></QueryClientProvider>);
    await user.click(screen.getByRole('combobox', { name: 'populationRefresh.scope' }));
    await user.click(await screen.findByText('populationRefresh.singleMapping'));
    await user.click(screen.getByRole('combobox', { name: 'populationRefresh.chooseMapping' }));
    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).getByText('CRM Production / customers')).toBeInTheDocument();
    expect(within(listbox).queryByText('customers.xlsx / Customers')).not.toBeInTheDocument();
  });
});
