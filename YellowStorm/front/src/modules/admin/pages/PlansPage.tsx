/**
 * PlansPage - Plan management with full CRUD
 */

import { useEffect, useState } from 'react';
import {
  CreditCard,
  Loader2,
  AlertCircle,
  RefreshCw,
  Plus,
  Pencil,
  Trash2,
  Infinity,
  Star,
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
import { getAllPlans, createPlan, updatePlan, deletePlan } from '../api';
import type { PlanResponse, CreatePlanRequest, UpdatePlanRequest } from '../types';
import { useModuleTranslation } from '@/modules/localization';
import type { ModuleTranslationKey, TranslationParams } from '@/modules/localization';

type AdminTranslate = (key: ModuleTranslationKey<'admin'>, params?: TranslationParams) => string;

// Format bytes to human readable
function formatBytes(bytes: number, t: AdminTranslate): string {
  if (bytes < 0) return t('plans.values.unlimited');
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

// Format number with commas
function formatNumber(num: number, t: AdminTranslate): string {
  if (num < 0) return t('plans.values.unlimited');
  return num.toLocaleString();
}

// Format price
function formatPrice(price: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
  }).format(price);
}

// Initial form state
const initialFormState: CreatePlanRequest = {
  name: '',
  slug: '',
  description: '',
  tokenLimit: 10000,
  windowHours: 24,
  requestsPerMinute: 10,
  maxTokensPerRequest: 2000,
  features: [],
  priority: 0,
  priceMonthly: 0,
  priceYearly: 0,
  currency: 'USD',
  isActive: true,
  isDefault: false,
  displayOrder: 0,
  maxWorkspaces: 3,
  workspaceStorageBytes: 100 * 1024 * 1024,
};

