import { ConfigService } from '@nestjs/config';
import { RemoteAppDataMcpDispatcherService } from './remote-app-data-mcp-dispatcher.service';
import { AppDataMcpAuthService } from './app-data-mcp-auth.service';
import { AppDataClientService } from './app-data-client.service';

function dispatcherWith() {
  const config = {
    get: jest.fn((key: string) => {
      const values: Record<string, unknown> = {
        'appData.enabled': true,
        'appData.mcpEnabled': true,
      };
      return values[key];
    }),
  };
  const auth = {
    resolveBinding: jest
      .fn()
      .mockResolvedValue({ workspaceId: 'ws-1', userId: 'user-1' }),
  };
  const client = {
    getAppByWorkspace: jest.fn().mockResolvedValue({ id: 'app-1', workspaceId: 'ws-1' }),
    applySchema: jest.fn().mockResolvedValue({ message: 'applied', tables: 1 }),
    seedRows: jest.fn().mockResolvedValue({
      total: 2,
      inserted: 2,
      skipped: 0,
      tables: [{ table: 'todos', inserted: 2, skipped: 0 }],
    }),
  };
  const dispatcher = new RemoteAppDataMcpDispatcherService(
    auth as unknown as AppDataMcpAuthService,
    config as unknown as ConfigService,
    client as unknown as AppDataClientService,
  );
  return { dispatcher, auth, client };
}

function schemaApplyRequest(manifest: unknown) {
  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'schema_apply',
      arguments: { expectedVersion: 0, manifest },
    },
  };
}

describe('RemoteAppDataMcpDispatcherService seed', () => {
  it('advertises the seed tool in tools/list', async () => {
    const { dispatcher } = dispatcherWith();
    const response = await dispatcher.handleRequest(
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      'Bearer mcp-token',
    );
    const tools = (response as { result?: { tools?: { name: string }[] } }).result?.tools ?? [];
    expect(tools.map((t) => t.name)).toContain('seed');
  });

  it('forwards a tables object map to seedRows in DEV with the owner userId', async () => {
    const { dispatcher, client } = dispatcherWith();
    const response = await dispatcher.handleRequest(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'seed',
          arguments: {
            tables: {
              todos: [{ title: 'A' }, { title: 'B' }],
              nonRows: 'skip-me',
            },
          },
        },
      },
      'Bearer mcp-token',
    );

    expect(client.seedRows).toHaveBeenCalledTimes(1);
    const [appDataId, env, tables, ownerUserId] = client.seedRows.mock.calls[0];
    expect(appDataId).toBe('app-1');
    expect(env).toBe('dev');
    expect(ownerUserId).toBe('user-1');
    expect(tables).toEqual([{ name: 'todos', rows: [{ title: 'A' }, { title: 'B' }] }]);
    expect(response).toMatchObject({
      result: { structuredContent: { inserted: 2, environment: 'dev' } },
    });
  });

  it('rejects seed calls whose tables argument is not an object map', async () => {
    const { dispatcher, client } = dispatcherWith();
    const response = await dispatcher.handleRequest(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'seed', arguments: { tables: ['not-a-map'] } },
      },
      'Bearer mcp-token',
    );
    expect(client.seedRows).not.toHaveBeenCalled();
    expect(response).toMatchObject({
      error: { code: -32602 },
    });
  });
});

describe('RemoteAppDataMcpDispatcherService schema_apply', () => {
  it('strips a version key nested inside tables before calling the microservice', async () => {
    const { dispatcher, client } = dispatcherWith();

    // The exact malformed payload observed in the field: the model copied the
    // manifest-level version inside `tables`.
    await dispatcher.handleRequest(
      schemaApplyRequest({
        version: 1,
        tables: {
          tasks: {
            columns: {
              id: { type: 'uuid', primaryKey: true },
              title: { type: 'text' },
              completed: { type: 'boolean' },
              description: { type: 'text' },
              created_at: { type: 'timestamptz' },
            },
          },
          version: 1,
        },
      }),
      'Bearer mcp-token',
    );

    expect(client.applySchema).toHaveBeenCalledTimes(1);
    const [, , tables] = client.applySchema.mock.calls[0];
    expect(tables).toHaveLength(1);
    expect(tables[0]).toMatchObject({ name: 'tasks' });
    expect(tables[0].columns.map((c: { name: string }) => c.name).sort()).toEqual([
      'completed',
      'created_at',
      'description',
      'id',
      'title',
    ]);
  });

  it('still applies a well-formed manifest unchanged', async () => {
    const { dispatcher, client } = dispatcherWith();

    const response = await dispatcher.handleRequest(
      schemaApplyRequest({
        version: 1,
        tables: {
          tasks: {
            columns: {
              id: { type: 'uuid', primaryKey: true },
              title: { type: 'text', nullable: true },
            },
          },
        },
      }),
      'Bearer mcp-token',
    );

    expect(client.applySchema).toHaveBeenCalledTimes(1);
    const [, , tables] = client.applySchema.mock.calls[0];
    expect(tables).toHaveLength(1);
    expect(tables[0].columns).toEqual([
      { name: 'id', type: 'uuid', nullable: false },
      { name: 'title', type: 'text', nullable: true },
    ]);
    expect(response).toMatchObject({ result: { structuredContent: { applied: true } } });
  });
});
