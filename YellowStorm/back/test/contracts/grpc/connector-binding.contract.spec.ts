import 'reflect-metadata';
import { expectContract } from '../expect-contract';
import { toWire, expectNoMongoKeys } from '../wire-helpers';
import { AgentConnectorRuntimeService } from '@modules/agent/services/agent-connector-runtime.service';
import { CONNECTOR_ID, connectorRow, makeConnectorService } from '../connector/connector-fixtures';

/**
 * Snapshot-style gRPC contracts for the ConnectorBinding / ToolBinding payloads
 * the runtime receives, for three agent shapes. Built through the real
 * ConnectorService.findByIdsForGrpc (conv-v2 proto) and
 * AgentConnectorRuntimeService.buildConnectorBindings / buildConnectorToolDefs
 * (agent proto) over fake stores.
 */
const USER = '64b000000000000000000001';

function build(rows: ReturnType<typeof connectorRow>[], auth = { headers: {} as Record<string, string>, env: {} as Record<string, string> }) {
  const connectorService = makeConnectorService(rows, auth);
  const runtime = new AgentConnectorRuntimeService(
    { setContext: jest.fn(), warn: jest.fn(), debug: jest.fn() } as never,
    {} as never,
    connectorService,
    { resolveRuntimeAuth: async () => auth, resolveDynamicHeaders: async () => ({}) } as never,
    { get: jest.fn((_key: string, fallback: unknown) => fallback) } as never,
  );
  return { connectorService, runtime };
}

async function payloads(rows: ReturnType<typeof connectorRow>[], auth?: { headers: Record<string, string>; env: Record<string, string> }) {
  const { connectorService, runtime } = build(rows, auth);
  const ids = rows.map((r) => r.id);
  const map = await runtime.buildConnectorsMap(ids);
  const connector_bindings = await runtime.buildConnectorBindings(map, ids, USER);
  return toWire({
    conv_v2_connectors: await connectorService.findByIdsForGrpc(ids, USER),
    connector_bindings,
    tools: runtime.buildConnectorToolDefs(connector_bindings),
  });
}

describe('gRPC connector / tool binding contracts', () => {
  it('agent without connector: empty binding lists', async () => {
    const body = await payloads([]);
    expectContract('grpc/agent-no-connector', body);
    expect(body).toEqual({ conv_v2_connectors: [], connector_bindings: [], tools: [] });
  });

  it('agent with an OAuth (connected-app) connector: auth headers resolved, no server config', async () => {
    const row = connectorRow({ authSourceType: 'connected_app', connectedAppKey: 'microsoft' });
    const body = await payloads([row], { headers: { Authorization: 'Bearer runtime-token' }, env: {} });
    expectContract('grpc/agent-oauth-connector', body);
    const [conv] = body.conv_v2_connectors;
    const [binding] = body.connector_bindings;
    expect(conv.connector_id).toBe(CONNECTOR_ID);
    expect(conv.auth_headers).toEqual({ Authorization: 'Bearer runtime-token' });
    expect(binding.connector_id).toBe(CONNECTOR_ID);
    expect(binding.auth_headers).toEqual({ Authorization: 'Bearer runtime-token' });
    // disabled actions never reach the runtime
    expect(conv.actions.map((a: { action_key: string }) => a.action_key)).toEqual(['list_messages']);
    expect(binding.actions.map((a: { action_key: string }) => a.action_key)).toEqual(['list_messages']);
    expect(body.tools).toEqual([expect.objectContaining({ name: 'graph-mail_list_messages', top_k: 0 })]);
    expectNoMongoKeys(body);
  });

  it('agent with an MCP server-config connector: config travels as JSON / object, static auth env', async () => {
    const row = connectorRow({
      id: '64b000000000000000000a03',
      slug: 'local-mcp',
      name: 'Local MCP',
      authSourceType: 'server_config',
      mcpTransportType: 'stdio',
      mcpServerUrl: '',
      mcpServerConfig: { command: 'npx', args: ['-y', 'some-mcp'], env: { API_URL: 'https://api.example.test' } },
      dynamicHeaders: [],
    });
    const body = await payloads([row], { headers: {}, env: { API_KEY: 'runtime-secret' } });
    expectContract('grpc/agent-mcp-server-config-connector', body);
    const [conv] = body.conv_v2_connectors;
    const [binding] = body.connector_bindings;
    expect(JSON.parse(conv.mcp_server_config_json)).toEqual(row.mcpServerConfig);
    expect(binding.mcp_server_config).toEqual(row.mcpServerConfig);
    expect(conv.mcp_transport_type).toBe('stdio');
    expect(conv.auth_env).toEqual({ API_KEY: 'runtime-secret' });
    expectNoMongoKeys(body);
  });
});
