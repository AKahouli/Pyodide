import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, RefreshCw, Save, FileText, BadgeInfo, ChevronDown, Plus, Trash2, LayoutGrid, X, Check, Palette, Sparkles, Download, Upload } from 'lucide-react';
import { toast } from 'sonner';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { useAgents, useAgentStore } from '@/modules/agent/store';
import {
  PlaybookIteratorConfigFields,
  PlaybookRouterConfigSection,
  buildRouterOutputPorts,
  cloneRouterConfig,
  usePlaybookStore,
  type PlaybookIteratorConfig,
  type PlaybookNodeType,
  type RouterConfig,
} from '@/modules/playbook';
import { getDefaultIteratorInputPorts, getDefaultIteratorOutputPorts } from '@/modules/playbook/hooks/helpers/node-serializer';
import apiClient from '@/lib/api/client';
import {
  getPlaybookPrompts,
  updatePlaybookPrompt,
  deletePlaybookPrompt,
  importPlaybookPrompts,
  getPlaybookNodeTemplates,
  createPlaybookNodeTemplate,
  updatePlaybookNodeTemplate,
  deletePlaybookNodeTemplate,
  importPlaybookNodeTemplates,
} from '../api';
import type { PlaybookPromptImportPayload, PlaybookPromptResponse, PlaybookNodeTemplateImportPayload, PlaybookNodeTemplateResponse, PlaybookNodeTemplatePort } from '../types';
import * as Icons from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const EMPTY_PROMPT: PlaybookPromptResponse = {
  id: '',
  key: '',
  title: '',
  category: 'task',
  description: '',
  systemTemplate: '',
  userTemplate: '',
  enabled: true,
  version: 1,
  isBuiltIn: false,
  createdAt: '',
  updatedAt: '',
};

const EMPTY_NODE_TEMPLATE: PlaybookNodeTemplateResponse = {
  id: '',
  key: '',
  nodeType: 'agent',
  title: '',
  description: '',
  icon: 'FileText',
  color: 'blue',
  category: 'content',
  inputPorts: [],
  outputPorts: [],
  promptTemplate: '',
  recommendedAgentTypeSlug: null,
  requiredToolNames: [],
  assignedAgentId: null,
  selectedAction: null,
  enabled: true,
  version: 1,
  isBuiltIn: false,
  createdAt: '',
  updatedAt: '',
};

const EMPTY_PORT: PlaybookNodeTemplatePort = { id: '', name: '', artifactKind: 'text', required: false };
const DEFAULT_ITERATOR_CONFIG: PlaybookIteratorConfig = {
  source: '{{items}}',
  mode: 'item',
  batchSize: 10,
  itemVariable: 'item',
  outputVariable: 'processed_items',
  errorStrategy: 'stop',
};

// Constants for selects
const CATEGORIES = ['content', 'generation', 'analysis', 'code', 'evaluation'];
const ACTIONS = ['index', 'delete', 'read'];
const ARTIFACT_KINDS = ['text', 'document', 'code', 'data', 'image', 'dashboard'];
const COLORS = ['blue', 'indigo', 'green', 'orange', 'purple', 'red', 'pink', 'slate', 'cyan', 'teal'] as const;

const COLOR_MAP: Record<string, string> = {
  blue: '#3b82f6',
  indigo: '#6366f1',
  green: '#22c55e',
  orange: '#f97316',
  purple: '#a855f7',
  red: '#ef4444',
  pink: '#ec4899',
  slate: '#64748b',
  cyan: '#06b6d4',
  teal: '#14b8a6',
};

// Curated Lucide icons for templates
const ICON_NAMES = [
  'FileText', 'FileType', 'Presentation', 'Code', 'BarChart3', 'Database', 'Image', 'Search',
  'Mail', 'MessageSquare', 'Calendar', 'Clock', 'Settings', 'Tool', 'Zap', 'Sparkles',
  'Brain', 'Bot', 'User', 'Users', 'Globe', 'Link', 'Paperclip', 'Upload',
  'Download', 'Copy', 'Edit', 'Trash2', 'Eye', 'EyeOff', 'Lock', 'Unlock',
  'Check', 'X', 'Plus', 'Minus', 'ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown',
  'ChevronRight', 'ChevronLeft', 'ChevronUp', 'ChevronDown', 'RefreshCw', 'RotateCcw', 'Save', 'Send', 'Scale'
];

// Helper to generate slug from title
function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeNodeTemplate(template: PlaybookNodeTemplateResponse): PlaybookNodeTemplateResponse {
  if (template.nodeType === 'iterator') {
    return {
      ...template,
      assignedAgentId: null,
      selectedAction: null,
      inputPorts: getDefaultIteratorInputPorts(),
      outputPorts: getDefaultIteratorOutputPorts(),
      iteratorConfig: template.iteratorConfig ?? { ...DEFAULT_ITERATOR_CONFIG },
      routerConfig: null,
    };
  }

  if (template.nodeType === 'router') {
    const routerConfig = cloneRouterConfig(template.routerConfig);
    return {
      ...template,
      assignedAgentId: null,
      selectedAction: null,
      outputPorts: buildRouterOutputPorts(routerConfig),
      iteratorConfig: null,
      routerConfig,
    };
  }

  return {
    ...template,
    routerConfig: null,
    iteratorConfig: null,
  };
}

