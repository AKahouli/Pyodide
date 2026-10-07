import { PlaybookFlowArtifactService } from './playbook-flow-artifact.service';
import { Readable } from 'stream';
import { trustedPlaybookArtifacts } from '../utils/playbook-artifact';

describe('PlaybookFlowArtifactService', () => {
  const executionRepository = { findById: jest.fn(), findOwned: jest.fn() };
  const taskResultRepository = { listForExecution: jest.fn(), listRecentArtifacts: jest.fn() };
  const accessService = { assertExecutionAccess: jest.fn(), findAccessibleFlow: jest.fn() };
  const documentService = {
    isAvailable: jest.fn(() => true),
    exists: jest.fn(),
    openReadStream: jest.fn(),
    upload: jest.fn(),
  };
  const jwtService = { signAsync: jest.fn(), verifyAsync: jest.fn() };
  const configService = { get: jest.fn((key: string) => ({ 'jwt.secret': 'secret', 'jwt.issuer': 'issuer' })[key]) };
  const playbookShareService = { getSharedPlaybookIdsForUser: jest.fn() };
  const service = new PlaybookFlowArtifactService(
    executionRepository as any,
    taskResultRepository as any,
    accessService as any,
    documentService as any,
    jwtService as any,
    configService as any,
    playbookShareService as any,
  );

  const task = {
    taskId: 'task-1', iteration: 0, components: [{ type: 'artifact', data: { filename: 'report.pdf', file_path: 'owner-1/system_execution-1/report.pdf' } }],
  };
  const artifactIdOf = (taskResult: Record<string, unknown>, index = 0): string =>
    trustedPlaybookArtifacts(taskResult, 'owner-1', 'execution-1')[index].artifactId;

  beforeEach(() => {
    jest.clearAllMocks();
    executionRepository.findById.mockResolvedValue({ id: 'execution-1', ownerId: 'owner-1', flowId: 'flow-1', status: 'completed' });
    executionRepository.findOwned.mockResolvedValue({ id: 'execution-1', ownerId: 'owner-1', flowId: 'flow-1', status: 'running' });
    taskResultRepository.listForExecution.mockResolvedValue([task]);
    documentService.exists.mockResolvedValue(true);
    documentService.upload.mockImplementation((_buffer, originalName, mimeType, options) => Promise.resolve({
      originalName,
      blobPath: `${options.folder}/${options.customFileName}`,
      mimeType,
      size: 3,
    }));
    jwtService.signAsync.mockResolvedValue('capability-token');
    taskResultRepository.listRecentArtifacts.mockResolvedValue([]);
    playbookShareService.getSharedPlaybookIdsForUser.mockResolvedValue([]);
  });

  it('scopes lookup to the authorized execution and returns no storage details', async () => {
    const artifactId = artifactIdOf(task);

    const result = await service.issueAccess('execution-1', artifactId, 'owner-1', 'view');
    expect(result).toEqual({ token: 'capability-token', expiresAt: expect.any(String) });
    expect(taskResultRepository.listForExecution).toHaveBeenCalledWith('execution-1', { light: true, with: ['components'] });
    expect(documentService.exists).toHaveBeenCalledWith('owner-1/system_execution-1/report.pdf');
    expect(jwtService.signAsync).toHaveBeenCalledWith(
      { type: 'playbook-artifact', executionId: 'execution-1', artifactId, action: 'view' },
      expect.objectContaining({ audience: 'yellostorm-playbook-artifact', expiresIn: 600 }),
    );
    expect(JSON.stringify(result)).not.toContain('system_execution-1');
  });

  it('reports an unknown execution before looking for its artifacts', async () => {
    executionRepository.findById.mockResolvedValue(null);

    await expect(service.issueAccess('execution-1', 'a'.repeat(32), 'owner-1', 'view')).rejects.toThrow('Execution not found');
    expect(taskResultRepository.listForExecution).not.toHaveBeenCalled();
  });

  it('lists the recent artifacts of the flows the user owns or is shared on, newest first', async () => {
    playbookShareService.getSharedPlaybookIdsForUser.mockResolvedValue(['flow-2']);
    taskResultRepository.listRecentArtifacts.mockResolvedValue([{
      flowId: 'flow-1', flowName: 'Weekly review', executionId: 'execution-1', executionOwnerId: 'owner-1', executionUpdatedAt: new Date('2026-09-13T10:05:00Z'),
      taskResult: { id: 'result-1', taskId: 'task-1', iteration: 0, endedAt: new Date('2026-09-13T10:01:00Z'), updatedAt: new Date('2026-09-13T10:02:00Z'), components: [
        { type: 'artifact', data: { artifactId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', filename: 'review.pdf', mimeType: 'application/pdf' } },
      ] },
      generatedAt: new Date('2026-09-13T10:01:00Z'),
    }]);

    await expect(service.listRecent('user-1', 6)).resolves.toEqual([{
      source: 'playbook',
      artifactId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      filename: 'review.pdf',
      artifactKind: 'document',
      mimeType: 'application/pdf',
      playbookId: 'flow-1',
      playbookName: 'Weekly review',
      executionId: 'execution-1',
      generatedAt: '2026-09-13T10:01:00.000Z',
    }]);
    expect(taskResultRepository.listRecentArtifacts).toHaveBeenCalledWith('user-1', ['flow-2'], 6);
  });

  it('caps the flattened artifacts at the requested limit', async () => {
    const components = ['a', 'b', 'c'].map((c) => ({ type: 'artifact', data: { artifactId: c.repeat(32), filename: `${c}.pdf` } }));
    taskResultRepository.listRecentArtifacts.mockResolvedValue([{
      flowId: 'flow-1', flowName: 'Weekly review', executionId: 'execution-1', executionOwnerId: 'owner-1', executionUpdatedAt: new Date(),
      taskResult: { id: 'result-1', taskId: 'task-1', iteration: 0, endedAt: null, updatedAt: new Date(), components }, generatedAt: new Date(),
    }]);

    await expect(service.listRecent('user-1', 2)).resolves.toHaveLength(2);
  });

  it('publishes into execution-scoped storage and verifies the object', async () => {
    const result = await service.publishArtifact('execution-1', 'owner-1', {
      buffer: Buffer.from('pdf'),
      originalname: 'report.pdf',
      mimetype: 'application/pdf',
    });

    expect(executionRepository.findOwned).toHaveBeenCalledWith('execution-1', 'owner-1');
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
    executionRepository.findOwned.mockResolvedValue(null);

    await expect(service.publishArtifact('execution-1', 'other-owner', {
      buffer: Buffer.from('pdf'),
      originalname: 'report.pdf',
      mimetype: 'application/pdf',
    })).rejects.toThrow('Running execution not found');
    expect(documentService.upload).not.toHaveBeenCalled();
  });

  it('rejects publication into an owned execution that is no longer running', async () => {
    executionRepository.findOwned.mockResolvedValue({ id: 'execution-1', ownerId: 'owner-1', flowId: 'flow-1', status: 'completed' });

    await expect(service.publishArtifact('execution-1', 'owner-1', {
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
    expect(executionRepository.findOwned).not.toHaveBeenCalled();
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
    await service.issueAccess('execution-1', artifactIdOf(task), 'shared-user', 'download');
    expect(accessService.assertExecutionAccess).toHaveBeenCalledWith('flow-1', 'shared-user', 'read');
  });

  it('resolves duplicate filenames to their distinct storage objects', async () => {
    const duplicates = {
      taskId: 'task-1',
      iteration: 0,
      components: [
        { type: 'artifact', data: { filename: 'report.pdf', file_path: 'owner-1/system_execution-1/report.pdf' } },
        { type: 'artifact', data: { filename: 'report.pdf', file_path: 'owner-1/system_execution-1/revised/report.pdf' } },
      ],
    };
    taskResultRepository.listForExecution.mockResolvedValue([duplicates]);

    await service.issueAccess('execution-1', artifactIdOf(duplicates, 1), 'owner-1', 'view');

    expect(documentService.exists).toHaveBeenCalledWith('owner-1/system_execution-1/revised/report.pdf');
  });

  it('verifies a scoped capability and opens the matching storage stream', async () => {
    const artifactId = artifactIdOf(task);
    jwtService.verifyAsync.mockResolvedValue({
      type: 'playbook-artifact', executionId: 'execution-1', artifactId, action: 'download',
    });
    documentService.openReadStream.mockResolvedValue({ body: Readable.from(['pdf']) });

    await expect(service.openContent('token', 'bytes=0-9')).resolves.toEqual(expect.objectContaining({
      action: 'download', filename: 'report.pdf',
    }));
    expect(executionRepository.findById).toHaveBeenCalledWith('execution-1');
    expect(documentService.openReadStream).toHaveBeenCalledWith('owner-1/system_execution-1/report.pdf', 'bytes=0-9');
  });

  it('projects actions only for storage-backed artifacts', async () => {
    const projected = await service.projectPublicTaskResult(task, 'owner-1', 'execution-1');

    expect((projected.components as Record<string, any>[])[0].data).toEqual(expect.objectContaining({
      artifactId: expect.stringMatching(/^[a-f0-9]{32}$/),
      availability: 'ready',
    }));
  });

  it('withholds actions when the storage object is missing', async () => {
    documentService.exists.mockResolvedValue(false);

    const projected = await service.projectPublicTaskResult(task, 'owner-1', 'execution-1');

    expect((projected.components as Record<string, any>[])[0].data).not.toHaveProperty('artifactId');
    expect((projected.components as Record<string, any>[])[0].data).not.toHaveProperty('availability');
  });

  it('fails closed when storage verification errors', async () => {
    documentService.exists.mockRejectedValue(new Error('storage unavailable'));

    const projected = await service.projectPublicTaskResult(task, 'owner-1', 'execution-1');

    expect((projected.components as Record<string, any>[])[0].data).not.toHaveProperty('artifactId');
  });

  it('rejects malformed artifact capabilities', async () => {
    jwtService.verifyAsync.mockResolvedValue({ type: 'access', executionId: 'execution-1' });
    await expect(service.openContent('access-token')).rejects.toThrow('Invalid or expired artifact access');
  });
});
