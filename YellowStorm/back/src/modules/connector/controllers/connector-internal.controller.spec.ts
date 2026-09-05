import { ConnectorInternalController } from './connector-internal.controller';

describe('ConnectorInternalController', () => {
  it('passes the trusted acting user to the transfer service', async () => {
    const transferService = {
      importToWorkspace: jest.fn().mockResolvedValue({ success: true }),
    };
    const controller = new ConnectorInternalController(transferService as never);

    await controller.importFromConnector({
      userId: 'user-1',
      connectorId: 'connector-1',
      workspaceId: 'workspace-1',
      mode: 'file',
      itemRef: { fileId: 'file-1' },
    });

    expect(transferService.importToWorkspace).toHaveBeenCalledWith(
      'user-1',
      'connector-1',
      'workspace-1',
      expect.objectContaining({ mode: 'file', itemRef: { fileId: 'file-1' } }),
    );
  });
});
