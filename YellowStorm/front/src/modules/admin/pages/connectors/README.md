# Connectors Page

This page enables administrators to manage MCP (Model Context Protocol) connectors with OAuth 2.0 authentication.

## Overview

The Connectors page provides a complete interface for:
- Creating, editing, and deleting connectors
- Inspecting MCP servers to discover available tools
- Managing OAuth connections for external providers (GitHub, etc.)
- Configuring transport types and runtime authentication

## Architecture

```
ConnectorsPage (Main list view)
    ↓
CreateEditConnectorDialog (Form dialog)
    ↓
OAuth Flow (Popup-based connection)
    ↓
MCP Inspection (Tool discovery)
```

## Files

| File | Description |
|------|-------------|
| `ConnectorsPage.tsx` | Main list page with table and actions |
| `CreateEditConnectorDialog.tsx` | Form dialog for CRUD operations |
| `connector-form-schema.ts` | Zod schema for form validation |
| `mcp-server-config.ts` | MCP config parsing utilities |

## Component: CreateEditConnectorDialog

The connector dialog handles all connector CRUD operations with OAuth integration.

### Props

```typescript
interface CreateEditConnectorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connector: ConnectorResponse | null;  // null for create mode
  onSave: (data: ConnectorFormValues) => void;
}
```

### OAuth Integration

The dialog includes OAuth connection UI for connected apps:

```tsx
// Status indicator
{form.authSourceType === 'connected_app' && form.connectedAppKey === 'github' && (
  <div className='flex items-center gap-2'>
    {githubConnected ? (
      <>
        <div className='w-2 h-2 rounded-full bg-green-500 animate-pulse' />
        <span>Connected to GitHub</span>
      </>
    ) : (
      <>
        <div className='w-2 h-2 rounded-full bg-amber-500' />
        <span>Not connected to GitHub</span>
      </>
    )}
  </div>
)}
```

### OAuth Connection Handler

```tsx
const handleGithubOAuth = async () => {
  setOauthConnecting(true);

  try {
    const result = await authorizeConnectorAppOAuth('github');
    const popup = window.open(result.authorizationUrl, 'connector-admin-github-oauth', 'width=600,height=700');

    if (!popup) {
      toast.error('Failed to open GitHub authorization window');
      return;
    }

    // Wait for popup to close and check status
    const connected = await new Promise<boolean>((resolve) => {
      let settled = false;
      let pollTimer: ReturnType<typeof setInterval>;

      const cleanup = () => {
        clearInterval(pollTimer);
        window.removeEventListener('message', handleMessage);
      };

      const finish = async (success: boolean) => {
        if (settled) return;
        settled = true;
        cleanup();
        await refreshGithubConnectionStatus();
        resolve(success);
      };

      const handleMessage = (event: MessageEvent) => {
        const message = event.data as {
          type?: string;
          appKey?: string;
          success?: boolean;
          error?: string;
        };

        if (message?.type === 'connector-admin-oauth-result' && message.appKey === 'github') {
          if (message.success) {
            void finish(true);
          } else {
            toast.error('GitHub connection failed', { description: message.error });
            void finish(false);
          }
        }
      };

      window.addEventListener('message', handleMessage);

      // Poll for popup close
      pollTimer = setInterval(() => {
        if (popup.closed && !settled) {
          const checkStatus = async () => {
            try {
              const status = await getConnectorAppOAuthStatus('github');
              await finish(status.connected);
            } catch {
              await finish(false);
            }
          };
          void checkStatus();
        }
      }, 500);
    });

    if (!connected) {
      toast.error('GitHub connection failed');
    }
  } catch (err) {
    toast.error('GitHub connection failed', {
      description: err instanceof Error ? err.message : undefined,
    });
  } finally {
    setOauthConnecting(false);
  }
};
```

### MCP Inspection

```tsx
const handleInspect = async () => {
  if (!form.mcpServerUrl.trim()) {
    toast.error('Server URL is required');
    return;
  }

  setInspecting(true);

  try {
    const mcpServerConfig = form.mcpServerConfig.trim()
      ? JSON.parse(form.mcpServerConfig)
      : undefined;

    const runtimeAuthConfig = buildRuntimeAuthConfig(form);

    const result = await inspectMcp(
      form.mcpTransportType,
      form.mcpServerUrl,
      mcpServerConfig,
      form.authSourceType === 'connected_app' ? form.connectedAppKey : undefined,
      runtimeAuthConfig
    );

    if (result.error) {
      setInspectError(result.error);
      return;
    }

    // Map MCP tools to connector actions
    const actions = mapInspectToolsToActions(result.tools ?? []);

    setForm((current) => ({
      ...current,
      actions,
      actionsJson: JSON.stringify(actions, null, 2),
    }));

    toast.success(`Loaded ${actions.length} tools from MCP server`);
  } catch (err) {
    setInspectError(err instanceof Error ? err.message : 'Inspection failed');
  } finally {
    setInspecting(false);
  }
};
```

## Form Schema

