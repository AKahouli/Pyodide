/**
 * RolesPage - Role management with full CRUD and permission selection
 */

import { useEffect, useState } from 'react';
import {
  Shield,
  Loader2,
  AlertCircle,
  RefreshCw,
  Plus,
  Pencil,
  Trash2,
  Lock,
} from 'lucide-react';
import { toast } from 'sonner';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
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
import { getAllRoles, createRole, updateRole, deleteRole } from '../api';
import type { RoleResponse, CreateRoleRequest, UpdateRoleRequest } from '../types';
import { countSelectedRolePermissions, RolePermissionsEditor } from '../components/RolePermissionsEditor';
import { useModuleTranslation } from '@/modules/localization';
import type { ModuleTranslationKey, TranslationParams } from '@/modules/localization';

type AdminTranslate = (key: ModuleTranslationKey<'admin'>, params?: TranslationParams) => string;

function formatDate(dateString: string, locale: string): string {
  return new Date(dateString).toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// Initial form state
const initialFormState: CreateRoleRequest = {
  name: '',
  description: '',
  permissions: [],
  isActive: true,
  priority: 0,
};

export function RolesPage() {
  const { t, language } = useModuleTranslation('admin');
  const { t: tCommon } = useModuleTranslation('common');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [roles, setRoles] = useState<RoleResponse[]>([]);

  // Modal states
  const [showFormDialog, setShowFormDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleResponse | null>(null);
  const [deletingRole, setDeletingRole] = useState<RoleResponse | null>(null);

  // Form state
  const [formData, setFormData] = useState<CreateRoleRequest>(initialFormState);

  // Permission picker state
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const fetchRoles = async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await getAllRoles();
      setRoles(data.sort((a, b) => b.priority - a.priority));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('roles.errors.load'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRoles();
  }, []);

  const openCreateDialog = () => {
    setEditingRole(null);
    setFormData(initialFormState);
    setExpandedGroups(new Set());
    setShowFormDialog(true);
  };

  const openEditDialog = (role: RoleResponse) => {
    setEditingRole(role);
    setFormData({
      name: role.name,
      description: role.description,
      permissions: [...role.permissions],
      isActive: role.isActive,
      priority: role.priority,
    });
    // Expand groups that have selected permissions
    const groupsToExpand = new Set<string>();
    for (const perm of role.permissions) {
      const namespace = perm === '*' ? 'super' : perm.split('.')[0];
      groupsToExpand.add(namespace);
    }
    setExpandedGroups(groupsToExpand);
    setShowFormDialog(true);
  };

  const openDeleteDialog = (role: RoleResponse) => {
    setDeletingRole(role);
    setShowDeleteDialog(true);
  };

  const toggleGroup = (namespace: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(namespace)) {
        next.delete(namespace);
      } else {
        next.add(namespace);
      }
      return next;
    });
  };

  const togglePermission = (permission: string) => {
    setFormData((prev) => {
      const permissions = prev.permissions.includes(permission)
        ? prev.permissions.filter((p) => p !== permission)
        : [...prev.permissions, permission];
      return { ...prev, permissions };
    });
  };

  const toggleAllInGroup = (namespace: string, groupPermissions: string[]) => {
    setFormData((prev) => {
      const allSelected = groupPermissions.every((p) => prev.permissions.includes(p));
      let permissions: string[];
      if (allSelected) {
        // Remove all from this group
        permissions = prev.permissions.filter((p) => !groupPermissions.includes(p));
      } else {
        // Add all from this group
        const toAdd = groupPermissions.filter((p) => !prev.permissions.includes(p));
        permissions = [...prev.permissions, ...toAdd];
      }
      return { ...prev, permissions };
    });
  };

  const handleSave = async () => {
    setSaving(true);

    try {
      if (editingRole) {
        const dataToUpdate: UpdateRoleRequest = {
          name: formData.name,
          description: formData.description,
          permissions: formData.permissions,
          isActive: formData.isActive,
          priority: formData.priority,
        };

        const updated = await updateRole(editingRole.id, dataToUpdate);
        setRoles((prev) =>
          prev.map((r) => (r.id === updated.id ? updated : r)).sort((a, b) => b.priority - a.priority)
        );
        toast.success(t('roles.toasts.updated.title'), {
          description: t('roles.toasts.updated.description', { name: updated.name }),
        });
      } else {
        const created = await createRole(formData);
        setRoles((prev) => [...prev, created].sort((a, b) => b.priority - a.priority));
        toast.success(t('roles.toasts.created.title'), {
          description: t('roles.toasts.created.description', { name: created.name }),
        });
      }

      setShowFormDialog(false);
    } catch (err) {
      toast.error(editingRole ? t('roles.errors.update') : t('roles.errors.create'), {
        description: err instanceof Error ? err.message : t('roles.errors.unknown'),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingRole) return;

    setSaving(true);

    try {
      await deleteRole(deletingRole.id);
      setRoles((prev) => prev.filter((r) => r.id !== deletingRole.id));
      toast.success(t('roles.toasts.deleted.title'), {
        description: t('roles.toasts.deleted.description', { name: deletingRole.name }),
      });
      setShowDeleteDialog(false);
      setDeletingRole(null);
    } catch (err) {
      toast.error(t('roles.errors.delete'), {
        description: err instanceof Error ? err.message : t('roles.errors.unknown'),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (role: RoleResponse) => {
    try {
      const updated = await updateRole(role.id, { isActive: !role.isActive });
      setRoles((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      toast.success(updated.isActive ? t('roles.toasts.activated.title') : t('roles.toasts.deactivated.title'), {
        description: t(updated.isActive ? 'roles.toasts.activated.description' : 'roles.toasts.deactivated.description', { name: updated.name }),
      });
    } catch (err) {
      toast.error(t('roles.errors.toggle'), {
        description: err instanceof Error ? err.message : t('roles.errors.unknown'),
      });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <AlertCircle className="h-12 w-12 text-destructive" />
        <p className="text-muted-foreground">{error}</p>
        <Button onClick={fetchRoles} variant="outline">
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
          <h1 className="text-2xl font-bold tracking-tight">{t('roles.title')}</h1>
          <p className="text-muted-foreground">{t('roles.description')}</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={fetchRoles} variant="outline" size="icon" aria-label={t('roles.actions.refresh')}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button onClick={openCreateDialog}>
            <Plus className="mr-2 h-4 w-4" />
            {t('roles.actions.create')}
          </Button>
        </div>
      </div>

      {/* Roles Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>{t('roles.table.title')}</CardTitle>
              <CardDescription>{t('roles.table.subtitle', { count: roles.length })}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('roles.table.columns.role')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('roles.table.columns.permissions')}</TableHead>
                  <TableHead className="hidden lg:table-cell">{t('roles.table.columns.priority')}</TableHead>
                  <TableHead className="hidden xl:table-cell">{t('roles.table.columns.created')}</TableHead>
                  <TableHead>{t('roles.table.columns.status')}</TableHead>
                  <TableHead className="text-right">{t('roles.table.columns.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roles.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center">
                      {t('roles.table.empty')}
                    </TableCell>
                  </TableRow>
                ) : (
                  roles.map((role) => (
                    <TableRow key={role.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{role.name}</span>
                            {role.isSystem && (
                              <Badge variant="secondary" className="text-xs">
                                <Lock className="mr-1 h-3 w-3" />
                                System
                              </Badge>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground line-clamp-1">
                            {role.description}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <div className="flex flex-wrap gap-1 max-w-xs">
                          {role.permissions.length === 0 ? (
                            <span className="text-muted-foreground text-sm">No permissions</span>
                          ) : role.permissions.includes('*') ? (
                            <Badge variant="destructive" className="text-xs">
                              Full Access
                            </Badge>
                          ) : (
                            <>
                              {role.permissions.slice(0, 3).map((perm) => (
                                <Badge key={perm} variant="outline" className="text-xs">
                                  {perm}
                                </Badge>
                              ))}
                              {role.permissions.length > 3 && (
                                <Badge variant="outline" className="text-xs">
                                  +{role.permissions.length - 3} more
                                </Badge>
                              )}
                            </>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <span className="text-sm">{role.priority}</span>
                      </TableCell>
                      <TableCell className="hidden xl:table-cell">
                        <span className="text-sm text-muted-foreground">
                          {formatDate(role.createdAt, language)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={role.isActive}
                          onCheckedChange={() => handleToggleActive(role)}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEditDialog(role)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openDeleteDialog(role)}
                            disabled={role.isSystem}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
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
      <Dialog open={showFormDialog} onOpenChange={setShowFormDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingRole ? (
                <>
                  {t('roles.form.editTitle')}
                  {editingRole.isSystem && (
                    <Badge variant="secondary" className="ml-2">
                      <Lock className="mr-1 h-3 w-3" />
                      {t('roles.table.systemBadge')}
                    </Badge>
                  )}
                </>
              ) : (
                t('roles.form.createTitle')
              )}
            </DialogTitle>
            <DialogDescription>
              {editingRole
                ? t('roles.form.editDescription')
                : t('roles.form.createDescription')}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-6 py-4">
            {/* Basic Info */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">{t('roles.form.fields.name.label')}</Label>
                <Input
                  id="name"
                  placeholder={t('roles.form.fields.name.placeholder')}
                  value={formData.name}
                  onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">
                  {t('roles.form.fields.name.helper')}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="priority">{t('roles.form.fields.priority.label')}</Label>
                <Input
                  id="priority"
                  type="number"
                  value={formData.priority}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, priority: parseInt(e.target.value) || 0 }))
                  }
                />
                <p className="text-xs text-muted-foreground">{t('roles.form.fields.priority.helper')}</p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">{t('roles.form.fields.description.label')}</Label>
              <Textarea
                id="description"
                placeholder={t('roles.form.fields.description.placeholder')}
                value={formData.description}
                onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
                rows={2}
              />
            </div>

            {/* Permissions */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-medium">{t('roles.permissions.title')}</h4>
                <span className="text-sm text-muted-foreground">
                  {t('roles.permissions.selected', { count: countSelectedRolePermissions(formData.permissions) })}
                </span>
              </div>

              <RolePermissionsEditor
                permissions={formData.permissions}
                expandedGroups={expandedGroups}
                onToggleGroup={toggleGroup}
                onTogglePermission={togglePermission}
                onToggleAllInGroup={toggleAllInGroup}
                onChange={(permissions) => setFormData((current) => ({ ...current, permissions }))}
                t={t}
              />
              </div>
            </div>

            {/* Active Toggle */}
            <div className="flex items-center gap-2">
            <Switch
              id="isActive"
              checked={formData.isActive}
              onCheckedChange={(checked) => setFormData((prev) => ({ ...prev, isActive: checked }))}
            />
            <Label htmlFor="isActive">{t('roles.form.fields.active.label')}</Label>
            </div>


          <DialogFooter>
              <Button variant="outline" onClick={() => setShowFormDialog(false)} disabled={saving}>
                {tCommon('actionCancel')}
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || !formData.name || !formData.description}
            >
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {editingRole ? t('roles.form.saving.update') : t('roles.form.saving.create')}
                </>
              ) : editingRole ? (
                t('roles.form.actions.update')
              ) : (
                t('roles.form.actions.create')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('roles.modals.delete.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('roles.modals.delete.description', { name: deletingRole?.name ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>{tCommon('actionCancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={saving}
              className="bg-destructive hover:bg-destructive/90"
            >
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('roles.modals.delete.loading')}
                </>
              ) : (
                t('roles.modals.delete.action')
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
