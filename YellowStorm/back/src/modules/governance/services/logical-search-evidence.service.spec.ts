import { LogicalSearchEvidenceService } from './logical-search-evidence.service';

describe('LogicalSearchEvidenceService', () => {
  it('keeps only exact-file results and preserves page/block locators', async () => {
    const runtime = { callTool: jest.fn().mockResolvedValue({ value: { results: [{ file_name: 'policy.pdf', text: 'Valid until 2026-12-31', page: 4, block_id: 'b-7', score: 0.9 }, { file_name: 'other.pdf', text: 'Valid until 2025-01-01', page: 1 }] }, text: '' }) };
    const service = new LogicalSearchEvidenceService(runtime as never);
    const result = await service.search({ connectorId: 'connector-1', workspaceId: 'workspace-1', authorizationUserId: 'user-1', documentId: 'document-1', sourceVersionId: 'version-1', fileName: 'policy.pdf' });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ documentId: 'document-1', page: 4, blockId: 'b-7', origin: 'logical_search' });
    expect(runtime.callTool).toHaveBeenCalledWith(expect.objectContaining({ authorizationUserId: 'user-1', authoritativeHeaders: expect.objectContaining({ 'Workspace-Id': 'workspace-1' }) }));
  });
});
