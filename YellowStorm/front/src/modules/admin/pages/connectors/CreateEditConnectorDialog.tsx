import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { MultiSelect } from '@/components/ui/multi-select';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type {
  ConnectorResponse,
  ConnectorActionResponse,
  ConnectorCategoryResponse,
  ConnectorDynamicHeader,
  ConnectorDynamicHeaderSource,
  SkillResponse,
  McpToolDefinition,
} from '../../types';
import type { ConnectorFormValues, DynamicHeaderRow } from './connector-form-schema';
import { defaultConnectorFormValues } from './connector-form-schema';
import { buildMcpServerConfig, parseMcpServerConfig } from './mcp-server-config';
import { ExternalLink, Loader2, Plus, TestTube2, Trash2, Github, X } from 'lucide-react';
import { IconPickerPreview } from './IconDisplay';
import { ColorPicker } from './ColorPicker';
import { ManageCategoriesDialog } from './ManageCategoriesDialog';
import { toast } from 'sonner';
import {
  authorizeConnectorAppOAuth,
  disconnectConnectorAppOAuth,
  getConnectorAppOAuthStatus,
  getConnectorCategories,
  getSkills,
  inspectMcp,
} from '../../api';
import { useModuleTranslation } from '@/modules/localization';
import { getAdminConnectedApps } from '@/modules/connected-app/api';
import type { ConnectedAppAdminResponse } from '@/modules/connected-app/types';

const ADD_CATEGORY_VALUE = '__add_category__';

const AUTH_SOURCE_TYPES = [
  { value: 'credential', label: 'Credential' },
  { value: 'connected_app', label: 'Connected App' },
  { value: 'none', label: 'None' },
];

const TRANSPORT_TYPES = [
  { value: 'streamable_http', label: 'Streamable HTTP' },
  { value: 'sse', label: 'SSE (Server-Sent Events)' },
  { value: 'stdio', label: 'Stdio (local command)' },
];

const RUNTIME_AUTH_STRATEGIES = [
  { value: 'http_header_bearer', label: 'Bearer header' },
  { value: 'custom_headers', label: 'Custom headers' },
  { value: 'env_vars', label: 'Environment variables' },
];

const DYNAMIC_HEADER_SOURCES: Array<{ value: ConnectorDynamicHeaderSource; label: string }> = [
  { value: 'user_id', label: 'User ID' },
  { value: 'user_email', label: 'User email' },
  { value: 'user_first_name', label: 'User first name' },
  { value: 'user_last_name', label: 'User last name' },
  { value: 'user_full_name', label: 'User full name' },
];

function createDynamicHeaderRow(
  headerName = '',
  source: ConnectorDynamicHeaderSource = 'user_id',
  enabled = true,
): DynamicHeaderRow {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    headerName,
    source,
    enabled,
  };
}

function dynamicHeadersToRows(headers?: ConnectorDynamicHeader[]): DynamicHeaderRow[] {
  return (headers || []).map((h) => createDynamicHeaderRow(h.headerName, h.source, h.enabled !== false));
}

function dynamicRowsToPayload(rows: DynamicHeaderRow[]): ConnectorDynamicHeader[] {
  return rows
    .map((row) => ({
      headerName: row.headerName.trim(),
      source: row.source,
      enabled: row.enabled,
    }))
    .filter((row) => row.headerName.length > 0);
}

const CONNECTOR_ACTION_KEY_MAX_LENGTH = 128;
const CONNECTOR_ACTION_LABEL_MAX_LENGTH = 128;
const CONNECTOR_ACTION_DESCRIPTION_MAX_LENGTH = 1024;

function createMappingRow(key = '', value = '') {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    key,
    value,
  };
}

function objectToMappingRows(source?: Record<string, unknown>) {
  return Object.entries(source || {}).map(([key, value]) => createMappingRow(key, String(value)));
}

function mappingRowsToObject(rows: Array<{ key: string; value: string }>) {
  return rows.reduce<Record<string, string>>((acc, row) => {
    const key = row.key.trim();
    if (key && row.value.trim()) {
      acc[key] = row.value;
    }
    return acc;
  }, {});
}

