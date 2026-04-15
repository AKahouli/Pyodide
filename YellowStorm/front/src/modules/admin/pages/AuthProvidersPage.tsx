/**
 * AuthProvidersPage - OAuth authentication provider management for admin
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  KeyRound,
  Loader2,
  AlertCircle,
  RefreshCw,
  Plus,
  Pencil,
  Trash2,
  Search,
} from 'lucide-react';
import { toast } from 'sonner';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
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
import apiClient, { type ApiResponse } from '@/lib/api/client';
import { API_ENDPOINTS } from '@/lib/api/config';
import { useModuleTranslation } from '@/modules/localization';
import { usePermissions } from '../hooks/usePermissions';

// Types

interface AuthProviderAdmin {
  type: 'classic' | 'oauth';
  id: string;
  providerKey: string;
  displayName: string;
  clientId: string;
  clientSecret: string;
  tenantId?: string;
  authorizationUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  scopes: string[];
  iconKey?: string;
  sortOrder: number;
  pkceEnabled: boolean;
  enabled: boolean;
  linkedUserCount: number;
  registrationEnabled?: boolean;
  createdAt: string;
  updatedAt: string;
}

interface AuthProviderFormData {
  providerKey: string;
  displayName: string;
  clientId: string;
  clientSecret: string;
  tenantId: string;
  authorizationUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  scopes: string;
  iconKey: string;
  sortOrder: number;
  pkceEnabled: boolean;
  enabled: boolean;
}

const MASKED_VALUE = '****';

const initialFormData: AuthProviderFormData = {
  providerKey: '',
  displayName: '',
  clientId: '',
  clientSecret: '',
  tenantId: '',
  authorizationUrl: '',
  tokenUrl: '',
  userinfoUrl: '',
  scopes: 'openid,email,profile',
  iconKey: '',
  sortOrder: 0,
  pkceEnabled: true,
  enabled: true,
};

export function AuthProvidersPage() {
  const { t } = useModuleTranslation('admin');
  const { t: tCommon } = useModuleTranslation('common');
  const { hasAnyPermission } = usePermissions();
  const canCreate = hasAnyPermission(['auth_providers.create', 'auth_providers.*', '*']);
  const canUpdate = hasAnyPermission(['auth_providers.update', 'auth_providers.*', '*']);
  const canDelete = hasAnyPermission(['auth_providers.delete', 'auth_providers.*', '*']);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<AuthProviderAdmin[]>([]);
  const [search, setSearch] = useState('');

  // Dialog states
  const [showFormDialog, setShowFormDialog] = useState(false);
  const [editingProvider, setEditingProvider] = useState<AuthProviderAdmin | null>(null);
  const [deletingProvider, setDeletingProvider] = useState<AuthProviderAdmin | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteLinks, setDeleteLinks] = useState(false);

  // Form state
  const [formData, setFormData] = useState<AuthProviderFormData>(initialFormData);

  // Classic auth edit dialog
  const [showClassicDialog, setShowClassicDialog] = useState(false);
  const [classicEnabled, setClassicEnabled] = useState(true);
  const [classicRegistrationEnabled, setClassicRegistrationEnabled] = useState(true);
  const [classicSaving, setClassicSaving] = useState(false);

  const fetchProviders = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.get<ApiResponse<AuthProviderAdmin[]>>(
        API_ENDPOINTS.adminAuthProviders.list,
      );
      setProviders(response.data.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('authProviders.errors.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  // Client-side filtering
  const filteredProviders = useMemo(() => {
    if (!search.trim()) return providers;

    const query = search.toLowerCase();
    return providers.filter(
      (p) =>
        p.displayName.toLowerCase().includes(query) ||
        p.providerKey.toLowerCase().includes(query),
    );
  }, [providers, search]);

  const openCreateDialog = () => {
    setEditingProvider(null);
    setFormData(initialFormData);
    setShowFormDialog(true);
  };

  const openEditDialog = (provider: AuthProviderAdmin) => {
    if (provider.type === 'classic') {
      setClassicEnabled(provider.enabled);
      setClassicRegistrationEnabled(provider.registrationEnabled ?? true);
      setShowClassicDialog(true);
      return;
    }
    setEditingProvider(provider);
    setFormData({
      providerKey: provider.providerKey,
      displayName: provider.displayName,
      clientId: provider.clientId,
      clientSecret: provider.clientSecret,
      tenantId: provider.tenantId ?? '',
      authorizationUrl: provider.authorizationUrl,
      tokenUrl: provider.tokenUrl,
      userinfoUrl: provider.userinfoUrl,
      scopes: provider.scopes.join(','),
      iconKey: provider.iconKey ?? '',
      sortOrder: provider.sortOrder,
      pkceEnabled: provider.pkceEnabled,
      enabled: provider.enabled,
    });
    setShowFormDialog(true);
  };

  const handleClassicSave = async () => {
    setClassicSaving(true);
    try {
      const response = await apiClient.patch<ApiResponse<AuthProviderAdmin>>(
        API_ENDPOINTS.adminAuthProviders.classic,
        { enabled: classicEnabled, registrationEnabled: classicRegistrationEnabled },
      );
      const updated = response.data.data;
      setProviders((prev) => prev.map((p) => (p.id === 'classic' ? updated : p)));
      toast.success(t('authProviders.toasts.updated.title'), {
        description: t('authProviders.toasts.updated.description', {
          name: updated.displayName,
        }),
      });
      setShowClassicDialog(false);
    } catch (err) {
      toast.error(t('authProviders.toasts.errors.update'), {
        description: err instanceof Error ? err.message : tCommon('errorUnknown'),
      });
    } finally {
      setClassicSaving(false);
    }
  };

  const handleToggleClassicEnabled = async (provider: AuthProviderAdmin) => {
    try {
      const response = await apiClient.patch<ApiResponse<AuthProviderAdmin>>(
        API_ENDPOINTS.adminAuthProviders.classic,
        { enabled: !provider.enabled },
      );
      const updated = response.data.data;
      setProviders((prev) => prev.map((p) => (p.id === 'classic' ? updated : p)));
      toast.success(
        updated.enabled
          ? t('authProviders.toasts.enabled.title')
          : t('authProviders.toasts.disabled.title'),
        {
          description: t(
            updated.enabled
              ? 'authProviders.toasts.enabled.description'
              : 'authProviders.toasts.disabled.description',
            { name: updated.displayName },
          ),
        },
      );
    } catch (err) {
      toast.error(t('authProviders.toasts.errors.toggle'), {
        description: err instanceof Error ? err.message : tCommon('errorUnknown'),
      });
    }
  };

  const buildPayload = () => {
    const isEdit = !!editingProvider;
    const scopes = formData.scopes
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: Record<string, any> = {
      displayName: formData.displayName,
      authorizationUrl: formData.authorizationUrl,
      tokenUrl: formData.tokenUrl,
      userinfoUrl: formData.userinfoUrl,
      scopes,
      sortOrder: formData.sortOrder,
      pkceEnabled: formData.pkceEnabled,
      enabled: formData.enabled,
    };

    if (!isEdit) {
      payload.providerKey = formData.providerKey;
    }

    // Only send secret fields if they were changed from the masked value
    if (formData.clientId !== MASKED_VALUE) {
      payload.clientId = formData.clientId;
    }
    if (formData.clientSecret !== MASKED_VALUE) {
      payload.clientSecret = formData.clientSecret;
    }
    if (formData.tenantId && formData.tenantId !== MASKED_VALUE) {
      payload.tenantId = formData.tenantId;
    }

    if (formData.iconKey) {
      payload.iconKey = formData.iconKey;
    }

    return payload;
  };

  const handleSave = async () => {
    setSaving(true);

    try {
      if (editingProvider) {
        const response = await apiClient.patch<ApiResponse<AuthProviderAdmin>>(
          API_ENDPOINTS.adminAuthProviders.byId(editingProvider.id),
          buildPayload(),
        );
        const updated = response.data.data;
        setProviders((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
        toast.success(t('authProviders.toasts.updated.title'), {
          description: t('authProviders.toasts.updated.description', {
            name: updated.displayName,
          }),
        });
      } else {
        const response = await apiClient.post<ApiResponse<AuthProviderAdmin>>(
          API_ENDPOINTS.adminAuthProviders.list,
          buildPayload(),
        );
        const created = response.data.data;
        setProviders((prev) => [...prev, created]);
        toast.success(t('authProviders.toasts.created.title'), {
          description: t('authProviders.toasts.created.description', {
            name: created.displayName,
          }),
        });
      }

      setShowFormDialog(false);
      setEditingProvider(null);
    } catch (err) {
      toast.error(
        editingProvider
          ? t('authProviders.toasts.errors.update')
          : t('authProviders.toasts.errors.create'),
        {
          description: err instanceof Error ? err.message : tCommon('errorUnknown'),
        },
      );
    } finally {
      setSaving(false);
    }
  };

  const handleToggleEnabled = async (provider: AuthProviderAdmin) => {
    try {
      const response = await apiClient.patch<ApiResponse<AuthProviderAdmin>>(
        API_ENDPOINTS.adminAuthProviders.byId(provider.id),
        { enabled: !provider.enabled },
      );
      const updated = response.data.data;
      setProviders((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      toast.success(
        updated.enabled
          ? t('authProviders.toasts.enabled.title')
          : t('authProviders.toasts.disabled.title'),
        {
          description: t(
            updated.enabled
              ? 'authProviders.toasts.enabled.description'
              : 'authProviders.toasts.disabled.description',
            { name: updated.displayName },
          ),
        },
      );
    } catch (err) {
      toast.error(t('authProviders.toasts.errors.toggle'), {
        description: err instanceof Error ? err.message : tCommon('errorUnknown'),
      });
    }
  };

  const handleDelete = async () => {
    if (!deletingProvider) return;

    setSaving(true);

    try {
      await apiClient.delete(API_ENDPOINTS.adminAuthProviders.byId(deletingProvider.id), {
        params: deleteLinks ? { deleteLinks: 'true' } : undefined,
      });
      setProviders((prev) => prev.filter((p) => p.id !== deletingProvider.id));
      toast.success(t('authProviders.toasts.deleted.title'), {
        description: t('authProviders.toasts.deleted.description', {
          name: deletingProvider.displayName,
        }),
      });
      setDeletingProvider(null);
    } catch (err) {
      toast.error(t('authProviders.toasts.errors.delete'), {
        description: err instanceof Error ? err.message : tCommon('errorUnknown'),
      });
    } finally {
      setSaving(false);
    }
  };

  const isFormValid =
    formData.displayName.trim() &&
    formData.clientId.trim() &&
    formData.clientSecret.trim() &&
    formData.authorizationUrl.trim() &&
    formData.tokenUrl.trim() &&
    formData.userinfoUrl.trim() &&
    (editingProvider || formData.providerKey.trim());

  if (loading && providers.length === 0) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error && providers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <AlertCircle className="h-12 w-12 text-destructive" />
        <p className="text-muted-foreground">{error}</p>
        <Button onClick={fetchProviders} variant="outline">
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
          <h1 className="text-2xl font-bold tracking-tight">{t('authProviders.title')}</h1>
          <p className="text-muted-foreground">{t('authProviders.description')}</p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={fetchProviders}
            variant="outline"
            size="icon"
            aria-label={t('authProviders.actions.refresh')}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          {canCreate && (
            <Button onClick={openCreateDialog}>
              <Plus className="mr-2 h-4 w-4" />
              {t('authProviders.actions.create')}
            </Button>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={t('authProviders.search.placeholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Providers Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <KeyRound className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>{t('authProviders.card.title')}</CardTitle>
              <CardDescription>
                {t('authProviders.card.description', { count: providers.length })}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('authProviders.table.displayName')}</TableHead>
                  <TableHead className="hidden md:table-cell">
                    {t('authProviders.table.providerKey')}
                  </TableHead>
                  <TableHead className="hidden lg:table-cell">
                    {t('authProviders.table.scopes')}
                  </TableHead>
                  <TableHead>{t('authProviders.table.enabled')}</TableHead>
                  <TableHead className="text-right">
                    {t('authProviders.table.actions')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProviders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center">
                      {search
                        ? t('authProviders.table.empty.search')
                        : t('authProviders.table.empty.default')}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredProviders.map((provider) => (
                    <TableRow
                      key={provider.id}
                      className={!provider.enabled ? 'opacity-50' : undefined}
                    >
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{provider.displayName}</span>
                          {provider.type === 'classic' && (
                            <Badge variant="outline" className="text-xs">
                              {t('authProviders.classic.badge')}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <span className="text-sm font-mono text-muted-foreground">
                          {provider.providerKey}
                        </span>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <span className="text-sm text-muted-foreground">
                          {provider.type === 'classic' ? '—' : provider.scopes.join(', ')}
                        </span>
                      </TableCell>
                      <TableCell>
                        {provider.type === 'classic' ? (
                          <Switch
                            checked={provider.enabled}
                            onCheckedChange={() => handleToggleClassicEnabled(provider)}
                            disabled={!canUpdate}
                          />
                        ) : (
                          <Switch
                            checked={provider.enabled}
                            onCheckedChange={() => handleToggleEnabled(provider)}
                            disabled={!canUpdate}
                          />
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {canUpdate && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openEditDialog(provider)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}
                          {provider.type !== 'classic' && canDelete && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setDeletingProvider(provider)}
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
          if (!open) setEditingProvider(null);
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingProvider
                ? t('authProviders.dialog.editTitle')
                : t('authProviders.dialog.createTitle')}
            </DialogTitle>
            <DialogDescription>
              {editingProvider
                ? t('authProviders.dialog.editDescription')
                : t('authProviders.dialog.createDescription')}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* Provider Key — only on create */}
            {!editingProvider && (
              <div className="space-y-2">
                <Label htmlFor="providerKey">{t('authProviders.form.providerKey')}</Label>
                <Input
                  id="providerKey"
                  placeholder={t('authProviders.form.providerKeyPlaceholder')}
                  value={formData.providerKey}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, providerKey: e.target.value }))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  {t('authProviders.form.providerKeyHelper')}
                </p>
              </div>
            )}

            {/* Display Name */}
            <div className="space-y-2">
              <Label htmlFor="displayName">{t('authProviders.form.displayName')}</Label>
              <Input
                id="displayName"
                placeholder={t('authProviders.form.displayNamePlaceholder')}
                value={formData.displayName}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, displayName: e.target.value }))
                }
              />
            </div>

            {/* Client ID & Client Secret */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="clientId">{t('authProviders.form.clientId')}</Label>
                <Input
                  id="clientId"
                  placeholder={
                    editingProvider
                      ? MASKED_VALUE
                      : t('authProviders.form.clientIdPlaceholder')
                  }
                  value={formData.clientId}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, clientId: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="clientSecret">{t('authProviders.form.clientSecret')}</Label>
                <Input
                  id="clientSecret"
                  placeholder={
                    editingProvider
                      ? MASKED_VALUE
                      : t('authProviders.form.clientSecretPlaceholder')
                  }
                  value={formData.clientSecret}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, clientSecret: e.target.value }))
                  }
                />
              </div>
            </div>

            {/* Tenant ID */}
            <div className="space-y-2">
              <Label htmlFor="tenantId">{t('authProviders.form.tenantId')}</Label>
              <Input
                id="tenantId"
                placeholder={t('authProviders.form.tenantIdPlaceholder')}
                value={formData.tenantId}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, tenantId: e.target.value }))
                }
              />
              <p className="text-xs text-muted-foreground">
                {t('authProviders.form.tenantIdHelper')}
              </p>
            </div>

            {/* Authorization URL */}
            <div className="space-y-2">
              <Label htmlFor="authorizationUrl">
                {t('authProviders.form.authorizationUrl')}
              </Label>
              <Input
                id="authorizationUrl"
                type="url"
                placeholder={t('authProviders.form.authorizationUrlPlaceholder')}
                value={formData.authorizationUrl}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, authorizationUrl: e.target.value }))
                }
              />
            </div>

            {/* Token URL */}
            <div className="space-y-2">
              <Label htmlFor="tokenUrl">{t('authProviders.form.tokenUrl')}</Label>
              <Input
                id="tokenUrl"
                type="url"
                placeholder={t('authProviders.form.tokenUrlPlaceholder')}
                value={formData.tokenUrl}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, tokenUrl: e.target.value }))
                }
              />
            </div>

            {/* Userinfo URL */}
            <div className="space-y-2">
              <Label htmlFor="userinfoUrl">{t('authProviders.form.userinfoUrl')}</Label>
              <Input
                id="userinfoUrl"
                type="url"
                placeholder={t('authProviders.form.userinfoUrlPlaceholder')}
                value={formData.userinfoUrl}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, userinfoUrl: e.target.value }))
                }
              />
            </div>

            {/* Scopes */}
            <div className="space-y-2">
              <Label htmlFor="scopes">{t('authProviders.form.scopes')}</Label>
              <Input
                id="scopes"
                placeholder={t('authProviders.form.scopesPlaceholder')}
                value={formData.scopes}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, scopes: e.target.value }))
                }
              />
              <p className="text-xs text-muted-foreground">
                {t('authProviders.form.scopesHelper')}
              </p>
            </div>

            {/* Icon Key & Sort Order */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="iconKey">{t('authProviders.form.iconKey')}</Label>
                <Input
                  id="iconKey"
                  placeholder={t('authProviders.form.iconKeyPlaceholder')}
                  value={formData.iconKey}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, iconKey: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sortOrder">{t('authProviders.form.sortOrder')}</Label>
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

            {/* PKCE Enabled & Enabled toggles */}
            <div className="flex flex-col gap-4 sm:flex-row sm:gap-8">
              <div className="flex items-center gap-2">
                <Switch
                  id="pkceEnabled"
                  checked={formData.pkceEnabled}
                  onCheckedChange={(checked) =>
                    setFormData((prev) => ({ ...prev, pkceEnabled: checked }))
                  }
                />
                <Label htmlFor="pkceEnabled">{t('authProviders.form.pkceEnabled')}</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="enabled"
                  checked={formData.enabled}
                  onCheckedChange={(checked) =>
                    setFormData((prev) => ({ ...prev, enabled: checked }))
                  }
                />
                <Label htmlFor="enabled">{t('authProviders.form.enabled')}</Label>
              </div>
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
                  {editingProvider
                    ? t('authProviders.dialog.saving')
                    : t('authProviders.dialog.creating')}
                </>
              ) : editingProvider ? (
                t('authProviders.dialog.save')
              ) : (
                t('authProviders.dialog.create')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Classic Auth Edit Dialog */}
      <Dialog
        open={showClassicDialog}
        onOpenChange={setShowClassicDialog}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('authProviders.classic.editTitle')}</DialogTitle>
            <DialogDescription>{t('authProviders.classic.editDescription')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <Label htmlFor="classicEnabledToggle" className="text-base font-medium">
                  {t('authProviders.classic.enabled')}
                </Label>
                <p className="text-sm text-muted-foreground">
                  {t('authProviders.classic.enabledDescription')}
                </p>
              </div>
              <Switch
                id="classicEnabledToggle"
                checked={classicEnabled}
                onCheckedChange={setClassicEnabled}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <Label htmlFor="classicRegToggle" className="text-base font-medium">
                  {t('authProviders.classic.registrationEnabled')}
                </Label>
                <p className="text-sm text-muted-foreground">
                  {t('authProviders.classic.registrationDescription')}
                </p>
              </div>
              <Switch
                id="classicRegToggle"
                checked={classicRegistrationEnabled}
                onCheckedChange={setClassicRegistrationEnabled}
                disabled={!classicEnabled}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowClassicDialog(false)}
              disabled={classicSaving}
            >
              {tCommon('actionCancel')}
            </Button>
            <Button onClick={handleClassicSave} disabled={classicSaving}>
              {classicSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('authProviders.dialog.saving')}
                </>
              ) : (
                t('authProviders.dialog.save')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={!!deletingProvider}
        onOpenChange={(open) => {
          if (!open) {
            setDeletingProvider(null);
            setDeleteConfirmText('');
            setDeleteLinks(false);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('authProviders.delete.title')}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  {t('authProviders.delete.description', {
                    name: deletingProvider?.displayName ?? '',
                  })}
                </p>
                {(deletingProvider?.linkedUserCount ?? 0) > 0 && (
                  <>
                    <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                      {t('authProviders.delete.warning', {
                        count: deletingProvider?.linkedUserCount ?? 0,
                      })}
                    </div>
                    <div className="flex items-start gap-2">
                      <Checkbox
                        id="deleteLinks"
                        checked={deleteLinks}
                        onCheckedChange={(checked) => setDeleteLinks(checked === true)}
                      />
                      <Label htmlFor="deleteLinks" className="text-sm font-normal leading-snug cursor-pointer">
                        {t('authProviders.delete.deleteLinks')}
                      </Label>
                    </div>
                  </>
                )}
                <p className="text-sm">
                  {t('authProviders.delete.challenge', {
                    name: deletingProvider?.providerKey ?? '',
                  })}
                </p>
                <Input
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder={deletingProvider?.providerKey ?? ''}
                  className="font-mono"
                />
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>{tCommon('actionCancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={saving || deleteConfirmText !== deletingProvider?.providerKey}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('authProviders.delete.deleting')}
                </>
              ) : (
                t('authProviders.delete.confirm')
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
