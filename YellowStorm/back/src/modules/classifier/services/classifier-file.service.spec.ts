import { ClassifierFileService } from './classifier-file.service';

function makeDoc() {
  return {
    _id: { toString: () => 'd1' },
    workspaceId: { toString: () => 'w1' },
    originalName: 'a',
    mimeType: 'application/pdf',
    size: 0,
    type: 'url',
    sourceUrl: 'https://a.com/x',
    indexingStatus: 'none',
    status: 'processing',
    metadata: { sourceRootUrl: 'https://a.com/services', normalizedSourceRootUrl: 'https://a.com/services' },
  };
}

function makeService(doc: unknown) {
  const documentModel = {
    find: jest.fn(() => ({ sort: () => ({ lean: () => ({ exec: async () => [doc] }) }) })),
    db: { name: 'test', host: 'test' },
  } as any;
  const folderModel = {} as any;
  const assignmentModel = {
    find: jest.fn(() => ({ lean: () => ({ exec: async () => [] }) })),
  } as any;
  const access = { assertWorkspaceAccess: jest.fn().mockResolvedValue(undefined) } as any;
  const logger = { setContext: jest.fn(), log: jest.fn(), debug: jest.fn(), error: jest.fn(), warn: jest.fn() } as any;
  return new ClassifierFileService(documentModel, folderModel, assignmentModel, access, logger);
}

describe('ClassifierFileService.listFiles sourceRootUrl', () => {
  // NOTE: the real listFiles() does `new Types.ObjectId(workspaceId)`, which requires a
  // valid 24-char hex string; the doc's own workspaceId (from makeDoc()) is never run through
  // Types.ObjectId, so it can stay a plain mock string.
  const WORKSPACE_OBJECT_ID = '507f1f77bcf86cd799439011';

  it('surfaces sourceRootUrl and normalizedSourceRootUrl from metadata', async () => {
    const service = makeService(makeDoc());
    const res = await service.listFiles('u1', WORKSPACE_OBJECT_ID, {} as any);
    expect(res[0].sourceRootUrl).toBe('https://a.com/services');
    expect(res[0].normalizedSourceRootUrl).toBe('https://a.com/services');
  });

  it('leaves the fields undefined when metadata has no root url', async () => {
    const doc = makeDoc();
    doc.metadata = {} as any;
    const service = makeService(doc);
    const res = await service.listFiles('u1', WORKSPACE_OBJECT_ID, {} as any);
    expect(res[0].sourceRootUrl).toBeUndefined();
    expect(res[0].normalizedSourceRootUrl).toBeUndefined();
  });
});
