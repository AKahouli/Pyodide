import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SemanticDataPreview } from './SemanticDataPreview';

const openFile = vi.fn();
const refetch = vi.fn();
const sourceIssues: Array<Record<string, unknown>> = [];
const gaps = {
  missingValues: [{ conceptId: 'organization', conceptLabel: 'Organization', attribute: 'country', attributeLabel: 'Country', missing: 1, total: 2 }],
  unresolvedLinks: [{ relationId: 'partner', relationLabel: 'works with', kind: 'unresolved_reference', count: 3 }],
  other: [],
};

vi.mock('@/modules/file-viewer/store', () => ({ useFileViewerStore: { getState: () => ({ openFile }) } }));
const recordCorrection = vi.fn();
const undoCorrection = vi.fn();
const corrections: Array<Record<string, unknown>> = [];
vi.mock('../../hooks/use-record-corrections', () => ({
  useRecordCorrections: () => ({
    corrections: { data: { corrections } },
    record: { mutate: recordCorrection, isPending: false },
    undo: { mutate: undoCorrection, isPending: false },
  }),
}));
vi.mock('../../query/hooks', () => ({
  useSemanticGraph: () => ({ data: { relations: [{ id: 'partner', key: 'works_with', label: 'works with', inverseLabel: 'works with', sourceNodeTypeId: 'organization', targetNodeTypeId: 'organization' }] } }),
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
          provenance: { id: { mappingId: 'mapping', source: { kind: 'csv', workspaceId: 'workspace', documentId: 'document', documentName: 'customers.csv', documentPath: '/customers.csv', mimeType: 'text/csv', sheetName: 'CSV' }, rowNumber: 2 },
            country: { mappingId: '', source: { kind: 'manual', documentName: '' }, correction: { sequence: 7, correctedBy: 'Ada', correctedByYou: false, originalValue: 'FR' } } },
        }, { id: 'organization:c002', conceptId: 'organization', entityKey: 'c002', label: 'Contoso', values: { id: 'C002' }, provenance: { id: { mappingId: '', source: { kind: 'manual', documentName: '' } } }, conflicts: [] }],
      }],
      relations: [{ relationId: 'partner', relationLabel: 'works with', sourceEntityId: 'organization:c001', targetEntityIds: ['organization:c002'], status: 'resolved', sourceAttribute: 'id', sourceValue: 'C001', targetAttribute: 'id', targetValues: ['C002'] }], sourceIssues, gaps,
      summary: { entities: 2, resolvedRelations: 1, unresolvedRelations: 0, ambiguousRelations: 0, conflicts: 0 },
    },
  }),
}));

describe('SemanticDataPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sourceIssues.length = 0;
    corrections.length = 0;
  });

  it('fixes a wrong value and keeps who corrected it with the original value', () => {
    render(<SemanticDataPreview modelId='model' />);
    expect(screen.getByText(/corrections.correctedBy/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'corrections.fixValueOf' })[0]);
    const input = screen.getByRole('textbox', { name: 'corrections.newValueOf' });
    fireEvent.change(input, { target: { value: 'C-001' } });
    fireEvent.click(screen.getByRole('button', { name: /corrections.save/ }));
    expect(recordCorrection).toHaveBeenCalledWith(
      { action: 'edit_entity', targetIdentity: { entityId: 'organization:c001' }, payload: { attribute: 'id', value: 'C-001' } },
      expect.any(Object),
    );
    fireEvent.click(screen.getAllByRole('button', { name: /corrections.undo/ })[0]);
    expect(undoCorrection).toHaveBeenCalledWith(7, expect.any(Object));
  });

  it('hides a record or a link and adds a missing link', () => {
    render(<SemanticDataPreview modelId='model' />);
    fireEvent.click(screen.getByRole('button', { name: /corrections.hideLink/ }));
    expect(recordCorrection).toHaveBeenLastCalledWith(
      { action: 'remove_relationship', targetIdentity: { relationId: 'partner', sourceEntityId: 'organization:c001', targetEntityId: 'organization:c002' } },
      expect.any(Object),
    );
    fireEvent.click(screen.getByRole('button', { name: /corrections.hideRecord/ }));
    fireEvent.click(screen.getAllByRole('button', { name: /corrections.hideRecord/ })[0]);
    expect(recordCorrection).toHaveBeenLastCalledWith({ action: 'remove_entity', targetIdentity: { entityId: 'organization:c001' } }, expect.any(Object));
    fireEvent.click(screen.getByRole('button', { name: /corrections.addLink/ }));
    fireEvent.change(screen.getByRole('combobox', { name: 'corrections.chooseRelationship' }), { target: { value: 'partner|out' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'corrections.chooseRecord' }), { target: { value: 'organization:c002' } });
    fireEvent.click(screen.getByRole('button', { name: 'corrections.link' }));
    expect(recordCorrection).toHaveBeenLastCalledWith(
      { action: 'add_relationship', targetIdentity: { relationId: 'partner', sourceEntityId: 'organization:c001', targetEntityId: 'organization:c002' } },
      expect.any(Object),
    );
  });

  it('lists fixes in force and lets people undo them', () => {
    corrections.push({ sequence: 3, action: 'remove_entity', targetIdentity: { entityId: 'organization:c002' }, payload: {}, reason: '', createdAt: null, correctedBy: '', correctedByYou: true });
    render(<SemanticDataPreview modelId='model' />);
    expect(screen.getByText('corrections.describeHideRecord')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /corrections.undo/ })[0]);
    expect(undoCorrection).toHaveBeenCalledWith(3, expect.any(Object));
  });

  it('offers no fixes to people who can only read', () => {
    render(<SemanticDataPreview modelId='model' canEdit={false} />);
    expect(screen.queryByRole('button', { name: /corrections.hideRecord/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'corrections.fixValueOf' })).not.toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: /^Contoso/ }));
    expect(screen.getByRole('heading', { name: 'Contoso' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /customers\.csv/ })).not.toBeInTheDocument();
    expect(screen.getByText(/works with/)).toBeInTheDocument();
  });

  it('says which values were typed by hand', () => {
    render(<SemanticDataPreview modelId='model' />);
    fireEvent.click(screen.getByRole('button', { name: /^Contoso/ }));
    expect(screen.getByText('dataPreview.typedByHand')).toBeInTheDocument();
  });

  it('lists what is missing with a way to fix it', () => {
    const onOpenItem = vi.fn();
    render(<SemanticDataPreview modelId='model' onOpenItem={onOpenItem} />);
    expect(screen.getByText('dataPreview.gapsTitle')).toBeInTheDocument();
    expect(screen.getByText('dataPreview.gapMissingValue')).toBeInTheDocument();
    expect(screen.getByText('dataPreview.gapUnresolvedLink')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'dataPreview.gapFixRelationship' }));
    expect(onOpenItem).toHaveBeenCalledWith('partner');
    fireEvent.click(screen.getByRole('button', { name: 'dataPreview.gapFixConcept' }));
    expect(onOpenItem).toHaveBeenCalledWith('organization');
  });
});
