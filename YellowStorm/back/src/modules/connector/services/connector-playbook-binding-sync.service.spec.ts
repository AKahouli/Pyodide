import { ConnectorPlaybookBindingSyncService } from './connector-playbook-binding-sync.service';

describe('ConnectorPlaybookBindingSyncService', () => {
  const createService = () => {
    const updateMany = jest.fn().mockResolvedValue({ matchedCount: 2, modifiedCount: 2 });
    const collection = jest.fn().mockReturnValue({ updateMany });
    const logger = { setContext: jest.fn(), log: jest.fn() };

    return {
      service: new ConnectorPlaybookBindingSyncService({ collection } as any, logger as any),
      updateMany,
    };
  };

  it('synchronizes actions and fixed parameters when a same-key schema changes', async () => {
    const { service, updateMany } = createService();

    await service.syncConnectorActions(
      'connector-1',
      [{ key: 'search', parameterSchema: { properties: { oldArg: {} }, additionalProperties: false } }],
      [{ key: 'search', parameterSchema: { properties: { newArg: {} }, additionalProperties: false } }],
    );

    expect(updateMany).toHaveBeenCalledWith(
      { 'nodes.metadata.toolBindings.connectorId': 'connector-1' },
      expect.arrayContaining([
        expect.objectContaining({ $set: expect.objectContaining({ nodes: expect.any(Object) }) }),
      ]),
    );
    const pipeline = updateMany.mock.calls[0][1];
    expect(JSON.stringify(pipeline)).toContain('newArg');
    expect(JSON.stringify(pipeline)).toContain('fixedParams');
    expect(JSON.stringify(pipeline)).toContain('actionKey');
  });

  it('preserves fixed parameters for explicitly open schemas', async () => {
    const { service, updateMany } = createService();

    await service.syncConnectorActions(
      'connector-1',
      [{ key: 'search', parameterSchema: { properties: { oldArg: {} } } }],
      [{
        key: 'search',
        parameterSchema: { properties: { newArg: {} }, additionalProperties: true },
      }],
    );

    expect(JSON.stringify(updateMany.mock.calls[0][1])).not.toContain('fixedParams');
  });

  it('does not write when action keys and schemas are unchanged', async () => {
    const { service, updateMany } = createService();
    const actions = [{ key: 'search', parameterSchema: { properties: { query: {} } } }];

    await service.syncConnectorActions('connector-1', actions, actions);

    expect(updateMany).not.toHaveBeenCalled();
  });
});
