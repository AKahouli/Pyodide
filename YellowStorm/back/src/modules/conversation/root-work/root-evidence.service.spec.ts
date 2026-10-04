import { RootEvidenceService } from './root-evidence.service';

describe('Root evidence current access', () => {
  const execution = { resultPayload: { producerAgentId: 'worker', citationRefs: ['evidence'], artifactRefs: [] } };
  function setup(payload: Record<string, unknown>, kind = 'citation') {
    const results = { authorizeResult: jest.fn().mockResolvedValue(execution) };
    const work = { listEvidenceForExecution: jest.fn().mockResolvedValue([{ id: 'evidence', executionId: 'child', conversationId: 'conversation',
      producerAgentId: 'worker', kind, payload }]) };
    const conversations = { filterAccessibleWorkspaceIds: jest.fn().mockResolvedValue(['workspace']) };
    const documents = { findById: jest.fn().mockResolvedValue({ path: 'owner/workspace/report.pdf', originalName: 'report.pdf' }),
      findByMultipleWorkspaces: jest.fn() };
    const storage = { generateSasUrl: jest.fn().mockResolvedValue('https://storage.test/read') };
    return { results, work, conversations, documents, storage,
      service: new RootEvidenceService(results as never, work as never, conversations as never, documents as never, storage as never) };
  }
  it('resolves only registered document evidence under current source access', async () => {
    const h = setup({ document_id: 'document', workspace_id: 'workspace', file_path: 'owner/workspace/report.pdf' }, 'artifact');
    expect(await h.service.resolve('conversation', 'child', 'evidence', 'owner')).toEqual({ evidenceId: 'evidence',
      kind: 'artifact', producerAgentId: 'worker', url: 'https://storage.test/read', fileName: 'report.pdf' });
    expect(h.results.authorizeResult).toHaveBeenCalledTimes(2);
    expect(h.conversations.filterAccessibleWorkspaceIds).toHaveBeenCalledTimes(2);
  });
  it('denies revoked source access before storage and after asynchronous resolution', async () => {
    const h = setup({ document_id: 'document', workspace_id: 'workspace' });
    h.conversations.filterAccessibleWorkspaceIds.mockResolvedValue([]);
    await expect(h.service.resolve('conversation', 'child', 'evidence', 'owner')).rejects.toThrow('access');
    expect(h.storage.generateSasUrl).not.toHaveBeenCalled();
    h.conversations.filterAccessibleWorkspaceIds.mockResolvedValueOnce(['workspace']).mockResolvedValueOnce([]);
    await expect(h.service.resolve('conversation', 'child', 'evidence', 'owner')).rejects.toThrow('access');
  });
  it('denies forged producer, execution references and mismatched document paths', async () => {
    const h = setup({ document_id: 'document', workspace_id: 'workspace', file_path: 'other/private' });
    await expect(h.service.resolve('conversation', 'child', 'evidence', 'owner')).rejects.toThrow('unavailable');
    expect(h.storage.generateSasUrl).not.toHaveBeenCalled();
    await expect(h.service.resolve('conversation', 'child', 'forged', 'owner')).rejects.toThrow('unavailable');
    h.work.listEvidenceForExecution.mockResolvedValue([{ id: 'evidence', executionId: 'child', conversationId: 'conversation', producerAgentId: 'other', kind: 'citation', payload: {} }]);
    await expect(h.service.resolve('conversation', 'child', 'evidence', 'owner')).rejects.toThrow('unavailable');
  });
  it.each(['owner/system_other/report.txt', 'owner/system_child/../secret', 'other/system_child/report.txt'])
    ('denies cross-child or unsafe run artifact path %s', async (path) => {
      const h = setup({ file_path: path }, 'artifact');
      await expect(h.service.resolve('conversation', 'child', 'evidence', 'owner')).rejects.toThrow('path');
      expect(h.storage.generateSasUrl).not.toHaveBeenCalled();
    });
  it('resolves the exact child run artifact prefix', async () => {
    const h = setup({ file_path: 'owner/system_child/report.txt', filename: 'report.txt' }, 'artifact');
    expect((await h.service.resolve('conversation', 'child', 'evidence', 'owner')).url).toBe('https://storage.test/read');
  });
  it('returns only safe public web source URLs', async () => {
    const h = setup({ source_object: { content: { source: 'https://source.test/page?token=private#fragment' } } });
    expect((await h.service.resolve('conversation', 'child', 'evidence', 'owner')).url).toBe('https://source.test/page');
    for (const source of ['javascript:alert(1)', 'https://user:password@source.test/']) {
      await expect(setup({ source }).service.resolve('conversation', 'child', 'evidence', 'owner')).rejects.toThrow('location');
    }
  });
});
