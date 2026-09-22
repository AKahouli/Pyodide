import { PlaybookFlowArtifactService } from './playbook-flow-artifact.service';
import { Readable } from 'stream';

function queryResult(value: unknown) {
  return { select: jest.fn().mockReturnThis(), lean: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue(value) };
}

describe('PlaybookFlowArtifactService', () => {
  const executionModel = { findById: jest.fn(), findOne: jest.fn(), find: jest.fn(), collection: { name: 'flowexecutions' } };
  const taskResultModel = { find: jest.fn(), aggregate: jest.fn(), collection: { name: 'flowtaskresults' } };
  const accessService = { assertExecutionAccess: jest.fn(), findAccessibleFlow: jest.fn() };
  const documentService = {
    isAvailable: jest.fn(() => true),
    exists: jest.fn(),
    openReadStream: jest.fn(),
    upload: jest.fn(),
  };
  const jwtService = { signAsync: jest.fn(), verifyAsync: jest.fn() };
  const configService = { get: jest.fn((key: string) => ({ 'jwt.secret': 'secret', 'jwt.issuer': 'issuer' })[key]) };
  const flowModel = { aggregate: jest.fn() };
  const playbookShareService = { getSharedPlaybookIdsForUser: jest.fn() };
  const service = new PlaybookFlowArtifactService(
    executionModel as any,
    taskResultModel as any,
    accessService as any,
    documentService as any,
    jwtService as any,
    configService as any,
    flowModel as any,
    playbookShareService as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    executionModel.findById.mockReturnValue(queryResult({ ownerId: 'owner-1', flowId: 'flow-1' }));
    executionModel.findOne.mockReturnValue(queryResult({ _id: 'execution-1' }));
    executionModel.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    });
    taskResultModel.find.mockReturnValue(queryResult([{
      taskId: 'task-1', iteration: 0, components: [{ type: 'artifact', data: { filename: 'report.pdf', file_path: 'owner-1/system_execution-1/report.pdf' } }],
    }]));
    documentService.exists.mockResolvedValue(true);
    documentService.upload.mockImplementation((_buffer, originalName, mimeType, options) => Promise.resolve({
      originalName,
      blobPath: `${options.folder}/${options.customFileName}`,
      mimeType,
      size: 3,
    }));
    jwtService.signAsync.mockResolvedValue('capability-token');
    flowModel.aggregate.mockResolvedValue([]);
    playbookShareService.getSharedPlaybookIdsForUser.mockResolvedValue([]);
  });

  it('scopes lookup to the authorized execution and returns no storage details', async () => {
    const task = (await taskResultModel.find().exec())[0];
    const { trustedPlaybookArtifacts } = await import('../utils/playbook-artifact');
    const artifactId = trustedPlaybookArtifacts(task, 'owner-1', 'execution-1')[0].artifactId;

    const result = await service.issueAccess('execution-1', artifactId, 'owner-1', 'view');
    expect(result).toEqual({ token: 'capability-token', expiresAt: expect.any(String) });
    expect(documentService.exists).toHaveBeenCalledWith('owner-1/system_execution-1/report.pdf');
    expect(jwtService.signAsync).toHaveBeenCalledWith(
      { type: 'playbook-artifact', executionId: 'execution-1', artifactId, action: 'view' },
      expect.objectContaining({ audience: 'yellostorm-playbook-artifact', expiresIn: 600 }),
    );
    expect(JSON.stringify(result)).not.toContain('system_execution-1');
  });

  it('filters access before limiting artifact-bearing results', async () => {
    flowModel.aggregate.mockResolvedValue([{
      playbookId: 'flow-1', playbookName: 'Weekly review', execution: { _id: 'execution-1', ownerId: 'owner-1' },
      taskResult: { executionId: 'execution-1', taskId: 'task-1', iteration: 0, generatedAt: new Date('2026-09-13T10:01:00Z'), components: [{ type: 'artifact', data: { artifactId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', filename: 'review.pdf', mimeType: 'application/pdf' } }] },
    }]);

    await expect(service.listRecent('user-1', 6)).resolves.toEqual([expect.objectContaining({
      artifactId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', playbookId: 'flow-1', playbookName: 'Weekly review', executionId: 'execution-1',
    })]);
    expect(flowModel.aggregate).toHaveBeenCalledWith(expect.arrayContaining([
      { $match: { ownerId: 'user-1' } },
      { $limit: 6 },
    ]));
    expect(JSON.stringify(flowModel.aggregate.mock.calls[0][0])).toContain('components.type');
  });

  it('publishes into execution-scoped storage and verifies the object', async () => {
    const result = await service.publishArtifact('execution-1', 'owner-1', {
      buffer: Buffer.from('pdf'),
      originalname: 'report.pdf',
      mimetype: 'application/pdf',
    });

    expect(executionModel.findOne).toHaveBeenCalledWith({
      _id: 'execution-1',
      ownerId: 'owner-1',
      status: 'running',
    });
    expect(documentService.upload).toHaveBeenCalledWith(
      Buffer.from('pdf'),
      'report.pdf',
      'application/pdf',
      expect.objectContaining({
        folder: 'owner-1/system_execution-1/artifacts',
        generateUniqueName: false,
        customFileName: expect.stringMatching(/^[a-f0-9]{32}$/),
      }),
    );
    expect(documentService.exists).toHaveBeenCalledWith(expect.stringMatching(
      /^owner-1\/system_execution-1\/artifacts\/[a-f0-9]{32}$/,
    ));
    expect(result).toEqual(expect.objectContaining({
      artifactId: expect.stringMatching(/^[a-f0-9]{32}$/),
      filename: 'report.pdf',
      mimeType: 'application/pdf',
      size: 3,
    }));
  });

  it('rejects publication outside an owned running execution', async () => {
    executionModel.findOne.mockReturnValue(queryResult(null));

    await expect(service.publishArtifact('execution-1', 'other-owner', {
      buffer: Buffer.from('pdf'),
      originalname: 'report.pdf',
      mimetype: 'application/pdf',
    })).rejects.toThrow('Running execution not found');
    expect(documentService.upload).not.toHaveBeenCalled();
  });

  it('rejects artifacts above the fixed 10 MB boundary before storage access', async () => {
    await expect(service.publishArtifact('execution-1', 'owner-1', {
      buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
      originalname: 'report.pdf',
      mimetype: 'application/pdf',
    })).rejects.toThrow('Artifact exceeds the 10 MB publication limit');
    expect(executionModel.findOne).not.toHaveBeenCalled();
    expect(documentService.upload).not.toHaveBeenCalled();
  });

  it('does not return a receipt when storage verification fails', async () => {
    documentService.exists.mockResolvedValue(false);

    await expect(service.publishArtifact('execution-1', 'owner-1', {
      buffer: Buffer.from('pdf'),
      originalname: 'report.pdf',
      mimetype: 'application/pdf',
    })).rejects.toThrow('Artifact storage verification failed');
  });

  it('applies shared-flow read access for a non-owner', async () => {
    const task = (await taskResultModel.find().exec())[0];
    const { trustedPlaybookArtifacts } = await import('../utils/playbook-artifact');
    const artifactId = trustedPlaybookArtifacts(task, 'owner-1', 'execution-1')[0].artifactId;

    await service.issueAccess('execution-1', artifactId, 'shared-user', 'download');
    expect(accessService.assertExecutionAccess).toHaveBeenCalledWith('flow-1', 'shared-user', 'read');
  });

  it('resolves duplicate filenames to their distinct storage objects', async () => {
    const task = {
      taskId: 'task-1',
      iteration: 0,
      components: [
        { type: 'artifact', data: { filename: 'report.pdf', file_path: 'owner-1/system_execution-1/report.pdf' } },
        { type: 'artifact', data: { filename: 'report.pdf', file_path: 'owner-1/system_execution-1/revised/report.pdf' } },
      ],
    };
    taskResultModel.find.mockReturnValue(queryResult([task]));
    const { trustedPlaybookArtifacts } = await import('../utils/playbook-artifact');
    const secondArtifactId = trustedPlaybookArtifacts(task, 'owner-1', 'execution-1')[1].artifactId;

    await service.issueAccess('execution-1', secondArtifactId, 'owner-1', 'view');

    expect(documentService.exists).toHaveBeenCalledWith('owner-1/system_execution-1/revised/report.pdf');
  });

  it('verifies a scoped capability and opens the matching storage stream', async () => {
    const task = (await taskResultModel.find().exec())[0];
    const { trustedPlaybookArtifacts } = await import('../utils/playbook-artifact');
    const artifactId = trustedPlaybookArtifacts(task, 'owner-1', 'execution-1')[0].artifactId;
    jwtService.verifyAsync.mockResolvedValue({
      type: 'playbook-artifact', executionId: 'execution-1', artifactId, action: 'download',
    });
    documentService.openReadStream.mockResolvedValue({ body: Readable.from(['pdf']) });

    await expect(service.openContent('token', 'bytes=0-9')).resolves.toEqual(expect.objectContaining({
      action: 'download', filename: 'report.pdf',
    }));
    expect(documentService.openReadStream).toHaveBeenCalledWith('owner-1/system_execution-1/report.pdf', 'bytes=0-9');
  });

  it('projects actions only for storage-backed artifacts', async () => {
    const task = (await taskResultModel.find().exec())[0];

    const projected = await service.projectPublicTaskResult(task, 'owner-1', 'execution-1');

    expect((projected.components as Array<Record<string, any>>)[0].data).toEqual(expect.objectContaining({
      artifactId: expect.stringMatching(/^[a-f0-9]{32}$/),
      availability: 'ready',
    }));
  });

  it('withholds actions when the storage object is missing', async () => {
    const task = (await taskResultModel.find().exec())[0];
    documentService.exists.mockResolvedValue(false);

    const projected = await service.projectPublicTaskResult(task, 'owner-1', 'execution-1');

    expect((projected.components as Array<Record<string, any>>)[0].data).not.toHaveProperty('artifactId');
    expect((projected.components as Array<Record<string, any>>)[0].data).not.toHaveProperty('availability');
  });

  it('fails closed when storage verification errors', async () => {
    const task = (await taskResultModel.find().exec())[0];
    documentService.exists.mockRejectedValue(new Error('storage unavailable'));

    const projected = await service.projectPublicTaskResult(task, 'owner-1', 'execution-1');

    expect((projected.components as Array<Record<string, any>>)[0].data).not.toHaveProperty('artifactId');
  });

  it('rejects malformed artifact capabilities', async () => {
    jwtService.verifyAsync.mockResolvedValue({ type: 'access', executionId: 'execution-1' });
    await expect(service.openContent('access-token')).rejects.toThrow('Invalid or expired artifact access');
  });
});
