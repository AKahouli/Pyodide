import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SemanticDataPreview } from './SemanticDataPreview';

const openFile = vi.fn();
const refetch = vi.fn();
const sourceIssues: Array<Record<string, unknown>> = [];

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
        }, { id: 'organization:c002', conceptId: 'organization', entityKey: 'c002', label: 'Contoso', values: { id: 'C002' }, provenance: {}, conflicts: [] }],
      }],
      relations: [{ relationId: 'partner', relationLabel: 'works with', sourceEntityId: 'organization:c001', targetEntityIds: ['organization:c002'], status: 'resolved', sourceAttribute: 'id', sourceValue: 'C001', targetAttribute: 'id', targetValues: ['C002'] }], sourceIssues,
      summary: { entities: 2, resolvedRelations: 1, unresolvedRelations: 0, ambiguousRelations: 0, conflicts: 0 },
    },
  }),
}));

describe('SemanticDataPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sourceIssues.length = 0;
  });

  it('names the source that failed and keeps the technical cause on demand', () => {
    sourceIssues.push({
      mappingId: 'mapping-1', conceptId: 'amendment', documentName: 'amendment-01.pdf', code: 'source_failed',
      message: 'amendment-01.pdf could not be read: extraction agent is not configured',
      detail: 'ServiceUnavailableException: extraction agent is not configured',
    });
    render(<SemanticDataPreview modelId='model' />);
    expect(screen.getByText(/amendment-01\.pdf could not be read/)).toBeInTheDocument();
    expect(screen.getByText(/ServiceUnavailableException/)).toBeInTheDocument();
  });

  it('groups sources that failed for the same cause into one line', () => {
    for (const name of ['amendment-01.pdf', 'amendment-02.pdf', 'master-agreement-0041.pdf']) {
      sourceIssues.push({
        mappingId: `mapping-${name}`, documentName: name, code: 'source_failed',
        reason: 'extraction agent is not configured',
        message: `${name} could not be read: extraction agent is not configured`,
        detail: 'ServiceUnavailableException: extraction agent is not configured',
      });
    }
    render(<SemanticDataPreview modelId='model' />);
    // The test harness stubs translation to return the key, so the grouped line shows as its key.
    expect(screen.getByText('dataPreview.sourceIssueGroup')).toBeInTheDocument();
    expect(screen.getByText('amendment-01.pdf, amendment-02.pdf, master-agreement-0041.pdf')).toBeInTheDocument();
    expect(screen.queryByText(/amendment-02\.pdf could not be read/)).not.toBeInTheDocument();
  });

  it('shows sampled entities and opens their source provenance', () => {
    render(<SemanticDataPreview modelId='model' />);
    expect(screen.getByRole('heading', { name: 'Sony Europe B.V.' })).toBeInTheDocument();
    const source = screen.getByRole('button', { name: /customers\.csv/ });
    expect(source).toBeInTheDocument();
    fireEvent.click(source);
    expect(openFile).toHaveBeenCalledWith('workspace', 'document', '/customers.csv', 'customers.csv', 'text/csv', expect.any(Object));
    expect(screen.getByText('FR')).toBeInTheDocument();
    expect(screen.getByText(/CRM Production/)).toBeInTheDocument();
  });

  it('keeps values and related records together when switching records', () => {
    render(<SemanticDataPreview modelId='model' />);
    expect(screen.getByText(/works with/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Contoso' }));
    expect(screen.getByRole('heading', { name: 'Contoso' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /customers\.csv/ })).not.toBeInTheDocument();
    expect(screen.getByText(/works with/)).toBeInTheDocument();
  });
});
