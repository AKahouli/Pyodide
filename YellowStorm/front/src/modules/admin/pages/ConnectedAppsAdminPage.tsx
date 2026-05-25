/**
 * ConnectedAppsAdminPage - Manage external app definitions for user OAuth connections
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plug,
  Loader2,
  AlertCircle,
  RefreshCw,
  Plus,
  Pencil,
  Trash2,
  Search,
  ChevronDown,
} from 'lucide-react';
import { toast } from 'sonner';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import apiClient, { type ApiResponse } from '@/lib/api/client';
import { API_ENDPOINTS } from '@/lib/api/config';
import { useModuleTranslation } from '@/modules/localization';
import { usePermissions } from '../hooks/usePermissions';
import { getOAuthPresets } from '@/modules/connected-app/api';
import { AppKeySelect } from '@/modules/connected-app/components/AppKeySelect';

// Types

interface ConnectedAppAdmin {
  id: string;
  appKey: string;
  authType: 'oauth2' | 'api_key';
  displayName: string;
  description?: string;
  iconKey?: string;
  clientId: string;
  clientSecret: string;
  tenantId?: string;
  authorizationUrl: string;
  tokenUrl: string;
  revokeUrl?: string;
  scopes: string[];
  pkceEnabled: boolean;
  apiKey: string;
  enabled: boolean;
  sortOrder: number;
  connectedUserCount: number;
  createdAt: string;
  updatedAt: string;
}

interface FormData {
  appKey: string;
  authType: 'oauth2' | 'api_key';
  displayName: string;
  description: string;
  iconKey: string;
  clientId: string;
  clientSecret: string;
  tenantId: string;
  authorizationUrl: string;
  tokenUrl: string;
  revokeUrl: string;
  scopes: string;
  pkceEnabled: boolean;
  apiKey: string;
  enabled: boolean;
  sortOrder: number;
}

const MASKED_VALUE = '****';

const initialFormData: FormData = {
  appKey: '',
  authType: 'oauth2',
  displayName: '',
  description: '',
  iconKey: '',
  clientId: '',
  clientSecret: '',
  tenantId: '',
  authorizationUrl: '',
  tokenUrl: '',
  revokeUrl: '',
  scopes: '',
  pkceEnabled: true,
  apiKey: '',
  enabled: true,
  sortOrder: 0,
};

export function ConnectedAppsAdminPage() {
  const { t } = useModuleTranslation('admin');
  const { t: tApp } = useModuleTranslation('connected-app');
  const { t: tCommon } = useModuleTranslation('common');
  const { hasAnyPermission } = usePermissions();
  const canCreate = hasAnyPermission(['connected_apps.create', 'connected_apps.*', '*']);
  const canUpdate = hasAnyPermission(['connected_apps.update', 'connected_apps.*', '*']);
  const canDelete = hasAnyPermission(['connected_apps.delete', 'connected_apps.*', '*']);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apps, setApps] = useState<ConnectedAppAdmin[]>([]);
  const [search, setSearch] = useState('');
  const [presets, setPresets] = useState<Array<{ key: string; displayName: string; appKey: string }>>([]);

  // Dialog states
  const [showFormDialog, setShowFormDialog] = useState(false);
  const [editingApp, setEditingApp] = useState<ConnectedAppAdmin | null>(null);
  const [deletingApp, setDeletingApp] = useState<ConnectedAppAdmin | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  // Form state
  const [formData, setFormData] = useState<FormData>(initialFormData);

  const fetchApps = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.get<ApiResponse<ConnectedAppAdmin[]>>(
        API_ENDPOINTS.adminConnectedApps.list,
      );
      setApps(response.data.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : tApp('admin.errors.load'));
    } finally {
      setLoading(false);
    }
  }, [tApp]);

  useEffect(() => {
    fetchApps();
    fetchPresets();
  }, [fetchApps]);

  const fetchPresets = useCallback(async () => {
    try {
      const presetsData = await getOAuthPresets();
      setPresets(presetsData);
    } catch (err) {
      console.error('Failed to fetch presets:', err);
    }
  }, []);

  // Client-side filtering
  const filteredApps = useMemo(() => {
    if (!search.trim()) return apps;
    const query = search.toLowerCase();
    return apps.filter(
      (a) =>
        a.displayName.toLowerCase().includes(query) ||
        a.appKey.toLowerCase().includes(query),
    );
  }, [apps, search]);

  const openCreateDialog = () => {
    setEditingApp(null);
    setFormData(initialFormData);
    setShowFormDialog(true);
  };

  const openEditDialog = (app: ConnectedAppAdmin) => {
    setEditingApp(app);
    setFormData({
      appKey: app.appKey,
      authType: app.authType || 'oauth2',
      displayName: app.displayName,
      description: app.description ?? '',
      iconKey: app.iconKey ?? '',
      clientId: app.clientId,
      clientSecret: app.clientSecret,
      tenantId: app.tenantId ?? '',
      authorizationUrl: app.authorizationUrl,
      tokenUrl: app.tokenUrl,
      revokeUrl: app.revokeUrl ?? '',
      scopes: app.scopes.join(', '),
      pkceEnabled: app.pkceEnabled,
      apiKey: app.apiKey,
      enabled: app.enabled,
      sortOrder: app.sortOrder,
    });
    setShowFormDialog(true);
  };

  const buildPayload = () => {
    const isEdit = !!editingApp;
    const scopes = formData.scopes
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: Record<string, any> = {
      authType: formData.authType,
      displayName: formData.displayName,
      scopes: formData.authType === 'oauth2' ? scopes : [],
      sortOrder: formData.sortOrder,
      enabled: formData.enabled,
    };

    if (!isEdit) {
      payload.appKey = formData.appKey;
    }

    if (formData.authType === 'oauth2') {
      payload.authorizationUrl = formData.authorizationUrl;
      payload.tokenUrl = formData.tokenUrl;
      payload.pkceEnabled = formData.pkceEnabled;
      if (formData.revokeUrl) payload.revokeUrl = formData.revokeUrl;

      if (!isEdit) {
        payload.clientId = formData.clientId;
        payload.clientSecret = formData.clientSecret;
        if (formData.tenantId) {
          payload.tenantId = formData.tenantId;
        }
      } else {
        if (formData.clientId !== MASKED_VALUE) {
          payload.clientId = formData.clientId;
        }
        if (formData.clientSecret !== MASKED_VALUE) {
          payload.clientSecret = formData.clientSecret;
        }
        if (formData.tenantId && formData.tenantId !== MASKED_VALUE) {
          payload.tenantId = formData.tenantId;
        }
      }
    } else {
      // API key type
      if (!isEdit) {
        payload.apiKey = formData.apiKey;
      } else {
        if (formData.apiKey !== MASKED_VALUE) {
          payload.apiKey = formData.apiKey;
        }
      }
    }

    if (formData.description) payload.description = formData.description;
    if (formData.iconKey) payload.iconKey = formData.iconKey;

    return payload;
  };

  const handleSave = async () => {
    setSaving(true);

    try {
      if (editingApp) {
        const response = await apiClient.patch<ApiResponse<ConnectedAppAdmin>>(
          API_ENDPOINTS.adminConnectedApps.byId(editingApp.id),
          buildPayload(),
        );
        const updated = response.data.data;
        setApps((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
        toast.success(tApp('admin.toasts.updated'), {
          description: updated.displayName,
        });
      } else {
        const response = await apiClient.post<ApiResponse<ConnectedAppAdmin>>(
          API_ENDPOINTS.adminConnectedApps.list,
          buildPayload(),
        );
        const created = response.data.data;
        setApps((prev) => [...prev, created]);
        toast.success(tApp('admin.toasts.created'), {
          description: created.displayName,
        });
      }

      setShowFormDialog(false);
      setEditingApp(null);
    } catch (err) {
      toast.error(
        editingApp
          ? tApp('admin.toasts.errors.update')
          : tApp('admin.toasts.errors.create'),
        {
          description: err instanceof Error ? err.message : tCommon('errorUnknown'),
        },
      );
    } finally {
      setSaving(false);
    }
  };

  const handleToggleEnabled = async (app: ConnectedAppAdmin) => {
    try {
      const response = await apiClient.patch<ApiResponse<ConnectedAppAdmin>>(
        API_ENDPOINTS.adminConnectedApps.byId(app.id),
        { enabled: !app.enabled },
      );
      const updated = response.data.data;
      setApps((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      toast.success(
        updated.enabled
          ? tApp('admin.toasts.enabled')
          : tApp('admin.toasts.disabled'),
        { description: updated.displayName },
      );
    } catch (err) {
      toast.error(tApp('admin.toasts.errors.toggle'), {
        description: err instanceof Error ? err.message : tCommon('errorUnknown'),
      });
    }
  };

  const handleDelete = async () => {
    if (!deletingApp) return;
    setSaving(true);

    try {
      await apiClient.delete(API_ENDPOINTS.adminConnectedApps.byId(deletingApp.id));
      setApps((prev) => prev.filter((a) => a.id !== deletingApp.id));
      toast.success(tApp('admin.toasts.deleted'), {
        description: deletingApp.displayName,
      });
      setDeletingApp(null);
    } catch (err) {
      toast.error(tApp('admin.toasts.errors.delete'), {
        description: err instanceof Error ? err.message : tCommon('errorUnknown'),
      });
    } finally {
      setSaving(false);
    }
  };

  const isFormValid =
    formData.displayName.trim() &&
    (editingApp || formData.appKey.trim()) &&
    (formData.authType === 'oauth2'
      ? formData.clientId.trim() &&
        formData.clientSecret.trim() &&
        formData.authorizationUrl.trim() &&
        formData.tokenUrl.trim() &&
        formData.scopes.trim()
      : formData.apiKey.trim());

  if (loading && apps.length === 0) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error && apps.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <AlertCircle className="h-12 w-12 text-destructive" />
        <p className="text-muted-foreground">{error}</p>
        <Button onClick={fetchApps} variant="outline">
          <RefreshCw className="mr-2 h-4 w-4" />
          {tCommon('actionRetry')}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{tApp('admin.title')}</h1>
          <p className="text-muted-foreground">{tApp('admin.description')}</p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={fetchApps}
            variant="outline"
            size="icon"
            aria-label="Refresh"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          {canCreate && (
            <Button onClick={openCreateDialog}>
              <Plus className="mr-2 h-4 w-4" />
              {tApp('admin.create')}
            </Button>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search apps..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Apps Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <Plug className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>{tApp('admin.title')}</CardTitle>
              <CardDescription>
                {apps.length} app{apps.length !== 1 ? 's' : ''} configured
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tApp('admin.fields.displayName')}</TableHead>
                  <TableHead className="hidden md:table-cell">
                    {tApp('admin.fields.appKey')}
                  </TableHead>
                  <TableHead>Auth Type</TableHead>
                  <TableHead className="hidden lg:table-cell">
                    {tApp('admin.fields.scopes')}
                  </TableHead>
                  <TableHead className="hidden md:table-cell">
                    {tApp('admin.fields.connectedUsers')}
                  </TableHead>
                  <TableHead>{tApp('admin.fields.enabled')}</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredApps.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-24 text-center">
                      {search ? 'No matching apps found.' : 'No apps configured yet.'}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredApps.map((app) => (
                    <TableRow
                      key={app.id}
                      className={!app.enabled ? 'opacity-50' : undefined}
                    >
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{app.displayName}</span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <span className="text-sm font-mono text-muted-foreground">
                          {app.appKey}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={app.authType === 'api_key' ? 'default' : 'secondary'}>
                          {app.authType === 'api_key' ? 'API Key' : 'OAuth 2.0'}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <span className="text-sm text-muted-foreground truncate max-w-48 block">
                          {app.scopes.join(', ')}
                        </span>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <Badge variant="secondary">{app.connectedUserCount}</Badge>
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={app.enabled}
                          onCheckedChange={() => handleToggleEnabled(app)}
                          disabled={!canUpdate}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {canUpdate && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openEditDialog(app)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}
                          {canDelete && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setDeletingApp(app)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog
        open={showFormDialog}
        onOpenChange={(open) => {
          setShowFormDialog(open);
          if (!open) setEditingApp(null);
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingApp ? tApp('admin.edit') : tApp('admin.create')}
            </DialogTitle>
            <DialogDescription>
              {editingApp
                ? 'Update the app definition. Masked fields are preserved unless changed.'
                : 'Add a new external app that users can connect to.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* App Key — only on create */}
            {!editingApp && (
              <div className="space-y-2">
                <Label htmlFor="appKey">{tApp('admin.fields.appKey')}</Label>
                <AppKeySelect
                  id="appKey"
                  value={formData.appKey}
                  onChange={(value) =>
                    setFormData((prev) => ({ ...prev, appKey: value }))
                  }
                  presets={presets}
                  existingAppKeys={apps.map((a) => a.appKey)}
                  placeholder="Select or enter app key..."
                />
                <p className="text-xs text-muted-foreground">
                  Lowercase letters, numbers, and hyphens only. Cannot be changed after creation.
                </p>
              </div>
            )}

            {/* Auth Type Selector */}
            <div className="space-y-2">
              <Label htmlFor="authType">Authentication Type</Label>
              <Select
                value={formData.authType}
                onValueChange={(value: 'oauth2' | 'api_key') =>
                  setFormData((prev) => ({ ...prev, authType: value }))
                }
                disabled={!!editingApp}
              >
                <SelectTrigger id="authType">
                  <SelectValue placeholder="Select authentication type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="oauth2">OAuth 2.0</SelectItem>
                  <SelectItem value="api_key">API Key</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {formData.authType === 'oauth2'
                  ? 'OAuth 2.0 requires users to connect their accounts through authorization flow.'
                  : 'API Key type uses a static key that is stored in the app definition. No user connection required.'}
              </p>
            </div>

            {/* Display Name */}
            <div className="space-y-2">
              <Label htmlFor="displayName">{tApp('admin.fields.displayName')}</Label>
              <Input
                id="displayName"
                placeholder="e.g., Google Drive, Microsoft 365"
                value={formData.displayName}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, displayName: e.target.value }))
                }
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description">{tApp('admin.fields.description')}</Label>
              <Textarea
                id="description"
                placeholder="Brief description shown to users"
                value={formData.description}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, description: e.target.value }))
                }
                rows={2}
              />
            </div>

            {/* OAuth 2.0 Fields */}
            {formData.authType === 'oauth2' && (
              <>
                {/* Client ID & Client Secret */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="clientId">{tApp('admin.fields.clientId')}</Label>
                    <Input
                      id="clientId"
                      placeholder={editingApp ? MASKED_VALUE : 'OAuth client ID'}
                      value={formData.clientId}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, clientId: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="clientSecret">{tApp('admin.fields.clientSecret')}</Label>
                    <Input
                      id="clientSecret"
                      placeholder={editingApp ? MASKED_VALUE : 'OAuth client secret'}
                      value={formData.clientSecret}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, clientSecret: e.target.value }))
                      }
                    />
                  </div>
                </div>

                {/* Tenant ID */}
                <div className="space-y-2">
                  <Label htmlFor="tenantId">{tApp('admin.fields.tenantId')}</Label>
                  <Input
                    id="tenantId"
                    placeholder="Azure AD tenant ID (optional)"
                    value={formData.tenantId}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, tenantId: e.target.value }))
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Required for Microsoft/Azure AD. Use &quot;common&quot; for multi-tenant or a specific tenant ID.
                  </p>
                </div>

                {/* Authorization URL */}
                <div className="space-y-2">
                  <Label htmlFor="authorizationUrl">{tApp('admin.fields.authorizationUrl')}</Label>
                  <Input
                    id="authorizationUrl"
                    placeholder="https://accounts.google.com/o/oauth2/v2/auth"
                    value={formData.authorizationUrl}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, authorizationUrl: e.target.value }))
                    }
                  />
                </div>

                {/* Token URL */}
                <div className="space-y-2">
                  <Label htmlFor="tokenUrl">{tApp('admin.fields.tokenUrl')}</Label>
                  <Input
                    id="tokenUrl"
                    placeholder="https://oauth2.googleapis.com/token"
                    value={formData.tokenUrl}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, tokenUrl: e.target.value }))
                    }
                  />
                </div>

                {/* Revoke URL */}
                <div className="space-y-2">
                  <Label htmlFor="revokeUrl">{tApp('admin.fields.revokeUrl')}</Label>
                  <Input
                    id="revokeUrl"
                    placeholder="https://oauth2.googleapis.com/revoke (optional)"
                    value={formData.revokeUrl}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, revokeUrl: e.target.value }))
                    }
                  />
                </div>

                {/* Scopes */}
                <div className="space-y-2">
                  <Label htmlFor="scopes">{tApp('admin.fields.scopes')}</Label>
                  <Textarea
                    id="scopes"
                    placeholder="Files.Read.All, Sites.Read.All, Mail.Read"
                    value={formData.scopes}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, scopes: e.target.value }))
                    }
                    rows={2}
                  />
                  <p className="text-xs text-muted-foreground">
                    Comma-separated list of OAuth scopes to request from the provider.
                  </p>
                </div>

                {/* PKCE Enabled toggle */}
                <div className="flex items-center gap-2">
                  <Switch
                    id="pkceEnabled"
                    checked={formData.pkceEnabled}
                    onCheckedChange={(checked) =>
                      setFormData((prev) => ({ ...prev, pkceEnabled: checked }))
                    }
                  />
                  <Label htmlFor="pkceEnabled">{tApp('admin.fields.pkceEnabled')}</Label>
                </div>
              </>
            )}

            {/* API Key Field */}
            {formData.authType === 'api_key' && (
              <div className="space-y-2">
                <Label htmlFor="apiKey">API Key</Label>
                <Input
                  id="apiKey"
                  type="password"
                  placeholder={editingApp ? MASKED_VALUE : 'Enter the API key'}
                  value={formData.apiKey}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, apiKey: e.target.value }))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  The API key will be encrypted and stored in the database. It will be used for all MCP requests to this service.
                </p>
              </div>
            )}


            {/* Icon Key & Sort Order */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="iconKey">{tApp('admin.fields.iconKey')}</Label>
                <Input
                  id="iconKey"
                  placeholder="e.g., google-drive, microsoft"
                  value={formData.iconKey}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, iconKey: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sortOrder">{tApp('admin.fields.sortOrder')}</Label>
                <Input
                  id="sortOrder"
                  type="number"
                  value={formData.sortOrder}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      sortOrder: parseInt(e.target.value) || 0,
                    }))
                  }
                />
              </div>
            </div>

            {/* Enabled toggle */}
            <div className="flex items-center gap-2">
              <Switch
                id="enabled"
                checked={formData.enabled}
                onCheckedChange={(checked) =>
                  setFormData((prev) => ({ ...prev, enabled: checked }))
                }
              />
              <Label htmlFor="enabled">{tApp('admin.fields.enabled')}</Label>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowFormDialog(false)}
              disabled={saving}
            >
              {tCommon('actionCancel')}
            </Button>
            <Button onClick={handleSave} disabled={saving || !isFormValid}>
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : editingApp ? (
                'Save Changes'
              ) : (
                'Create App'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={!!deletingApp}
        onOpenChange={(open) => {
          if (!open) {
            setDeletingApp(null);
            setDeleteConfirmText('');
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tApp('admin.delete')}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>{tApp('admin.confirmDelete')}</p>
                {(deletingApp?.connectedUserCount ?? 0) > 0 && (
                  <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                    {deletingApp?.connectedUserCount} user{(deletingApp?.connectedUserCount ?? 0) !== 1 ? 's' : ''} will be disconnected.
                  </div>
                )}
                <p className="text-sm">
                  Type <span className="font-mono font-bold">{deletingApp?.appKey}</span> to confirm:
                </p>
                <Input
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder={deletingApp?.appKey ?? ''}
                  className="font-mono"
                />
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>{tCommon('actionCancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={saving || deleteConfirmText !== deletingApp?.appKey}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete App'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
