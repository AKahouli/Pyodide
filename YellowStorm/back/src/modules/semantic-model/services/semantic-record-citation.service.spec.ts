import { SemanticRecordCitationService } from './semantic-record-citation.service';

describe('SemanticRecordCitationService', () => {
  const cited = {
    dataRevisionId: 'rev-2', changed: true, status: 'ok',
    record: {
      entityId: 'e1', conceptLabel: 'Message', conceptKey: 'mail', label: 'Hello',
      keyFields: { id: 'k1' }, values: { body: 'Hi', subject: 'Hello' }, truncatedFields: ['body'],
      provenance: [{ assetId: 'doc-ok', rowNumbers: [4] }, { assetId: 'doc-other' }],
      origins: { subject: { kind: 'source', assetId: 'doc-ok', rowNumber: '4', column: 'B' } },
    },
  };
  const graph = { nodes: [{ key: 'mail', attributes: [{ key: 'subject', label: 'Subject' }, { key: 'body', label: 'Body' }] }] };
  const graphSearch = { citedRecord: jest.fn() };
  const documents = { findByIds: jest.fn() };
  const service = new SemanticRecordCitationService(graphSearch as never, documents as never);

  beforeEach(() => {
    jest.clearAllMocks();
    graphSearch.citedRecord.mockResolvedValue({ model: { id: 'm1', name: 'Mails' }, cited, allowedWorkspaceIds: ['w1'], graph });
    documents.findByIds.mockResolvedValue([
      { id: 'doc-ok', workspaceId: 'w1', originalName: 'a.xlsx', path: 'p/a.xlsx', mimeType: 'x', isFolder: false },
      { id: 'doc-other', workspaceId: 'w-hidden', originalName: 'b.pdf', path: 'p/b.pdf', mimeType: 'y', isFolder: false },
    ]);
  });

  it('orders fields by the model, links origins to openable documents and counts the others', async () => {
    const view = await service.citedRecord('u1', 'm1', { entityId: 'e1', data: 'draft' });
    expect(graphSearch.citedRecord).toHaveBeenCalledWith('u1', 'm1', expect.objectContaining({ environment: 'draft', entityId: 'e1' }));
    expect(view).toMatchObject({ changed: true, status: 'ok', data: 'draft' });
    expect(view.record!.fields.map((field) => field.label)).toEqual(['id', 'Subject', 'Body']);
    expect(view.record!.fields[1].origin).toEqual({ kind: 'source', documentId: 'doc-ok', row: 4, column: 'B' });
    expect(view.record!.fields[2].truncated).toBe(true);
    expect(view.record!.sources).toEqual([expect.objectContaining({ documentId: 'doc-ok', rows: [4] })]);
    expect(view.record!.unavailableSources).toBe(1);
  });

  it('returns no record when it is hidden', async () => {
    graphSearch.citedRecord.mockResolvedValue({ model: { id: 'm1', name: 'Mails' }, cited: { dataRevisionId: 'r', changed: false, status: 'hidden' }, allowedWorkspaceIds: [], graph });
    const view = await service.citedRecord('u1', 'm1', { entityId: 'e1' });
    expect(view.record).toBeUndefined();
    expect(documents.findByIds).not.toHaveBeenCalled();
  });
});
