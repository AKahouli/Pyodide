import { act, render as renderCollapsed, screen, waitFor } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import userEvent from '@testing-library/user-event';
import { vi, describe, expect, it, beforeEach } from 'vitest';
import type { ConnectorOAuthStatusResponse, ConnectorResponse, McpInspectResult } from '../../types';
import { getConnectorAppOAuthStatus, getConnectorCategories, inspectMcp } from '../../api';
import en from '../../locales/en.json';
import fr from '../../locales/fr.json';
import ar from '../../locales/ar.json';
import { getAdminConnectedApps } from '@/modules/connected-app/api';
import { CreateEditConnectorDialog } from './CreateEditConnectorDialog';
import type { ConnectorSecurityPolicy } from './connector-form-schema';
import { securityPolicyChanged, serializeConnectorSecretFields } from './connector-form-schema';

const hasPermission = vi.hoisted(() => vi.fn(() => true));
it('detects workspace authorization changes without treating absent and false as different authority', () => {
  const policy: ConnectorSecurityPolicy = { version: 1, profile: 'internal_jwt', audience: 'mcp-logical-search', actorDelegation: 'verified_user', allowPrivateNetwork: true, allowInsecureHttp: false, requiredPermissions: [] };
  expect(securityPolicyChanged({ ...policy, workspaceAuthorization: true }, policy)).toBe(true);
  expect(securityPolicyChanged(policy, { ...policy, workspaceAuthorization: true })).toBe(true);
  expect(securityPolicyChanged({ ...policy, workspaceAuthorization: false }, policy)).toBe(false);
});
vi.mock('../../hooks/usePermissions', () => ({ usePermissions: () => ({ hasPermission }) }));
beforeEach(() => {
  hasPermission.mockReturnValue(true);
  // An existing connector refreshes its provider connection status on load; an
  // unmocked undefined response would throw while React reduces that state.
  vi.mocked(getConnectorAppOAuthStatus).mockResolvedValue({ connected: false } as ConnectorOAuthStatusResponse);
});

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
  it('has localized concrete guidance for the editable field inventory and static options', () => {
    const fields = ['slug', 'name', 'description', 'category', 'icon', 'color', 'iconMode', 'iconClear', 'url', 'transport', 'source', 'app', 'audience', 'private', 'http', 'permissions', 'token', 'clearCredential', 'strategy', 'headerName', 'headerKey', 'mappingValue', 'envKey', 'removeMapping', 'serverConfig', 'dynamicName', 'dynamicSource', 'dynamicEnabled', 'dynamicRemove', 'toolEnabled', 'toolSelect', 'resultKind', 'citationMode', 'itemsPath', 'resultField', 'skills', 'active', 'hidden', 'system', 'inspect', 'connect', 'disconnect', 'addHeaderMapping', 'addEnvMapping', 'addDynamic'];
    const options = ['option.public', 'option.configured', 'option.internal_jwt', 'option.credential', 'option.connected_app', 'option.none', 'option.streamable_http', 'option.sse', 'option.http_header_bearer', 'option.custom_headers', 'option.env_vars', 'option.categoryAdd', 'option.categoryNone', 'option.appNone', 'result.generic', 'result.web_search', 'result.web_fetch', 'result.document_search', 'result.file_read', 'result.database_query', 'citation.none', 'citation.source_only', 'citation.text_fragment', 'citation.document_evidence', 'dynamic.workspace', 'dynamic.user_id', 'dynamic.user_email', 'dynamic.user_first_name', 'dynamic.user_last_name', 'dynamic.user_full_name', 'access.inherit', 'access.allow', 'access.block', 'kind.inherit', 'kind.leaf', 'kind.orchestration', 'kind.unknown'];
    for (const key of [...fields, ...options]) {
      for (const locale of [en, fr, ar]) {
        const text = (locale as Record<string, string>)[`connectors.help.${key}`];
        expect(text, key).toBeTruthy();
        expect(text.length, key).toBeGreaterThan(locale === ar ? 20 : 35);
        if (locale === ar) expect(text, key).toMatch(/[\u0600-\u06ff]/);
        expect(text).not.toContain('connectors.help.');
      }
    }
  });

  it('explains keyboard-highlighted static Select options without changing their names', async () => {
    const user = userEvent.setup();
    render(<CreateEditConnectorDialog open onOpenChange={vi.fn()} connector={connector} onSave={vi.fn()} />);
    await user.click(screen.getByLabelText('connectors.form.fields.transportType.label'));
    const sse = screen.getByRole('option', { name: 'SSE (Server-Sent Events)' });
    await user.keyboard('{End}');
    expect(sse).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('connectors.help.option.sse');
    expect(sse).toHaveAccessibleDescription('connectors.help.option.sse');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('uses actual dynamic category descriptions on pointer and keyboard without exposing stored secrets', async () => {
    const user = userEvent.setup();
    vi.mocked(getConnectorCategories).mockResolvedValueOnce([{ id: 'category-run-help', name: 'Operations', description: 'Tools for incident response and service operations.', isSystem: false, createdBy: '', createdAt: '', updatedAt: '' }]);
    render(<CreateEditConnectorDialog open onOpenChange={vi.fn()} connector={{ ...connector, categoryId: 'category-run-help', credentialConfigured: true }} onSave={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'connectors.help.categoryLabel' })).toHaveTextContent('Operations'));
    await user.click(screen.getByRole('combobox', { name: 'connectors.help.categoryLabel' }));
    const option = screen.getByRole('option', { name: 'Operations' });
    act(() => option.focus());
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Tools for incident response and service operations.');
    expect(screen.queryByLabelText('connectors.form.auth.accessToken')).not.toBeInTheDocument();
    await user.hover(option);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Tools for incident response and service operations.');
  });

  it('shows provider descriptions, never provider secrets, in dynamic connected-app option help', async () => {
    const user = userEvent.setup();
    vi.mocked(getAdminConnectedApps).mockResolvedValueOnce([{
      id: 'app-help-run', appKey: 'help-provider', displayName: 'Help Provider', description: 'Connect your account to use the configured provider.', clientId: 'private-client-id', clientSecret: 'run-owned-secret-never-in-help', authorizationUrl: 'https://provider.example.test/authorize', tokenUrl: 'https://provider.example.test/token', scopes: [], pkceEnabled: true, enabled: true, sortOrder: 0, connectedUserCount: 0, createdAt: '', updatedAt: '',
    }]);
    render(<CreateEditConnectorDialog open onOpenChange={vi.fn()} connector={{ ...connector, authSourceType: 'connected_app', connectedAppKey: 'help-provider' }} onSave={vi.fn()} />);
    const app = screen.getByRole('combobox', { name: 'connectors.form.auth.connectedAppLabel' });
    await waitFor(() => expect(app).toHaveTextContent('Help Provider'));
    await user.click(app);
    const option = screen.getByRole('option', { name: 'Help Provider' });
    await user.hover(option);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Connect your account to use the configured provider.');
    expect(document.body).not.toHaveTextContent('run-owned-secret-never-in-help');
    expect(document.body).not.toHaveTextContent('private-client-id');
  });

  it('renders field and operational guidance throughout the expanded editor without displaying it at rest', () => {
    render(<CreateEditConnectorDialog open onOpenChange={vi.fn()} connector={connector} onSave={vi.fn()} />);
    for (const key of ['slug', 'name', 'url', 'transport', 'source', 'description', 'category', 'icon', 'color', 'permissions', 'private', 'serverConfig', 'addDynamic', 'inspect', 'resultKind', 'citationMode', 'skills', 'active', 'hidden', 'system']) {
      expect(screen.getByRole('button', { name: `connectors.help.${key}` })).toBeVisible();
    }
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(screen.getByText('connectors.form.fields.serverConfig.preservedHelper')).toBeVisible();
  });

  it('allows the advanced fieldset to shrink and stacks dynamic header names on mobile', () => {
    render(<CreateEditConnectorDialog open onOpenChange={vi.fn()} connector={{ ...connector, dynamicHeaders: [{ headerName: 'X-User-Id', source: 'user_id', enabled: true }] }} onSave={vi.fn()} />);
    const header = screen.getByPlaceholderText('connectors.help.dynamicPlaceholder');
    expect(header.closest('fieldset')).toHaveClass('min-w-0');
    expect(header.closest('details')).toHaveClass('min-w-0');
    expect(header).toHaveClass('col-span-3', 'sm:col-span-1');
    expect(header.parentElement).toHaveClass('grid-cols-[minmax(0,1fr)_auto_auto]', 'sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto]');
  });

  it('opens field guidance on keyboard focus and pointer hover without hiding operational warnings', async () => {
    const user = userEvent.setup();
    render(<CreateEditConnectorDialog open onOpenChange={vi.fn()} connector={connector} onSave={vi.fn()} />);
    expect(screen.queryByText('connectors.form.auth.securityProfileHelper')).not.toBeInTheDocument();
    const profileHelp = screen.getByRole('button', { name: 'connectors.form.auth.securityProfile' });
    act(() => profileHelp.focus());
    expect(await screen.findByRole('tooltip')).toHaveTextContent('connectors.form.auth.securityProfileHelper');
    expect(profileHelp).toHaveAccessibleDescription('connectors.form.auth.securityProfileHelper');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    act(() => profileHelp.blur());
    const headerHelp = screen.getByRole('button', { name: 'connectors.form.dynamicHeaders.helper' });
    await user.hover(headerHelp);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('connectors.form.dynamicHeaders.helper');
    await user.hover(screen.getByRole('button', { name: 'connectors.form.inspect.action' }));
    screen.getAllByText('connectors.form.inspect.saveFirst').forEach((node) => expect(node).toBeVisible());
  });

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

  const internalPolicy: ConnectorSecurityPolicy = { version: 1, profile: 'internal_jwt', audience: 'custom-recipient', actorDelegation: 'verified_user', allowPrivateNetwork: false, allowInsecureHttp: false, requiredPermissions: ['connectors.read'] };

  it('explicitly toggles workspace scope with revision fencing and requires saving before inspection', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<CreateEditConnectorDialog open onOpenChange={vi.fn()} connector={{ ...connector, mcpSecurityPolicy: internalPolicy, securityRevision: 8 }} onSave={onSave} />);
    const scope = screen.getByRole('switch', { name: 'connectors.form.security.workspaceAuthorization' });
    expect(scope).toHaveAccessibleDescription('connectors.form.security.workspaceAuthorizationHelper');
    await user.click(scope);
    expect(scope).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'connectors.form.dialog.update' }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ expectedSecurityRevision: 8, mcpSecurityPolicy: { ...internalPolicy, workspaceAuthorization: true } }));
    await user.click(scope);
    expect(scope).not.toBeChecked();
  });

  it.each([
    { profile: 'public' as const },
    { actorDelegation: 'none' as const },
    { audience: '' },
  ])('disables workspace opt-in without eligible authority %j', (override) => {
    render(<CreateEditConnectorDialog open onOpenChange={vi.fn()} connector={{ ...connector, mcpSecurityPolicy: { ...internalPolicy, ...override } }} onSave={vi.fn()} />);
    expect(screen.getByRole('switch', { name: 'connectors.form.security.workspaceAuthorization' })).toBeDisabled();
  });

  it('revokes configured workspace authority with a valid nondelegated policy', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<CreateEditConnectorDialog open onOpenChange={vi.fn()} connector={{ ...connector, mcpSecurityPolicy: { ...internalPolicy, profile: 'configured', workspaceAuthorization: true }, securityRevision: 8 }} onSave={onSave} />);
    await user.click(screen.getByRole('switch', { name: 'connectors.form.security.workspaceAuthorization' }));
    await user.click(screen.getByRole('button', { name: 'connectors.form.dialog.update' }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ expectedSecurityRevision: 8, mcpSecurityPolicy: { ...internalPolicy, profile: 'configured', workspaceAuthorization: false, actorDelegation: 'none', audience: undefined } }));
  });

  it('hides workspace authority from editors without security permission', () => {
    hasPermission.mockReturnValue(false);
    render(<CreateEditConnectorDialog open onOpenChange={vi.fn()} connector={{ ...connector, mcpSecurityPolicy: internalPolicy }} onSave={vi.fn()} />);
    expect(screen.queryByRole('switch', { name: 'connectors.form.security.workspaceAuthorization' })).not.toBeInTheDocument();
  });

  it('retains explicit workspace authorization when moving configured assertions to internal JWT and changing credentials', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const policy = { ...internalPolicy, profile: 'configured' as const, workspaceAuthorization: true };
    render(<CreateEditConnectorDialog open onOpenChange={vi.fn()} connector={{ ...connector, authSourceType: 'credential', mcpSecurityPolicy: policy, securityRevision: 7 }} onSave={onSave} />);
    await user.click(screen.getByText('connectors.form.securityProfile.configured').closest('button')!);
    await user.click(screen.getByRole('option', { name: 'connectors.form.securityProfile.internalJwt' }));
    await user.click(screen.getByText('connectors.form.auth.savedCredential').closest('button')!);
    await user.click(screen.getByRole('option', { name: 'connectors.form.auth.noAuthSource' }));
    await user.click(screen.getByRole('button', { name: 'connectors.form.dialog.update' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ mcpSecurityPolicy: { ...policy, profile: 'internal_jwt' }, expectedSecurityRevision: 7 }));
  });

  it('preserves workspace opt-in on unrelated policy edits and omits unchanged policy on metadata saves', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const policy = { ...internalPolicy, workspaceAuthorization: true };
    render(<CreateEditConnectorDialog open onOpenChange={vi.fn()} connector={{ ...connector, authSourceType: 'credential', mcpSecurityPolicy: policy, securityRevision: 7 }} onSave={onSave} />);
    await user.type(screen.getByPlaceholderText('connectors.form.fields.name.placeholder'), ' renamed');
    await user.click(screen.getByRole('button', { name: 'connectors.form.dialog.update' }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ mcpSecurityPolicy: undefined, expectedSecurityRevision: 7 }));
    await user.click(screen.getByLabelText('connectors.form.security.allowInsecureHttp'));
    await user.click(screen.getByRole('button', { name: 'connectors.form.dialog.update' }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ mcpSecurityPolicy: { ...policy, allowInsecureHttp: true } }));
  });

  it.each(['public', 'configured'] as const)('explicitly clears workspace authorization when %s removes delegation', async (profile) => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<CreateEditConnectorDialog open onOpenChange={vi.fn()} connector={{ ...connector, mcpSecurityPolicy: { ...internalPolicy, workspaceAuthorization: true }, securityRevision: 7 }} onSave={onSave} />);
    await user.click(screen.getByText('connectors.form.securityProfile.internalJwt').closest('button')!);
    await user.click(screen.getByRole('option', { name: `connectors.form.securityProfile.${profile}` }));
    await user.click(screen.getByRole('button', { name: 'connectors.form.dialog.update' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ mcpSecurityPolicy: expect.objectContaining({ profile, actorDelegation: 'none', workspaceAuthorization: false }) }));
  });

  it('explicitly clears configured workspace authorization on incompatible transport', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const policy = { ...internalPolicy, profile: 'configured' as const, workspaceAuthorization: true };
    render(<CreateEditConnectorDialog open onOpenChange={vi.fn()} connector={{ ...connector, mcpSecurityPolicy: policy, securityRevision: 7 }} onSave={onSave} />);
    await user.click(screen.getByLabelText('connectors.form.fields.transportType.label'));
    await user.click(screen.getByRole('option', { name: /SSE/ }));
    await user.click(screen.getByRole('button', { name: 'connectors.form.dialog.update' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ mcpTransportType: 'sse', mcpSecurityPolicy: { ...policy, workspaceAuthorization: false, actorDelegation: 'none', audience: undefined } }));
  });

  it('preserves configured workspace delegation across compatible credential changes', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const policy = { ...internalPolicy, profile: 'configured' as const, workspaceAuthorization: true };
    render(<CreateEditConnectorDialog open onOpenChange={vi.fn()} connector={{ ...connector, authSourceType: 'credential', mcpSecurityPolicy: policy, securityRevision: 7 }} onSave={onSave} />);
    await user.click(screen.getByText('connectors.form.auth.savedCredential').closest('button')!);
    await user.click(screen.getByRole('option', { name: 'connectors.form.auth.connectedAccount' }));
    await user.click(screen.getByRole('button', { name: 'connectors.form.dialog.update' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ authSourceType: 'connected_app', mcpSecurityPolicy: undefined }));
    // A policy edit serializes the retained flag and delegation, not inferred defaults.
    await user.click(screen.getByLabelText('connectors.form.security.allowPrivateNetwork'));
    await user.click(screen.getByRole('button', { name: 'connectors.form.dialog.update' }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ mcpSecurityPolicy: { ...policy, allowPrivateNetwork: true } }));
  });

  it('never infers workspace authorization from the Logical Search audience', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<CreateEditConnectorDialog open onOpenChange={vi.fn()} connector={{ ...connector, mcpSecurityPolicy: { ...internalPolicy, profile: 'configured', audience: 'mcp-logical-search' }, securityRevision: 7 }} onSave={onSave} />);
    await user.click(screen.getByText('connectors.form.securityProfile.configured').closest('button')!);
    await user.click(screen.getByRole('option', { name: 'connectors.form.securityProfile.internalJwt' }));
    await user.click(screen.getByRole('button', { name: 'connectors.form.dialog.update' }));
    expect(onSave.mock.calls[0][0].mcpSecurityPolicy).not.toHaveProperty('workspaceAuthorization');
  });

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
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ mcpSecurityPolicy: { version: 1, profile: 'public', actorDelegation: 'none', allowPrivateNetwork: false, allowInsecureHttp: false, requiredPermissions: [] } }));
    const method = screen.getByText('connectors.form.auth.noAuthSource').closest('button')!;
    await user.click(method);
    await user.click(screen.getByRole('option', { name: 'connectors.form.auth.connectedAccount' }));
    expect(screen.getByText('connectors.form.auth.connectedAppLabel')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'connectors.form.dialog.create' }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ authSourceType: 'connected_app', mcpSecurityPolicy: expect.objectContaining({ profile: 'configured', actorDelegation: 'none' }) }));
  });

  it('keeps the security profile independent of the auth source and sends both credentials together', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<CreateEditConnectorDialog open onOpenChange={vi.fn()} connector={null} onSave={onSave} />);

    // Pick the verified-user identity first, then a provider credential: the
    // credential choice must not drop the profile or its audience.
    await user.click(screen.getByText('connectors.form.securityProfile.public').closest('button')!);
    await user.click(screen.getByRole('option', { name: 'connectors.form.securityProfile.internalJwt' }));
    await user.type(screen.getByLabelText('connectors.form.security.audience'), 'mcp-sharepoint');

    await user.type(screen.getByPlaceholderText('connectors.form.fields.slug.placeholder'), 'sharepoint');
    await user.type(screen.getByPlaceholderText('connectors.form.fields.name.placeholder'), 'SharePoint');
    await user.type(screen.getByLabelText('connectors.form.fields.serverUrl.label'), 'https://mcp.example.test/mcp');

    await user.click(screen.getByText('connectors.form.auth.noAuthSource').closest('button')!);
    await user.click(screen.getByRole('option', { name: 'connectors.form.auth.connectedAccount' }));
    expect(screen.getByText('connectors.form.securityProfile.internalJwt')).toBeInTheDocument();

    // A raw provider token header: the empty prefix must survive the save.
    await user.clear(screen.getByPlaceholderText('connectors.form.auth.headerNamePlaceholder'));
    await user.type(screen.getByPlaceholderText('connectors.form.auth.headerNamePlaceholder'), 'X-M365-Access-Token');
    await user.clear(screen.getByPlaceholderText('connectors.form.auth.headerPrefixPlaceholder'));

    await user.click(screen.getByRole('button', { name: 'connectors.form.dialog.create' }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({
      authSourceType: 'connected_app',
      mcpSecurityPolicy: expect.objectContaining({ profile: 'internal_jwt', actorDelegation: 'verified_user', audience: 'mcp-sharepoint' }),
      runtimeAuthConfig: JSON.stringify({ strategy: 'http_header_bearer', headerName: 'X-M365-Access-Token', headerPrefix: '' }),
    }));
  });

  it('defaults the provider header prefix to a raw token under the assertion profile', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<CreateEditConnectorDialog open onOpenChange={vi.fn()} connector={null} onSave={onSave} />);

    await user.click(screen.getByText('connectors.form.securityProfile.public').closest('button')!);
    await user.click(screen.getByRole('option', { name: 'connectors.form.securityProfile.internalJwt' }));
    await user.type(screen.getByLabelText('connectors.form.security.audience'), 'mcp-sharepoint');
    await user.type(screen.getByPlaceholderText('connectors.form.fields.slug.placeholder'), 'sharepoint');
    await user.type(screen.getByPlaceholderText('connectors.form.fields.name.placeholder'), 'SharePoint');
    await user.type(screen.getByLabelText('connectors.form.fields.serverUrl.label'), 'https://mcp.example.test/mcp');

    await user.click(screen.getByText('connectors.form.auth.noAuthSource').closest('button')!);
    await user.click(screen.getByRole('option', { name: 'connectors.form.auth.connectedAccount' }));

    // Selecting the profile is enough: the MCP server adds "Bearer " itself, so
    // an untouched prefix field must already hold the raw value.
    await user.clear(screen.getByPlaceholderText('connectors.form.auth.headerNamePlaceholder'));
    await user.type(screen.getByPlaceholderText('connectors.form.auth.headerNamePlaceholder'), 'X-M365-Access-Token');
    expect(screen.getByPlaceholderText('connectors.form.auth.headerPrefixPlaceholder')).toHaveValue('');

    await user.click(screen.getByRole('button', { name: 'connectors.form.dialog.create' }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({
      runtimeAuthConfig: JSON.stringify({ strategy: 'http_header_bearer', headerName: 'X-M365-Access-Token', headerPrefix: '' }),
    }));
  });

  it('keeps a typed provider header prefix across an assertion-profile round trip', async () => {
    const user = userEvent.setup();
    render(<CreateEditConnectorDialog open onOpenChange={vi.fn()} connector={null} onSave={vi.fn()} />);
    const prefixField = () => screen.getByPlaceholderText('connectors.form.auth.headerPrefixPlaceholder');

    await user.click(screen.getByText('connectors.form.auth.noAuthSource').closest('button')!);
    await user.click(screen.getByRole('option', { name: 'connectors.form.auth.connectedAccount' }));
    expect(prefixField()).toHaveValue('Bearer ');

    await user.click(screen.getByText('connectors.form.securityProfile.configured').closest('button')!);
    await user.click(screen.getByRole('option', { name: 'connectors.form.securityProfile.internalJwt' }));
    expect(prefixField()).toHaveValue('');

    // An admin override must survive leaving and re-entering the profile.
    await user.type(prefixField(), 'Token ');
    await user.click(screen.getByText('connectors.form.securityProfile.internalJwt').closest('button')!);
    await user.click(screen.getByRole('option', { name: 'connectors.form.securityProfile.configured' }));
    expect(prefixField()).toHaveValue('Token ');

    await user.click(screen.getByText('connectors.form.securityProfile.configured').closest('button')!);
    await user.click(screen.getByRole('option', { name: 'connectors.form.securityProfile.internalJwt' }));
    expect(prefixField()).toHaveValue('Token ');
  });

  it('restores the plain bearer prefix when the profile stops being an assertion', async () => {
    const user = userEvent.setup();
    render(<CreateEditConnectorDialog open onOpenChange={vi.fn()} connector={null} onSave={vi.fn()} />);
    const prefixField = () => screen.getByPlaceholderText('connectors.form.auth.headerPrefixPlaceholder');

    await user.click(screen.getByText('connectors.form.auth.noAuthSource').closest('button')!);
    await user.click(screen.getByRole('option', { name: 'connectors.form.auth.connectedAccount' }));
    expect(prefixField()).toHaveValue('Bearer ');

    await user.click(screen.getByText('connectors.form.securityProfile.configured').closest('button')!);
    await user.click(screen.getByRole('option', { name: 'connectors.form.securityProfile.internalJwt' }));
    expect(prefixField()).toHaveValue('');

    await user.click(screen.getByText('connectors.form.securityProfile.internalJwt').closest('button')!);
    await user.click(screen.getByRole('option', { name: 'connectors.form.securityProfile.configured' }));
    expect(prefixField()).toHaveValue('Bearer ');
  });

  it('preserves an explicitly empty provider header prefix across a profile round trip', async () => {
    const user = userEvent.setup();
    render(<CreateEditConnectorDialog open onOpenChange={vi.fn()} connector={null} onSave={vi.fn()} />);
    const prefixField = () => screen.getByPlaceholderText('connectors.form.auth.headerPrefixPlaceholder');

    await user.click(screen.getByText('connectors.form.auth.noAuthSource').closest('button')!);
    await user.click(screen.getByRole('option', { name: 'connectors.form.auth.connectedAccount' }));
    await user.clear(prefixField());
    expect(prefixField()).toHaveValue('');

    await user.click(screen.getByText('connectors.form.securityProfile.configured').closest('button')!);
    await user.click(screen.getByRole('option', { name: 'connectors.form.securityProfile.internalJwt' }));
    expect(prefixField()).toHaveValue('');

    // A deliberate empty prefix means "send the raw token"; leaving the profile
    // must not put a scheme back into it.
    await user.click(screen.getByText('connectors.form.securityProfile.internalJwt').closest('button')!);
    await user.click(screen.getByRole('option', { name: 'connectors.form.securityProfile.configured' }));
    expect(prefixField()).toHaveValue('');
  });

  it('keeps an explicitly typed bearer prefix under the assertion profile', async () => {
    const user = userEvent.setup();
    render(<CreateEditConnectorDialog open onOpenChange={vi.fn()} connector={null} onSave={vi.fn()} />);
    const prefixField = () => screen.getByPlaceholderText('connectors.form.auth.headerPrefixPlaceholder');

    await user.click(screen.getByText('connectors.form.auth.noAuthSource').closest('button')!);
    await user.click(screen.getByRole('option', { name: 'connectors.form.auth.connectedAccount' }));
    await user.click(screen.getByText('connectors.form.securityProfile.configured').closest('button')!);
    await user.click(screen.getByRole('option', { name: 'connectors.form.securityProfile.internalJwt' }));
    expect(prefixField()).toHaveValue('');

    // Explicitly typing the default value is still an explicit choice.
    await user.type(prefixField(), 'Bearer ');
    expect(prefixField()).toHaveValue('Bearer ');
    await user.click(screen.getByText('connectors.form.securityProfile.internalJwt').closest('button')!);
    await user.click(screen.getByRole('option', { name: 'connectors.form.securityProfile.configured' }));
    expect(prefixField()).toHaveValue('Bearer ');
    await user.click(screen.getByText('connectors.form.securityProfile.configured').closest('button')!);
    await user.click(screen.getByRole('option', { name: 'connectors.form.securityProfile.internalJwt' }));
    expect(prefixField()).toHaveValue('Bearer ');
  });

  it('delivers a raw literal credential under the assertion profile without touching the prefix', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<CreateEditConnectorDialog open onOpenChange={vi.fn()} connector={null} onSave={onSave} />);

    await user.type(screen.getByPlaceholderText('connectors.form.fields.slug.placeholder'), 'sharepoint');
    await user.type(screen.getByPlaceholderText('connectors.form.fields.name.placeholder'), 'SharePoint');
    await user.type(screen.getByLabelText('connectors.form.fields.serverUrl.label'), 'https://mcp.example.test/mcp');
    await user.click(screen.getByText('connectors.form.auth.noAuthSource').closest('button')!);
    await user.click(screen.getByRole('option', { name: 'connectors.form.auth.savedCredential' }));
    await user.type(screen.getByLabelText('connectors.form.auth.accessToken'), 'raw-token');
    await user.click(screen.getByText('connectors.form.securityProfile.configured').closest('button')!);
    await user.click(screen.getByRole('option', { name: 'connectors.form.securityProfile.internalJwt' }));
    await user.type(screen.getByLabelText('connectors.form.security.audience'), 'mcp-sharepoint');
    await user.clear(screen.getByPlaceholderText('connectors.form.auth.headerNamePlaceholder'));
    await user.type(screen.getByPlaceholderText('connectors.form.auth.headerNamePlaceholder'), 'X-M365-Access-Token');

    await user.click(screen.getByRole('button', { name: 'connectors.form.dialog.create' }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({
      runtimeAuthConfig: JSON.stringify({ strategy: 'custom_headers', headerMappings: { 'X-M365-Access-Token': 'raw-token' } }),
    }));
  });

  it('applies the raw prefix default when the assertion profile is chosen last', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<CreateEditConnectorDialog open onOpenChange={vi.fn()} connector={null} onSave={onSave} />);
    const prefixField = () => screen.getByPlaceholderText('connectors.form.auth.headerPrefixPlaceholder');

    // Admin order: method first, then header name, then the identity profile.
    await user.click(screen.getByText('connectors.form.auth.noAuthSource').closest('button')!);
    await user.click(screen.getByRole('option', { name: 'connectors.form.auth.connectedAccount' }));
    expect(prefixField()).toHaveValue('Bearer ');
    await user.clear(screen.getByPlaceholderText('connectors.form.auth.headerNamePlaceholder'));
    await user.type(screen.getByPlaceholderText('connectors.form.auth.headerNamePlaceholder'), 'X-M365-Access-Token');
    await user.click(screen.getByText('connectors.form.securityProfile.configured').closest('button')!);
    await user.click(screen.getByRole('option', { name: 'connectors.form.securityProfile.internalJwt' }));
    expect(prefixField()).toHaveValue('');

    await user.type(screen.getByPlaceholderText('connectors.form.fields.slug.placeholder'), 'sharepoint');
    await user.type(screen.getByPlaceholderText('connectors.form.fields.name.placeholder'), 'SharePoint');
    await user.type(screen.getByLabelText('connectors.form.fields.serverUrl.label'), 'https://mcp.example.test/mcp');
    await user.type(screen.getByLabelText('connectors.form.security.audience'), 'mcp-sharepoint');
    await user.click(screen.getByRole('button', { name: 'connectors.form.dialog.create' }));

    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({
      mcpSecurityPolicy: expect.objectContaining({ profile: 'internal_jwt' }),
      runtimeAuthConfig: JSON.stringify({ strategy: 'http_header_bearer', headerName: 'X-M365-Access-Token', headerPrefix: '' }),
    }));
  });

  it('refuses to save an assertion profile whose provider credential would land in Authorization', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<CreateEditConnectorDialog open onOpenChange={vi.fn()} connector={null} onSave={onSave} />);

    await user.click(screen.getByText('connectors.form.securityProfile.public').closest('button')!);
    await user.click(screen.getByRole('option', { name: 'connectors.form.securityProfile.internalJwt' }));
    await user.type(screen.getByLabelText('connectors.form.security.audience'), 'mcp-sharepoint');
    await user.type(screen.getByPlaceholderText('connectors.form.fields.slug.placeholder'), 'sharepoint');
    await user.type(screen.getByPlaceholderText('connectors.form.fields.name.placeholder'), 'SharePoint');
    await user.type(screen.getByLabelText('connectors.form.fields.serverUrl.label'), 'https://mcp.example.test/mcp');

    await user.click(screen.getByText('connectors.form.auth.noAuthSource').closest('button')!);
    await user.click(screen.getByRole('option', { name: 'connectors.form.auth.connectedAccount' }));

    // The default delivery header is Authorization, which the assertion replaces.
    expect(screen.getByPlaceholderText('connectors.form.auth.headerNamePlaceholder')).toHaveValue('Authorization');
    await user.click(screen.getByRole('button', { name: 'connectors.form.dialog.create' }));
    expect(onSave).not.toHaveBeenCalled();

    await user.clear(screen.getByPlaceholderText('connectors.form.auth.headerNamePlaceholder'));
    await user.type(screen.getByPlaceholderText('connectors.form.auth.headerNamePlaceholder'), 'X-M365-Access-Token');
    await user.click(screen.getByRole('button', { name: 'connectors.form.dialog.create' }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('saves a metadata-only update of a combined connector without re-delivering its provider header', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    // The stored delivery config never round-trips, so the form shows the
    // default header; a name-only update must not be rejected on that basis.
    const combined = {
      ...connector,
      authSourceType: 'connected_app' as const,
      connectedAppKey: 'microsoft',
      mcpSecurityPolicy: { ...internalPolicy, audience: 'mcp-sharepoint', allowPrivateNetwork: true, requiredPermissions: [] },
    };
    render(<CreateEditConnectorDialog open onOpenChange={vi.fn()} connector={combined} onSave={onSave} />);

    expect(await screen.findByRole('switch', { name: 'connectors.form.fields.hidden.label' })).not.toBeChecked();
    expect(screen.getByPlaceholderText('connectors.form.fields.name.placeholder')).toHaveValue('Files');
    await user.click(screen.getByRole('button', { name: 'connectors.form.dialog.update' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: 'Files', runtimeAuthConfig: '' }));
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
    { actorDelegation: 'none' as const, requiredPermissions: [], allowInsecureHttp: true },
  ])('locks configured privileged destinations for ordinary editors: %j', (flags) => {
    hasPermission.mockReturnValue(false);
    render(<CreateEditConnectorDialog open onOpenChange={vi.fn()} connector={{ ...connector, mcpSecurityPolicy: { ...internalPolicy, profile: 'configured', audience: undefined, ...flags } }} onSave={vi.fn()} />);
    expect(screen.getByLabelText('connectors.form.fields.serverUrl.label')).toBeDisabled();
  });

  it('preserves the insecure-HTTP toggle through an authorized save', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<CreateEditConnectorDialog open onOpenChange={vi.fn()} connector={{ ...connector, authSourceType: 'credential', credentialConfigured: true, mcpSecurityPolicy: { ...internalPolicy, profile: 'configured', audience: undefined, allowInsecureHttp: true } }} onSave={onSave} />);
    await user.click(screen.getByText('connectors.form.security.details'));
    expect(screen.getByLabelText('connectors.form.security.allowInsecureHttp')).toBeChecked();
    await user.click(screen.getByLabelText('connectors.form.security.allowInsecureHttp'));
    await user.click(screen.getByRole('button', { name: 'connectors.form.dialog.update' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ mcpSecurityPolicy: expect.objectContaining({ allowInsecureHttp: false }) }));
  });

  it('clears the insecure-HTTP grant when the method changes to public access', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<CreateEditConnectorDialog open onOpenChange={vi.fn()} connector={{ ...connector, authSourceType: 'credential', credentialConfigured: true, mcpSecurityPolicy: { ...internalPolicy, profile: 'configured', audience: undefined, allowInsecureHttp: true } }} onSave={onSave} />);
    await user.click(screen.getByText('connectors.form.securityProfile.configured').closest('button')!);
    await user.click(screen.getByRole('option', { name: 'connectors.form.securityProfile.public' }));
    await user.click(screen.getByRole('button', { name: 'connectors.form.dialog.update' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ authSourceType: 'none', mcpSecurityPolicy: expect.objectContaining({ profile: 'public', allowInsecureHttp: false }) }));
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
    // Profile and credential are independent controls: drop the provider
    // credential first, then change the identity profile.
    await user.click(screen.getByText('connectors.form.auth.savedCredential').closest('button')!);
    await user.click(screen.getByRole('option', { name: 'connectors.form.auth.noAuthSource' }));
    if (profile === 'internal_jwt') {
      await user.click(screen.getByText('connectors.form.securityProfile.public').closest('button')!);
      await user.click(screen.getByRole('option', { name: 'connectors.form.securityProfile.internalJwt' }));
      await user.type(screen.getByLabelText('connectors.form.security.audience'), 'custom-recipient');
    }
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
