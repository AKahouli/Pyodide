import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, expect, it } from 'vitest';
import type { ConnectorResponse, McpInspectResult } from '../../types';
import { inspectMcp } from '../../api';
import { CreateEditConnectorDialog } from './CreateEditConnectorDialog';

vi.mock('../../api', () => ({
  authorizeConnectorAppOAuth: vi.fn(),
  disconnectConnectorAppOAuth: vi.fn(),
  getConnectorAppOAuthStatus: vi.fn(),
  getConnectorCategories: vi.fn().mockResolvedValue([]),
  getSkills: vi.fn().mockResolvedValue({ data: [] }),
  inspectMcp: vi.fn(),
}));

vi.mock('@/modules/connected-app/api', () => ({
  getAdminConnectedApps: vi.fn().mockResolvedValue([]),
}));

const connector: ConnectorResponse = {
  id: 'connector-1',
  slug: 'files',
  name: 'Files',
  description: 'File tools',
  icon: '',
  color: '',
  iconColor: 'light',
  categoryId: null,
  authType: 'none',
  authConfigSchema: {},
  authSourceType: 'none',
  connectedAppKey: '',
  credentialConfigured: false,
  mcpTransportType: 'streamable_http',
  mcpServerUrl: 'https://mcp.example.test',
  inspectionStatus: 'supported',
  dynamicHeaders: [],
  actions: [
    { key: 'list_files', label: 'List Files', description: 'Lists files.', parameterSchema: { type: 'object' }, outputSchema: { type: 'array' }, safety: 'read', supportsBatch: false, supportsIteration: false, isEnabled: true },
    { key: 'delete_file', label: 'Delete File', description: 'Deletes a file.', parameterSchema: { required: ['path'] }, outputSchema: {}, safety: 'delete', supportsBatch: true, supportsIteration: false, isEnabled: true },
  ],
  referencedSkillIds: [],
  isActive: true,
  createdBy: 'user-1',
  createdAt: '',
  updatedAt: '',
};