function parseRuntimeAuthConfig(config?: Record<string, unknown>) {
  const strategy = typeof config?.strategy === 'string' ? config.strategy : 'http_header_bearer';
  return {
    runtimeAuthConfig: config && Object.keys(config).length > 0 ? JSON.stringify(config, null, 2) : '',
    runtimeAuthStrategy: strategy,
    runtimeHeaderName: typeof config?.headerName === 'string' ? config.headerName : 'Authorization',
    runtimeHeaderPrefix: typeof config?.headerPrefix === 'string' ? config.headerPrefix : 'Bearer ',
    runtimeHeaderMappings: objectToMappingRows((config?.headerMappings as Record<string, unknown>) || undefined),
    runtimeEnvMappings: objectToMappingRows((config?.envMap as Record<string, unknown>) || undefined),
  };
}

function buildRuntimeAuthConfig(form: ConnectorFormValues): Record<string, unknown> | undefined {
  if (form.authSourceType === 'none') {
    return undefined;
  }

  if (form.runtimeAuthStrategy === 'custom_headers') {
    return {
      strategy: 'custom_headers',
      headerMappings: mappingRowsToObject(form.runtimeHeaderMappings),
    };
  }

  if (form.runtimeAuthStrategy === 'env_vars') {
    return {
      strategy: 'env_vars',
      envMap: mappingRowsToObject(form.runtimeEnvMappings),
    };
  }

  return {
    strategy: 'http_header_bearer',
    headerName: form.runtimeHeaderName.trim() || 'Authorization',
    headerPrefix: form.runtimeHeaderPrefix || 'Bearer ',
  };
}

