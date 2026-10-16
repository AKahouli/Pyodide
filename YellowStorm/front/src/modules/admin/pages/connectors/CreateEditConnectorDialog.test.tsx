import { act, render as renderCollapsed, screen, waitFor } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import userEvent from '@testing-library/user-event';
import { vi, describe, expect, it, beforeEach } from 'vitest';
import type { ConnectorResponse, McpInspectResult } from '../../types';
import { inspectMcp } from '../../api';
import { CreateEditConnectorDialog } from './CreateEditConnectorDialog';
import type { ConnectorSecurityPolicy } from './connector-form-schema';
import { serializeConnectorSecretFields } from './connector-form-schema';

const hasPermission = vi.hoisted(() => vi.fn(() => true));
vi.mock('../../hooks/usePermissions', () => ({ usePermissions: () => ({ hasPermission }) }));
beforeEach(() => hasPermission.mockReturnValue(true));

// Legacy behavioral cases exercise the existing secondary controls explicitly expanded.
function render(element: ReactElement) {
  const result = renderCollapsed(element);
  document.querySelectorAll('details').forEach((details) => { details.open = true; });
  return result;
}

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
  it('restores focus to the current opener after Escape, including reopening', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [open, setOpen] = useState(false);
      return <>
        <button onClick={() => setOpen(true)}>Add connector</button>
        <button onClick={() => setOpen(true)}>Edit connector</button>
        <CreateEditConnectorDialog open={open} onOpenChange={setOpen} connector={null} onSave={vi.fn()} />
      </>;
    }
    renderCollapsed(<Harness />);
    for (const name of ['Add connector', 'Edit connector']) {
      const opener = screen.getByRole('button', { name });
      await user.click(opener);
      expect(await screen.findByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      await waitFor(() => expect(opener).toHaveFocus());
    }
  });

  const internalPolicy: ConnectorSecurityPolicy = { version: 1, profile: 'internal_jwt', audience: 'custom-recipient', actorDelegation: 'verified_user', allowPrivateNetwork: false, requiredPermissions: ['connectors.read'] };

  it('starts with secondary sections collapsed and no unrelated connected account dropdown', () => {
    renderCollapsed(<CreateEditConnectorDialog open onOpenChange={vi.fn()} connector={connector} onSave={vi.fn()} />);
    expect(screen.getByText('connectors.form.sections.branding').closest('details')).not.toHaveAttribute('open');
    expect(screen.getAllByText('connectors.form.actions.title')[0].closest('details')).not.toHaveAttribute('open');
    expect(screen.queryByText('connectors.form.auth.connectedAppLabel')).not.toBeInTheDocument();
  });

  it('creates an explicit public policy and only shows the connected account field for that method', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<CreateEditConnectorDialog open onOpenChange={vi.fn()} connector={null} onSave={onSave} />);
    await user.type(screen.getByPlaceholderText('connectors.form.fields.slug.placeholder'), 'public-tools');
    await user.type(screen.getByPlaceholderText('connectors.form.fields.name.placeholder'), 'Public tools');
    await user.type(screen.getByLabelText('connectors.form.fields.serverUrl.label'), 'https://mcp.example.test');
    await user.click(screen.getByRole('button', { name: 'connectors.form.dialog.create' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ mcpSecurityPolicy: { version: 1, profile: 'public', actorDelegation: 'none', allowPrivateNetwork: false, requiredPermissions: [] } }));
    const method = screen.getByText('connectors.form.auth.publicAccess').closest('button')!;
    await user.click(method);
    await user.click(screen.getByRole('option', { name: 'connectors.form.auth.connectedAccount' }));
    expect(screen.getByText('connectors.form.auth.connectedAppLabel')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'connectors.form.dialog.create' }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ authSourceType: 'connected_app', mcpSecurityPolicy: expect.objectContaining({ profile: 'configured', actorDelegation: 'none' }) }));
  });

  it('omits unchanged policy and carries the saved revision for metadata updates', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const securedConnector = { ...connector, mcpSecurityPolicy: internalPolicy, securityRevision: 7 };
    render(<CreateEditConnectorDialog open onOpenChange={vi.fn()} connector={securedConnector} onSave={onSave} />);
    await user.click(screen.getByRole('button', { name: 'connectors.form.dialog.update' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ mcpSecurityPolicy: undefined, expectedSecurityRevision: 7 }));
    expect(serializeConnectorSecretFields(onSave.mock.calls[0][0])).toEqual({ mcpServerConfig: undefined, runtimeAuthConfig: undefined, clearRuntimeAuthConfig: undefined });
  });

  it.each([
    { actorDelegation: 'verified_user' as const, requiredPermissions: [] },
    { actorDelegation: 'none' as const, requiredPermissions: ['connectors.read'] },
  ])('locks configured privileged destinations for ordinary editors: %j', (flags) => {
    hasPermission.mockReturnValue(false);
    render(<CreateEditConnectorDialog open onOpenChange={vi.fn()} connector={{ ...connector, mcpSecurityPolicy: { ...internalPolicy, profile: 'configured', audience: undefined, ...flags } }} onSave={vi.fn()} />);
    expect(screen.getByLabelText('connectors.form.fields.serverUrl.label')).toBeDisabled();
  });

  it('allows ordinary configured credentials without submitting hidden security policy', async () => {
    hasPermission.mockReturnValue(false);
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<CreateEditConnectorDialog open onOpenChange={vi.fn()} connector={null} onSave={onSave} />);
    await user.type(screen.getByPlaceholderText('connectors.form.fields.slug.placeholder'), 'ordinary');
    await user.type(screen.getByPlaceholderText('connectors.form.fields.name.placeholder'), 'Ordinary');
    await user.type(screen.getByLabelText('connectors.form.fields.serverUrl.label'), 'https://mcp.example.test');
    await user.type(screen.getByLabelText('connectors.form.auth.accessToken'), 'ordinary-token');
    await user.click(screen.getByRole('button', { name: 'connectors.form.dialog.create' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ authSourceType: 'credential', mcpSecurityPolicy: undefined, runtimeAuthConfig: JSON.stringify({ strategy: 'custom_headers', headerMappings: { Authorization: 'Bearer ordinary-token' } }) }));
  });

  it.each(['public', 'internal_jwt'] as const)('does not submit a previous token or server JSON when switching to %s authentication', async (profile) => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<CreateEditConnectorDialog open onOpenChange={vi.fn()} connector={{ ...connector, authSourceType: 'credential', credentialConfigured: true }} onSave={onSave} />);
    await user.click(screen.getByRole('button', { name: 'connectors.form.auth.replaceCredentials' }));
    await user.type(screen.getByLabelText('connectors.form.auth.accessToken'), 'do-not-send');
    await user.click(screen.getByPlaceholderText('connectors.form.fields.serverConfig.placeholder'));
    await user.paste('{"headers":{"X-Secret":"old"}}');
    await user.click(screen.getByText('connectors.form.auth.savedCredential').closest('button')!);
    await user.click(screen.getByRole('option', { name: profile === 'public' ? 'connectors.form.auth.publicAccess' : 'connectors.form.auth.userDelegation' }));
    if (profile === 'internal_jwt') await user.type(screen.getByLabelText('connectors.form.security.audience'), 'custom-recipient');
    await user.click(screen.getByRole('button', { name: 'connectors.form.dialog.update' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ authSourceType: 'none', mcpServerConfig: '{}', runtimeAuthConfig: '', clearCredentials: true, mcpSecurityPolicy: expect.objectContaining({ profile }) }));
    expect(serializeConnectorSecretFields(onSave.mock.calls[0][0])).toEqual({ mcpServerConfig: {}, runtimeAuthConfig: undefined, clearRuntimeAuthConfig: true });
  });

  it('preserves omission on a public metadata save but honors an explicit advanced empty config', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const publicConnector = { ...connector, mcpSecurityPolicy: { ...internalPolicy, profile: 'public' as const, audience: undefined, actorDelegation: 'none' as const, requiredPermissions: [] }, securityRevision: 4 };
    render(<CreateEditConnectorDialog open onOpenChange={vi.fn()} connector={publicConnector} onSave={onSave} />);
    await user.click(screen.getByRole('button', { name: 'connectors.form.dialog.update' }));
    expect(serializeConnectorSecretFields(onSave.mock.calls[0][0])).toEqual({ mcpServerConfig: undefined, runtimeAuthConfig: undefined, clearRuntimeAuthConfig: undefined });
    await user.click(screen.getByPlaceholderText('connectors.form.fields.serverConfig.placeholder'));
    await user.paste('{}');
    await user.click(screen.getByRole('button', { name: 'connectors.form.dialog.update' }));
    expect(serializeConnectorSecretFields(onSave.mock.calls[1][0])).toEqual({ mcpServerConfig: {}, runtimeAuthConfig: undefined, clearRuntimeAuthConfig: undefined });
  });

  it('locks privileged destination and hides security details from ordinary editors without blocking metadata save', async () => {
    hasPermission.mockReturnValue(false);
    const user = userEvent.setup();
    const onSave = vi.fn();
    const securedConnector = { ...connector, mcpSecurityPolicy: internalPolicy, securityRevision: 8 };
    render(<CreateEditConnectorDialog open onOpenChange={vi.fn()} connector={securedConnector} onSave={onSave} />);
    expect(screen.getByDisplayValue(connector.mcpServerUrl)).toBeDisabled();
    expect(screen.queryByText('connectors.form.security.details')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'connectors.form.dialog.update' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ mcpSecurityPolicy: undefined, expectedSecurityRevision: 8, runtimeAuthConfig: '', mcpServerConfig: '' }));
  });

  it('saves an explicitly edited audience without deriving it from the slug and requires saving before inspection', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const securedConnector = { ...connector, mcpSecurityPolicy: internalPolicy, securityRevision: 9 };
    render(<CreateEditConnectorDialog open onOpenChange={vi.fn()} connector={securedConnector} onSave={onSave} />);
    const audience = screen.getByLabelText('connectors.form.security.audience');
    await user.clear(audience);
    await user.type(audience, 'another-recipient');
    const calls = vi.mocked(inspectMcp).mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'connectors.form.inspect.action' }));
    expect(vi.mocked(inspectMcp).mock.calls).toHaveLength(calls);
    await user.click(screen.getByRole('button', { name: 'connectors.form.dialog.update' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ mcpSecurityPolicy: { ...internalPolicy, audience: 'another-recipient' }, expectedSecurityRevision: 9 }));
  });

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
    await user.click(screen.getByRole('button', { name: 'connectors.form.auth.replaceCredentials' }));
    const accessToken = screen.getByLabelText('connectors.form.auth.accessToken');
    expect(accessToken).toHaveAttribute('type', 'password');
    expect(accessToken).toHaveValue('');
    await user.type(accessToken, 'canary-token');
    await user.click(screen.getByRole('button', { name: 'connectors.form.dialog.update' }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({
      runtimeAuthConfig: JSON.stringify({ strategy: 'custom_headers', headerMappings: { Authorization: 'Bearer canary-token' } }),
      clearCredentials: false,
    }));
    expect(JSON.stringify(onSave.mock.calls.at(-1)![0])).toContain('canary-token');
  });

  it('clears stored credentials via the explicit remove action', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const credentialedConnector: ConnectorResponse = {
      ...connector,
      authSourceType: 'credential',
      credentialConfigured: true,
    };

    render(<CreateEditConnectorDialog open onOpenChange={vi.fn()} connector={credentialedConnector} onSave={onSave} />);

    await user.click(await screen.findByRole('button', { name: 'connectors.form.auth.clearCredentials' }));
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