export function PlansPage() {
  const { t } = useModuleTranslation('admin');
  const { t: tCommon } = useModuleTranslation('common');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plans, setPlans] = useState<PlanResponse[]>([]);

  // Modal states
  const [showFormDialog, setShowFormDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [editingPlan, setEditingPlan] = useState<PlanResponse | null>(null);
  const [deletingPlan, setDeletingPlan] = useState<PlanResponse | null>(null);

  // Form state
  const [formData, setFormData] = useState<CreatePlanRequest>(initialFormState);
  const [featuresInput, setFeaturesInput] = useState('');

  const fetchPlans = async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await getAllPlans();
      setPlans(data.sort((a, b) => a.displayOrder - b.displayOrder));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('plans.errors.load'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPlans();
  }, []);

  const openCreateDialog = () => {
    setEditingPlan(null);
    setFormData(initialFormState);
    setFeaturesInput('');
    setShowFormDialog(true);
  };

  const openEditDialog = (plan: PlanResponse) => {
    setEditingPlan(plan);
    setFormData({
      name: plan.name,
      slug: plan.slug,
      description: plan.description || '',
      tokenLimit: plan.tokenLimit,
      windowHours: plan.windowHours,
      requestsPerMinute: plan.requestsPerMinute,
      maxTokensPerRequest: plan.maxTokensPerRequest,
      features: plan.features,
      priority: plan.priority,
      priceMonthly: plan.priceMonthly,
      priceYearly: plan.priceYearly,
      currency: plan.currency,
      isActive: plan.isActive,
      isDefault: plan.isDefault,
      displayOrder: plan.displayOrder,
      maxWorkspaces: plan.maxWorkspaces,
      workspaceStorageBytes: plan.workspaceStorageBytes,
    });
    setFeaturesInput(plan.features.join(', '));
    setShowFormDialog(true);
  };

  const openDeleteDialog = (plan: PlanResponse) => {
    setDeletingPlan(plan);
    setShowDeleteDialog(true);
  };

  const handleSave = async () => {
    setSaving(true);

    try {
      // Parse features from comma-separated input
      const features = featuresInput
        .split(',')
        .map((f) => f.trim())
        .filter((f) => f.length > 0);

      const dataToSave = {
        ...formData,
        features,
      };

      if (editingPlan) {
        // Remove slug from update payload - it cannot be changed
        const { slug: _slug, ...updateData } = dataToSave;
        const updated = await updatePlan(editingPlan.id, updateData as UpdatePlanRequest);
        setPlans((prev) =>
          prev.map((p) => (p.id === updated.id ? updated : p)).sort((a, b) => a.displayOrder - b.displayOrder)
        );
        toast.success(t('plans.toasts.updated.title'), {
          description: t('plans.toasts.updated.description', { name: updated.name }),
        });
      } else {
        const created = await createPlan(dataToSave);
        setPlans((prev) => [...prev, created].sort((a, b) => a.displayOrder - b.displayOrder));
        toast.success(t('plans.toasts.created.title'), {
          description: t('plans.toasts.created.description', { name: created.name }),
        });
      }

      setShowFormDialog(false);
    } catch (err) {
      toast.error(
        t(editingPlan ? 'plans.toasts.errors.update' : 'plans.toasts.errors.create'),
        {
          description: err instanceof Error ? err.message : tCommon('errorUnknown'),
        }
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingPlan) return;

    setSaving(true);

    try {
      await deletePlan(deletingPlan.id);
      setPlans((prev) => prev.filter((p) => p.id !== deletingPlan.id));
      toast.success(t('plans.toasts.deleted.title'), {
        description: t('plans.toasts.deleted.description', { name: deletingPlan.name }),
      });
      setShowDeleteDialog(false);
      setDeletingPlan(null);
    } catch (err) {
      toast.error(t('plans.toasts.errors.delete'), {
        description: err instanceof Error ? err.message : tCommon('errorUnknown'),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (plan: PlanResponse) => {
    try {
      const updated = await updatePlan(plan.id, { isActive: !plan.isActive });
      setPlans((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      toast.success(
        t(updated.isActive ? 'plans.toasts.activated.title' : 'plans.toasts.deactivated.title'),
        {
          description: t('plans.toasts.status.description', {
            name: updated.name,
            status: t(updated.isActive ? 'plans.status.active' : 'plans.status.inactive'),
          }),
        }
      );
    } catch (err) {
      toast.error(t('plans.toasts.errors.status'), {
        description: err instanceof Error ? err.message : tCommon('errorUnknown'),
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
        <Button onClick={fetchPlans} variant="outline">
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
          <h1 className="text-2xl font-bold tracking-tight">{t('plans.title')}</h1>
          <p className="text-muted-foreground">{t('plans.description')}</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={fetchPlans} variant="outline" size="icon" aria-label={t('plans.actions.refresh')}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button onClick={openCreateDialog}>
            <Plus className="mr-2 h-4 w-4" />
            {t('plans.actions.create')}
          </Button>
        </div>
      </div>

      {/* Plans Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <CreditCard className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>{t('plans.table.title')}</CardTitle>
              <CardDescription>{t('plans.table.description', { count: plans.length })}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('plans.table.columns.plan')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('plans.table.columns.tokens')}</TableHead>
                  <TableHead className="hidden lg:table-cell">{t('plans.table.columns.price')}</TableHead>
                  <TableHead className="hidden xl:table-cell">{t('plans.table.columns.workspaces')}</TableHead>
                  <TableHead>{t('plans.table.columns.status')}</TableHead>
                  <TableHead className="text-right">{t('plans.table.columns.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plans.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center">
                      {t('plans.table.empty')}
                    </TableCell>
                  </TableRow>
                ) : (
                  plans.map((plan) => (
                    <TableRow key={plan.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{plan.name}</span>
                            {plan.isDefault && (
                              <Badge variant="secondary" className="text-xs">
                                <Star className="mr-1 h-3 w-3" />
                                {t('plans.badges.default')}
                              </Badge>
                            )}
                            {plan.isUnlimited && (
                              <Badge variant="outline" className="text-xs">
                                <Infinity className="mr-1 h-3 w-3" />
                                {t('plans.badges.unlimited')}
                              </Badge>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground">{plan.slug}</span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <div className="flex flex-col">
                          <span>
                            {plan.tokenLimit < 0 ? (
                              <span className="flex items-center gap-1">
                                <Infinity className="h-3 w-3" />
                                {t('plans.details.tokens.unlimited')}
                              </span>
                            ) : (
                              t('plans.details.tokens.value', {
                                value: formatNumber(plan.tokenLimit, t),
                              })
                            )}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {t('plans.details.tokens.window', { hours: plan.windowHours })}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <div className="flex flex-col">
                          <span>
                            {t('plans.details.price.monthly', {
                              price: formatPrice(plan.priceMonthly, plan.currency),
                            })}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {t('plans.details.price.yearly', {
                              price: formatPrice(plan.priceYearly, plan.currency),
                            })}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden xl:table-cell">
                        <div className="flex flex-col">
                          <span>
                            {plan.maxWorkspaces < 0 ? (
                              <span className="flex items-center gap-1">
                                <Infinity className="h-3 w-3" />
                                {t('plans.details.workspaces.unlimited')}
                              </span>
                            ) : (
                              plan.maxWorkspaces
                            )}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {t('plans.details.workspaces.storage', {
                              amount: formatBytes(plan.workspaceStorageBytes, t),
                            })}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={plan.isActive}
                          onCheckedChange={() => handleToggleActive(plan)}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEditDialog(plan)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openDeleteDialog(plan)}
                            disabled={plan.isDefault}
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
              {editingPlan ? t('plans.form.editTitle') : t('plans.form.createTitle')}
            </DialogTitle>
            <DialogDescription>
              {editingPlan
                ? t('plans.form.editDescription')
                : t('plans.form.createDescription')}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-6 py-4">
            {/* Basic Info */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">{t('plans.form.fields.name.label')}</Label>
                <Input
                  id="name"
                  placeholder={t('plans.form.fields.name.placeholder')}
                  value={formData.name}
                  onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="slug">{t('plans.form.fields.slug.label')}</Label>
                <Input
                  id="slug"
                  placeholder={t('plans.form.fields.slug.placeholder')}
                  value={formData.slug}
                  onChange={(e) => setFormData((prev) => ({ ...prev, slug: e.target.value }))}
                  disabled={!!editingPlan}
                />
                {editingPlan && (
                  <p className="text-xs text-muted-foreground">
                    {t('plans.form.fields.slug.helper')}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">{t('plans.form.fields.description.label')}</Label>
              <Textarea
                id="description"
                placeholder={t('plans.form.fields.description.placeholder')}
                value={formData.description}
                onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
                rows={2}
              />
            </div>

            {/* Token Limits */}
            <div className="space-y-4">
              <h4 className="font-medium">{t('plans.form.sections.usage')}</h4>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="tokenLimit">{t('plans.form.fields.tokenLimit.label')}</Label>
                  <Input
                    id="tokenLimit"
                    type="number"
                    value={formData.tokenLimit}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, tokenLimit: parseInt(e.target.value) || 0 }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="windowHours">{t('plans.form.fields.windowHours.label')}</Label>
                  <Input
                    id="windowHours"
                    type="number"
                    value={formData.windowHours}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, windowHours: parseInt(e.target.value) || 24 }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="requestsPerMinute">
                    {t('plans.form.fields.requestsPerMinute.label')}
                  </Label>
                  <Input
                    id="requestsPerMinute"
                    type="number"
                    value={formData.requestsPerMinute}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        requestsPerMinute: parseInt(e.target.value) || 0,
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="maxTokensPerRequest">
                    {t('plans.form.fields.maxTokensPerRequest.label')}
                  </Label>
                  <Input
                    id="maxTokensPerRequest"
                    type="number"
                    value={formData.maxTokensPerRequest}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        maxTokensPerRequest: parseInt(e.target.value) || 0,
                      }))
                    }
                  />
                </div>
              </div>
            </div>

            {/* Workspace Limits */}
            <div className="space-y-4">
              <h4 className="font-medium">{t('plans.form.sections.workspace')}</h4>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="maxWorkspaces">{t('plans.form.fields.maxWorkspaces.label')}</Label>
                  <Input
                    id="maxWorkspaces"
                    type="number"
                    value={formData.maxWorkspaces}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, maxWorkspaces: parseInt(e.target.value) || 0 }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="workspaceStorageBytes">
                    {t('plans.form.fields.workspaceStorageBytes.label')}
                  </Label>
                  <Input
                    id="workspaceStorageBytes"
                    type="number"
                    value={formData.workspaceStorageBytes}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        workspaceStorageBytes: parseInt(e.target.value) || 0,
                      }))
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('plans.form.fields.workspaceStorageBytes.helper', {
                      value: formatBytes(formData.workspaceStorageBytes || 0, t),
                    })}
                  </p>
                </div>
              </div>
            </div>

            {/* Pricing */}
            <div className="space-y-4">
              <h4 className="font-medium">{t('plans.form.sections.pricing')}</h4>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="priceMonthly">{t('plans.form.fields.priceMonthly.label')}</Label>
                  <Input
                    id="priceMonthly"
                    type="number"
                    step="0.01"
                    value={formData.priceMonthly}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        priceMonthly: parseFloat(e.target.value) || 0,
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="priceYearly">{t('plans.form.fields.priceYearly.label')}</Label>
                  <Input
                    id="priceYearly"
                    type="number"
                    step="0.01"
                    value={formData.priceYearly}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        priceYearly: parseFloat(e.target.value) || 0,
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="currency">{t('plans.form.fields.currency.label')}</Label>
                  <Input
                    id="currency"
                    placeholder={t('plans.form.fields.currency.placeholder')}
                    value={formData.currency}
                    onChange={(e) => setFormData((prev) => ({ ...prev, currency: e.target.value }))}
                  />
                </div>
              </div>
            </div>

            {/* Features */}
            <div className="space-y-2">
              <Label htmlFor="features">{t('plans.form.fields.features.label')}</Label>
              <Input
                id="features"
                placeholder={t('plans.form.fields.features.placeholder')}
                value={featuresInput}
                onChange={(e) => setFeaturesInput(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {t('plans.form.fields.features.helper')}
              </p>
            </div>

            {/* Priority & Display */}
            <div className="space-y-4">
              <h4 className="font-medium">{t('plans.form.sections.priority')}</h4>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="priority">{t('plans.form.fields.priority.label')}</Label>
                  <Input
                    id="priority"
                    type="number"
                    value={formData.priority}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, priority: parseInt(e.target.value) || 0 }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="displayOrder">{t('plans.form.fields.displayOrder.label')}</Label>
                  <Input
                    id="displayOrder"
                    type="number"
                    value={formData.displayOrder}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        displayOrder: parseInt(e.target.value) || 0,
                      }))
                    }
                  />
                </div>
              </div>
            </div>

            {/* Status Toggles */}
            <div className="space-y-4">
              <h4 className="font-medium">{t('plans.form.sections.status')}</h4>
              <div className="flex flex-col gap-4 sm:flex-row sm:gap-8">
                <div className="flex items-center gap-2">
                  <Switch
                    id="isActive"
                    checked={formData.isActive}
                    onCheckedChange={(checked) =>
                      setFormData((prev) => ({ ...prev, isActive: checked }))
                    }
                  />
                  <Label htmlFor="isActive">{t('plans.form.toggles.active')}</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="isDefault"
                    checked={formData.isDefault}
                    onCheckedChange={(checked) =>
                      setFormData((prev) => ({ ...prev, isDefault: checked }))
                    }
                  />
                  <Label htmlFor="isDefault">{t('plans.form.toggles.default')}</Label>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowFormDialog(false)} disabled={saving}>
              {tCommon('actionCancel')}
            </Button>
            <Button onClick={handleSave} disabled={saving || !formData.name || !formData.slug}>
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {editingPlan
                    ? t('plans.form.actions.updating')
                    : t('plans.form.actions.creating')}
                </>
              ) : editingPlan ? (
                t('plans.form.actions.update')
              ) : (
                t('plans.form.actions.create')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('plans.delete.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('plans.delete.description', { name: deletingPlan?.name ?? '' })}
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
                  {t('plans.delete.actions.deleting')}
                </>
              ) : (
                t('plans.delete.actions.confirm')
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
