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
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
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
  ConnectorActionResultKind,
  ConnectorCitationMode,
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

const RESULT_KIND_OPTIONS = [
  { value: 'generic', labelKey: 'connectors.form.actions.resultKind.generic' },
  { value: 'web_search', labelKey: 'connectors.form.actions.resultKind.web_search' },
  { value: 'web_fetch', labelKey: 'connectors.form.actions.resultKind.web_fetch' },
  { value: 'document_search', labelKey: 'connectors.form.actions.resultKind.document_search' },
  { value: 'file_read', labelKey: 'connectors.form.actions.resultKind.file_read' },
  { value: 'database_query', labelKey: 'connectors.form.actions.resultKind.database_query' },
] as const;

const CITATION_MODE_OPTIONS = [
  { value: 'none', labelKey: 'connectors.form.actions.citationMode.none' },
  { value: 'source_only', labelKey: 'connectors.form.actions.citationMode.source_only' },
  { value: 'text_fragment', labelKey: 'connectors.form.actions.citationMode.text_fragment' },
  { value: 'document_evidence', labelKey: 'connectors.form.actions.citationMode.document_evidence' },
] as const;

const WEB_SEARCH_MAPPING_FIELDS = [
  { value: 'title', labelKey: 'connectors.form.actions.mapping.title' },
  { value: 'url', labelKey: 'connectors.form.actions.mapping.url' },
  { value: 'snippet', labelKey: 'connectors.form.actions.mapping.snippet' },
  { value: 'content', labelKey: 'connectors.form.actions.mapping.content' },
  { value: 'publishedAt', labelKey: 'connectors.form.actions.mapping.publishedAt' },
  { value: 'author', labelKey: 'connectors.form.actions.mapping.author' },
] as const;

const WEB_FETCH_MAPPING_FIELDS = WEB_SEARCH_MAPPING_FIELDS.filter(({ value }) => ['title', 'url', 'content'].includes(value));

const RUNTIME_AUTH_STRATEGIES = [
  { value: 'http_header_bearer', label: 'Bearer header' },
  { value: 'custom_headers', label: 'Custom headers' },
  { value: 'env_vars', label: 'Environment variables' },
];

const DYNAMIC_HEADER_SOURCES = [
  { value: 'workspace', labelKey: 'connectors.form.dynamicHeaders.sources.workspace' },
  { value: 'user_id', labelKey: 'connectors.form.dynamicHeaders.sources.userId' },
  { value: 'user_email', labelKey: 'connectors.form.dynamicHeaders.sources.userEmail' },
  { value: 'user_first_name', labelKey: 'connectors.form.dynamicHeaders.sources.userFirstName' },
  { value: 'user_last_name', labelKey: 'connectors.form.dynamicHeaders.sources.userLastName' },
  { value: 'user_full_name', labelKey: 'connectors.form.dynamicHeaders.sources.userFullName' },
] as const satisfies ReadonlyArray<{ value: ConnectorDynamicHeaderSource; labelKey: string }>;

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

  if (form.authSourceType === 'server_config') {
    try {
      const config = JSON.parse(form.runtimeAuthConfig) as unknown;
      return config && typeof config === 'object' && !Array.isArray(config)
        ? config as Record<string, unknown>
        : undefined;
    } catch {
      return undefined;
    }
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
    headerPrefix: form.runtimeHeaderPrefix,
  };
}

