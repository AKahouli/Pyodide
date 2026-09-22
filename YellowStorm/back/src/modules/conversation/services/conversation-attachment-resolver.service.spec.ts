import { ForbiddenException } from '../../exceptions';
import { ConversationAttachmentResolverService } from './conversation-attachment-resolver.service';

const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

function doc(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    workspaceId: 'system-1',
    status: 'completed',
    isFolder: false,
    originalName: `${id}.pdf`,
    mimeType: 'application/pdf',
    ...overrides,
  };
}

describe('ConversationAttachmentResolverService', () => {
  let findByIdsInWorkspace: jest.Mock;
  let service: ConversationAttachmentResolverService;

  beforeEach(() => {
    jest.clearAllMocks();
    findByIdsInWorkspace = jest.fn().mockResolvedValue([]);
    service = new ConversationAttachmentResolverService(
      { findByIdsInWorkspace } as never,
      logger as never,
    );
  });

  it('resolves and deduplicates document IDs in input order', async () => {
    findByIdsInWorkspace.mockResolvedValue([doc('a'), doc('b')]);

    const resolved = await service.resolve('system-1', ['a', 'a', 'b']);

    expect(findByIdsInWorkspace).toHaveBeenCalledWith('system-1', ['a', 'b']);
    expect(resolved.map((d: { id: string }) => d.id)).toEqual(['a', 'b']);
  });

  it('fails closed when an ID is outside the workspace (cross-workspace attack)', async () => {
    findByIdsInWorkspace.mockResolvedValue([doc('a')]); // 'b' belongs to another workspace

    await expect(service.resolve('system-1', ['a', 'b'])).rejects.toBeInstanceOf(ForbiddenException);
    expect(findByIdsInWorkspace).toHaveBeenCalledWith('system-1', ['a', 'b']);
  });

  it('skips documents that are not COMPLETED but keeps ownership failures fatal', async () => {
    findByIdsInWorkspace.mockResolvedValue([doc('a', { status: 'processing' }), doc('b')]);

    const resolved = await service.resolve('system-1', ['a', 'b']);

    expect(resolved.map((d: { id: string }) => d.id)).toEqual(['b']);
  });

  it('returns empty for an empty ID list without querying', async () => {
    const resolved = await service.resolve('system-1', []);

    expect(resolved).toEqual([]);
    expect(findByIdsInWorkspace).not.toHaveBeenCalled();
  });
});
