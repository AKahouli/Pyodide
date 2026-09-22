import { ConnectorService } from '@modules/connector/connector.service';
import type { ConnectorRow } from '@modules/connector/persistence/connector.store';

export const CONNECTOR_ID = '64b000000000000000000a01';

export const connectorRow = (over: Partial<ConnectorRow> = {}): ConnectorRow =>
  ({
    id: CONNECTOR_ID,
    slug: 'graph-mail',
    name: 'Graph Mail',
    description: 'Read mail',
    icon: 'mail',
    color: '#0078d4',
    iconColor: 'light',
    categoryId: '64b000000000000000000a02',
    authType: 'oauth2',
    authConfigSchema: {},
    authSourceType: 'none',
    connectedAppKey: '',
    runtimeAuthConfig: {},
    mcpTransportType: 'streamable_http',
    mcpServerUrl: 'https://mcp.example.test/mail',
    mcpServerConfig: {},
    dynamicHeaders: [
      { headerName: 'X-Workspace-Id', source: 'workspace', enabled: true },
      { headerName: 'X-User-Id', source: 'user_id', enabled: true },
    ],
    actions: [
      {
        key: 'list_messages',
        label: 'List messages',
        description: 'List recent messages',
        parameterSchema: { type: 'object', properties: { top: { type: 'number' } } },
        outputSchema: {},
        safety: 'read',
        supportsBatch: false,
        supportsIteration: true,
        isEnabled: true,
        resultKind: 'generic',
        citationMode: 'none',
      },
      {
        key: 'disabled_action',
        label: 'Disabled',
        description: '',
        parameterSchema: {},
        outputSchema: {},
        safety: 'write',
        supportsBatch: false,
        supportsIteration: false,
        isEnabled: false,
        resultKind: 'generic',
        citationMode: 'none',
      },
    ],
    skillIds: ['64b000000000000000000701'],
    isActive: true,
    isSystem: false,
    isHidden: false,
    createdBy: '64b000000000000000000001',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    ...over,
  }) as unknown as ConnectorRow;

/** ConnectorService over a fake store holding `rows`; the auth resolver is injectable. */
export function makeConnectorService(
  rows: ConnectorRow[],
  auth: { headers: Record<string, string>; env: Record<string, string> } = { headers: {}, env: {} },
): ConnectorService {
  const store = {
    findByIds: async (ids: string[]) => rows.filter((r) => ids.includes(r.id)),
    findNamesByIds: async () => new Map<string, string>(),
  };
  return new ConnectorService(
    store as never,
    { findNamesByIds: async () => new Map() } as never,
    { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as never,
    null as never,
    {
      resolveRuntimeAuth: async () => auth,
      resolveDynamicHeaders: async () => ({}),
    } as never,
    { syncConnectorActions: async () => undefined } as never,
  );
}