function humanizeToolName(name: string) {
  return name.replace(/_/g, ' ').replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function truncateValue(value: string, maxLength: number) {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function normalizeMcpActionDescription(description: string) {
  return description
    .replaceAll('workspace names', 'workspace IDs')
    .replaceAll('Workspace name', 'Workspace ID')
    .replaceAll('workspace name', 'workspace ID');
}

function mapInspectToolsToActions(
  tools: McpToolDefinition[],
  existingActions: ConnectorActionResponse[] = [],
): ConnectorActionResponse[] {
  const enabledByKey = new Map(
    existingActions.map((action) => [action.key, action]),
  );

  return tools.map((tool) => ({
    key: truncateValue(tool.name, CONNECTOR_ACTION_KEY_MAX_LENGTH),
    label: truncateValue(humanizeToolName(tool.name), CONNECTOR_ACTION_LABEL_MAX_LENGTH),
    description: truncateValue(
      normalizeMcpActionDescription(tool.description ?? ''),
      CONNECTOR_ACTION_DESCRIPTION_MAX_LENGTH,
    ),
    parameterSchema: tool.inputSchema ?? {},
    outputSchema: {},
    safety: 'read',
    supportsBatch: false,
    supportsIteration: false,
    isEnabled: enabledByKey.get(truncateValue(tool.name, CONNECTOR_ACTION_KEY_MAX_LENGTH))?.isEnabled ?? true,
    resultKind: enabledByKey.get(truncateValue(tool.name, CONNECTOR_ACTION_KEY_MAX_LENGTH))?.resultKind ?? 'generic',
    citationMode: enabledByKey.get(truncateValue(tool.name, CONNECTOR_ACTION_KEY_MAX_LENGTH))?.citationMode ?? 'none',
    resultMapping: enabledByKey.get(truncateValue(tool.name, CONNECTOR_ACTION_KEY_MAX_LENGTH))?.resultMapping,
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
  const [selectedActionKey, setSelectedActionKey] = useState<string | null>(null);
  const [inspecting, setInspecting] = useState(false);
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
      setSelectedActionKey(null);
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
          isHidden: connector.isHidden ?? false,
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

  useEffect(() => {
    if (!open || form.actions?.some((action) => action.key === selectedActionKey)) {
      return;
    }
    setSelectedActionKey(form.actions?.[0]?.key ?? null);
  }, [form.actions, open, selectedActionKey]);

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
      authType: form.authSourceType === 'connected_app' ? 'oauth2' : form.authSourceType === 'none' ? 'none' : 'token',
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
    try {
      const runtimeAuthConfig = buildRuntimeAuthConfig(form);
      const result = await inspectMcp(
        form.mcpTransportType,
        form.mcpServerUrl,
        mcpServerConfig,
        form.authSourceType === 'connected_app' ? form.connectedAppKey || undefined : undefined,
        runtimeAuthConfig,
        connector?.id,
      );
      if (result.error) {
        toast.error(t('connectors.form.inspect.title'), { description: result.error });
        return;
      }
      setForm((current) => {
        const actions = mapInspectToolsToActions(result.tools ?? [], current.actions);
        return {
          ...current,
          actions,
          actionsJson: JSON.stringify(actions, null, 2),
        };
      });
      setSelectedActionKey(
        result.tools?.[0]?.name
          ? truncateValue(result.tools[0].name, CONNECTOR_ACTION_KEY_MAX_LENGTH)
          : null,
      );
      toast.success(t('connectors.form.inspect.loadedTitle'), {
        description: t('connectors.form.inspect.loadedDescription', { count: result.tools?.length ?? 0 }),
      });
    } catch (err) {
      toast.error(t('connectors.form.inspect.title'), {
        description: err instanceof Error ? err.message : 'Inspection failed',
      });
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

  const updateActionEnabled = (actionKey: string, isEnabled: boolean) => {
    setForm((current) => {
      const actions = (current.actions ?? []).map((action) =>
        action.key === actionKey ? { ...action, isEnabled } : action,
      );
      return {
        ...current,
        actions,
        actionsJson: JSON.stringify(actions, null, 2),
      };
    });
  };

  const updateSelectedAction = (patch: Partial<ConnectorActionResponse>) => {
    if (!selectedActionKeyForDisplay) return;
    setForm((current) => {
      const actions = (current.actions ?? []).map((action) =>
        action.key === selectedActionKeyForDisplay ? { ...action, ...patch } : action,
      );
      return { ...current, actions, actionsJson: JSON.stringify(actions, null, 2) };
    });
  };

  const updateMapping = (field: string, value: string) => {
    if (!selectedAction) return;
    const resultMapping = { ...(selectedAction.resultMapping ?? {}) };
    if (field === 'itemsPath') {
      resultMapping.itemsPath = value;
    } else {
      resultMapping.fields = {
        ...(resultMapping.fields ?? {}),
        [field]: value.split(',').map((item) => item.trim()).filter(Boolean),
      };
    }
    updateSelectedAction({ resultMapping });
  };

  const connectorActions = form.actions ?? [];
  const selectedAction = connectorActions.find((action) => action.key === selectedActionKey) ?? connectorActions[0];
  const selectedActionKeyForDisplay = selectedAction?.key ?? null;
  const safetyLabel = (safety: string) => {
    if (safety === 'write') return t('connectors.form.actions.safety.write');
    if (safety === 'delete') return t('connectors.form.actions.safety.delete');
    return t('connectors.form.actions.safety.read');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='w-[calc(100vw-2rem)] max-w-2xl max-h-[85vh] overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>{connector ? t('connectors.form.dialog.editTitle') : t('connectors.form.dialog.addTitle')}</DialogTitle>
        </DialogHeader>
        <div className='grid min-w-0 gap-4 py-4'>
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
                <Select value={form.authSourceType} onValueChange={(value) => setForm({ ...form, authSourceType: value, connectedAppKey: value === 'connected_app' ? form.connectedAppKey : '' })} disabled={form.authSourceType === 'server_config'}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('connectors.form.auth.sourcePlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {form.authSourceType === 'server_config' ? (
                      <SelectItem value='server_config'>{t('connectors.form.auth.serverConfigOption')}</SelectItem>
                    ) : null}
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

            {form.authSourceType === 'server_config' ? (
              <p className='text-sm text-muted-foreground'>{t('connectors.form.auth.serverConfigHelper')}</p>
            ) : null}

            {form.authSourceType === 'connected_app' && form.connectedAppKey && (() => {
              const app = getCurrentConnectedApp();
              const isConnected = isCurrentAppConnected();
              if (!app) return null;

              return (
                <div className='flex flex-wrap items-center gap-3 rounded-md bg-muted/40 p-3'>
                  <span className={`text-sm font-medium ${isConnected ? 'text-green-600' : 'text-amber-600'}`}>
                    {isConnected
                      ? t('connectors.form.auth.connected', { app: app.displayName })
                      : t('connectors.form.auth.notConnected', { app: app.displayName })}
                  </span>
                  {!isConnected ? (
                    <Button
                      type='button'
                      variant='outline'
                      size='sm'
                      onClick={() => handleOAuth(app.appKey, app.displayName)}
                      disabled={oauthConnecting}
                    >
                      {oauthConnecting ? <Loader2 className='mr-2 h-4 w-4 animate-spin' /> : null}
                      {t('connectors.form.auth.connectAction', { app: app.displayName })}
                    </Button>
                  ) : (
                    <Button
                      type='button'
                      variant='outline'
                      size='sm'
                      onClick={() => handleDisconnect(app.appKey, app.displayName)}
                      disabled={oauthConnecting}
                    >
                      {oauthConnecting ? <Loader2 className='mr-2 h-4 w-4 animate-spin' /> : <X className='mr-2 h-4 w-4' />}
                      {t('connectors.form.auth.disconnectAction', { app: app.displayName })}
                    </Button>
                  )}
                </div>
              );
            })()}

            {form.authSourceType !== 'none' && form.authSourceType !== 'server_config' && (
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
                      <p className='mt-1 text-xs text-muted-foreground'>
                        {t('connectors.form.auth.headerPrefixHelper')}
                      </p>
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
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={handleInspect}
                disabled={inspecting || (form.authSourceType === 'connected_app' && form.connectedAppKey !== '' && !isCurrentAppConnected())}
                className='mt-2'
              >
                {inspecting ? <Loader2 className='mr-2 h-4 w-4 animate-spin' /> : <TestTube2 className='mr-2 h-4 w-4' />}
                {t('connectors.form.inspect.action')}
              </Button>
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
                  {t('connectors.form.dynamicHeaders.helper')}
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
                          {t(source.labelKey)}
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

          <div className='min-w-0 space-y-3'>
            <div>
              <Label>{t('connectors.form.actions.title')}</Label>
              <p className='text-sm text-muted-foreground'>{t('connectors.form.actions.description')}</p>
            </div>
            {connectorActions.length === 0 ? (
              <div className='rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground'>
                {t('connectors.form.actions.empty')}
              </div>
            ) : (
              <>
                <ScrollArea className='h-56 rounded-md border'>
                  <Table className='table-fixed'>
                    <TableHeader className='sticky top-0 bg-background'>
                      <TableRow>
                        <TableHead className='w-1/3'>{t('connectors.form.actions.columns.tool')}</TableHead>
                        <TableHead>{t('connectors.form.actions.columns.description')}</TableHead>
                        <TableHead className='w-20'>{t('connectors.form.actions.columns.safety')}</TableHead>
                        <TableHead className='w-20 text-center'>{t('connectors.form.actions.columns.enabled')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {connectorActions.map((action) => (
                        <TableRow key={action.key} data-state={selectedActionKeyForDisplay === action.key ? 'selected' : undefined}>
                          <TableCell className='break-all font-medium'>
                            <Button type='button' variant='link' className='h-auto max-w-full break-all p-0 text-left font-medium' onClick={() => setSelectedActionKey(action.key)}>
                              {action.label || action.key}
                            </Button>
                            {action.label !== action.key ? <p className='font-mono text-xs text-muted-foreground'>{action.key}</p> : null}
                          </TableCell>
                          <TableCell className='max-w-0 truncate text-muted-foreground'>{action.description || t('connectors.form.actions.noDescription')}</TableCell>
                          <TableCell>{safetyLabel(action.safety)}</TableCell>
                          <TableCell className='text-center'>
                            <Switch
                              checked={action.isEnabled !== false}
                              onCheckedChange={(checked) => updateActionEnabled(action.key, checked)}
                              aria-label={t('connectors.form.actions.toggleLabel', {
                                tool: action.label || action.key,
                              })}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
                {selectedAction ? (
                    <div className='space-y-3 rounded-md border bg-muted/20 p-3'>
                      <div>
                        <p className='font-medium'>{selectedAction.label || selectedAction.key}</p>
                        <p className='font-mono text-xs text-muted-foreground'>{selectedAction.key}</p>
                      </div>
                      <div>
                        <p className='text-xs font-medium text-muted-foreground'>{t('connectors.form.actions.detail.description')}</p>
                        <p className='mt-1 whitespace-pre-wrap text-sm'>{selectedAction.description || t('connectors.form.actions.noDescription')}</p>
                      </div>
                      <div className='grid grid-cols-3 gap-3 text-sm'>
                        <div><p className='text-xs text-muted-foreground'>{t('connectors.form.actions.detail.safety')}</p><p>{safetyLabel(selectedAction.safety)}</p></div>
                        <div><p className='text-xs text-muted-foreground'>{t('connectors.form.actions.detail.batch')}</p><p>{selectedAction.supportsBatch ? t('connectors.form.actions.yes') : t('connectors.form.actions.no')}</p></div>
                        <div><p className='text-xs text-muted-foreground'>{t('connectors.form.actions.detail.iteration')}</p><p>{selectedAction.supportsIteration ? t('connectors.form.actions.yes') : t('connectors.form.actions.no')}</p></div>
                      </div>
                      <div className='space-y-3 border-t pt-3'>
                        <p className='text-xs font-medium text-muted-foreground'>{t('connectors.form.actions.semantics.title')}</p>
                        <div className='grid gap-3 sm:grid-cols-2'>
                          <div className='space-y-1'>
                            <Label>{t('connectors.form.actions.semantics.resultKind')}</Label>
                            <Select value={selectedAction.resultKind ?? 'generic'} onValueChange={(value) => updateSelectedAction({ resultKind: value as ConnectorActionResultKind })}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {RESULT_KIND_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{t(option.labelKey)}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className='space-y-1'>
                            <Label>{t('connectors.form.actions.semantics.citationMode')}</Label>
                            <Select value={selectedAction.citationMode ?? 'none'} onValueChange={(value) => updateSelectedAction({ citationMode: value as ConnectorCitationMode })}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {CITATION_MODE_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{t(option.labelKey)}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        {['web_search', 'web_fetch'].includes(selectedAction.resultKind ?? 'generic') ? (
                          <div className='grid gap-3 sm:grid-cols-2'>
                            {selectedAction.resultKind === 'web_search' ? <div className='space-y-1 sm:col-span-2'><Label>{t('connectors.form.actions.mapping.itemsPath')}</Label><Input value={selectedAction.resultMapping?.itemsPath ?? ''} onChange={(event) => updateMapping('itemsPath', event.target.value)} /></div> : null}
                            {(selectedAction.resultKind === 'web_search' ? WEB_SEARCH_MAPPING_FIELDS : WEB_FETCH_MAPPING_FIELDS).map((field) => (
                              <div key={field.value} className='space-y-1'><Label>{t(field.labelKey)}</Label><Input value={selectedAction.resultMapping?.fields?.[field.value]?.join(', ') ?? ''} onChange={(event) => updateMapping(field.value, event.target.value)} placeholder={t('connectors.form.actions.mapping.placeholder')} /></div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <div>
                        <p className='text-xs font-medium text-muted-foreground'>{t('connectors.form.actions.detail.inputSchema')}</p>
                        <ScrollArea className='mt-1 h-36 rounded border bg-background'>
                          <pre className='whitespace-pre-wrap break-words p-2 font-mono text-xs'>{JSON.stringify(selectedAction.parameterSchema, null, 2)}</pre>
                        </ScrollArea>
                      </div>
                      <div>
                        <p className='text-xs font-medium text-muted-foreground'>{t('connectors.form.actions.detail.outputSchema')}</p>
                        <ScrollArea className='mt-1 h-28 rounded border bg-background'>
                          <pre className='whitespace-pre-wrap break-words p-2 font-mono text-xs'>{JSON.stringify(selectedAction.outputSchema, null, 2)}</pre>
                        </ScrollArea>
                      </div>
                    </div>
                  ) : null}
              </>
            )}
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
            <Switch id='connector-active' checked={form.isActive} onCheckedChange={(checked) => setForm({ ...form, isActive: checked })} />
            <Label htmlFor='connector-active'>{t('connectors.form.fields.active.label')}</Label>
          </div>

          <div className='flex items-center gap-2'>
            <Switch id='connector-hidden' checked={form.isHidden} onCheckedChange={(checked) => setForm({ ...form, isHidden: checked })} />
            <Label htmlFor='connector-hidden'>{t('connectors.form.fields.hidden.label')}</Label>
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
