import { useState, useEffect } from 'react';
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
import type { ConnectorResponse, ConnectorActionResponse, SkillResponse, McpToolDefinition } from '../../types';
import type { ConnectorFormValues } from './connector-form-schema';
import { defaultConnectorFormValues } from './connector-form-schema';
import { parseMcpServerConfig } from './mcp-server-config';
import { Loader2, Plus, TestTube2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { getSkills, inspectMcp } from '../../api';
import { useModuleTranslation } from '@/modules/localization';
import { getAdminConnectedApps } from '@/modules/connected-app/api';
import type { ConnectedAppAdminResponse } from '@/modules/connected-app/types';

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
  const [connectedApps, setConnectedApps] = useState<ConnectedAppAdminResponse[]>([]);

  useEffect(() => {
    if (open) {
      setInspectError(null);
      setInspectTools([]);
      getSkills({ isActive: true, limit: 1000 })
        .then((result) => setAvailableSkills(result.data || []))
        .catch(() => setAvailableSkills([]));
      getAdminConnectedApps()
        .then((apps) => setConnectedApps(apps.filter((app) => app.enabled)))
        .catch(() => setConnectedApps([]));
      if (connector) {
        const parsedRuntime = parseRuntimeAuthConfig(connector.runtimeAuthConfig);
        const parsedServerConfig = parseMcpServerConfig(connector.mcpServerConfig);
        setForm({
          slug: connector.slug,
          name: connector.name,
          description: connector.description,
          icon: connector.icon || '',
          color: connector.color || '',
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
          mcpServerConfig: parsedServerConfig.serverConfigText,
          actions: connector.actions || [],
          actionsJson: connector.actions ? JSON.stringify(connector.actions, null, 2) : '',
          referencedSkillIds: connector.referencedSkillIds || [],
          isActive: connector.isActive,
        });
      } else {
        setForm({ ...defaultConnectorFormValues });
      }
    }
  }, [open, connector]);

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

    let mcpServerConfig: Record<string, unknown> | undefined;
    try {
      mcpServerConfig = form.mcpServerConfig.trim() ? (JSON.parse(form.mcpServerConfig) as Record<string, unknown>) : undefined;
    } catch {
      toast.error(t('connectors.form.errors.invalidServerConfigJson'));
      return;
    }

    setInspecting(true);
    setInspectError(null);
    setInspectTools([]);
    try {
      const result = await inspectMcp(form.mcpTransportType, form.mcpServerUrl, mcpServerConfig);
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-2xl max-h-[85vh] overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>{connector ? 'Edit Connector' : 'Add Connector'}</DialogTitle>
        </DialogHeader>
        <div className='grid gap-4 py-4'>
          <div className='grid grid-cols-2 gap-4'>
            <div>
              <Label>Slug</Label>
              <Input placeholder='sharepoint' value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
            </div>
            <div>
              <Label>Name</Label>
              <Input placeholder='SharePoint' value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
          </div>

          <div>
            <Label>Description</Label>
            <Textarea placeholder='Microsoft SharePoint Online connector' value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
          </div>

          <div className='grid grid-cols-2 gap-4'>
            <div>
              <Label>Icon</Label>
              <Input placeholder='Cable' value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} />
            </div>
            <div>
              <Label>Color</Label>
              <Input placeholder='#0078d4' value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} />
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
              <Label>Transport Type</Label>
              <Select value={form.mcpTransportType} onValueChange={(value) => setForm({ ...form, mcpTransportType: value })}>
                <SelectTrigger>
                  <SelectValue placeholder='Select transport type' />
                </SelectTrigger>
                <SelectContent>
                  {TRANSPORT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{form.mcpTransportType === 'stdio' ? 'Command' : 'MCP Server URL'}</Label>
              <Input
                placeholder={
                  form.mcpTransportType === 'stdio'
                    ? 'npx @anthropic/mcp-server-sharepoint'
                    : 'https://mcp.example.com/mcp'
                }
                value={form.mcpServerUrl}
                onChange={(e) => setForm({ ...form, mcpServerUrl: e.target.value })}
              />
            </div>
          </div>

          <div>
            <Label>MCP Server Config (JSON)</Label>
            <Textarea placeholder='{"commandArgs": ["--stdio"]}' value={form.mcpServerConfig} onChange={(e) => setForm({ ...form, mcpServerConfig: e.target.value })} rows={3} className='font-mono text-xs' />
          </div>

          <div className='flex items-center justify-between gap-3'>
            <div className='text-sm text-muted-foreground'>{t('connectors.form.inspect.helper')}</div>
            <Button type='button' variant='outline' onClick={handleInspect} disabled={inspecting}>
              {inspecting ? <Loader2 className='mr-2 h-4 w-4 animate-spin' /> : <TestTube2 className='mr-2 h-4 w-4' />}
              {t('connectors.form.inspect.action')}
            </Button>
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
            <Label>Actions (JSON array)</Label>
            <Textarea
              placeholder='[{"key": "list_files", "label": "List Files", "safety": "read"}]'
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
            <Label>Active</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit}>{connector ? 'Update' : 'Create'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
