import { useState, useEffect, useCallback, useRef } from 'react';
import { ConnectorWorkerSettings } from './ConnectorWorkerSettings';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { buildMcpServerConfig } from './mcp-server-config';
import { ExternalLink, Loader2, Plus, TestTube2, Trash2, Github, X } from 'lucide-react';
import { IconPickerPreview } from './IconDisplay';
import { ColorPicker } from './ColorPicker';
import { usePermissions } from '../../hooks/usePermissions';
import { securityPolicyChanged } from './connector-form-schema';
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
  { value: 'credential', labelKey: 'connectors.form.auth.savedCredential' },
  { value: 'connected_app', labelKey: 'connectors.form.auth.connectedAccount' },
  { value: 'internal_jwt', labelKey: 'connectors.form.auth.userDelegation' },
  { value: 'none', labelKey: 'connectors.form.auth.publicAccess' },
 ] as const;

// Remote transports only: local stdio connectors are not supported over HTTP
// inspection or configuration (SEC-01 / WP-01).
const TRANSPORT_TYPES = [
  { value: 'streamable_http', label: 'Streamable HTTP' },
  { value: 'sse', label: 'SSE (Server-Sent Events)' },
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

function mappingRowsToObject(rows: Array<{ key: string; value: string }>) {
  return rows.reduce<Record<string, string>>((acc, row) => {
    const key = row.key.trim();
    if (key && row.value.trim()) {
      acc[key] = row.value;
    }
    return acc;
  }, {});
}

function buildRuntimeAuthConfig(form: ConnectorFormValues): Record<string, unknown> | undefined {
  if (form.authSourceType === 'none') {
    return undefined;
  }

  if (form.authSourceType === 'credential' && form.accessToken?.trim()) {
    // Literal mapping deliberately has no {token} interpolation: an existing
    // per-user credential must never be appended to this explicitly entered token.
    return { strategy: 'custom_headers', headerMappings: { Authorization: `Bearer ${form.accessToken.trim()}` } };
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
    safety: tool.safety ?? 'read',
    workerAccess: enabledByKey.get(truncateValue(tool.name, CONNECTOR_ACTION_KEY_MAX_LENGTH))?.workerAccess ?? 'inherit',
    executionKind: enabledByKey.get(truncateValue(tool.name, CONNECTOR_ACTION_KEY_MAX_LENGTH))?.executionKind ?? 'inherit',
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
  const opener = useRef<HTMLElement | null>(null);
  const { hasPermission } = usePermissions();
  const canManageSecurity = hasPermission('connectors.security.manage');
  const savedSecurity = connector;
  const legacyAuth = !!connector && !['credential', 'connected_app', 'none'].includes(connector.authSourceType || 'credential');
  const destinationLocked = !canManageSecurity && (legacyAuth || (!!savedSecurity?.mcpSecurityPolicy &&
    (savedSecurity.mcpSecurityPolicy.profile === 'internal_jwt' || savedSecurity.mcpSecurityPolicy.allowPrivateNetwork || savedSecurity.mcpSecurityPolicy.allowInsecureHttp || savedSecurity.mcpSecurityPolicy.actorDelegation === 'verified_user' || savedSecurity.mcpSecurityPolicy.requiredPermissions.length > 0)));
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
        // Stored credentials/config never round-trip to the browser (SEC-02 /
        // WP-02): the form starts empty and only replaces them when the admin
        // explicitly opts in.
        setForm({
          ...defaultConnectorFormValues,
          mcpSecurityPolicy: savedSecurity?.mcpSecurityPolicy,
          expectedSecurityRevision: savedSecurity?.securityRevision,
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
          mcpTransportType: connector.mcpTransportType || 'streamable_http',
          mcpServerUrl: connector.mcpServerUrl || '',
          dynamicHeaders: dynamicHeadersToRows(connector.dynamicHeaders),
          workerPolicy: connector.workerPolicy ?? { enabled: true, defaultExecutionKind: 'leaf', agentLaunchEnabled: false },
          actions: connector.actions || [],
          actionsJson: connector.actions ? JSON.stringify(connector.actions, null, 2) : '',
          referencedSkillIds: connector.referencedSkillIds || [],
          isActive: connector.isActive,
          isHidden: connector.isHidden ?? false,
          isSystem: connector.isSystem ?? false,
        });

        if (connector.connectedAppKey) {
          void refreshConnectionStatus(connector.connectedAppKey);
        }
      } else {
        setForm({ ...defaultConnectorFormValues, authSourceType: canManageSecurity ? 'none' : 'credential', mcpSecurityPolicy: canManageSecurity ? { version: 1, profile: 'public', actorDelegation: 'none', allowPrivateNetwork: false, allowInsecureHttp: false, requiredPermissions: [] } : undefined });
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

    const runtimeAuthConfig = form.authSourceType !== 'none' && form.mcpSecurityPolicy?.profile !== 'internal_jwt' && (!connector || form.replaceCredentials) ? buildRuntimeAuthConfig(form) : undefined;
    const leavingConfiguredAuth = !!connector && form.authSourceType === 'none' && (connector.authSourceType !== 'none' || savedSecurity?.mcpSecurityPolicy?.profile !== form.mcpSecurityPolicy?.profile);

    const policyChanged = securityPolicyChanged(form.mcpSecurityPolicy, savedSecurity?.mcpSecurityPolicy);
    if (canManageSecurity && policyChanged && form.mcpSecurityPolicy?.profile === 'internal_jwt' && !form.mcpSecurityPolicy.audience?.trim()) {
      toast.error(t('connectors.form.security.audienceRequired'));
      return;
    }
    onSave({
      ...form,
      mcpSecurityPolicy: canManageSecurity && (!connector || policyChanged) ? form.mcpSecurityPolicy : undefined,
      expectedSecurityRevision: savedSecurity?.securityRevision,
      actions: actions ?? [],
      // A deliberate switch must clear stored headers/env rather than omit the
      // field (omission intentionally preserves secrets on metadata-only saves).
      mcpServerConfig: leavingConfiguredAuth ? '{}' : mcpServerConfig ? JSON.stringify(mcpServerConfig) : '',
      authType: legacyAuth ? connector.authType : form.authSourceType === 'connected_app' ? 'oauth2' : form.authSourceType === 'none' ? 'none' : 'token',
      connectedAppKey: form.authSourceType === 'connected_app' ? form.connectedAppKey : '',
      runtimeAuthConfig: runtimeAuthConfig ? JSON.stringify(runtimeAuthConfig) : '',
      clearCredentials: connector ? form.clearCredentials || leavingConfiguredAuth : false,
    });
  };

  const handleInspect = async () => {
    if (!connector || securityPolicyChanged(form.mcpSecurityPolicy, savedSecurity?.mcpSecurityPolicy) || form.mcpServerUrl !== connector.mcpServerUrl || form.mcpTransportType !== connector.mcpTransportType || form.authSourceType !== (connector.authSourceType || 'credential') || form.connectedAppKey !== (connector.connectedAppKey || '') || form.replaceCredentials || form.clearCredentials || form.mcpServerConfig.trim()) {
      toast.error(t('connectors.form.inspect.saveFirst'));
      return;
    }
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
      // Editing an existing connector inspects with its stored server-side
      // credentials (resolved by the backend via connectorId) unless the admin
      // is replacing them.
      const runtimeAuthConfig = !connector || form.replaceCredentials ? buildRuntimeAuthConfig(form) : undefined;
      const result = await inspectMcp(
        form.mcpTransportType,
        form.mcpServerUrl,
        mcpServerConfig,
        form.authSourceType === 'connected_app' ? form.connectedAppKey || undefined : undefined,
        runtimeAuthConfig,
        connector?.id,
        dynamicRowsToPayload(form.dynamicHeaders),
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

  const connectionFields = (
    <div className='grid gap-4 rounded-md border p-4 sm:grid-cols-2'>
      <div>
        <Label htmlFor='connector-url'>{t('connectors.form.fields.serverUrl.label')}</Label>
        <Input id='connector-url' placeholder={t('connectors.form.fields.serverUrl.placeholder')} value={form.mcpServerUrl} disabled={destinationLocked} onChange={(e) => setForm({ ...form, mcpServerUrl: e.target.value })} />
      </div>
      <div>
        <Label htmlFor='connector-transport'>{t('connectors.form.fields.transportType.label')}</Label>
        <Select disabled={destinationLocked} value={form.mcpTransportType} onValueChange={(value) => setForm({ ...form, mcpTransportType: value })}>
          <SelectTrigger id='connector-transport'><SelectValue placeholder={t('connectors.form.fields.transportType.placeholder')} /></SelectTrigger>
          <SelectContent>{TRANSPORT_TYPES.map((type) => <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className='sm:col-span-2'>
        {connector?.inspectionStatus === 'unsupported_for_http_inspection' ? <p className='text-xs text-muted-foreground'>{t('connectors.form.fields.transportType.unsupportedInspection')}</p> : null}
        <Button type='button' variant='outline' size='sm' onClick={handleInspect} disabled={inspecting || (form.authSourceType === 'connected_app' && form.connectedAppKey !== '' && !isCurrentAppConnected())}>
          {inspecting ? <Loader2 className='me-2 h-4 w-4 animate-spin' /> : <TestTube2 className='me-2 h-4 w-4' />}{t('connectors.form.inspect.action')}
        </Button>
        <p className='mt-2 text-xs text-muted-foreground'>{t('connectors.form.inspect.saveFirst')}</p>
      </div>
    </div>
  );

  const brandingFields = (
    <details className='rounded-md border p-4'>
      <summary className='cursor-pointer font-medium'>{t('connectors.form.sections.branding')}</summary>
      <div className='mt-4 grid gap-4'>
        <div><Label>{t('connectors.form.fields.description.label')}</Label><Textarea placeholder={t('connectors.form.fields.description.placeholder')} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} /></div>
        <div>
          <Label>Category</Label>
          <Select value={form.categoryId || '__none__'} onValueChange={(value) => { if (value === ADD_CATEGORY_VALUE) { setShowCategoriesDialog(true); return; } setForm({ ...form, categoryId: value === '__none__' ? '' : value }); }}>
            <SelectTrigger><SelectValue placeholder='Select a category' /></SelectTrigger>
            <SelectContent><SelectItem value={ADD_CATEGORY_VALUE}><Plus className='me-2 inline h-3.5 w-3.5' />Add category</SelectItem><SelectItem value='__none__'>No category</SelectItem>{availableCategories.map((cat) => <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className='grid gap-4 sm:grid-cols-2'>
          <div>
            <Label>{t('connectors.form.fields.icon.label')}</Label>
            <div className='flex gap-2'>
              <IconPickerPreview icon={form.icon} color={form.color} iconColor={form.iconColor} onClear={() => setForm({ ...form, icon: '' })} onToggleColorMode={() => setForm({ ...form, iconColor: form.iconColor === 'light' ? 'dark' : 'light' })} />
              <div className='min-w-0 flex-1 space-y-1'><Input placeholder='FaGithub' value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} /><a href='https://react-icons.github.io/react-icons/search/#q=' target='_blank' rel='noopener noreferrer' className='flex items-center gap-1 text-xs text-primary hover:underline'><ExternalLink className='h-3 w-3' />Browse icons</a></div>
            </div>
          </div>
          <div><Label>{t('connectors.form.fields.color.label')}</Label><ColorPicker value={form.color} onChange={(value) => setForm({ ...form, color: value })} placeholder='#24292e' /></div>
        </div>
      </div>
    </details>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='w-[calc(100vw-2rem)] max-w-2xl max-h-[85vh] overflow-y-auto'
        onOpenAutoFocus={() => {
          opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }}
        onCloseAutoFocus={(event) => {
          if (opener.current?.isConnected) {
            event.preventDefault();
            opener.current.focus({ preventScroll: true });
          }
        }}>
        <DialogHeader>
          <DialogTitle>{connector ? t('connectors.form.dialog.editTitle') : t('connectors.form.dialog.addTitle')}</DialogTitle>
          <DialogDescription>{t('connectors.form.inspect.saveFirst')}</DialogDescription>
        </DialogHeader>
        <div className='grid min-w-0 gap-4 py-4'>
          <div className='grid gap-4 sm:grid-cols-2'>
            <div>
              <Label>{t('connectors.form.fields.slug.label')}</Label>
              <Input placeholder={t('connectors.form.fields.slug.placeholder')} value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
            </div>
            <div>
              <Label>{t('connectors.form.fields.name.label')}</Label>
              <Input placeholder={t('connectors.form.fields.name.placeholder')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
          </div>

          {connectionFields}
          <div className='grid gap-4 rounded-md border p-4'>
            <div>
              <Label>{t('connectors.form.auth.sectionLabel')}</Label>
              <p className='text-sm text-muted-foreground'>{t('connectors.form.auth.sectionHelper')}</p>
            </div>
            <div className='grid grid-cols-2 gap-4'>
              <div>
                <Label>{t('connectors.form.auth.sourceLabel')}</Label>
                <Select value={form.mcpSecurityPolicy?.profile === 'internal_jwt' ? 'internal_jwt' : form.authSourceType} onValueChange={(value) => setForm({ ...form, authSourceType: value === 'internal_jwt' ? 'none' : value, connectedAppKey: value === 'connected_app' ? form.connectedAppKey : '', mcpSecurityPolicy: canManageSecurity ? { version: 1, profile: value === 'internal_jwt' ? 'internal_jwt' : value === 'none' ? 'public' : 'configured', actorDelegation: value === 'internal_jwt' ? 'verified_user' : 'none', allowPrivateNetwork: value === 'none' ? false : form.mcpSecurityPolicy?.allowPrivateNetwork ?? false, allowInsecureHttp: value === 'none' ? false : form.mcpSecurityPolicy?.allowInsecureHttp ?? false, requiredPermissions: form.mcpSecurityPolicy?.requiredPermissions ?? [], ...(value === 'internal_jwt' && form.mcpSecurityPolicy?.audience ? { audience: form.mcpSecurityPolicy.audience } : {}) } : form.mcpSecurityPolicy })} disabled={legacyAuth || destinationLocked || (!canManageSecurity && form.authSourceType === 'none')}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('connectors.form.auth.sourcePlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {legacyAuth ? (
                      <SelectItem value={form.authSourceType}>{t('connectors.form.auth.serverConfigOption')}</SelectItem>
                    ) : null}
                    {AUTH_SOURCE_TYPES.filter((option) => (option.value !== 'internal_jwt' || canManageSecurity || form.mcpSecurityPolicy?.profile === 'internal_jwt') && (option.value !== 'none' || canManageSecurity || form.authSourceType === 'none')).map((option) => (
                      <SelectItem key={option.value} value={option.value}>{t(option.labelKey)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {form.authSourceType === 'connected_app' ? <div>
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
              </div> : null}
            </div>

            {legacyAuth ? (
              <details><summary className='cursor-pointer'>{t('connectors.form.sections.advanced')}</summary><p className='text-sm text-muted-foreground'>{t('connectors.form.auth.serverConfigHelper')}</p></details>
            ) : null}
            {form.mcpSecurityPolicy?.profile === 'internal_jwt' ? <p className='text-sm text-muted-foreground'>{t('connectors.form.auth.delegationHelper')}</p> : null}
            {canManageSecurity ? <details className='rounded-md border p-3'>
              <summary className='cursor-pointer font-medium'>{t('connectors.form.security.details')}</summary>
              <div className='mt-3 grid gap-3'>
                {form.mcpSecurityPolicy?.profile === 'internal_jwt' ? <div>
                  <Label htmlFor='connector-audience'>{t('connectors.form.security.audience')}</Label>
                  <Input id='connector-audience' maxLength={256} value={form.mcpSecurityPolicy.audience ?? ''} onChange={(event) => setForm({ ...form, mcpSecurityPolicy: { ...form.mcpSecurityPolicy!, audience: event.target.value } })} />
                </div> : null}
                <div className='flex items-center gap-2'>
                  <Switch id='connector-private-network' checked={form.mcpSecurityPolicy?.allowPrivateNetwork ?? false} onCheckedChange={(checked) => setForm({ ...form, mcpSecurityPolicy: { version: 1, profile: form.authSourceType === 'none' ? 'public' : 'configured', actorDelegation: 'none', requiredPermissions: [], allowInsecureHttp: false, ...form.mcpSecurityPolicy, allowPrivateNetwork: checked } })} />
                  <Label htmlFor='connector-private-network'>{t('connectors.form.security.allowPrivateNetwork')}</Label>
                </div>
                {form.authSourceType !== 'none' ? <div className='flex items-center gap-2'>
                  <Switch id='connector-insecure-http' checked={form.mcpSecurityPolicy?.allowInsecureHttp ?? false} onCheckedChange={(checked) => setForm({ ...form, mcpSecurityPolicy: { version: 1, profile: 'configured', actorDelegation: 'none', requiredPermissions: [], allowPrivateNetwork: false, ...form.mcpSecurityPolicy, allowInsecureHttp: checked } })} />
                  <Label htmlFor='connector-insecure-http'>{t('connectors.form.security.allowInsecureHttp')}</Label>
                </div> : null}
                <div>
                  <Label htmlFor='connector-permissions'>{t('connectors.form.security.requiredPermissions')}</Label>
                  <Input id='connector-permissions' maxLength={4096} value={form.requiredPermissionsInput ?? form.mcpSecurityPolicy?.requiredPermissions.join(', ') ?? ''} onChange={(event) => setForm({ ...form, requiredPermissionsInput: event.target.value, mcpSecurityPolicy: { version: 1, profile: form.authSourceType === 'none' ? 'public' : 'configured', actorDelegation: 'none', allowPrivateNetwork: false, allowInsecureHttp: false, ...form.mcpSecurityPolicy, requiredPermissions: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) } })} />
                </div>
              </div>
            </details> : null}

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
                      {oauthConnecting ? <Loader2 className='me-2 h-4 w-4 animate-spin' /> : null}
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
                      {oauthConnecting ? <Loader2 className='me-2 h-4 w-4 animate-spin' /> : <X className='me-2 h-4 w-4' />}
                      {t('connectors.form.auth.disconnectAction', { app: app.displayName })}
                    </Button>
                  )}
                </div>
              );
            })()}

            {connector && form.authSourceType === 'credential' && form.mcpSecurityPolicy?.profile !== 'internal_jwt' ? (
              <div className='grid gap-3 rounded-md bg-muted/40 p-3'>
                <span className={`text-sm font-medium ${connector.credentialConfigured ? 'text-green-600' : 'text-amber-600'}`}>
                  {connector.credentialConfigured
                    ? t('connectors.form.auth.credentialConfigured')
                    : t('connectors.form.auth.credentialNotConfigured')}
                </span>
                <div className='grid gap-1'>
                  <div className='flex items-center gap-2'>
                     <Button type='button' variant={form.replaceCredentials ? 'secondary' : 'outline'} aria-pressed={form.replaceCredentials} onClick={() => setForm({ ...form, replaceCredentials: !form.replaceCredentials, clearCredentials: false })}>{t('connectors.form.auth.replaceCredentials')}</Button>
                  </div>
                  <p className='text-xs text-muted-foreground'>{t('connectors.form.auth.replaceCredentialsHelper')}</p>
                </div>
                {connector.credentialConfigured ? (
                  <div className='flex items-center gap-2'>
                     <Button type='button' variant={form.clearCredentials ? 'destructive' : 'outline'} aria-pressed={form.clearCredentials} onClick={() => setForm({ ...form, clearCredentials: !form.clearCredentials, replaceCredentials: false })}>{t('connectors.form.auth.clearCredentials')}</Button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {form.authSourceType === 'credential' && form.mcpSecurityPolicy?.profile !== 'internal_jwt' && (!connector || form.replaceCredentials) ? <div>
              <Label htmlFor='connector-access-token'>{t('connectors.form.auth.accessToken')}</Label>
              <Input id='connector-access-token' type='password' autoComplete='new-password' value={form.accessToken ?? ''} onChange={(event) => setForm({ ...form, accessToken: event.target.value })} />
            </div> : null}
            {!legacyAuth && form.mcpSecurityPolicy?.profile !== 'internal_jwt' && form.authSourceType !== 'none' && (!connector || form.replaceCredentials) && (
              <details className='rounded-md border p-3'>
                <summary className='cursor-pointer'>{t('connectors.form.sections.runtimeInjection')}</summary>
              <div className='mt-3 grid gap-4'>
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
                        <Plus className='me-2 h-4 w-4' />
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
                        <Plus className='me-2 h-4 w-4' />
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
              </details>
            )}
          </div>

          {brandingFields}
          <details className='rounded-md border p-4'>
          <summary className='cursor-pointer font-medium'>{t('connectors.form.sections.advanced')}</summary>
          <fieldset disabled={destinationLocked || legacyAuth} className='mt-4 grid gap-4'>
          <div>
            <Label>{t('connectors.form.fields.serverConfig.label')}</Label>
            {connector ? (
              <p className='mb-1 text-xs text-muted-foreground'>
                {t('connectors.form.fields.serverConfig.preservedHelper')}
              </p>
            ) : null}
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
                <Plus className='me-2 h-4 w-4' />
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

          </fieldset>
          </details>
          <details className='min-w-0 rounded-md border p-4'>
          <summary className='cursor-pointer font-medium'>{t('connectors.form.actions.title')}</summary>
          <div className='mt-4 grid min-w-0 gap-4'>
          <ConnectorWorkerSettings policy={form.workerPolicy} actions={form.actions ?? []} onPolicyChange={(workerPolicy) => setForm({ ...form, workerPolicy })} onActionsChange={(actions) => setForm({ ...form, actions, actionsJson: JSON.stringify(actions, null, 2) })} />

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
                            <Button type='button' variant='link' className='h-auto max-w-full break-all p-0 text-start font-medium' onClick={() => setSelectedActionKey(action.key)}>
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

          <div className='flex items-center gap-2'>
            <Switch id='connector-system' checked={form.isSystem} onCheckedChange={(checked) => setForm({ ...form, isSystem: checked })} />
            <Label htmlFor='connector-system'>{t('connectors.form.fields.system.label')}</Label>
          </div>
          </div>
          </details>
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
