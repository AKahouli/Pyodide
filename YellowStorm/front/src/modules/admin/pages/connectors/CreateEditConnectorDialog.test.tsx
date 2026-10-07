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
  runtimeAuthConfig: {},
  mcpTransportType: 'streamable_http',
  mcpServerUrl: 'https://mcp.example.test',
  mcpServerConfig: {},
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

  it('preserves server-managed Playbook MCP authentication when inspecting and saving', async () => {
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
      runtimeAuthConfig: { secretKey: 'playbook_mcp_ingress' },
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
      { secretKey: 'playbook_mcp_ingress' },
      'playbook-connector',
    ));

    await user.click(screen.getByRole('button', { name: 'connectors.form.dialog.update' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      authType: 'token',
      authSourceType: 'server_config',
      runtimeAuthConfig: JSON.stringify({ secretKey: 'playbook_mcp_ingress' }),
    }));
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
