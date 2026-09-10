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