describe('CreateEditConnectorDialog tool table', () => {
  it('loads and saves a workspace-sourced dynamic header', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <CreateEditConnectorDialog
        open
        onOpenChange={vi.fn()}
        connector={{
          ...connector,
          dynamicHeaders: [{ headerName: 'Workspace-Id', source: 'workspace', enabled: true }],
        }}
        onSave={onSave}
      />,
    );

    expect(await screen.findByText('connectors.form.dynamicHeaders.sources.workspace')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'connectors.form.dialog.update' }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      dynamicHeaders: [expect.objectContaining({ headerName: 'Workspace-Id', source: 'workspace', enabled: true })],
    }));
  });

  it('submits the hidden connector visibility setting', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<CreateEditConnectorDialog open onOpenChange={vi.fn()} connector={connector} onSave={onSave} />);

    const hiddenSwitch = await screen.findByRole('switch', { name: 'connectors.form.fields.hidden.label' });
    expect(hiddenSwitch).not.toBeChecked();
    await user.click(hiddenSwitch);
    await user.click(screen.getByRole('button', { name: 'connectors.form.dialog.update' }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ isHidden: true }));
  });

  it('submits the system connector flag and round-trips an existing system connector', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<CreateEditConnectorDialog open onOpenChange={vi.fn()} connector={connector} onSave={onSave} />);

    const systemSwitch = await screen.findByRole('switch', { name: 'connectors.form.fields.system.label' });
    expect(systemSwitch).not.toBeChecked();
    await user.click(systemSwitch);
    await user.click(screen.getByRole('button', { name: 'connectors.form.dialog.update' }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ isSystem: true }));
  });

  it('keeps server-managed credentials intact when inspecting and saving without opting in', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    vi.mocked(inspectMcp).mockResolvedValueOnce({ serverName: 'playbook', tools: [] });
    const systemConnector: ConnectorResponse = {
      ...connector,
      id: 'playbook-connector',
      slug: 'playbook-mcp',
      name: 'Playbook MCP',
      authType: 'token',
      authSourceType: 'server_config',
      credentialConfigured: true,
      mcpServerUrl: 'http://localhost:8025/mcp',
      isSystem: true,
      isHidden: true,
    };

    render(<CreateEditConnectorDialog open onOpenChange={vi.fn()} connector={systemConnector} onSave={onSave} />);

    expect(await screen.findByText('connectors.form.auth.serverConfigOption')).toBeInTheDocument();
    expect(screen.getByText('connectors.form.auth.serverConfigHelper')).toBeInTheDocument();
    expect(screen.queryByText('connectors.form.auth.strategyLabel')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'connectors.form.inspect.action' }));
    await waitFor(() => expect(inspectMcp).toHaveBeenCalledWith(
      'streamable_http',
      'http://localhost:8025/mcp',
      undefined,
      undefined,
      undefined,
      'playbook-connector',
      [],
    ));

    await user.click(screen.getByRole('button', { name: 'connectors.form.dialog.update' }));
    // Omitted credential fields preserve the stored server-side secret.
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      authType: 'token',
      authSourceType: 'server_config',
      runtimeAuthConfig: '',
      mcpServerConfig: '',
    }));
  });

  it('shows the credential state and replaces stored credentials only on explicit opt-in', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const credentialedConnector: ConnectorResponse = {
      ...connector,
      authSourceType: 'credential',
      credentialConfigured: true,
    };

    render(<CreateEditConnectorDialog open onOpenChange={vi.fn()} connector={credentialedConnector} onSave={onSave} />);

    expect(await screen.findByText('connectors.form.auth.credentialConfigured')).toBeInTheDocument();

    // Saving without the replace opt-in keeps the stored credentials.
    await user.click(screen.getByRole('button', { name: 'connectors.form.dialog.update' }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({
      runtimeAuthConfig: '',
      clearCredentials: false,
    }));

    // Opting in reveals the credential inputs and sends the replacement.
    await user.click(screen.getByRole('switch', { name: 'connectors.form.auth.replaceCredentials' }));
    const headerPrefix = screen.getByPlaceholderText('connectors.form.auth.headerPrefixPlaceholder');
    await user.clear(headerPrefix);
    await user.type(headerPrefix, 'Bearer canary-token');
    await user.click(screen.getByRole('button', { name: 'connectors.form.dialog.update' }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({
      runtimeAuthConfig: JSON.stringify({ strategy: 'http_header_bearer', headerName: 'Authorization', headerPrefix: 'Bearer canary-token' }),
      clearCredentials: false,
    }));
    expect(JSON.stringify(onSave.mock.calls.at(-1)![0])).toContain('canary-token');
  });

  it('clears stored credentials via the explicit clear switch', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const credentialedConnector: ConnectorResponse = {
      ...connector,
      authSourceType: 'credential',
      credentialConfigured: true,
    };

    render(<CreateEditConnectorDialog open onOpenChange={vi.fn()} connector={credentialedConnector} onSave={onSave} />);

    await user.click(await screen.findByRole('switch', { name: 'connectors.form.auth.clearCredentials' }));
    await user.click(screen.getByRole('button', { name: 'connectors.form.dialog.update' }));
    // The dialog emits the form-level flag; ConnectorsPage maps it to the
    // API's clearRuntimeAuthConfig field.
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({
      clearCredentials: true,
      runtimeAuthConfig: '',
    }));
  });

  it('flags stored stdio connectors as unsupported for HTTP inspection', () => {
    const stdioConnector: ConnectorResponse = {
      ...connector,
      mcpTransportType: 'stdio',
      inspectionStatus: 'unsupported_for_http_inspection',
    };

    render(<CreateEditConnectorDialog open onOpenChange={vi.fn()} connector={stdioConnector} onSave={vi.fn()} />);

    expect(screen.getByText('connectors.form.fields.transportType.unsupportedInspection')).toBeInTheDocument();
  });

  it('shows tool metadata and preserves actions when saving', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<CreateEditConnectorDialog open onOpenChange={vi.fn()} connector={connector} onSave={onSave} />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete File' })).toBeInTheDocument());
    expect(screen.getAllByText('Lists files.')).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Delete File' }));
    expect(screen.getAllByText('Deletes a file.')).toHaveLength(2);
    await user.click(screen.getAllByRole('switch', { name: 'connectors.form.actions.toggleLabel' })[0]);
    await user.click(screen.getByRole('button', { name: 'connectors.form.dialog.update' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      actions: [
        expect.objectContaining({ key: 'list_files', isEnabled: false, parameterSchema: { type: 'object' } }),
        expect.objectContaining({ key: 'delete_file', isEnabled: true, parameterSchema: { required: ['path'] } }),
      ],
    }));
  });

  it('preserves disabled tools during inspection and enables newly discovered tools', async () => {
    const user = userEvent.setup();
    vi.mocked(inspectMcp).mockResolvedValueOnce({
      serverName: 'Files',
      tools: [
        { name: 'list_files', description: 'Updated list.', inputSchema: { type: 'object' } },
        { name: 'move_file', description: 'Moves a file.', inputSchema: { required: ['path'] } },
      ],
    });
    const connectorWithDisabledTool = {
      ...connector,
      actions: connector.actions.map((action) =>
        action.key === 'list_files' ? { ...action, isEnabled: false } : action,
      ),
    };

    render(
      <CreateEditConnectorDialog
        open
        onOpenChange={vi.fn()}
        connector={connectorWithDisabledTool}
        onSave={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'connectors.form.inspect.action' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Move File' })).toBeInTheDocument());
    const switches = screen.getAllByRole('switch', { name: 'connectors.form.actions.toggleLabel' });
    expect(switches[0]).not.toBeChecked();
    expect(switches[1]).toBeChecked();
  });

  it('preserves the latest toggle while inspection is in flight', async () => {
    const user = userEvent.setup();
    let resolveInspection!: (result: McpInspectResult) => void;
    vi.mocked(inspectMcp).mockReturnValueOnce(new Promise((resolve) => {
      resolveInspection = resolve;
    }));

    render(<CreateEditConnectorDialog open onOpenChange={vi.fn()} connector={connector} onSave={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'connectors.form.inspect.action' }));
    await user.click(screen.getAllByRole('switch', { name: 'connectors.form.actions.toggleLabel' })[0]);
    await act(async () => resolveInspection({
      serverName: 'Files',
      tools: [{ name: 'list_files', description: 'Updated list.' }],
    }));

    await waitFor(() => expect(screen.getByRole('switch', { name: 'connectors.form.actions.toggleLabel' })).not.toBeChecked());
  });

  it('preserves disabled state for inspected tool names that are truncated into action keys', async () => {
    const user = userEvent.setup();
    const longToolName = `tool_${'x'.repeat(130)}`;
    const truncatedKey = longToolName.slice(0, 128);
    vi.mocked(inspectMcp).mockResolvedValueOnce({
      serverName: 'Files',
      tools: [{ name: longToolName, description: 'A long-named tool.' }],
    });
    const connectorWithLongTool = {
      ...connector,
      actions: [{ ...connector.actions[0], key: truncatedKey, label: 'Long Tool', isEnabled: false }],
    };

    render(
      <CreateEditConnectorDialog
        open
        onOpenChange={vi.fn()}
        connector={connectorWithLongTool}
        onSave={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'connectors.form.inspect.action' }));

    await waitFor(() => expect(screen.getByRole('switch', { name: 'connectors.form.actions.toggleLabel' })).not.toBeChecked());
  });
});
