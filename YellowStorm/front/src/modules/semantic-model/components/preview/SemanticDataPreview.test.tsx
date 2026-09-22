import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SemanticDataPreview } from './SemanticDataPreview';

const openFile = vi.fn();
const refetch = vi.fn();

vi.mock('@/modules/file-viewer/store', () => ({ useFileViewerStore: { getState: () => ({ openFile }) } }));
vi.mock('../../query/hooks', () => ({
  useSemanticDataPreview: () => ({
    isLoading: false,
    isFetching: false,
    isError: false,
    refetch,
    data: {
      concepts: [{
        id: 'organization', label: 'Organization', entities: [{
          id: 'organization:c001', conceptId: 'organization', entityKey: 'c001', label: 'Sony Europe B.V.',
          values: { id: 'C001', country: 'NL' },
          sources: [{ mappingId: 'crm', source: { documentName: 'CRM Production' } }, { mappingId: 'excel', source: { documentName: 'customers.csv' } }],
          conflicts: [{ attribute: 'country', preferred: 'NL', conflicting: 'FR', preferredMappingId: 'crm', conflictingMappingId: 'excel' }],
          provenance: { id: { mappingId: 'mapping', source: { kind: 'csv', workspaceId: 'workspace', documentId: 'document', documentName: 'customers.csv', documentPath: '/customers.csv', mimeType: 'text/csv', sheetName: 'CSV' }, rowNumber: 2 } },
        }],
      }],
      relations: [], sourceIssues: [],
      summary: { entities: 1, resolvedRelations: 1, unresolvedRelations: 0, ambiguousRelations: 0, conflicts: 0 },
    },
  }),
}));

describe('SemanticDataPreview', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows sampled entities and opens their source provenance', () => {
    render(<SemanticDataPreview modelId='model' />);
    expect(screen.getByText('Sony Europe B.V.')).toBeInTheDocument();
    const source = screen.getByRole('button', { name: /customers\.csv/ });
    expect(source).toBeInTheDocument();
    fireEvent.click(source);
    expect(openFile).toHaveBeenCalledWith('workspace', 'document', '/customers.csv', 'customers.csv', 'text/csv', expect.any(Object));
    expect(screen.getByText('FR')).toBeInTheDocument();
    expect(screen.getByText(/CRM Production/)).toBeInTheDocument();
  });
});
