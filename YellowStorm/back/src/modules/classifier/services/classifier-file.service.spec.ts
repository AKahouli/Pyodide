import { ClassifierFileService } from './classifier-file.service';
import type { WorkspaceDocumentRecord } from '../../workspace/ports';

function makeDoc(): WorkspaceDocumentRecord {
  return {
    id: '507f1f77bcf86cd799439012',
    workspaceId: '507f1f77bcf86cd799439011',
    originalName: 'a',
    mimeType: 'application/pdf',
    size: 0,
    type: 'url',
    sourceUrl: 'https://a.com/x',
    indexingStatus: 'none',
    status: 'processing',
    metadata: { sourceRootUrl: 'https://a.com/services', normalizedSourceRootUrl: 'https://a.com/services' },
    isFolder: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: 'u1',
  };
}

function makeService(doc: WorkspaceDocumentRecord) {
  const documentReadPort = {
    find: jest.fn().mockResolvedValue([doc]),
    findById: jest.fn().mockResolvedValue(doc),
  };
  const folderModel = {} as any;
  const assignmentModel = {
    find: jest.fn(() => ({ lean: () => ({ exec: async () => [] }) })),
  } as any;
  const access = { assertWorkspaceAccess: jest.fn().mockResolvedValue(undefined) } as any;
  const logger = { setContext: jest.fn(), log: jest.fn(), debug: jest.fn(), error: jest.fn(), warn: jest.fn() } as any;
  return new ClassifierFileService(documentReadPort as any, folderModel, assignmentModel, access, logger);
}

describe('ClassifierFileService.listFiles sourceRootUrl', () => {
  const WORKSPACE_OBJECT_ID = '507f1f77bcf86cd799439011';

  it('surfaces sourceRootUrl and normalizedSourceRootUrl from metadata', async () => {
    const service = makeService(makeDoc());
    const res = await service.listFiles('u1', WORKSPACE_OBJECT_ID, {} as any);
    expect(res[0].sourceRootUrl).toBe('https://a.com/services');
    expect(res[0].normalizedSourceRootUrl).toBe('https://a.com/services');
  });

  it('leaves the fields undefined when metadata has no root url', async () => {
    const doc = makeDoc();
    doc.metadata = {};
    const service = makeService(doc);
    const res = await service.listFiles('u1', WORKSPACE_OBJECT_ID, {} as any);
    expect(res[0].sourceRootUrl).toBeUndefined();
    expect(res[0].normalizedSourceRootUrl).toBeUndefined();
  });
});