The connector form uses Zod for validation:

```typescript
export const connectorFormSchema = z.object({
  slug: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  description: z.string().max(500),
  icon: z.string().max(50),
  color: z.string().max(20),
  authType: z.enum(['oauth2', 'token', 'none']),
  authSourceType: z.enum(['connected_app', 'credential', 'none']),
  connectedAppKey: z.string().max(64),
  runtimeAuthConfig: z.string().max(5000),
  runtimeAuthStrategy: z.enum(['http_header_bearer', 'custom_headers', 'env_vars']),
  runtimeHeaderName: z.string().max(100),
  runtimeHeaderPrefix: z.string().max(100),
  mcpTransportType: z.enum(['streamable_http', 'sse', 'stdio']),
  mcpServerUrl: z.string().max(500),
  mcpServerConfig: z.string().max(2000),
  actionsJson: z.string().max(10000),
  referencedSkillIds: z.array(z.string()),
  isActive: z.boolean(),
});
```

## MCP Server Config

The `mcp-server-config.ts` provides utilities for parsing MCP server configuration:

```typescript
export interface McpServerConfig {
  transport?: string;
  url?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
}

export function parseMcpServerConfig(jsonString: string): McpServerConfig | undefined {
  try {
    return JSON.parse(jsonString);
  } catch {
    return undefined;
  }
}

export function formatMcpServerConfig(config: McpServerConfig | undefined): string {
  if (!config) return '';
  return JSON.stringify(config, null, 2);
}
```

## API Functions

### Connector CRUD

```typescript
// List connectors
const { data, meta } = await getConnectors({ page: 1, limit: 20, search: 'github' });

// Get by ID
const connector = await getConnectorById(connectorId);

// Create connector
const newConnector = await createConnector({
  slug: 'github-mcp',
  name: 'GitHub MCP',
  // ... other fields
});

// Update connector
const updated = await updateConnector(connectorId, { name: 'Updated Name' });

// Delete connector
await deleteConnector(connectorId);
```

### OAuth Management

```typescript
// Get authorization URL
const { authorizationUrl } = await authorizeConnectorAppOAuth('github');

// Check connection status
const status = await getConnectorAppOAuthStatus('github');
// { appKey: 'github', connected: true, status: 'active', connectedAt: '2024-01-01T00:00:00Z', ... }

// Disconnect OAuth
await disconnectConnectorAppOAuth('github');
```

### MCP Inspection

```typescript
// Inspect MCP server (with optional OAuth)
const result = await inspectMcp(
  'streamable_http',      // transportType
  'https://api.github.com/mcp',  // serverUrl
  {},                     // serverConfig
  'github',               // connectedAppKey (optional, for OAuth)
  {                       // runtimeAuthConfig
    strategy: 'http_header_bearer',
    headerName: 'Authorization',
    headerPrefix: 'Bearer '
  }
);

// result: { serverName: 'GitHub MCP Server', tools: [...], error?: string }
```

## Runtime Authentication Strategies

### HTTP Header Bearer

```typescript
{
  strategy: 'http_header_bearer',
  headerName: 'Authorization',
  headerPrefix: 'Bearer '
}
```

Injects the OAuth token as a Bearer token in the Authorization header.

### Custom Headers

```typescript
{
  strategy: 'custom_headers',
  headerMappings: {
    'X-API-Key': 'your-api-key',
    'X-Custom-Header': 'custom-value'
  }
}
```

Injects multiple custom headers into the MCP request.

### Environment Variables

```typescript
{
  strategy: 'env_vars',
  envMap: {
    'GITHUB_TOKEN': 'your-github-token',
    'API_ENDPOINT': 'https://api.example.com'
  }
}
```

Sets environment variables for the MCP process (stdio transport).

## Transport Types

| Type | Description | Use Case |
|------|-------------|----------|
| `streamable_http` | HTTP streaming | Remote MCP servers |
| `sse` | Server-Sent Events | Long-lived connections |
| `stdio` | Standard I/O | Local MCP servers |

## Error Handling

```tsx
try {
  const result = await inspectMcp(...);
  if (result.error) {
    setInspectError(result.error);
    toast.error('Inspection failed', { description: result.error });
  }
} catch (err) {
  toast.error('Inspection failed', {
    description: err instanceof Error ? err.message : 'Unknown error',
  });
}
```

## Localization

All UI strings are translatable via the admin locales:

```json
{
  "connectors": {
    "title": "Connectors",
    "form": {
      "auth": {
        "sectionLabel": "Authentication",
        "sourceLabel": "Authentication Source",
        "connectedAppLabel": "Connected App",
        "githubConnectAction": "Connect to GitHub",
        "githubConnected": "Connected to GitHub",
        "githubNotConnected": "Not connected to GitHub"
      }
    }
  }
}
```

## Related Documentation

- Backend Connector Module: `back/src/modules/connector/README.md`
- Backend Connected App Module: `back/src/modules/connected-app/README.md`
- Admin Module README: `../README.md`