function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function readJsonFile<T>(file: File): Promise<T> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(JSON.parse(String(reader.result)) as T);
      } catch (error) {
        reject(error instanceof Error ? error : new Error('Invalid JSON'));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

export function PlaybookPromptsPage() {
  const { t } = useModuleTranslation('admin');
  const invalidateNodeTemplates = usePlaybookStore((s) => s.invalidateNodeTemplates);
  const agents = useAgents();
  const fetchAgents = useAgentStore((s) => s.fetchAgents);
  // ===== Prompts State =====
  const [promptLoading, setPromptLoading] = useState(true);
  const [promptSaving, setPromptSaving] = useState(false);
  const [promptItems, setPromptItems] = useState<PlaybookPromptResponse[]>([]);
  const [selectedPromptKey, setSelectedPromptKey] = useState('');
  const [promptDraft, setPromptDraft] = useState<PlaybookPromptResponse>(EMPTY_PROMPT);
  const [isCreatingPrompt, setIsCreatingPrompt] = useState(false);
  const [promptDeleteDialogOpen, setPromptDeleteDialogOpen] = useState(false);
  const promptImportInputRef = useRef<HTMLInputElement | null>(null);

  // ===== Node Templates State =====
  const [templateLoading, setTemplateLoading] = useState(true);
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateItems, setTemplateItems] = useState<PlaybookNodeTemplateResponse[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [templateDraft, setTemplateDraft] = useState<PlaybookNodeTemplateResponse>(EMPTY_NODE_TEMPLATE);
  const [isCreatingTemplate, setIsCreatingTemplate] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const templateImportInputRef = useRef<HTMLInputElement | null>(null);
  
  // Data for selects
  const [connectors, setConnectors] = useState<Array<{ id: string; slug: string; name: string }>>([]);
  const [connectorsLoading, setConnectorsLoading] = useState(false);

  const selectedPrompt = useMemo(() => promptItems.find((item) => item.key === selectedPromptKey) || null, [promptItems, selectedPromptKey]);
  const selectedTemplate = useMemo(() => templateItems.find((item) => item.id === selectedTemplateId) || null, [templateItems, selectedTemplateId]);

  const syncPromptDraft = (item: PlaybookPromptResponse | null) => {
    if (!item) {
      setPromptDraft(EMPTY_PROMPT);
      return;
    }
    setPromptDraft(item);
  };

  const startCreatePrompt = () => {
    setIsCreatingPrompt(true);
    setSelectedPromptKey('');
    setPromptDraft({ ...EMPTY_PROMPT, key: '', title: '', category: 'task' });
  };

  const cancelCreatePrompt = () => {
    setIsCreatingPrompt(false);
    const first = promptItems[0] || null;
    setSelectedPromptKey(first?.key || '');
    syncPromptDraft(first);
  };

  const handlePromptTitleChange = (title: string) => {
    setPromptDraft((current) => ({
      ...current,
      title,
      key: isCreatingPrompt ? slugify(title) : current.key,
    }));
  };

  const syncTemplateDraft = (item: PlaybookNodeTemplateResponse | null) => {
    if (!item) {
      setTemplateDraft(EMPTY_NODE_TEMPLATE);
      return;
    }
    setTemplateDraft(normalizeNodeTemplate(item));
  };

  const fetchPrompts = async () => {
    setPromptLoading(true);
    try {
      const data = await getPlaybookPrompts();
      const nextItems = data.items || [];
      setPromptItems(nextItems);
      if (isCreatingPrompt) {
        setIsCreatingPrompt(false);
      }
      const first = nextItems[0] || null;
      setSelectedPromptKey((current) => current && nextItems.some((item) => item.key === current) ? current : (first?.key || ''));
      syncPromptDraft(selectedPromptKey && nextItems.some((item) => item.key === selectedPromptKey) ? nextItems.find((item) => item.key === selectedPromptKey) || null : first);
    } catch (err) {
      toast.error(t('playbook.prompts.toasts.loadFailed'), {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setPromptLoading(false);
    }
  };

  const fetchTemplates = async () => {
    setTemplateLoading(true);
    try {
      const data = await getPlaybookNodeTemplates();
      const nextItems = data.items || [];
      setTemplateItems(nextItems);
      const first = nextItems[0] || null;
      setSelectedTemplateId((current) => current && nextItems.some((item) => item.id === current) ? current : (first?.id || ''));
      syncTemplateDraft(selectedTemplateId && nextItems.some((item) => item.id === selectedTemplateId) ? nextItems.find((item) => item.id === selectedTemplateId) || null : first);
    } catch (err) {
      toast.error(t('playbook.templates.toasts.loadFailed'), {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setTemplateLoading(false);
    }
  };

  const fetchConnectors = async () => {
    setConnectorsLoading(true);
    try {
      const response = await apiClient.get('/connectors');
      const data = response.data?.data ?? [];
      setConnectors(data.map((c: { id: string; slug: string; name: string }) => ({ id: c.id, slug: c.slug, name: c.name })));
    } catch {
      // Silent fail - connectors are optional
    } finally {
      setConnectorsLoading(false);
    }
  };

  useEffect(() => {
    void fetchPrompts();
    void fetchTemplates();
    fetchAgents();
    void fetchConnectors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isCreatingPrompt) {
      syncPromptDraft(selectedPrompt);
    }
  }, [selectedPrompt, isCreatingPrompt]);

  useEffect(() => {
    syncTemplateDraft(selectedTemplate);
  }, [selectedTemplate]);

  const handleSavePrompt = async () => {
    if (!promptDraft.key) return;
    setPromptSaving(true);
    try {
      const saved = await updatePlaybookPrompt(promptDraft.key, {
        title: promptDraft.title,
        category: promptDraft.category,
        description: promptDraft.description,
        systemTemplate: promptDraft.systemTemplate,
        userTemplate: promptDraft.userTemplate,
        enabled: promptDraft.enabled,
      });
      if (isCreatingPrompt) {
        setPromptItems((current) => [...current, saved].sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title)));
        setSelectedPromptKey(saved.key);
        setIsCreatingPrompt(false);
        toast.success(t('playbook.prompts.toasts.created'));
      } else {
        setPromptItems((current) => current.map((item) => (item.key === saved.key ? saved : item)));
        toast.success(t('playbook.prompts.toasts.saved'));
      }
      setPromptDraft(saved);
    } catch (err) {
      toast.error(isCreatingPrompt ? t('playbook.prompts.toasts.createFailed') : t('playbook.prompts.toasts.saveFailed'), {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setPromptSaving(false);
    }
  };

  const handleDeletePrompt = async () => {
    if (!promptDraft.key) return;
    try {
      await deletePlaybookPrompt(promptDraft.key);
      setPromptItems((current) => current.filter((item) => item.key !== promptDraft.key));
      setSelectedPromptKey('');
      setPromptDraft(EMPTY_PROMPT);
      setPromptDeleteDialogOpen(false);
      toast.success(t('playbook.prompts.toasts.deleted'));
    } catch (err) {
      toast.error(t('playbook.prompts.toasts.deleteFailed'), {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  };

  const handleExportPrompts = () => {
    downloadJson('playbook-prompts.json', {
      version: 1,
      type: 'playbook-prompts',
      items: promptItems.map(({ id, createdAt, updatedAt, version, ...item }) => item),
    } satisfies PlaybookPromptImportPayload);
  };

  const handleImportPrompts = async (file: File | undefined) => {
    if (!file) return;
    if (!window.confirm(t('playbook.prompts.import.confirm'))) return;
    setPromptLoading(true);
    try {
      const data = await importPlaybookPrompts(await readJsonFile<PlaybookPromptImportPayload>(file));
      const nextItems = data.items || [];
      const first = nextItems[0] || null;
      setPromptItems(nextItems);
      setIsCreatingPrompt(false);
      setSelectedPromptKey(first?.key || '');
      syncPromptDraft(first);
      toast.success(t('playbook.prompts.toasts.imported'));
    } catch (err) {
      toast.error(t('playbook.prompts.toasts.importFailed'), {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setPromptLoading(false);
      if (promptImportInputRef.current) promptImportInputRef.current.value = '';
    }
  };

  const handleSaveTemplate = async () => {
    if (!templateDraft.key || !templateDraft.title) {
      toast.error(t('playbook.templates.toasts.validationError'));
      return;
    }
    const draftToSave = normalizeNodeTemplate(templateDraft);
    const routerValidationError = validateRouterTemplate(draftToSave);
    if (routerValidationError) {
      toast.error(routerValidationError);
      return;
    }
    setTemplateSaving(true);
    try {
      if (isCreatingTemplate) {
        const created = await createPlaybookNodeTemplate({
          key: draftToSave.key,
          nodeType: draftToSave.nodeType,
          title: draftToSave.title,
          description: draftToSave.description,
          icon: draftToSave.icon,
          color: draftToSave.color,
          category: draftToSave.category,
          inputPorts: stripPortIds(draftToSave.inputPorts),
          outputPorts: stripPortIds(draftToSave.outputPorts),
          promptTemplate: draftToSave.promptTemplate,
          requiredToolNames: draftToSave.requiredToolNames,
          assignedAgentId: draftToSave.assignedAgentId,
          selectedAction: draftToSave.selectedAction,
          iteratorConfig: stripIteratorConfigIds(draftToSave.iteratorConfig),
          routerConfig: draftToSave.nodeType === 'router' ? draftToSave.routerConfig : null,
          enabled: draftToSave.enabled,
        });
        setTemplateItems((current) => [...current, created].sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title)));
        setSelectedTemplateId(created.id);
        setIsCreatingTemplate(false);
        invalidateNodeTemplates();
        toast.success(t('playbook.templates.toasts.created'));
      } else if (templateDraft.id) {
        const updated = await updatePlaybookNodeTemplate(templateDraft.id, {
          key: draftToSave.key,
          nodeType: draftToSave.nodeType,
          title: draftToSave.title,
          description: draftToSave.description,
          icon: draftToSave.icon,
          color: draftToSave.color,
          category: draftToSave.category,
          inputPorts: stripPortIds(draftToSave.inputPorts),
          outputPorts: stripPortIds(draftToSave.outputPorts),
          promptTemplate: draftToSave.promptTemplate,
          requiredToolNames: draftToSave.requiredToolNames,
          assignedAgentId: draftToSave.assignedAgentId,
          selectedAction: draftToSave.selectedAction,
          iteratorConfig: stripIteratorConfigIds(draftToSave.iteratorConfig),
          routerConfig: draftToSave.nodeType === 'router' ? draftToSave.routerConfig : null,
          enabled: draftToSave.enabled,
        });
        setTemplateItems((current) => current.map((item) => (item.id === updated.id ? updated : item)));
        setTemplateDraft(updated);
        invalidateNodeTemplates();
        toast.success(t('playbook.templates.toasts.saved'));
      }
    } catch (err) {
      toast.error(isCreatingTemplate ? t('playbook.templates.toasts.createFailed') : t('playbook.templates.toasts.saveFailed'), {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setTemplateSaving(false);
    }
  };

  const handleDeleteTemplate = async () => {
    if (!templateDraft.id) return;
    try {
      await deletePlaybookNodeTemplate(templateDraft.id);
      setTemplateItems((current) => current.filter((item) => item.id !== templateDraft.id));
      setSelectedTemplateId('');
      setTemplateDraft(EMPTY_NODE_TEMPLATE);
      setDeleteDialogOpen(false);
      invalidateNodeTemplates();
      toast.success(t('playbook.templates.toasts.deleted'));
    } catch (err) {
      toast.error(t('playbook.templates.toasts.deleteFailed'), {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  };

  const handleExportTemplates = () => {
    downloadJson('playbook-node-templates.json', {
      version: 1,
      type: 'playbook-node-templates',
      items: templateItems.map(({ id, createdAt, updatedAt, version, ...item }) => item),
    } satisfies PlaybookNodeTemplateImportPayload);
  };

  const handleImportTemplates = async (file: File | undefined) => {
    if (!file) return;
    if (!window.confirm(t('playbook.templates.import.confirm'))) return;
    setTemplateLoading(true);
    try {
      const data = await importPlaybookNodeTemplates(await readJsonFile<PlaybookNodeTemplateImportPayload>(file));
      const nextItems = data.items || [];
      const first = nextItems[0] || null;
      setTemplateItems(nextItems);
      setIsCreatingTemplate(false);
      setSelectedTemplateId(first?.id || '');
      syncTemplateDraft(first);
      invalidateNodeTemplates();
      toast.success(t('playbook.templates.toasts.imported'));
    } catch (err) {
      toast.error(t('playbook.templates.toasts.importFailed'), {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setTemplateLoading(false);
      if (templateImportInputRef.current) templateImportInputRef.current.value = '';
    }
  };

  const startCreateTemplate = () => {
    setIsCreatingTemplate(true);
    setSelectedTemplateId('');
    setTemplateDraft(normalizeNodeTemplate({ ...EMPTY_NODE_TEMPLATE, key: '', title: '' }));
  };

  const cancelCreateTemplate = () => {
    setIsCreatingTemplate(false);
    const first = templateItems[0] || null;
    setSelectedTemplateId(first?.id || '');
    syncTemplateDraft(first);
  };

  // Auto-generate key from title (always)
  const handleTitleChange = (title: string) => {
    setTemplateDraft((current) => ({
      ...current,
      title,
      key: isCreatingTemplate ? slugify(title) : current.key,
    }));
  };

  const stripPortIds = (ports: PlaybookNodeTemplatePort[]): PlaybookNodeTemplatePort[] =>
    ports.map(({ _id, ...rest }: any) => rest);

  const stripIteratorConfigIds = (config: PlaybookIteratorConfig | null | undefined): PlaybookIteratorConfig | null => {
    if (!config) return null;
    const { _id, id, ...rest } = config as any;
    return rest as PlaybookIteratorConfig;
  };

  const validateRouterTemplate = (template: PlaybookNodeTemplateResponse): string | null => {
    if (template.nodeType !== 'router') return null;

    const routerConfig = template.routerConfig;
    if (!routerConfig) return t('playbook.templates.toasts.routerConfigRequired');

    const labels = routerConfig.outputLabels.map((label) => label.trim());
    if (labels.length === 0) return t('playbook.templates.toasts.routerLabelRequired');
    if (labels.some((label) => label.length === 0)) return t('playbook.templates.toasts.routerLabelRequired');
    if (new Set(labels).size !== labels.length) return t('playbook.templates.toasts.routerLabelDuplicate');
    if (routerConfig.defaultLabel && !labels.includes(routerConfig.defaultLabel)) {
      return t('playbook.templates.toasts.routerDefaultInvalid');
    }
    if ((routerConfig.conditions ?? []).some((condition) => !labels.includes(condition.label))) {
      return t('playbook.templates.toasts.routerConditionInvalid');
    }

    return null;
  };

  const addInputPort = () => {
    setTemplateDraft((current) => ({
      ...current,
      inputPorts: [...current.inputPorts, { ...EMPTY_PORT, id: `input-${current.inputPorts.length + 1}` }],
    }));
  };

  const updateInputPort = (index: number, port: PlaybookNodeTemplatePort) => {
    setTemplateDraft((current) => ({
      ...current,
      inputPorts: current.inputPorts.map((p, i) => {
        if (i !== index) return p;
        // Auto-generate ID from name if ID is empty or matches auto-pattern
        const newId = port.id || (port.name ? slugify(port.name) : p.id);
        return { ...port, id: newId };
      }),
    }));
  };

  const removeInputPort = (index: number) => {
    setTemplateDraft((current) => ({
      ...current,
      inputPorts: current.inputPorts.filter((_, i) => i !== index),
    }));
  };

  const addOutputPort = () => {
    setTemplateDraft((current) => ({
      ...current,
      outputPorts: [...current.outputPorts, { ...EMPTY_PORT, id: `output-${current.outputPorts.length + 1}` }],
    }));
  };

  const updateOutputPort = (index: number, port: PlaybookNodeTemplatePort) => {
    setTemplateDraft((current) => ({
      ...current,
      outputPorts: current.outputPorts.map((p, i) => {
        if (i !== index) return p;
        const newId = port.id || (port.name ? slugify(port.name) : p.id);
        return { ...port, id: newId };
      }),
    }));
  };

  const removeOutputPort = (index: number) => {
    setTemplateDraft((current) => ({
      ...current,
      outputPorts: current.outputPorts.filter((_, i) => i !== index),
    }));
  };

  const toggleTool = (toolName: string) => {
    setTemplateDraft((current) => {
      const hasTool = current.requiredToolNames.includes(toolName);
      return {
        ...current,
        requiredToolNames: hasTool
          ? current.requiredToolNames.filter((t) => t !== toolName)
          : [...current.requiredToolNames, toolName],
      };
    });
  };

  const applyTemplateNodeType = (nodeType: PlaybookNodeType) => {
    setTemplateDraft((current) => {
      if (nodeType === 'iterator') {
        return normalizeNodeTemplate({
          ...current,
          nodeType: 'iterator',
        });
      }

      if (nodeType === 'router') {
        const routerConfig = cloneRouterConfig(current.routerConfig);
        return normalizeNodeTemplate({
          ...current,
          nodeType: 'router',
          routerConfig,
          outputPorts: buildRouterOutputPorts(routerConfig),
        });
      }

      if (nodeType === 'action') {
        return {
          ...current,
          nodeType: 'action',
          assignedAgentId: null,
          selectedAction: current.selectedAction ?? 'index',
          iteratorConfig: null,
          routerConfig: null,
        };
      }

      return {
        ...current,
        nodeType: 'agent',
        selectedAction: null,
        iteratorConfig: null,
        routerConfig: null,
      };
    });
  };

  const templateNodeType: PlaybookNodeType = templateDraft.nodeType
    ?? 'agent';

  const isLoading = promptLoading || templateLoading;

  // Icon component lookup
  const IconComponent = useMemo(() => {
    const iconName = templateDraft.icon as keyof typeof Icons;
    return (Icons[iconName] as LucideIcon) || Icons.FileText;
  }, [templateDraft.icon]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('playbook.title')}</h1>
          <p className="text-muted-foreground">{t('playbook.description')}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { void fetchPrompts(); void fetchTemplates(); }}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {t('playbook.refresh')}
          </Button>
        </div>
      </div>

      {/* Prompts Pane */}
      <Collapsible defaultOpen={false} className="rounded-lg border bg-background">
        <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            <span className="text-lg font-semibold">{t('playbook.prompts.title')}</span>
            <Badge variant="secondary">{promptItems.length}</Badge>
          </div>
          <ChevronDown className="h-5 w-5 text-muted-foreground transition-transform data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className="border-t data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
          <div className="p-4">
            <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
              <Card className="overflow-hidden">
                  <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" /> {t('playbook.prompts.registry')}</CardTitle>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={handleExportPrompts} disabled={promptItems.length === 0}>
                        <Download className="mr-2 h-4 w-4" />
                        {t('playbook.prompts.actions.export')}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => promptImportInputRef.current?.click()}>
                        <Upload className="mr-2 h-4 w-4" />
                        {t('playbook.prompts.actions.import')}
                      </Button>
                      <input
                        ref={promptImportInputRef}
                        type="file"
                        accept="application/json,.json"
                        className="hidden"
                        onChange={(event) => { void handleImportPrompts(event.target.files?.[0]); }}
                      />
                      <Button variant="outline" size="sm" onClick={startCreatePrompt}>
                        <Plus className="mr-2 h-4 w-4" />
                        {t('playbook.prompts.actions.create')}
                      </Button>
                    </div>
                  </div>
                  <CardDescription>{t('playbook.prompts.slots', { count: promptItems.length })}</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <ScrollArea className="h-[760px]">
                    <div className="p-3 space-y-2">
                      {promptItems.map((item) => (
                        <div
                          key={item.key}
                          className={cn(
                            'group relative rounded-lg border p-3 text-left transition-colors hover:bg-muted/40',
                            selectedPromptKey === item.key && !isCreatingPrompt && 'border-primary bg-primary/5',
                          )}
                        >
                          <button
                            type="button"
                            className="w-full text-left"
                            onClick={() => { setIsCreatingPrompt(false); setSelectedPromptKey(item.key); }}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="font-medium">{item.title}</div>
                              <Badge variant={item.enabled ? 'default' : 'secondary'}>{item.category}</Badge>
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground break-all">{item.key}</div>
                            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                              <BadgeInfo className="h-3.5 w-3.5" />
                              v{item.version}{item.isBuiltIn ? ` • ${t('playbook.prompts.builtIn')}` : ''}
                            </div>
                          </button>
                          {!item.isBuiltIn && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="absolute right-2 top-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedPromptKey(item.key);
                                setPromptDraft(item);
                                setPromptDeleteDialogOpen(true);
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <CardTitle>{isCreatingPrompt ? t('playbook.prompts.actions.createPrompt') : (promptDraft.title || t('playbook.prompts.selectPrompt'))}</CardTitle>
                      <CardDescription className="break-all">
                        {isCreatingPrompt ? t('playbook.prompts.createDescription') : (promptDraft.key || t('playbook.prompts.noPromptSelected'))}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch checked={promptDraft.enabled} onCheckedChange={(checked) => setPromptDraft((current) => ({ ...current, enabled: checked }))} />
                      <span className="text-sm text-muted-foreground">{t('playbook.prompts.fields.enabled')}</span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">{t('playbook.prompts.fields.title')}</label>
                      <Input
                        value={promptDraft.title}
                        onChange={(e) => handlePromptTitleChange(e.target.value)}
                        placeholder={t('playbook.templates.fields.titlePlaceholder')}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium flex items-center gap-2">
                        {t('playbook.prompts.fields.key')}
                        <Badge variant="outline" className="text-xs">{t('playbook.prompts.fields.keyAuto')}</Badge>
                      </label>
                      <Input
                        value={promptDraft.key}
                        disabled
                        placeholder={t('playbook.prompts.fields.keyPlaceholder')}
                        className="bg-muted/50"
                      />
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">{t('playbook.prompts.fields.category')}</label>
                      <Input value={promptDraft.category} onChange={(e) => setPromptDraft((current) => ({ ...current, category: e.target.value }))} />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">{t('playbook.prompts.fields.description')}</label>
                      <Input value={promptDraft.description || ''} onChange={(e) => setPromptDraft((current) => ({ ...current, description: e.target.value }))} />
                    </div>
                  </div>

                  <Separator />

                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">{t('playbook.prompts.fields.systemTemplate')}</label>
                      <Textarea
                        value={promptDraft.systemTemplate}
                        onChange={(e) => setPromptDraft((current) => ({ ...current, systemTemplate: e.target.value }))}
                        className="min-h-[320px] font-mono text-sm"
                        placeholder={t('playbook.prompts.fields.systemTemplatePlaceholder')}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">{t('playbook.prompts.fields.userTemplate')}</label>
                      <Textarea
                        value={promptDraft.userTemplate}
                        onChange={(e) => setPromptDraft((current) => ({ ...current, userTemplate: e.target.value }))}
                        className="min-h-[320px] font-mono text-sm"
                        placeholder={t('playbook.prompts.fields.userTemplatePlaceholder')}
                      />
                    </div>
                  </div>

                  <div className="rounded-lg border bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground mb-1 font-medium">{t('playbook.prompts.hints.title')}</p>
                    <p className="text-xs text-muted-foreground">{t('playbook.prompts.hints.variables')}</p>
                  </div>

                  <div className="flex justify-between">
                    <div className="flex gap-2">
                      {isCreatingPrompt ? (
                        <Button variant="outline" onClick={cancelCreatePrompt}>{t('playbook.prompts.actions.cancel')}</Button>
                      ) : !promptDraft.isBuiltIn && promptDraft.key ? (
                        <Button variant="destructive" onClick={() => setPromptDeleteDialogOpen(true)}>
                          <Trash2 className="mr-2 h-4 w-4" />
                          {t('playbook.prompts.actions.delete')}
                        </Button>
                      ) : null}
                    </div>
                    <Button onClick={() => void handleSavePrompt()} disabled={!promptDraft.key || promptSaving}>
                      {promptSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                      {isCreatingPrompt ? t('playbook.prompts.actions.createPrompt') : t('playbook.prompts.actions.save')}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Node Templates Pane */}
      <Collapsible defaultOpen={false} className="rounded-lg border bg-background">
        <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
          <div className="flex items-center gap-2">
            <LayoutGrid className="h-5 w-5" />
            <span className="text-lg font-semibold">{t('playbook.templates.title')}</span>
            <Badge variant="secondary">{templateItems.length}</Badge>
          </div>
          <ChevronDown className="h-5 w-5 text-muted-foreground transition-transform data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className="border-t data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
          <div className="p-4">
            <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
              <Card className="overflow-hidden">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2"><LayoutGrid className="h-5 w-5" /> {t('playbook.templates.registry')}</CardTitle>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={handleExportTemplates} disabled={templateItems.length === 0}>
                        <Download className="mr-2 h-4 w-4" />
                        {t('playbook.templates.actions.export')}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => templateImportInputRef.current?.click()}>
                        <Upload className="mr-2 h-4 w-4" />
                        {t('playbook.templates.actions.import')}
                      </Button>
                      <input
                        ref={templateImportInputRef}
                        type="file"
                        accept="application/json,.json"
                        className="hidden"
                        onChange={(event) => { void handleImportTemplates(event.target.files?.[0]); }}
                      />
                      <Button variant="outline" size="sm" onClick={startCreateTemplate}>
                        <Plus className="mr-2 h-4 w-4" />
                        {t('playbook.templates.actions.create')}
                      </Button>
                    </div>
                  </div>
                  <CardDescription>{t('playbook.templates.slots', { count: templateItems.length })}</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <ScrollArea className="h-[760px]">
                    <div className="p-3 space-y-2">
                      {templateItems.map((item) => (
                        <div
                          key={item.id}
                          className={cn(
                            'group relative rounded-lg border p-3 text-left transition-colors hover:bg-muted/40',
                            selectedTemplateId === item.id && !isCreatingTemplate && 'border-primary bg-primary/5',
                          )}
                        >
                          <button
                            type="button"
                            className="w-full text-left"
                            onClick={() => { setIsCreatingTemplate(false); setSelectedTemplateId(item.id); }}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="font-medium">{item.title}</div>
                              <Badge variant={item.enabled ? 'default' : 'secondary'}>{item.category}</Badge>
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground break-all">{item.key}</div>
                            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                              <BadgeInfo className="h-3.5 w-3.5" />
                              v{item.version}{item.isBuiltIn ? ` • ${t('playbook.templates.builtIn')}` : ''}
                            </div>
                          </button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="absolute right-2 top-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedTemplateId(item.id);
                              setTemplateDraft(item);
                              setDeleteDialogOpen(true);
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <CardTitle>{isCreatingTemplate ? t('playbook.templates.actions.createTemplate') : (templateDraft.title || t('playbook.templates.selectTemplate'))}</CardTitle>
                      <CardDescription className="break-all">
                        {isCreatingTemplate ? t('playbook.templates.createDescription') : (templateDraft.key || t('playbook.templates.selectTemplate'))}
                      </CardDescription>
                    </div>
                    {!isCreatingTemplate && templateDraft.id && (
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={templateDraft.enabled}
                          onCheckedChange={(checked) => setTemplateDraft((current) => ({ ...current, enabled: checked }))}
                          disabled={templateDraft.isBuiltIn}
                        />
                      <span className="text-sm text-muted-foreground">{t('playbook.prompts.fields.enabled')}</span>
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-5">
                  {/* Title & Key */}
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">{t('playbook.templates.fields.title')}</label>
                      <Input
                        value={templateDraft.title}
                        onChange={(e) => handleTitleChange(e.target.value)}
                        placeholder={t('playbook.templates.fields.titlePlaceholder')}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium flex items-center gap-2">
                        {t('playbook.templates.fields.key')}
                        <Badge variant="outline" className="text-xs">{t('playbook.templates.fields.keyAuto')}</Badge>
                      </label>
                      <Input
                        value={templateDraft.key}
                        disabled
                        placeholder="auto-generated-from-title"
                        className="bg-muted/50"
                      />
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">{t('playbook.templates.fields.category')}</label>
                      <div className="flex gap-2">
                        <select
                          value={templateDraft.category}
                          onChange={(e) => setTemplateDraft((current) => ({ ...current, category: e.target.value }))}
                          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {CATEGORIES.map((cat) => (
                            <option key={cat} value={cat}>{cat}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">{t('playbook.templates.fields.nodeType')}</label>
                      <select
                        value={templateNodeType}
                        onChange={(e) => applyTemplateNodeType(e.target.value as PlaybookNodeType)}
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <option value="agent">{t('playbook.templates.fields.nodeTypeAgent')}</option>
                        <option value="action">{t('playbook.templates.fields.nodeTypeAction')}</option>
                        <option value="iterator">{t('playbook.templates.fields.nodeTypeIterator')}</option>
                        <option value="router">{t('playbook.templates.fields.nodeTypeRouter')}</option>
                      </select>
                    </div>
                  </div>

                  {/* Description */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{t('playbook.templates.fields.description')}</label>
                    <Input
                      value={templateDraft.description || ''}
                      onChange={(e) => setTemplateDraft((current) => ({ ...current, description: e.target.value }))}
                      placeholder={t('playbook.templates.fields.descriptionPlaceholder')}
                    />
                  </div>

                  {/* Icon, Color */}
                  <div className="grid gap-4 md:grid-cols-2">
                    {/* Icon Picker */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium">{t('playbook.templates.fields.icon')}</label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" className="w-full justify-start gap-2">
                            <IconComponent className="h-4 w-4" />
                            <span className="truncate">{templateDraft.icon}</span>
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-80 p-2">
                          <div className="grid grid-cols-6 gap-1">
                            {ICON_NAMES.map((iconName) => {
                              const Icon = (Icons[iconName as keyof typeof Icons] as LucideIcon) || Icons.FileText;
                              return (
                                <button
                                  key={iconName}
                                  type="button"
                                  onClick={() => setTemplateDraft((current) => ({ ...current, icon: iconName }))}
                                  className={cn(
                                    'flex items-center justify-center rounded-md p-2 hover:bg-muted',
                                    templateDraft.icon === iconName && 'bg-primary/10 ring-1 ring-primary'
                                  )}
                                  title={iconName}
                                >
                                  <Icon className="h-4 w-4" />
                                </button>
                              );
                            })}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>

                    {/* Color Picker */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium">{t('playbook.templates.fields.color')}</label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" className="w-full justify-start gap-2">
                            <div className="h-4 w-4 rounded-full" style={{ backgroundColor: templateDraft.color ? (COLOR_MAP[templateDraft.color] ?? COLOR_MAP.blue) : COLOR_MAP.blue }} />
                            <span className="capitalize">{templateDraft.color}</span>
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-64 p-2">
                          <div className="grid grid-cols-5 gap-2">
                            {COLORS.map((color) => (
                              <button
                                key={color}
                                type="button"
                                onClick={() => setTemplateDraft((current) => ({ ...current, color }))}
                                className={cn(
                                  'flex flex-col items-center gap-1 rounded-md p-2 hover:bg-muted',
                                  templateDraft.color === color && 'bg-muted ring-1 ring-primary'
                                )}
                              >
                                <div className="h-6 w-6 rounded-full" style={{ backgroundColor: COLOR_MAP[color] || COLOR_MAP.blue }} />
                                <span className="text-xs capitalize">{color}</span>
                              </button>
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>


                  </div>

                  {/* Node type configuration */}
                  {templateNodeType === 'iterator' && templateDraft.iteratorConfig ? (
                    <PlaybookIteratorConfigFields
                      value={templateDraft.iteratorConfig}
                      onChange={(iteratorConfig) => setTemplateDraft((current) => ({ ...current, iteratorConfig }))}
                    />
                  ) : templateNodeType === 'router' && templateDraft.routerConfig ? (
                    <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
                      <div>
                        <h3 className="text-sm font-medium">{t('playbook.templates.fields.routerConfig')}</h3>
                        <p className="text-xs text-muted-foreground">{t('playbook.templates.fields.routerConfigHint')}</p>
                      </div>
                      <PlaybookRouterConfigSection
                        value={templateDraft.routerConfig}
                        onChange={(routerConfig) => setTemplateDraft((current) => ({
                          ...current,
                          routerConfig,
                          outputPorts: buildRouterOutputPorts(routerConfig),
                        }))}
                      />
                    </div>
                  ) : templateNodeType !== 'action' ? (
                    <div className="space-y-2">
                      <label className="text-sm font-medium">{t('playbook.templates.fields.agent')}</label>
                      <SearchableSelect
                        options={agents.map((a) => ({ value: a.id, label: a.name }))}
                        value={templateDraft.assignedAgentId || ''}
                        onValueChange={(value) => setTemplateDraft((current) => ({ ...current, assignedAgentId: value || null }))}
                        placeholder={t('playbook.templates.fields.agentPlaceholder')}
                        emptyText={t('playbook.templates.fields.noAgents')}
                      />
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <label className="text-sm font-medium">{t('playbook.templates.fields.action')}</label>
                      <select
                        value={templateDraft.selectedAction || ''}
                        onChange={(e) => setTemplateDraft((current) => ({ ...current, selectedAction: e.target.value || null }))}
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <option value="">{t('playbook.templates.fields.selectAction')}</option>
                        {ACTIONS.map((action) => (
                          <option key={action} value={action}>{action}</option>
                        ))}
                      </select>
                      {templateDraft.selectedAction && (
                        <p className="text-xs text-muted-foreground">
                          {templateDraft.selectedAction === 'index' && t('playbook.templates.fields.actionIndex')}
                          {templateDraft.selectedAction === 'delete' && t('playbook.templates.fields.actionDelete')}
                          {templateDraft.selectedAction === 'read' && t('playbook.templates.fields.actionRead')}
                        </p>
                      )}
                    </div>
                  )}

                  <Separator />

                  {/* Input Ports */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium">{t('playbook.templates.fields.inputPorts')}</label>
                      <Button variant="outline" size="sm" onClick={addInputPort} disabled={templateNodeType === 'iterator'}>
                        <Plus className="mr-2 h-4 w-4" /> {t('playbook.templates.fields.addPort')}
                      </Button>
                    </div>
                    {templateDraft.inputPorts.map((port, index) => (
                      <div key={index} className="grid gap-2 md:grid-cols-[1fr_1fr_1fr_auto] items-end rounded-lg border p-3">
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">{t('playbook.templates.fields.portName')}</label>
                          <Input
                            value={port.name}
                            disabled={templateNodeType === 'iterator'}
                            onChange={(e) => updateInputPort(index, { ...port, name: e.target.value })}
                            placeholder={t('playbook.templates.fields.portNamePlaceholder')}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">{t('playbook.templates.fields.portId')}</label>
                          <Input
                            value={port.id}
                            disabled={templateNodeType === 'iterator'}
                            onChange={(e) => updateInputPort(index, { ...port, id: e.target.value })}
                            placeholder="port-id"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">{t('playbook.templates.fields.artifactKind')}</label>
                          <select
                            value={port.artifactKind}
                            disabled={templateNodeType === 'iterator'}
                            onChange={(e) => updateInputPort(index, { ...port, artifactKind: e.target.value })}
                            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors"
                          >
                            {ARTIFACT_KINDS.map((kind) => (
                              <option key={kind} value={kind}>{kind}</option>
                            ))}
                          </select>
                        </div>
                        <Button variant="ghost" size="icon" onClick={() => removeInputPort(index)} className="h-9 w-9" disabled={templateNodeType === 'iterator'}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    ))}
                  </div>

                  <Separator />

                  {/* Output Ports */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium">{t('playbook.templates.fields.outputPorts')}</label>
                      <Button variant="outline" size="sm" onClick={addOutputPort} disabled={templateNodeType === 'iterator' || templateNodeType === 'router'}>
                        <Plus className="mr-2 h-4 w-4" /> {t('playbook.templates.fields.addPort')}
                      </Button>
                    </div>
                    {templateNodeType === 'iterator' && (
                      <p className="text-xs text-muted-foreground">{t('playbook.templates.fields.iteratorOutputPortHint')}</p>
                    )}
                    {templateNodeType === 'router' && (
                      <p className="text-xs text-muted-foreground">{t('playbook.templates.fields.routerOutputPortHint')}</p>
                    )}
                    {templateDraft.outputPorts.map((port, index) => (
                      <div key={index} className="grid gap-2 md:grid-cols-[1fr_1fr_1fr_auto] items-end rounded-lg border p-3">
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">{t('playbook.templates.fields.portName')}</label>
                          <Input
                            value={port.name}
                            disabled={templateNodeType === 'iterator' || templateNodeType === 'router'}
                            onChange={(e) => updateOutputPort(index, { ...port, name: e.target.value })}
                            placeholder={t('playbook.templates.fields.portNamePlaceholder')}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">{t('playbook.templates.fields.portId')}</label>
                          <Input
                            value={port.id}
                            disabled={templateNodeType === 'iterator' || templateNodeType === 'router'}
                            onChange={(e) => updateOutputPort(index, { ...port, id: e.target.value })}
                            placeholder="port-id"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">{t('playbook.templates.fields.artifactKind')}</label>
                          <select
                            value={port.artifactKind}
                            disabled={templateNodeType === 'iterator' || templateNodeType === 'router'}
                            onChange={(e) => updateOutputPort(index, { ...port, artifactKind: e.target.value })}
                            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors"
                          >
                            {ARTIFACT_KINDS.map((kind) => (
                              <option key={kind} value={kind}>{kind}</option>
                            ))}
                          </select>
                        </div>
                        <Button variant="ghost" size="icon" onClick={() => removeOutputPort(index)} className="h-9 w-9" disabled={templateNodeType === 'iterator' || templateNodeType === 'router'}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    ))}
                  </div>

                  <Separator />

                  {/* Prompt Template */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{t('playbook.templates.fields.promptTemplate')}</label>
                    <Textarea
                      value={templateDraft.promptTemplate || ''}
                      onChange={(e) => setTemplateDraft((current) => ({ ...current, promptTemplate: e.target.value }))}
                      className="min-h-[160px] font-mono text-sm"
                      placeholder={t('playbook.templates.fields.promptTemplatePlaceholder')}
                    />
                  </div>

                  {/* Tools Multi-select */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{t('playbook.templates.fields.requiredTools')}</label>
                    <div className="flex flex-wrap gap-2">
                      {connectorsLoading ? (
                        <span className="text-sm text-muted-foreground">{t('playbook.templates.fields.requiredToolsLoading')}</span>
                      ) : connectors.length === 0 ? (
                        <span className="text-sm text-muted-foreground">{t('playbook.templates.fields.noTools')}</span>
                      ) : (
                        connectors.map((connector) => {
                          const isSelected = templateDraft.requiredToolNames.includes(connector.slug);
                          return (
                            <button
                              key={connector.id}
                              type="button"
                              onClick={() => toggleTool(connector.slug)}
                              className={cn(
                                'inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm transition-colors',
                                isSelected
                                  ? 'border-primary bg-primary/10 text-primary'
                                  : 'border-input bg-background hover:bg-muted'
                              )}
                            >
                              {isSelected && <Check className="h-3 w-3" />}
                              {connector.name}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>

                  <div className="flex justify-between">
                    <div className="flex gap-2">
                      {isCreatingTemplate ? (
                        <Button variant="outline" onClick={cancelCreateTemplate}>{t('playbook.templates.actions.cancel')}</Button>
                      ) : templateDraft.id ? (
                        <Button variant="destructive" onClick={() => setDeleteDialogOpen(true)}>
                          <Trash2 className="mr-2 h-4 w-4" />
                          {t('playbook.templates.actions.delete')}
                        </Button>
                      ) : null}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        onClick={() => void handleSaveTemplate()}
                        disabled={templateSaving || !templateDraft.key || !templateDraft.title}
                      >
                        {templateSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                        {isCreatingTemplate ? t('playbook.templates.actions.createTemplate') : t('playbook.templates.actions.saveTemplate')}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Delete Prompt Confirmation Dialog */}
      <Dialog open={promptDeleteDialogOpen} onOpenChange={setPromptDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('playbook.prompts.delete.title')}</DialogTitle>
            <DialogDescription>
              {t('playbook.prompts.delete.description', { name: promptDraft.title })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPromptDeleteDialogOpen(false)}>{t('playbook.prompts.actions.cancel')}</Button>
            <Button variant="destructive" onClick={() => void handleDeletePrompt()}>{t('playbook.prompts.delete.confirm')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Template Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('playbook.templates.delete.title')}</DialogTitle>
            <DialogDescription>
              {t('playbook.templates.delete.description', { name: templateDraft.title })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>{t('playbook.templates.actions.cancel')}</Button>
            <Button variant="destructive" onClick={() => void handleDeleteTemplate()}>{t('playbook.templates.delete.confirm')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
