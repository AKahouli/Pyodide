jest.mock('../connector.service', () => ({ ConnectorService: class {} }));
jest.mock('../connector-transfer.service', () => ({ ConnectorTransferService: class {} }));
import { ConnectorInternalController } from './connector-internal.controller';

describe('ConnectorInternalController', () => {
  it('renews from connector-bound proof, ignoring an arbitrary supplied user', async () => {
    const jwt = { renew: jest.fn().mockResolvedValue({ token: 'renewed' }) };
    const controller = new ConnectorInternalController({} as never, undefined, jwt as never);
    await expect(controller.issueMcpToken({ connectorId: 'connector-1', assertion: 'proof',
      userId: 'arbitrary' } as never)).resolves.toEqual({ token: 'renewed' });
    expect(jwt.renew).toHaveBeenCalledWith('connector-1', 'proof');
  });
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
