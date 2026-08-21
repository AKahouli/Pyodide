/**
 * ModelsPage - AI model management
 */

import { useEffect, useState } from 'react';
import {
  Cpu,
  Loader2,
  AlertCircle,
  RefreshCw,
  Pencil,
  Star,
  Cloud,
  MessagesSquare,
} from 'lucide-react';
import { toast } from 'sonner';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  getAllModels,
  updateModel,
  setDefaultModel,
  clearDefaultModel,
  setConversationV2DefaultModel,
  clearConversationV2DefaultModel,
  syncModels,
} from '../api';
import { useModelsStore } from '@/modules/models';
import type { AdminModelResponse, AdminModelsListResponse, ModelInputModality, ModelType } from '../types';
import { MODEL_INPUT_MODALITIES, MODEL_TYPES } from '../types';
import { useModuleTranslation } from '@/modules/localization';
import type { ModuleTranslationKey, TranslationParams } from '@/modules/localization';

type AdminTranslate = (key: ModuleTranslationKey<'admin'>, params?: TranslationParams) => string;

// Provider slug to display name mapping
const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  azure: 'Azure',
  cohere: 'Cohere',
  mistral: 'Mistral AI',
  meta: 'Meta',
  'meta-llama': 'Meta',
  deepseek: 'DeepSeek',
  groq: 'Groq',
  perplexity: 'Perplexity',
  together: 'Together AI',
  anyscale: 'Anyscale',
  replicate: 'Replicate',
  huggingface: 'Hugging Face',
  bedrock: 'AWS Bedrock',
  vertex_ai: 'Google Vertex AI',
  sagemaker: 'AWS SageMaker',
  ollama: 'Ollama',
  custom: 'Custom',
};

function getProviderDisplayName(slug: string): string {
  return PROVIDER_DISPLAY_NAMES[slug.toLowerCase()] || slug.charAt(0).toUpperCase() + slug.slice(1);
}

// Sort models: default first, then active, then alphabetically by name
function sortModels(models: AdminModelResponse[]): AdminModelResponse[] {
  return [...models].sort((a, b) => {
    // Default model first
    if (a.isDefault !== b.isDefault) {
      return a.isDefault ? -1 : 1;
    }
    // Active models before inactive
    if (a.isActive !== b.isActive) {
      return a.isActive ? -1 : 1;
    }
    // Then sort alphabetically by name
    return a.name.localeCompare(b.name);
  });
}

function normalizeModel(model: AdminModelResponse): AdminModelResponse {
  return {
    ...model,
    types: Array.isArray(model.types) ? model.types : model.type ? [model.type] : [],
    inputModalities: Array.isArray(model.inputModalities) && model.inputModalities.includes('text')
      ? model.inputModalities
      : ['text'],
  };
}

