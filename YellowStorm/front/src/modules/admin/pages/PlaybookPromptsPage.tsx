import { useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, Save, FileText, BadgeInfo, ChevronDown, Plus, Trash2, LayoutGrid, X, Check, Palette, Sparkles } from 'lucide-react';
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
import {
  getPlaybookPrompts,
  updatePlaybookPrompt,
  getPlaybookNodeTemplates,
  createPlaybookNodeTemplate,
  updatePlaybookNodeTemplate,
  deletePlaybookNodeTemplate,
  getAdminAgents,
  getTools,
} from '../api';
import type { PlaybookPromptResponse, PlaybookNodeTemplateResponse, PlaybookNodeTemplatePort, AgentResponse, ToolResponse } from '../types';
import { usePlaybookStore } from '@/modules/playbook';
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
  type: '',
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
  executionMode: 'agent',
  assignedAgentId: null,
  selectedAction: null,
  enabled: true,
  version: 1,
  isBuiltIn: false,
  createdAt: '',
  updatedAt: '',
};

const EMPTY_PORT: PlaybookNodeTemplatePort = { id: '', name: '', artifactKind: 'text', required: false };

// Constants for selects
const CATEGORIES = ['content', 'generation', 'analysis', 'code'];
const EXECUTION_MODES = ['agent', 'action'];
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
  'ChevronRight', 'ChevronLeft', 'ChevronUp', 'ChevronDown', 'RefreshCw', 'RotateCcw', 'Save', 'Send'
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

