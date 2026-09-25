import { ClassifierFileService } from './classifier-file.service';
import { AssignmentSource, type ClassifierAssignmentRecord } from '../classifier.types';
import type { WorkspaceDocumentRecord } from '../../workspace/ports';

const WORKSPACE_ID = '507f1f77bcf86cd799439011';
const DOCUMENT_ID = '507f1f77bcf86cd799439012';
const FOLDER_ID = '507f1f77bcf86cd799439013';

function makeDoc(): WorkspaceDocumentRecord {
  return {
    id: DOCUMENT_ID,
    workspaceId: WORKSPACE_ID,
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

const assignment = (over: Partial<ClassifierAssignmentRecord> = {}): ClassifierAssignmentRecord => ({
  id: '507f1f77bcf86cd799439014',
  workspaceId: WORKSPACE_ID,
  documentId: DOCUMENT_ID,
  folderId: FOLDER_ID,
  assignmentSource: AssignmentSource.MANUAL,
  classificationRunId: null,
  assignedBy: 'u1',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

function makeService(doc: WorkspaceDocumentRecord, assignments: ClassifierAssignmentRecord[] = []) {
  const documentReadPort = {
    find: jest.fn().mockResolvedValue([doc]),
    findById: jest.fn().mockResolvedValue(doc),
  };
  const folders = { findById: jest.fn().mockResolvedValue({ id: FOLDER_ID, workspaceId: WORKSPACE_ID }) };
  const assignmentRepo = {
    listByWorkspace: jest.fn().mockResolvedValue(assignments),
    upsertManual: jest.fn().mockImplementation(async (input) => assignment({ folderId: input.folderId })),
    applyPlaybookResult: jest.fn().mockResolvedValue(true),
  };
  const access = { assertWorkspaceAccess: jest.fn().mockResolvedValue(undefined) } as any;
  const logger = { setContext: jest.fn(), log: jest.fn(), debug: jest.fn(), error: jest.fn(), warn: jest.fn() } as any;
  const service = new ClassifierFileService(documentReadPort as any, folders as any, assignmentRepo as any, access, logger);
  return { service, folders, assignmentRepo };
}

describe('ClassifierFileService.listFiles sourceRootUrl', () => {
  it('surfaces sourceRootUrl and normalizedSourceRootUrl from metadata', async () => {
    const { service } = makeService(makeDoc());
    const res = await service.listFiles('u1', WORKSPACE_ID, {} as any);
    expect(res[0].sourceRootUrl).toBe('https://a.com/services');
    expect(res[0].normalizedSourceRootUrl).toBe('https://a.com/services');
  });

  it('leaves the fields undefined when metadata has no root url', async () => {
    const doc = makeDoc();
    doc.metadata = {};
    const { service } = makeService(doc);
    const res = await service.listFiles('u1', WORKSPACE_ID, {} as any);
    expect(res[0].sourceRootUrl).toBeUndefined();
    expect(res[0].normalizedSourceRootUrl).toBeUndefined();
  });
});

describe('ClassifierFileService.listFiles folder view', () => {
  it('reports the folder and source of an assigned file, and null for a file without a row', async () => {
    const assigned = await makeService(makeDoc(), [assignment({ assignmentSource: AssignmentSource.PLAYBOOK })]).service.listFiles('u1', WORKSPACE_ID, {} as any);
    expect(assigned[0].folderId).toBe(FOLDER_ID);
    expect(assigned[0].assignmentSource).toBe('playbook');

    const loose = await makeService(makeDoc()).service.listFiles('u1', WORKSPACE_ID, {} as any);
    expect(loose[0].folderId).toBeNull();
    expect(loose[0].assignmentSource).toBeNull();
  });

  it('filters on the unclassified flag and on a folder id', async () => {
    const withFolder = makeService(makeDoc(), [assignment()]).service;
    expect(await withFolder.listFiles('u1', WORKSPACE_ID, { unclassified: 'true' } as any)).toHaveLength(0);
    expect(await withFolder.listFiles('u1', WORKSPACE_ID, { folderId: FOLDER_ID } as any)).toHaveLength(1);
    expect(await withFolder.listFiles('u1', WORKSPACE_ID, { folderId: '507f1f77bcf86cd799439099' } as any)).toHaveLength(0);

    const unassigned = makeService(makeDoc(), [assignment({ folderId: null })]).service;
    expect(await unassigned.listFiles('u1', WORKSPACE_ID, { unclassified: 'true' } as any)).toHaveLength(1);
  });
});

describe('ClassifierFileService.applyClassificationResults', () => {
  it('counts the rows that changed and ignores entries whose ids are not object ids', async () => {
    const { service, assignmentRepo } = makeService(makeDoc());
    assignmentRepo.applyPlaybookResult.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const updated = await service.applyClassificationResults({
      workspaceId: WORKSPACE_ID,
      runId: '507f1f77bcf86cd799439015',
      triggeredBy: 'u1',
      overwrite: false,
      mapping: [
        { documentId: DOCUMENT_ID, folderId: FOLDER_ID },
        { documentId: '507f1f77bcf86cd799439016', folderId: FOLDER_ID },
        { documentId: 'nope', folderId: FOLDER_ID },
      ],
    });

    expect(updated).toBe(1);
    expect(assignmentRepo.applyPlaybookResult).toHaveBeenCalledTimes(2);
    expect(assignmentRepo.applyPlaybookResult).toHaveBeenCalledWith(expect.objectContaining({ overwrite: false, assignedBy: 'u1' }));
  });
});
