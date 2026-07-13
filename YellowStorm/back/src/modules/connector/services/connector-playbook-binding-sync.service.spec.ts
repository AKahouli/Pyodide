import { ConnectorPlaybookBindingSyncService } from './connector-playbook-binding-sync.service';

describe('ConnectorPlaybookBindingSyncService', () => {
  const createService = () => {
    const updateMany = jest.fn().mockResolvedValue({ matchedCount: 2, modifiedCount: 2 });
    const collection = jest.fn().mockReturnValue({
      updateMany,
    });
    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
    };

    return {
      service: new ConnectorPlaybookBindingSyncService({ collection } as any, logger as any),
      updateMany,
    };
  };

  it('adds new connector actions and removes actions no longer enabled from playbook bindings', async () => {
    const { service, updateMany } = createService();

    await service.syncConnectorActions('connector-1', ['keep', 'removed'], ['keep', 'added']);

    expect(updateMany).toHaveBeenCalledWith(
      { 'nodes.metadata.toolBindings.connectorId': 'connector-1' },
      {
        $set: {
          'nodes.$[].metadata.toolBindings.$[binding].actions': [
            { actionKey: 'keep', isEnabled: true },
            { actionKey: 'added', isEnabled: true },
          ],
        },
      },
      { arrayFilters: [{ 'binding.connectorId': 'connector-1' }] },
    );
  });

  it('adds re-enabled connector actions to playbook bindings', async () => {
    const { service, updateMany } = createService();

    await service.syncConnectorActions('connector-1', ['keep'], ['keep', 'reenabled']);

    expect(updateMany).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        $set: {
          'nodes.$[].metadata.toolBindings.$[binding].actions': [
            { actionKey: 'keep', isEnabled: true },
            { actionKey: 'reenabled', isEnabled: true },
          ],
        },
      }),
      expect.any(Object),
    );
  });

  it('does not write when action keys are unchanged', async () => {
    const { service, updateMany } = createService();

    await service.syncConnectorActions('connector-1', ['keep'], ['keep']);

    expect(updateMany).not.toHaveBeenCalled();
  });
});
