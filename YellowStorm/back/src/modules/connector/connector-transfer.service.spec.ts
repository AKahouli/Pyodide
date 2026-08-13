import { Types } from 'mongoose';
import { ConnectorTransferService } from './connector-transfer.service';

describe('ConnectorTransferService', () => {
  const userId = new Types.ObjectId().toString();
  const workspaceId = new Types.ObjectId().toString();
  const connectorId = new Types.ObjectId().toString();

  function build() {
    const connectorService = {
      findById: jest.fn().mockResolvedValue({
        id: connectorId,
        slug: 'sharepoint',
        createdBy: new Types.ObjectId(),
        authSourceType: 'connected_app',
        connectedAppKey: 'microsoft',
        runtimeAuthConfig: {},
      }),
    };
    const auth = {
      resolveRuntimeAuth: jest.fn().mockResolvedValue({
        headers: { Authorization: 'Bearer provider-token' },
        env: {},
      }),
    };
    const workspaceDocService = {
      findAllByWorkspace: jest.fn().mockResolvedValue({ documents: [] }),
      uploadSmallFile: jest.fn().mockResolvedValue({
        id: 'document-1',
        originalName: 'report.pdf',
        mimeType: 'application/pdf',
        size: 4,
      }),
    };
    const workspaceShareService = {
      assertUserHasWriteAccess: jest.fn().mockResolvedValue(undefined),
    };
    const adapter = {
      provider: 'm365',
      resolveImportCandidates: jest.fn().mockResolvedValue([
        {
          itemRef: { driveId: 'drive-1', itemId: 'item-1' },
          filename: 'report.pdf',
          mimeType: 'application/pdf',
          sourcePath: '/report.pdf',
        },
      ]),
      downloadItem: jest.fn().mockResolvedValue({
        buffer: Buffer.from('file'),
        filename: 'report.pdf',
        mimeType: 'application/pdf',
      }),
    };
    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
    };
    const service = new ConnectorTransferService(
      connectorService as never,
      auth as never,
      workspaceDocService as never,
      workspaceShareService as never,
      {} as never,
      logger as never,
      adapter as never,
    );

    return {
      service,
      connectorService,
      auth,
      workspaceDocService,
      workspaceShareService,
      adapter,
    };
  }

  it('authorizes before resolving provider credentials', async () => {
    const { service, connectorService, workspaceShareService } = build();
    workspaceShareService.assertUserHasWriteAccess.mockRejectedValue(new Error('denied'));

    await expect(
      service.importToWorkspace(userId, connectorId, workspaceId, {
        mode: 'file',
        itemRef: { driveId: 'drive-1', itemId: 'item-1' },
      }),
    ).rejects.toThrow('denied');
    expect(connectorService.findById).not.toHaveBeenCalled();
  });

  it('resolves provider auth and attributes upload to the requesting user', async () => {
    const { service, auth, workspaceDocService } = build();

    const result = await service.importToWorkspace(userId, connectorId, workspaceId, {
      mode: 'file',
      itemRef: { driveId: 'drive-1', itemId: 'item-1' },
    });

    expect(auth.resolveRuntimeAuth).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({ connectedAppKey: 'microsoft' }),
    );
    expect(workspaceDocService.uploadSmallFile).toHaveBeenCalledWith(
      workspaceId,
      userId,
      expect.any(Buffer),
      'report.pdf',
      'application/pdf',
    );
    expect(result.summary.imported).toBe(1);
  });
});