export function PlaybookPromptsPage() {
  const { t } = useModuleTranslation('admin');
  const invalidateNodeTemplates = usePlaybookStore((s) => s.invalidateNodeTemplates);
  // ===== Prompts State =====
  const [promptLoading, setPromptLoading] = useState(true);
  const [promptSaving, setPromptSaving] = useState(false);
  const [promptItems, setPromptItems] = useState<PlaybookPromptResponse[]>([]);
  const [selectedPromptKey, setSelectedPromptKey] = useState('');
  const [promptDraft, setPromptDraft] = useState<PlaybookPromptResponse>(EMPTY_PROMPT);

  // ===== Node Templates State =====
  const [templateLoading, setTemplateLoading] = useState(true);
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateItems, setTemplateItems] = useState<PlaybookNodeTemplateResponse[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [templateDraft, setTemplateDraft] = useState<PlaybookNodeTemplateResponse>(EMPTY_NODE_TEMPLATE);
  const [isCreatingTemplate, setIsCreatingTemplate] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  
  // Data for selects
  const [agents, setAgents] = useState<AgentResponse[]>([]);
  const [tools, setTools] = useState<ToolResponse[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [toolsLoading, setToolsLoading] = useState(false);

  const selectedPrompt = useMemo(() => promptItems.find((item) => item.key === selectedPromptKey) || null, [promptItems, selectedPromptKey]);
  const selectedTemplate = useMemo(() => templateItems.find((item) => item.id === selectedTemplateId) || null, [templateItems, selectedTemplateId]);

  const syncPromptDraft = (item: PlaybookPromptResponse | null) => {
    if (!item) {
      setPromptDraft(EMPTY_PROMPT);
      return;
    }
    setPromptDraft(item);
  };

  const syncTemplateDraft = (item: PlaybookNodeTemplateResponse | null) => {
    if (!item) {
      setTemplateDraft(EMPTY_NODE_TEMPLATE);
      return;
    }
    setTemplateDraft(item);
  };

  const fetchPrompts = async () => {
    setPromptLoading(true);
    try {
      const data = await getPlaybookPrompts();
      const nextItems = data.items || [];
      setPromptItems(nextItems);
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

  const fetchAgents = async () => {
    setAgentsLoading(true);
    try {
      const data = await getAdminAgents({ limit: 1000 });
      setAgents(data.data || []);
    } catch {
      // Silent fail - agents are optional
    } finally {
      setAgentsLoading(false);
    }
  };

  const fetchTools = async () => {
    setToolsLoading(true);
    try {
      const data = await getTools({ limit: 1000 });
      setTools(data.data || []);
    } catch {
      // Silent fail - tools are optional
    } finally {
      setToolsLoading(false);
    }
  };

  useEffect(() => {
    void fetchPrompts();
    void fetchTemplates();
    void fetchAgents();
    void fetchTools();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    syncPromptDraft(selectedPrompt);
  }, [selectedPrompt]);

  useEffect(() => {
    syncTemplateDraft(selectedTemplate);
  }, [selectedTemplate]);

  const handleSavePrompt = async () => {
    if (!promptDraft.key) return;
    setPromptSaving(true);
    try {
      const updated = await updatePlaybookPrompt(promptDraft.key, {
        title: promptDraft.title,
        category: promptDraft.category,
        description: promptDraft.description,
        systemTemplate: promptDraft.systemTemplate,
        userTemplate: promptDraft.userTemplate,
        enabled: promptDraft.enabled,
      });
      setPromptItems((current) => current.map((item) => (item.key === updated.key ? updated : item)));
      setPromptDraft(updated);
      toast.success(t('playbook.prompts.toasts.saved'));
    } catch (err) {
      toast.error(t('playbook.prompts.toasts.saveFailed'), {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setPromptSaving(false);
    }
  };

  const handleSaveTemplate = async () => {
    if (!templateDraft.key || !templateDraft.type || !templateDraft.title) {
      toast.error(t('playbook.templates.toasts.validationError'));
      return;
    }
    setTemplateSaving(true);
    try {
      if (isCreatingTemplate) {
        const created = await createPlaybookNodeTemplate({
          key: templateDraft.key,
          type: templateDraft.type,
          title: templateDraft.title,
          description: templateDraft.description,
          icon: templateDraft.icon,
          color: templateDraft.color,
          category: templateDraft.category,
          inputPorts: templateDraft.inputPorts,
          outputPorts: templateDraft.outputPorts,
          promptTemplate: templateDraft.promptTemplate,
          recommendedAgentTypeSlug: templateDraft.recommendedAgentTypeSlug,
          requiredToolNames: templateDraft.requiredToolNames,
          executionMode: templateDraft.executionMode,
          assignedAgentId: templateDraft.assignedAgentId,
          selectedAction: templateDraft.selectedAction,
          enabled: templateDraft.enabled,
        });
        setTemplateItems((current) => [...current, created].sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title)));
        setSelectedTemplateId(created.id);
        setIsCreatingTemplate(false);
        invalidateNodeTemplates();
        toast.success(t('playbook.templates.toasts.created'));
      } else if (templateDraft.id) {
        const updated = await updatePlaybookNodeTemplate(templateDraft.id, {
          key: templateDraft.key,
          type: templateDraft.type,
          title: templateDraft.title,
          description: templateDraft.description,
          icon: templateDraft.icon,
          color: templateDraft.color,
          category: templateDraft.category,
          inputPorts: templateDraft.inputPorts,
          outputPorts: templateDraft.outputPorts,
          promptTemplate: templateDraft.promptTemplate,
          recommendedAgentTypeSlug: templateDraft.recommendedAgentTypeSlug,
          requiredToolNames: templateDraft.requiredToolNames,
          executionMode: templateDraft.executionMode,
          assignedAgentId: templateDraft.assignedAgentId,
          selectedAction: templateDraft.selectedAction,
          enabled: templateDraft.enabled,
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
    if (!templateDraft.id || templateDraft.isBuiltIn) return;
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

  const startCreateTemplate = () => {
    setIsCreatingTemplate(true);
    setSelectedTemplateId('');
    setTemplateDraft({ ...EMPTY_NODE_TEMPLATE, key: '', type: '', title: '' });
  };

  const cancelCreateTemplate = () => {
    setIsCreatingTemplate(false);
    const first = templateItems[0] || null;
    setSelectedTemplateId(first?.id || '');
    syncTemplateDraft(first);
  };

  // Auto-generate key from title
  const handleTitleChange = (title: string) => {
    setTemplateDraft((current) => {
      const newKey = isCreatingTemplate && !current.key ? slugify(title) : current.key;
      return { ...current, title, key: newKey };
    });
  };

  // Auto-generate type from title (if not manually set)
  const handleTypeChange = (type: string) => {
    setTemplateDraft((current) => ({ ...current, type }));
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
                  <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" /> {t('playbook.prompts.registry')}</CardTitle>
                  <CardDescription>{t('playbook.prompts.slots', { count: promptItems.length })}</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <ScrollArea className="h-[760px]">
                    <div className="p-3 space-y-2">
                      {promptItems.map((item) => (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() => setSelectedPromptKey(item.key)}
                          className={cn(
                            'w-full rounded-lg border p-3 text-left transition-colors hover:bg-muted/40',
                            selectedPromptKey === item.key && 'border-primary bg-primary/5',
                          )}
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
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <CardTitle>{promptDraft.title || t('playbook.prompts.selectPrompt')}</CardTitle>
                      <CardDescription className="break-all">{promptDraft.key || t('playbook.prompts.noPromptSelected')}</CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch checked={promptDraft.enabled} onCheckedChange={(checked) => setPromptDraft((current) => ({ ...current, enabled: checked }))} />
                      <span className="text-sm text-muted-foreground">Enabled</span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">{t('playbook.prompts.fields.title')}</label>
                      <Input value={promptDraft.title} onChange={(e) => setPromptDraft((current) => ({ ...current, title: e.target.value }))} />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">{t('playbook.prompts.fields.category')}</label>
                      <Input value={promptDraft.category} onChange={(e) => setPromptDraft((current) => ({ ...current, category: e.target.value }))} />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Description</label>
                    <Input value={promptDraft.description || ''} onChange={(e) => setPromptDraft((current) => ({ ...current, description: e.target.value }))} />
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

                  <div className="flex justify-end">
                    <Button onClick={() => void handleSavePrompt()} disabled={!promptDraft.key || promptSaving}>
                      {promptSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                      {t('playbook.prompts.actions.save')}
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
                    <Button variant="outline" size="sm" onClick={startCreateTemplate}>
                      <Plus className="mr-2 h-4 w-4" />
                      {t('playbook.templates.actions.create')}
                    </Button>
                  </div>
                  <CardDescription>{t('playbook.templates.slots', { count: templateItems.length })}</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <ScrollArea className="h-[760px]">
                    <div className="p-3 space-y-2">
                      {templateItems.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => { setIsCreatingTemplate(false); setSelectedTemplateId(item.id); }}
                          className={cn(
                            'w-full rounded-lg border p-3 text-left transition-colors hover:bg-muted/40',
                            selectedTemplateId === item.id && !isCreatingTemplate && 'border-primary bg-primary/5',
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-medium">{item.title}</div>
                            <Badge variant={item.enabled ? 'default' : 'secondary'}>{item.category}</Badge>
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground break-all">{item.type}</div>
                          <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                            <BadgeInfo className="h-3.5 w-3.5" />
                            v{item.version}{item.isBuiltIn ? ` • ${t('playbook.templates.builtIn')}` : ''}
                          </div>
                        </button>
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
                        {isCreatingTemplate ? t('playbook.templates.createDescription') : (templateDraft.type || t('playbook.templates.selectTemplate'))}
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
                        {isCreatingTemplate && templateDraft.key && (
                          <Badge variant="outline" className="text-xs">{t('playbook.templates.fields.keyAuto')}</Badge>
                        )}
                      </label>
                      <Input
                        value={templateDraft.key}
                        onChange={(e) => setTemplateDraft((current) => ({ ...current, key: e.target.value }))}
                        placeholder="unique-key"
                      />
                    </div>
                  </div>

                  {/* Type & Category */}
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">{t('playbook.templates.fields.type')}</label>
                      <Input
                        value={templateDraft.type}
                        onChange={(e) => handleTypeChange(e.target.value)}
                        placeholder={t('playbook.templates.fields.typePlaceholder')}
                      />
                    </div>
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

                  {/* Icon, Color, Execution Mode */}
                  <div className="grid gap-4 md:grid-cols-3">
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

                    {/* Execution Mode */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium">{t('playbook.templates.fields.executionMode')}</label>
                      <select
                        value={templateDraft.executionMode}
                        onChange={(e) => setTemplateDraft((current) => ({
                          ...current,
                          executionMode: e.target.value,
                          assignedAgentId: e.target.value === 'agent' ? current.assignedAgentId : null,
                          selectedAction: e.target.value === 'action' ? current.selectedAction : null,
                        }))}
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {EXECUTION_MODES.map((mode) => (
                          <option key={mode} value={mode}>{mode}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Agent or Action based on Execution Mode */}
                  {templateDraft.executionMode === 'agent' ? (
                    <div className="space-y-2">
                      <label className="text-sm font-medium">{t('playbook.templates.fields.agent')}</label>
                      <SearchableSelect
                        options={agents.map((a) => ({ value: a.id, label: a.name }))}
                        value={templateDraft.assignedAgentId || ''}
                        onValueChange={(value) => setTemplateDraft((current) => ({ ...current, assignedAgentId: value || null }))}
                        placeholder={agentsLoading ? 'Loading agents...' : t('playbook.templates.fields.agentPlaceholder')}
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
                      <Button variant="outline" size="sm" onClick={addInputPort}>
                        <Plus className="mr-2 h-4 w-4" /> {t('playbook.templates.fields.addPort')}
                      </Button>
                    </div>
                    {templateDraft.inputPorts.map((port, index) => (
                      <div key={index} className="grid gap-2 md:grid-cols-[1fr_1fr_1fr_auto] items-end rounded-lg border p-3">
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">{t('playbook.templates.fields.portName')}</label>
                          <Input
                            value={port.name}
                            onChange={(e) => updateInputPort(index, { ...port, name: e.target.value })}
                            placeholder={t('playbook.templates.fields.portNamePlaceholder')}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">{t('playbook.templates.fields.portId')}</label>
                          <Input
                            value={port.id}
                            onChange={(e) => updateInputPort(index, { ...port, id: e.target.value })}
                            placeholder="port-id"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">{t('playbook.templates.fields.artifactKind')}</label>
                          <select
                            value={port.artifactKind}
                            onChange={(e) => updateInputPort(index, { ...port, artifactKind: e.target.value })}
                            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors"
                          >
                            {ARTIFACT_KINDS.map((kind) => (
                              <option key={kind} value={kind}>{kind}</option>
                            ))}
                          </select>
                        </div>
                        <Button variant="ghost" size="icon" onClick={() => removeInputPort(index)} className="h-9 w-9">
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
                      <Button variant="outline" size="sm" onClick={addOutputPort}>
                        <Plus className="mr-2 h-4 w-4" /> {t('playbook.templates.fields.addPort')}
                      </Button>
                    </div>
                    {templateDraft.outputPorts.map((port, index) => (
                      <div key={index} className="grid gap-2 md:grid-cols-[1fr_1fr_1fr_auto] items-end rounded-lg border p-3">
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">{t('playbook.templates.fields.portName')}</label>
                          <Input
                            value={port.name}
                            onChange={(e) => updateOutputPort(index, { ...port, name: e.target.value })}
                            placeholder={t('playbook.templates.fields.portNamePlaceholder')}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">{t('playbook.templates.fields.portId')}</label>
                          <Input
                            value={port.id}
                            onChange={(e) => updateOutputPort(index, { ...port, id: e.target.value })}
                            placeholder="port-id"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">{t('playbook.templates.fields.artifactKind')}</label>
                          <select
                            value={port.artifactKind}
                            onChange={(e) => updateOutputPort(index, { ...port, artifactKind: e.target.value })}
                            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors"
                          >
                            {ARTIFACT_KINDS.map((kind) => (
                              <option key={kind} value={kind}>{kind}</option>
                            ))}
                          </select>
                        </div>
                        <Button variant="ghost" size="icon" onClick={() => removeOutputPort(index)} className="h-9 w-9">
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
                      {toolsLoading ? (
                        <span className="text-sm text-muted-foreground">{t('playbook.templates.fields.requiredToolsLoading')}</span>
                      ) : tools.length === 0 ? (
                        <span className="text-sm text-muted-foreground">{t('playbook.templates.fields.noTools')}</span>
                      ) : (
                        tools.map((tool) => {
                          const isSelected = templateDraft.requiredToolNames.includes(tool.name);
                          return (
                            <button
                              key={tool.id}
                              type="button"
                              onClick={() => toggleTool(tool.name)}
                              className={cn(
                                'inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm transition-colors',
                                isSelected
                                  ? 'border-primary bg-primary/10 text-primary'
                                  : 'border-input bg-background hover:bg-muted'
                              )}
                            >
                              {isSelected && <Check className="h-3 w-3" />}
                              {tool.name}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>

                  {/* Legacy Agent Type (for backward compatibility) */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-muted-foreground">{t('playbook.templates.fields.recommendedAgentType')}</label>
                    <Input
                      value={templateDraft.recommendedAgentTypeSlug || ''}
                      onChange={(e) => setTemplateDraft((current) => ({ ...current, recommendedAgentTypeSlug: e.target.value || null }))}
                      placeholder="researcher"
                      className="bg-muted/50"
                    />
                  </div>

                  <div className="flex justify-between">
                    <div className="flex gap-2">
                      {isCreatingTemplate ? (
                        <Button variant="outline" onClick={cancelCreateTemplate}>{t('playbook.templates.actions.cancel')}</Button>
                      ) : templateDraft.id && !templateDraft.isBuiltIn ? (
                        <Button variant="destructive" onClick={() => setDeleteDialogOpen(true)}>
                          <Trash2 className="mr-2 h-4 w-4" />
                          {t('playbook.templates.actions.delete')}
                        </Button>
                      ) : null}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        onClick={() => void handleSaveTemplate()}
                        disabled={templateSaving || !templateDraft.key || !templateDraft.type || !templateDraft.title}
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

      {/* Delete Confirmation Dialog */}
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
