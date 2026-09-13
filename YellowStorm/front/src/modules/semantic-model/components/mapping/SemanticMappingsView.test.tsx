import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSemanticModelEditorStore } from '../../store';
import { SemanticMappingsView } from './SemanticMappingsView';

vi.mock('../../query/hooks', () => ({
  useSourceMappings: () => ({ isLoading: false, data: [
    { id: 'crm', conceptId: 'organization', documentId: 'crm', documentName: 'CRM Production', sheetName: 'customers', fieldMappings: [{ sourceField: 'customer_id', targetAttribute: 'id', mode: 'direct' }], identityFields: ['id'] },
    { id: 'excel', conceptId: 'organization', documentId: 'excel', documentName: 'customers.xlsx', sheetName: 'Customers', fieldMappings: [{ sourceField: 'legal_name', targetAttribute: 'name', mode: 'direct' }], identityFields: ['id'] },
  ] }),
  useRelationResolutionRules: () => ({ isLoading: false, data: [{ relationId: 'customer-of', sourceAttribute: 'id', targetAttribute: 'customerId', strategy: 'exact' }] }),
  useSourceResolutionPolicies: () => ({ isLoading: false, data: [{ conceptId: 'organization', priorities: [{ mappingId: 'crm', rank: 1 }, { mappingId: 'excel', rank: 2 }] }] }),
  useMappingHealth: () => ({ isLoading: false, data: { items: [], summary: { healthy: 2, changed: 0, unavailable: 0, broken: 0 } } }),
}));

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
    expect(screen.getByText('customers.xlsx / Customers')).toBeInTheDocument();
     expect(screen.getByText('id = customerId · cardinality.one_to_many · relationMatching.strategyOption.exact')).toBeInTheDocument();
    expect(screen.getByText('mappingHealth.allReady')).toBeInTheDocument();
  });

  it('does not offer source-priority edits to viewers', () => {
    render(<QueryClientProvider client={new QueryClient()}><SemanticMappingsView modelId='model' canEdit={false} /></QueryClientProvider>);
    expect(screen.getByRole('combobox')).toBeDisabled();
  });
});