export function ModelsPage() {
  const { t } = useModuleTranslation('admin');
  const { t: tCommon } = useModuleTranslation('common');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<AdminModelResponse[]>([]);

  // Edit dialog state
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingModel, setEditingModel] = useState<AdminModelResponse | null>(null);
  const [editFormData, setEditFormData] = useState({
    name: '',
    providers: '',
    chefSlug: '',
    types: [] as ModelType[],
    omitTemperature: false,
    inputModalities: ['text'] as ModelInputModality[],
  });

  const fetchModels = async () => {
    setLoading(true);
    setError(null);

    try {
      const data: AdminModelsListResponse = await getAllModels();
      setModels(sortModels(data.models.map(normalizeModel)));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('models.errors.load'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchModels();
  }, []);

  const handleSync = async () => {
    setSyncing(true);

    try {
      const result = await syncModels();
      toast.success(t('models.toasts.synced.title'), {
        description: t('models.toasts.synced.description', { added: result.added, activated: result.reactivated, deactivated: result.deactivated }),
      });
      await fetchModels();
    } catch (err) {
      toast.error(t('models.toasts.syncError.title'), {
        description: err instanceof Error ? err.message : t('models.toasts.syncError.description'),
      });
    } finally {
      setSyncing(false);
    }
  };

  const handleToggleActive = async (model: AdminModelResponse) => {
    try {
      const updated = await updateModel(model.id, { isActive: !model.isActive });
      setModels((prev) =>
        sortModels(prev.map((m) => (m.id === updated.id ? normalizeModel(updated) : m)))
      );
      toast.success(updated.isActive ? t('models.toasts.enabled.title') : t('models.toasts.disabled.title'), {
        description: t(updated.isActive ? 'models.toasts.enabled.description' : 'models.toasts.disabled.description', { name: updated.name }),
      });
    } catch (err) {
      toast.error(t('models.toasts.updateError.title'), {
        description: err instanceof Error ? err.message : tCommon('errorUnknown'),
      });
    }
  };

  const handleToggleDefault = async (model: AdminModelResponse) => {
    try {
      if (model.isDefault) {
        // Clear default
        const updated = await clearDefaultModel(model.id);
        setModels((prev) =>
          sortModels(prev.map((m) => (m.id === updated.id ? normalizeModel(updated) : m)))
        );
        toast.success(t('models.toasts.defaultCleared.title'), {
          description: t('models.toasts.defaultCleared.description', { name: updated.name }),
        });
      } else {
        // Set as default
        const updated = await setDefaultModel(model.id);
        // Update all models - clear previous default and set new one
        setModels((prev) =>
          sortModels(
            prev.map((m) => ({
              ...m,
              isDefault: m.id === updated.id,
            }))
          )
        );
        toast.success(t('models.toasts.defaultSet.title'), {
          description: t('models.toasts.defaultSet.description', { name: updated.name }),
        });
      }
    } catch (err) {
      toast.error(t('models.toasts.defaultError.title'), {
        description: err instanceof Error ? err.message : tCommon('errorUnknown'),
      });
    }
  };

  const handleToggleConversationV2Default = async (model: AdminModelResponse) => {
    try {
      if (model.isConversationV2Default) {
        // Clear conversation-v2 default
        const updated = await clearConversationV2DefaultModel(model.id);
        setModels((prev) =>
          sortModels(prev.map((m) => (m.id === updated.id ? normalizeModel(updated) : m)))
        );
        useModelsStore.getState().syncConversationV2Default(null);
        toast.success(t('models.toasts.conversationV2DefaultCleared.title'), {
          description: t('models.toasts.conversationV2DefaultCleared.description', {
            name: updated.name,
          }),
        });
      } else {
        // Set as conversation-v2 default
        const updated = await setConversationV2DefaultModel(model.id);
        // Update all models - clear previous conversation-v2 default and set new one
        setModels((prev) =>
          sortModels(
            prev.map((m) => ({
              ...m,
              isConversationV2Default: m.id === updated.id,
            }))
          )
        );
        useModelsStore.getState().syncConversationV2Default(updated.id);
        toast.success(t('models.toasts.conversationV2DefaultSet.title'), {
          description: t('models.toasts.conversationV2DefaultSet.description', {
            name: updated.name,
          }),
        });
      }
    } catch (err) {
      toast.error(t('models.toasts.conversationV2DefaultError.title'), {
        description: err instanceof Error ? err.message : tCommon('errorUnknown'),
      });
    }
  };

  const openEditDialog = (model: AdminModelResponse) => {
    setEditingModel(model);
    setEditFormData({
      name: model.name,
      providers: model.providers.join(', '),
      chefSlug: model.chefSlug,
      types: (model.types.length > 0 ? model.types : model.type ? [model.type] : []) as ModelType[],
      omitTemperature: model.omitTemperature,
      inputModalities: model.inputModalities,
    });
    setShowEditDialog(true);
  };

  const handleSaveEdit = async () => {
    if (!editingModel) return;

    setSaving(true);

    try {
      const providers = editFormData.providers
        .split(',')
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

      // Get chef display name from chefSlug
      const chefSlug = editFormData.chefSlug;
      const chef = getProviderDisplayName(chefSlug);

      const updated = await updateModel(editingModel.id, {
        name: editFormData.name,
        chef,
        chefSlug,
        providers,
        types: editFormData.types,
        omitTemperature: editFormData.omitTemperature,
        inputModalities: editFormData.inputModalities,
      });

      setModels((prev) =>
        sortModels(prev.map((m) => (m.id === updated.id ? normalizeModel(updated) : m)))
      );

      toast.success(t('models.toasts.editSuccess.title'), {
        description: t('models.toasts.editSuccess.description', { name: updated.name }),
      });

      setShowEditDialog(false);
    } catch (err) {
      toast.error(t('models.toasts.updateError.title'), {
        description: err instanceof Error ? err.message : tCommon('errorUnknown'),
      });
    } finally {
      setSaving(false);
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
        <Button onClick={fetchModels} variant="outline">
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
          <h1 className="text-2xl font-bold tracking-tight">{t('models.title')}</h1>
          <p className="text-muted-foreground">{t('models.description')}</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={fetchModels} variant="outline" size="icon" aria-label={t('models.actions.refresh')}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button onClick={handleSync} disabled={syncing}>
            {syncing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('models.syncing')}
              </>
            ) : (
              <>
                <Cloud className="mr-2 h-4 w-4" />
                {t('models.actions.sync')}
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Models Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <Cpu className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>{t('models.table.title')}</CardTitle>
              <CardDescription>
                {t('models.table.description', { count: models.filter((m) => m.isActive).length, total: models.length })}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('models.table.columns.model')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('models.table.columns.type')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('models.table.columns.provider')}</TableHead>
                  <TableHead className="hidden lg:table-cell">{t('models.table.columns.providers')}</TableHead>
                  <TableHead>{t('models.table.columns.enabled')}</TableHead>
                  <TableHead>{t('models.table.columns.default')}</TableHead>
                  <TableHead className="text-right">{t('models.table.columns.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {models.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-24 text-center">
                      {t('models.table.empty')}
                    </TableCell>
                  </TableRow>
                ) : (
                  models.map((model) => (
                    <TableRow
                      key={model.id}
                      className={!model.isActive ? 'opacity-50' : undefined}
                    >
                      <TableCell>
                        <div className="flex flex-col">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{model.name}</span>
                            {model.isDefault && (
                              <Badge variant="default" className="text-xs">
                                <Star className="mr-1 h-3 w-3" />
                                {t('models.table.defaultBadge')}
                              </Badge>
                            )}
                            {model.isConversationV2Default && (
                              <Badge variant="secondary" className="text-xs">
                                <MessagesSquare className="mr-1 h-3 w-3" />
                                {t('models.table.conversationV2DefaultBadge')}
                              </Badge>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground font-mono">
                            {model.id}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {model.types.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {model.types.map((type) => <Badge key={type} variant="secondary">{type}</Badge>)}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {t('models.table.typeUnset')}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <Badge variant="outline">{model.chef}</Badge>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <div className="flex flex-wrap gap-1">
                          {model.providers.map((provider) => (
                            <Badge
                              key={provider}
                              variant={provider === model.chefSlug ? 'default' : 'secondary'}
                              className="text-xs"
                            >
                              {getProviderDisplayName(provider)}
                              {provider === model.chefSlug && ` ${t('models.table.providerPrimarySuffix')}`}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={model.isActive}
                          onCheckedChange={() => handleToggleActive(model)}
                        />
                      </TableCell>
                      <TableCell>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleToggleDefault(model)}
                                disabled={!model.isActive}
                              >
                                <Star
                                  className={`h-4 w-4 ${
                                    model.isDefault
                                      ? 'fill-yellow-400 text-yellow-400'
                                      : 'text-muted-foreground'
                                  }`}
                                />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {model.isDefault
                                ? t('models.table.actions.clearDefault')
                                : t('models.table.actions.setDefault')}
                            </TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleToggleConversationV2Default(model)}
                                disabled={!model.isActive}
                              >
                                <MessagesSquare
                                  className={`h-4 w-4 ${
                                    model.isConversationV2Default
                                      ? 'fill-sky-400 text-sky-400'
                                      : 'text-muted-foreground'
                                  }`}
                                />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {model.isConversationV2Default
                                ? t('models.table.actions.clearConversationV2Default')
                                : t('models.table.actions.setConversationV2Default')}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t('models.table.actions.edit')}
                          onClick={() => openEditDialog(model)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('models.edit.title')}</DialogTitle>
            <DialogDescription>
              {t('models.edit.description')}
            </DialogDescription>
          </DialogHeader>

          {editingModel && (
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label>{t('models.edit.fields.modelId')}</Label>
                <Input value={editingModel.id} disabled className="font-mono" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="name">{t('models.edit.fields.name')}</Label>
                <Input
                  id="name"
                  placeholder={t('models.edit.fields.namePlaceholder')}
                  value={editFormData.name}
                  onChange={(e) =>
                    setEditFormData((prev) => ({ ...prev, name: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>{t('models.edit.fields.type')}</Label>
                <div className="grid grid-cols-2 gap-2 rounded-md border p-3">
                  {MODEL_TYPES.map((modelType) => (
                    <Label key={modelType} htmlFor={`type-${modelType}`} className="flex items-center gap-2 font-normal">
                      <Checkbox
                        id={`type-${modelType}`}
                        checked={editFormData.types.includes(modelType)}
                        onCheckedChange={(checked) => setEditFormData((prev) => ({
                          ...prev,
                          types: checked === true
                            ? [...prev.types, modelType]
                            : prev.types.filter((type) => type !== modelType),
                        }))}
                      />
                      {modelType}
                    </Label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('models.edit.fields.typeHelper')}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="providers">{t('models.edit.fields.providers')}</Label>
                <Input
                  id="providers"
                  placeholder={t('models.edit.fields.providersPlaceholder')}
                  value={editFormData.providers}
                  onChange={(e) =>
                    setEditFormData((prev) => ({ ...prev, providers: e.target.value }))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  {t('models.edit.fields.providersHelper')}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="chefSlug">{t('models.edit.fields.primaryProvider')}</Label>
                <Select
                  value={editFormData.chefSlug}
                  onValueChange={(value) =>
                    setEditFormData((prev) => ({ ...prev, chefSlug: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('models.edit.fields.selectProvider')} />
                  </SelectTrigger>
                  <SelectContent>
                    {editFormData.providers
                      .split(',')
                      .map((p) => p.trim())
                      .filter((p) => p.length > 0)
                      .map((provider) => (
                        <SelectItem key={provider} value={provider}>
                          {getProviderDisplayName(provider)}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {t('models.edit.fields.primaryProviderHelper')}
                </p>
              </div>
              <div className="space-y-2">
                <Label>{t('models.edit.fields.inputModalities')}</Label>
                <div className="grid grid-cols-2 gap-2 rounded-md border p-3">
                  {MODEL_INPUT_MODALITIES.map((modality) => (
                    <Label key={modality} htmlFor={`input-modality-${modality}`} className="flex items-center gap-2 font-normal">
                      <Checkbox
                        id={`input-modality-${modality}`}
                        checked={editFormData.inputModalities.includes(modality)}
                        disabled={modality === 'text'}
                        onCheckedChange={(checked) => setEditFormData((prev) => ({
                          ...prev,
                          inputModalities: checked === true
                            ? [...new Set([...prev.inputModalities, modality])]
                            : prev.inputModalities.filter((value) => value !== modality),
                        }))}
                      />
                      {t(`models.edit.fields.inputModalities.${modality}`)}
                    </Label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('models.edit.fields.inputModalitiesHelper')}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="omitTemperature" className="flex items-center gap-2 font-normal">
                  <Checkbox
                    id="omitTemperature"
                    checked={editFormData.omitTemperature}
                    onCheckedChange={(checked) =>
                      setEditFormData((prev) => ({ ...prev, omitTemperature: checked === true }))
                    }
                  />
                  {t('models.edit.fields.omitTemperature')}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t('models.edit.fields.omitTemperatureHelper')}
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowEditDialog(false)}
              disabled={saving}
            >
              {t('models.edit.actions.cancel')}
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={saving || !editFormData.name.trim()}
            >
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('models.edit.actions.saving')}
                </>
              ) : (
                t('models.edit.actions.save')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