function humanizeToolName(name: string) {
  return name.replace(/_/g, ' ').replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function truncateValue(value: string, maxLength: number) {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function mapInspectToolsToActions(tools: McpToolDefinition[]): ConnectorActionResponse[] {
  return tools.map((tool) => ({
    key: truncateValue(tool.name, CONNECTOR_ACTION_KEY_MAX_LENGTH),
    label: truncateValue(humanizeToolName(tool.name), CONNECTOR_ACTION_LABEL_MAX_LENGTH),
    description: truncateValue(tool.description ?? '', CONNECTOR_ACTION_DESCRIPTION_MAX_LENGTH),
    parameterSchema: tool.inputSchema ?? {},
    outputSchema: {},
    safety: 'read',
    supportsBatch: false,
    supportsIteration: false,
    isEnabled: true,
  }));
}

export function CreateEditConnectorDialog({
  open,
  onOpenChange,
  connector,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connector: ConnectorResponse | null;
  onSave: (data: ConnectorFormValues) => void;
}) {
  const { t } = useModuleTranslation('admin');
  const [form, setForm] = useState<ConnectorFormValues>({ ...defaultConnectorFormValues });
  const [inspecting, setInspecting] = useState(false);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [inspectTools, setInspectTools] = useState<McpToolDefinition[]>([]);
  const [availableSkills, setAvailableSkills] = useState<SkillResponse[]>([]);
  const [availableCategories, setAvailableCategories] = useState<ConnectorCategoryResponse[]>([]);
  const [showCategoriesDialog, setShowCategoriesDialog] = useState(false);
  const [connectedApps, setConnectedApps] = useState<ConnectedAppAdminResponse[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<Record<string, boolean>>({});
  const [oauthConnecting, setOauthConnecting] = useState(false);

  const refreshCategories = useCallback(() => {
    getConnectorCategories()
      .then((data) => setAvailableCategories(data))
      .catch(() => {});
  }, []);

  const refreshConnectionStatus = useCallback(async (appKey: string) => {
    try {
      const status = await getConnectorAppOAuthStatus(appKey);
      setConnectionStatus((prev) => ({ ...prev, [appKey]: status.connected }));
    } catch {
      setConnectionStatus((prev) => ({ ...prev, [appKey]: false }));
    }
  }, []);

  const getCurrentConnectedApp = useCallback(() => {
    return connectedApps.find((app) => app.appKey === form.connectedAppKey);
  }, [connectedApps, form.connectedAppKey]);

  const isCurrentAppConnected = useCallback(() => {
    return form.connectedAppKey ? connectionStatus[form.connectedAppKey] ?? false : false;
  }, [connectionStatus, form.connectedAppKey]);

  useEffect(() => {
    if (open) {
      setInspectError(null);
      setInspectTools([]);
      getSkills({ isActive: true, limit: 1000 })
        .then((result) => setAvailableSkills(result.data || []))
        .catch(() => setAvailableSkills([]));
      getConnectorCategories()
        .then((data) => setAvailableCategories(data))
        .catch(() => setAvailableCategories([]));
      getAdminConnectedApps()
        .then((apps) => {
          const enabledApps = apps.filter((app) => app.enabled);
          setConnectedApps(enabledApps);
          const initialStatus: Record<string, boolean> = {};
          enabledApps.forEach((app) => {
            initialStatus[app.appKey] = false;
          });
          setConnectionStatus(initialStatus);
        })
        .catch(() => {
          setConnectedApps([]);
          setConnectionStatus({});
        });

      if (connector) {
        const parsedRuntime = parseRuntimeAuthConfig(connector.runtimeAuthConfig);
        const parsedServerConfig = parseMcpServerConfig(connector.mcpServerConfig);
        setForm({
          slug: connector.slug,
          name: connector.name,
          description: connector.description,
          icon: connector.icon || '',
          color: connector.color || '',
          iconColor: connector.iconColor || 'light',
          categoryId: connector.categoryId || '',
          authType: connector.authType || 'none',
          authSourceType: connector.authSourceType || 'credential',
          connectedAppKey: connector.connectedAppKey || '',
          runtimeAuthConfig: parsedRuntime.runtimeAuthConfig,
          runtimeAuthStrategy: parsedRuntime.runtimeAuthStrategy,
          runtimeHeaderName: parsedRuntime.runtimeHeaderName,
          runtimeHeaderPrefix: parsedRuntime.runtimeHeaderPrefix,
          runtimeHeaderMappings: parsedRuntime.runtimeHeaderMappings,
          runtimeEnvMappings: parsedRuntime.runtimeEnvMappings,
          mcpTransportType: connector.mcpTransportType || 'streamable_http',
          mcpServerUrl: connector.mcpServerUrl || '',
          githubPatToken: parsedServerConfig.githubPatToken,
          mcpServerConfig: parsedServerConfig.serverConfigText,
          dynamicHeaders: dynamicHeadersToRows(connector.dynamicHeaders),
          actions: connector.actions || [],
          actionsJson: connector.actions ? JSON.stringify(connector.actions, null, 2) : '',
          referencedSkillIds: connector.referencedSkillIds || [],
          isActive: connector.isActive,
        });

        if (connector.connectedAppKey) {
          void refreshConnectionStatus(connector.connectedAppKey);
        }
      } else {
        setForm({ ...defaultConnectorFormValues });
      }
    }
  }, [open, connector, refreshConnectionStatus]);

  useEffect(() => {
    if (!open || !form.connectedAppKey) {
      return;
    }

    if (form.authSourceType === 'connected_app') {
      void refreshConnectionStatus(form.connectedAppKey);
    }
  }, [form.authSourceType, form.connectedAppKey, open, refreshConnectionStatus]);

  const handleSubmit = () => {
    if (!form.slug.trim() || !form.name.trim()) {
        toast.error(t('connectors.form.errors.slugNameRequired'));
      return;
    }

    if (!form.mcpServerUrl.trim()) {
      toast.error(t('connectors.form.errors.serverRequired'));
      return;
    }

    let actions: ConnectorActionResponse[] | undefined;
    if (form.actionsJson.trim()) {
      try {
        actions = JSON.parse(form.actionsJson);
        if (!Array.isArray(actions)) throw new Error('Must be an array');
      } catch {
        toast.error(t('connectors.form.errors.invalidActionsJson'));
        return;
      }
    }

    let mcpServerConfig: Record<string, unknown> | undefined;
    try {
      mcpServerConfig = form.mcpServerConfig.trim() ? (JSON.parse(form.mcpServerConfig) as Record<string, unknown>) : undefined;
    } catch {
      toast.error(t('connectors.form.errors.invalidServerConfigJson'));
      return;
    }

    const runtimeAuthConfig = buildRuntimeAuthConfig(form);

    onSave({
      ...form,
      actions: actions ?? [],
      mcpServerConfig: mcpServerConfig ? JSON.stringify(mcpServerConfig) : '',
      authType: form.authSourceType === 'connected_app' ? 'oauth2' : form.authSourceType === 'credential' ? 'token' : 'none',
      connectedAppKey: form.authSourceType === 'connected_app' ? form.connectedAppKey : '',
      runtimeAuthConfig: runtimeAuthConfig ? JSON.stringify(runtimeAuthConfig) : '',
    });
  };

  const handleInspect = async () => {
    if (!form.mcpServerUrl.trim()) {
      toast.error(t('connectors.form.errors.serverRequired'));
      return;
    }

    if (form.authSourceType === 'connected_app' && !isCurrentAppConnected()) {
      const app = getCurrentConnectedApp();
      toast.error(t('connectors.form.auth.connectRequired', { app: app?.displayName || form.connectedAppKey }));
      return;
    }

    let mcpServerConfig: Record<string, unknown> | undefined;
    try {
      mcpServerConfig = buildMcpServerConfig(form.mcpServerConfig, form.githubPatToken);
    } catch {
      toast.error(t('connectors.form.errors.invalidServerConfigJson'));
      return;
    }

    setInspecting(true);
    setInspectError(null);
    setInspectTools([]);
    try {
      const runtimeAuthConfig = buildRuntimeAuthConfig(form);
      const result = await inspectMcp(
        form.mcpTransportType,
        form.mcpServerUrl,
        mcpServerConfig,
        form.authSourceType === 'connected_app' ? form.connectedAppKey || undefined : undefined,
        runtimeAuthConfig,
      );
      if (result.error) {
        setInspectError(result.error);
        return;
      }
      setInspectTools(result.tools ?? []);
      const actions = mapInspectToolsToActions(result.tools ?? []);
      setForm((current) => ({
        ...current,
        actions,
        actionsJson: JSON.stringify(actions, null, 2),
      }));
      toast.success(t('connectors.form.inspect.loadedTitle'), {
        description: t('connectors.form.inspect.loadedDescription', { count: actions.length }),
      });
    } catch (err) {
      setInspectError(err instanceof Error ? err.message : 'Inspection failed');
    } finally {
      setInspecting(false);
    }
  };

  const handleOAuth = async (appKey: string, appDisplayName: string) => {
    setOauthConnecting(true);

    try {
      const result = await authorizeConnectorAppOAuth(appKey);
      const popup = window.open(result.authorizationUrl, `connector-admin-${appKey}-oauth`, 'width=600,height=700');

      if (!popup) {
        toast.error(t('connectors.form.auth.connectFailed', { app: appDisplayName }));
        return;
      }

      const connected = await new Promise<boolean>((resolve) => {
        let settled = false;
        let pollTimer: ReturnType<typeof setInterval>;

        const cleanup = () => {
          clearInterval(pollTimer);
          window.removeEventListener('message', handleMessage);
        };

        const finish = async (success: boolean) => {
          if (settled) {
            return;
          }
          settled = true;
          cleanup();
          await refreshConnectionStatus(appKey);
          resolve(success);
        };

        const finishFromStatus = async () => {
          if (settled) {
            return;
          }
          try {
            const status = await getConnectorAppOAuthStatus(appKey);
            await finish(status.connected);
          } catch {
            await finish(false);
          }
        };

        const handleMessage = (event: MessageEvent) => {
          const message = event.data as
            | { type?: string; appKey?: string; success?: boolean; error?: string }
            | undefined;

          if (message?.type !== 'connector-admin-oauth-result' || message.appKey !== appKey) {
            return;
          }

          if (message.success) {
            void finish(true);
            return;
          }

          toast.error(t('connectors.form.auth.connectFailed', { app: appDisplayName }), {
            description: message.error,
          });
          void finish(false);
        };

        window.addEventListener('message', handleMessage);

        pollTimer = setInterval(() => {
          if (popup.closed && !settled) {
            void finishFromStatus();
          }
        }, 500);
      });

      if (connected) {
        toast.success(t('connectors.form.auth.connectSuccess', { app: appDisplayName }));
      } else {
        toast.error(t('connectors.form.auth.connectFailed', { app: appDisplayName }));
      }
    } catch (err) {
      toast.error(t('connectors.form.auth.connectFailed', { app: appDisplayName }), {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setOauthConnecting(false);
    }
  };

  const handleDisconnect = async (appKey: string, appDisplayName: string) => {
    try {
      await disconnectConnectorAppOAuth(appKey);
      await refreshConnectionStatus(appKey);
      toast.success(t('connectors.form.auth.disconnectSuccess', { app: appDisplayName }));
    } catch (err) {
      toast.error(t('connectors.form.auth.disconnectFailed', { app: appDisplayName }), {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const updateMappingRow = (
    field: 'runtimeHeaderMappings' | 'runtimeEnvMappings',
    rowId: string,
    property: 'key' | 'value',
    value: string,
  ) => {
    setForm((current) => ({
      ...current,
      [field]: current[field].map((row) => (row.id === rowId ? { ...row, [property]: value } : row)),
    }));
  };

  const addMappingRow = (field: 'runtimeHeaderMappings' | 'runtimeEnvMappings') => {
    setForm((current) => ({
      ...current,
      [field]: [...current[field], createMappingRow()],
    }));
  };

  const removeMappingRow = (field: 'runtimeHeaderMappings' | 'runtimeEnvMappings', rowId: string) => {
    setForm((current) => ({
      ...current,
      [field]: current[field].filter((row) => row.id !== rowId),
    }));
  };

  const updateDynamicHeader = <K extends keyof DynamicHeaderRow>(rowId: string, property: K, value: DynamicHeaderRow[K]) => {
    setForm((current) => ({
      ...current,
      dynamicHeaders: current.dynamicHeaders.map((row) =>
        row.id === rowId ? { ...row, [property]: value } : row,
      ),
    }));
  };

  const addDynamicHeader = () => {
    setForm((current) => ({
      ...current,
      dynamicHeaders: [...current.dynamicHeaders, createDynamicHeaderRow()],
    }));
  };

  const removeDynamicHeader = (rowId: string) => {
    setForm((current) => ({
      ...current,
      dynamicHeaders: current.dynamicHeaders.filter((row) => row.id !== rowId),
    }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-2xl max-h-[85vh] overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>{connector ? t('connectors.form.dialog.editTitle') : t('connectors.form.dialog.addTitle')}</DialogTitle>
        </DialogHeader>
        <div className='grid gap-4 py-4'>
          <div className='grid grid-cols-2 gap-4'>
            <div>
              <Label>{t('connectors.form.fields.slug.label')}</Label>
              <Input placeholder={t('connectors.form.fields.slug.placeholder')} value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
            </div>
            <div>
              <Label>{t('connectors.form.fields.name.label')}</Label>
              <Input placeholder={t('connectors.form.fields.name.placeholder')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
          </div>

          <div>
            <Label>{t('connectors.form.fields.description.label')}</Label>
            <Textarea placeholder={t('connectors.form.fields.description.placeholder')} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
          </div>

          <div>
            <Label>Category</Label>
            <Select
              value={form.categoryId || '__none__'}
              onValueChange={(value) => {
                if (value === ADD_CATEGORY_VALUE) {
                  setShowCategoriesDialog(true);
                  return;
                }
                setForm({ ...form, categoryId: value === '__none__' ? '' : value });
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder='Select a category' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ADD_CATEGORY_VALUE} className='text-primary'>
                  <span className='flex items-center gap-2'>
                    <Plus className='h-3.5 w-3.5' />
                    Add category
                  </span>
                </SelectItem>
                <SelectItem value='__none__'>No category</SelectItem>
                {availableCategories.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>
                    {cat.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className='grid grid-cols-2 gap-4'>
            <div>
              <Label>{t('connectors.form.fields.icon.label')}</Label>
              <div className='flex gap-2'>
                <IconPickerPreview
                  icon={form.icon}
                  color={form.color}
                  iconColor={form.iconColor}
                  onClear={() => setForm({ ...form, icon: '' })}
                  onToggleColorMode={() =>
                    setForm({ ...form, iconColor: form.iconColor === 'light' ? 'dark' : 'light' })
                  }
                />
                <div className='flex-1 space-y-1'>
                  <Input
                    placeholder='FaGithub'
                    value={form.icon}
                    onChange={(e) => setForm({ ...form, icon: e.target.value })}
                  />
                  <a
                    href='https://react-icons.github.io/react-icons/search/#q='
                    target='_blank'
                    rel='noopener noreferrer'
                    className='text-xs text-primary hover:underline flex items-center gap-1'
                  >
                    <ExternalLink className='h-3 w-3' />
                    Browse icons
                  </a>
                </div>
              </div>
            </div>
            <div>
              <Label>{t('connectors.form.fields.color.label')}</Label>
              <ColorPicker
                value={form.color}
                onChange={(value) => setForm({ ...form, color: value })}
                placeholder='#24292e'
              />
            </div>
          </div>

          <div className='grid gap-4 rounded-md border p-4'>
            <div>
              <Label>{t('connectors.form.auth.sectionLabel')}</Label>
              <p className='text-sm text-muted-foreground'>{t('connectors.form.auth.sectionHelper')}</p>
            </div>
            <div className='grid grid-cols-2 gap-4'>
              <div>
                <Label>{t('connectors.form.auth.sourceLabel')}</Label>
                <Select value={form.authSourceType} onValueChange={(value) => setForm({ ...form, authSourceType: value, connectedAppKey: value === 'connected_app' ? form.connectedAppKey : '' })}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('connectors.form.auth.sourcePlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {AUTH_SOURCE_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t('connectors.form.auth.connectedAppLabel')}</Label>
                <Select value={form.connectedAppKey || '__none__'} onValueChange={(value) => setForm({ ...form, connectedAppKey: value === '__none__' ? '' : value })} disabled={form.authSourceType !== 'connected_app'}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('connectors.form.auth.connectedAppPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='__none__'>{t('connectors.form.auth.noneOption')}</SelectItem>
                    {connectedApps.map((app) => (
                      <SelectItem key={app.id} value={app.appKey}>{app.displayName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {form.authSourceType !== 'none' && (
              <div className='grid gap-4'>
                <div>
                  <Label>{t('connectors.form.auth.strategyLabel')}</Label>
                  <Select value={form.runtimeAuthStrategy} onValueChange={(value) => setForm({ ...form, runtimeAuthStrategy: value })}>
                    <SelectTrigger>
                      <SelectValue placeholder={t('connectors.form.auth.strategyPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {RUNTIME_AUTH_STRATEGIES.map((strategy) => (
                        <SelectItem key={strategy.value} value={strategy.value}>{strategy.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {form.runtimeAuthStrategy === 'http_header_bearer' && (
                  <div className='grid grid-cols-2 gap-4'>
                    <div>
                      <Label>{t('connectors.form.auth.headerNameLabel')}</Label>
                      <Input value={form.runtimeHeaderName} onChange={(e) => setForm({ ...form, runtimeHeaderName: e.target.value })} placeholder={t('connectors.form.auth.headerNamePlaceholder')} />
                    </div>
                    <div>
                      <Label>{t('connectors.form.auth.headerPrefixLabel')}</Label>
                      <Input value={form.runtimeHeaderPrefix} onChange={(e) => setForm({ ...form, runtimeHeaderPrefix: e.target.value })} placeholder={t('connectors.form.auth.headerPrefixPlaceholder')} />
                    </div>
                  </div>
                )}

                {form.runtimeAuthStrategy === 'custom_headers' && (
                  <div className='grid gap-2'>
                    <div className='flex items-center justify-between'>
                      <Label>{t('connectors.form.auth.headerMappingsLabel')}</Label>
                      <Button type='button' variant='outline' size='sm' onClick={() => addMappingRow('runtimeHeaderMappings')}>
                        <Plus className='mr-2 h-4 w-4' />
                        {t('connectors.form.auth.addHeader')}
                      </Button>
                    </div>
                    <p className='text-sm text-muted-foreground'>{t('connectors.form.auth.headerMappingsHelper')}</p>
                    {form.runtimeHeaderMappings.length === 0 ? <p className='text-sm text-muted-foreground'>{t('connectors.form.auth.noHeaderMappings')}</p> : null}
                    {form.runtimeHeaderMappings.map((row) => (
                      <div key={row.id} className='grid grid-cols-[1fr_1fr_auto] gap-2'>
                        <Input placeholder={t('connectors.form.auth.headerMappingKeyPlaceholder')} value={row.key} onChange={(e) => updateMappingRow('runtimeHeaderMappings', row.id, 'key', e.target.value)} />
                        <Input placeholder={t('connectors.form.auth.headerMappingValuePlaceholder')} value={row.value} onChange={(e) => updateMappingRow('runtimeHeaderMappings', row.id, 'value', e.target.value)} />
                        <Button type='button' variant='outline' size='icon' onClick={() => removeMappingRow('runtimeHeaderMappings', row.id)}>
                          <Trash2 className='h-4 w-4' />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                {form.runtimeAuthStrategy === 'env_vars' && (
                  <div className='grid gap-2'>
                    <div className='flex items-center justify-between'>
                      <Label>{t('connectors.form.auth.envMappingsLabel')}</Label>
                      <Button type='button' variant='outline' size='sm' onClick={() => addMappingRow('runtimeEnvMappings')}>
                        <Plus className='mr-2 h-4 w-4' />
                        {t('connectors.form.auth.addVariable')}
                      </Button>
                    </div>
                    <p className='text-sm text-muted-foreground'>{t('connectors.form.auth.envMappingsHelper')}</p>
                    {form.runtimeEnvMappings.length === 0 ? <p className='text-sm text-muted-foreground'>{t('connectors.form.auth.noEnvMappings')}</p> : null}
                    {form.runtimeEnvMappings.map((row) => (
                      <div key={row.id} className='grid grid-cols-[1fr_1fr_auto] gap-2'>
                        <Input placeholder={t('connectors.form.auth.envMappingKeyPlaceholder')} value={row.key} onChange={(e) => updateMappingRow('runtimeEnvMappings', row.id, 'key', e.target.value)} />
                        <Input placeholder={t('connectors.form.auth.envMappingValuePlaceholder')} value={row.value} onChange={(e) => updateMappingRow('runtimeEnvMappings', row.id, 'value', e.target.value)} />
                        <Button type='button' variant='outline' size='icon' onClick={() => removeMappingRow('runtimeEnvMappings', row.id)}>
                          <Trash2 className='h-4 w-4' />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className='grid grid-cols-2 gap-4'>
            <div>
              <Label>{t('connectors.form.fields.transportType.label')}</Label>
              <Select value={form.mcpTransportType} onValueChange={(value) => setForm({ ...form, mcpTransportType: value })}>
                <SelectTrigger>
                  <SelectValue placeholder={t('connectors.form.fields.transportType.placeholder')} />
                </SelectTrigger>
                <SelectContent>
                  {TRANSPORT_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{form.mcpTransportType === 'stdio' ? t('connectors.form.fields.command.label') : t('connectors.form.fields.serverUrl.label')}</Label>
              <Input
                placeholder={
                  form.mcpTransportType === 'stdio'
                    ? t('connectors.form.fields.command.placeholder')
                    : t('connectors.form.fields.serverUrl.placeholder')
                }
                value={form.mcpServerUrl}
                onChange={(e) => setForm({ ...form, mcpServerUrl: e.target.value })}
              />
            </div>
          </div>

          <div>
            <Label>{t('connectors.form.fields.serverConfig.label')}</Label>
            <Textarea placeholder={t('connectors.form.fields.serverConfig.placeholder')} value={form.mcpServerConfig} onChange={(e) => setForm({ ...form, mcpServerConfig: e.target.value })} rows={3} className='font-mono text-xs' />
          </div>

          <div className='grid gap-3 rounded-md border p-4'>
            <div className='flex items-center justify-between'>
              <div>
                <Label>Dynamic headers</Label>
                <p className='text-sm text-muted-foreground'>
                  Headers automatically filled at runtime from the calling user (e.g. X-User-Id → user_id).
                </p>
              </div>
              <Button type='button' variant='outline' size='sm' onClick={addDynamicHeader}>
                <Plus className='mr-2 h-4 w-4' />
                Add header
              </Button>
            </div>
            {form.dynamicHeaders.length === 0 ? (
              <p className='text-sm text-muted-foreground'>No dynamic headers configured.</p>
            ) : (
              form.dynamicHeaders.map((row) => (
                <div key={row.id} className='grid grid-cols-[1fr_1fr_auto_auto] items-center gap-2'>
                  <Input
                    placeholder='Header name (e.g. X-User-Id)'
                    value={row.headerName}
                    onChange={(e) => updateDynamicHeader(row.id, 'headerName', e.target.value)}
                  />
                  <Select
                    value={row.source}
                    onValueChange={(value) =>
                      updateDynamicHeader(row.id, 'source', value as ConnectorDynamicHeaderSource)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder='Source' />
                    </SelectTrigger>
                    <SelectContent>
                      {DYNAMIC_HEADER_SOURCES.map((source) => (
                        <SelectItem key={source.value} value={source.value}>
                          {source.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Switch
                    checked={row.enabled}
                    onCheckedChange={(checked) => updateDynamicHeader(row.id, 'enabled', checked)}
                  />
                  <Button
                    type='button'
                    variant='outline'
                    size='icon'
                    onClick={() => removeDynamicHeader(row.id)}
                  >
                    <Trash2 className='h-4 w-4' />
                  </Button>
                </div>
              ))
            )}
          </div>

          <div className='rounded-lg border bg-muted/20 p-4 space-y-4'>
            <div className='space-y-2'>
              <div className='flex items-center justify-between'>
                <h4 className='font-semibold flex items-center gap-2'>
                  <TestTube2 className='h-4 w-4' />
                  {t('connectors.form.inspect.title')}
                </h4>
                {form.authSourceType === 'connected_app' && form.connectedAppKey && (() => {
                  const app = getCurrentConnectedApp();
                  const isConnected = isCurrentAppConnected();
                  return app ? (
                    <div className='flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium'>
                      {isConnected ? (
                        <>
                          <div className='w-2 h-2 rounded-full bg-green-500 animate-pulse' />
                          <span className='text-green-600'>{t('connectors.form.auth.connected', { app: app.displayName })}</span>
                        </>
                      ) : (
                        <>
                          <div className='w-2 h-2 rounded-full bg-amber-500' />
                          <span className='text-amber-600'>{t('connectors.form.auth.notConnected', { app: app.displayName })}</span>
                        </>
                      )}
                    </div>
                  ) : null;
                })()}
              </div>
              <p className='text-sm text-muted-foreground'>
                {t('connectors.form.inspect.description')}
              </p>
            </div>

            <div className='flex flex-wrap items-center gap-3'>
              {form.authSourceType === 'connected_app' && form.connectedAppKey && (() => {
                const app = getCurrentConnectedApp();
                const isConnected = isCurrentAppConnected();
                if (!app) return null;

                return (
                  <>
                    {!isConnected ? (
                      <Button
                        type='button'
                        variant='outline'
                        onClick={() => handleOAuth(app.appKey, app.displayName)}
                        disabled={oauthConnecting}
                        className='flex items-center gap-2'
                      >
                        {oauthConnecting ? <Loader2 className='h-4 w-4 animate-spin' /> : <Github className='h-4 w-4' />}
                        {t('connectors.form.auth.connectAction', { app: app.displayName })}
                      </Button>
                    ) : (
                      <>
                        <Button
                          type='button'
                          variant='default'
                          className='flex items-center gap-2 bg-green-600 hover:bg-green-700'
                          disabled
                        >
                          <Github className='h-4 w-4' />
                          {t('connectors.form.auth.connectedAction', { app: app.displayName })}
                        </Button>
                        <Button
                          type='button'
                          variant='outline'
                          onClick={() => handleDisconnect(app.appKey, app.displayName)}
                          disabled={oauthConnecting}
                          className='flex items-center gap-2'
                        >
                          {oauthConnecting ? <Loader2 className='h-4 w-4 animate-spin' /> : <X className='h-4 w-4' />}
                          {t('connectors.form.auth.disconnectAction', { app: app.displayName })}
                        </Button>
                      </>
                    )}
                  </>
                );
              })()}
              <Button
                type='button'
                variant='outline'
                onClick={handleInspect}
                disabled={inspecting || (form.authSourceType === 'connected_app' && form.connectedAppKey !== '' && !isCurrentAppConnected())}
                className='flex items-center gap-2'
              >
                {inspecting ? <Loader2 className='h-4 w-4 animate-spin' /> : <TestTube2 className='h-4 w-4' />}
                {t('connectors.form.inspect.action')}
              </Button>
            </div>
          </div>

          {(inspectError || inspectTools.length > 0) && (
            <div className='rounded-md border p-3 space-y-2'>
              {inspectError ? (
                <p className='text-sm text-destructive'>{inspectError}</p>
              ) : (
                <div className='space-y-2'>
                  <p className='text-sm font-medium'>{t('connectors.form.inspect.availableTools')}</p>
                  <div className='space-y-1'>
                    {inspectTools.map((tool) => (
                      <div key={tool.name} className='rounded border px-2 py-1 text-xs'>
                        <div className='font-medium'>{tool.name}</div>
                        {tool.description ? <div className='text-muted-foreground'>{tool.description}</div> : null}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div>
            <Label>{t('connectors.form.fields.actions.label')}</Label>
            <Textarea
              placeholder={t('connectors.form.fields.actions.placeholder')}
              value={form.actionsJson}
              onChange={(e) => setForm({ ...form, actionsJson: e.target.value, actions: [] })}
              rows={6}
              className='font-mono text-xs'
            />
          </div>

          <div>
            <Label>{t('connectors.form.referencedSkills.label')}</Label>
            <MultiSelect
              options={availableSkills.map((skill) => ({
                value: skill.id,
                label: skill.name,
                description: skill.description,
              }))}
              value={form.referencedSkillIds}
              onValueChange={(value) => setForm({ ...form, referencedSkillIds: value })}
              placeholder={t('connectors.form.referencedSkills.selectPlaceholder')}
              searchPlaceholder={t('connectors.form.referencedSkills.searchPlaceholder')}
              emptyText={t('connectors.form.referencedSkills.emptyText')}
            />
          </div>

          <div className='flex items-center gap-2'>
            <Switch checked={form.isActive} onCheckedChange={(checked) => setForm({ ...form, isActive: checked })} />
            <Label>{t('connectors.form.fields.active.label')}</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>{t('connectors.form.dialog.cancel')}</Button>
          <Button onClick={handleSubmit}>{connector ? t('connectors.form.dialog.update') : t('connectors.form.dialog.create')}</Button>
        </DialogFooter>
      </DialogContent>

      <ManageCategoriesDialog
        open={showCategoriesDialog}
        onOpenChange={setShowCategoriesDialog}
        onCategoriesChanged={refreshCategories}
      />
    </Dialog>
  );
}
