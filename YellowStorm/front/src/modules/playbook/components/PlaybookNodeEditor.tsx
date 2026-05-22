import { useState, useEffect, useMemo, useCallback, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { SearchableSelect, type SearchableSelectOption } from '@/components/ui/searchable-select';
import { ChevronDown, Loader2, Plus, Trash2 } from 'lucide-react';
import { useAgents, useAgentStore } from '@/modules/agent/store';
import { useAuth } from '@/modules/auth';
import { useModels, useModelsStore } from '@/modules/models';
import { usePlaybookStore } from '../store';
import { PlaybookIteratorConfigFields } from './PlaybookIteratorConfigFields';
import { PlaybookRouterConfigSection } from './PlaybookRouterConfigSection';
import { PlaybookHumanApprovalConfigSection } from './PlaybookHumanApprovalConfigSection';
import { PlaybookDataFlowSection } from './PlaybookDataFlowSection';
import type {
  PlaybookTask,
  ValidatedTaskReplay,
  TaskInputPort,
  TaskOutputPort,
  ArtifactKind,
  SelectedAction,
  PlaybookEvaluationConfig,
  PlaybookNodeType,
  PlaybookIteratorConfig,
  RouterConfig,
  HumanApprovalConfig,
  RetryPolicy,
} from '../types';
import { useModuleTranslation } from '@/modules/localization';
import {
  getDefaultIteratorInputPorts,
  getDefaultIteratorOutputPorts,
} from '../hooks/helpers/node-serializer';
import { getEffectiveNodeType } from '../utils/node-type';

interface EditorDraft {
  title: string;
  description: string;
  assignedAgentId: string | null;
  nodeType: PlaybookNodeType;
  executionMode: string;
  selectedAction: SelectedAction;
  interruptBefore: boolean;
  interruptAfter: boolean;
  allowClarification: boolean;
  enabled: boolean;
  notifyOnComplete: boolean;
  notifyEmails: string[];
  inputPorts: TaskInputPort[];
  outputPorts: TaskOutputPort[];
  evaluationConfig: PlaybookEvaluationConfig | null;
  iteratorConfig: PlaybookIteratorConfig | null;
  routerConfig: RouterConfig | null;
  humanApprovalConfig: HumanApprovalConfig | null;
  retryPolicy: RetryPolicy | null;
  modelId: string | null;
  disableAdvisorEvaluation: boolean;
  expectedResult: string | null;
}

const DEFAULT_ITERATOR_CONFIG: PlaybookIteratorConfig = {
  source: '{{items}}',
  mode: 'item',
  batchSize: 10,
  itemVariable: 'item',
  outputVariable: 'processed_items',
  errorStrategy: 'stop',
};

const DEFAULT_ROUTER_CONFIG: RouterConfig = {
  outputLabels: ['retry', 'done', '__error__'],
  maxIterations: 3,
};

const DEFAULT_HUMAN_APPROVAL_CONFIG: HumanApprovalConfig = {
  promptTemplate: '',
  timeoutSeconds: 3600,
};

const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 1,
  delayMs: 1000,
};

const DEFAULT_EVALUATION_CONFIG: PlaybookEvaluationConfig = {
  expectation: '',
  referenceBaselineId: null,
  passThreshold: 80,
  warningThreshold: 60,
  weight: 1,
  rubricVersion: 'evaluation-node-v1',
  weights: {
    semanticMatch: 40,
    referenceMatch: 20,
    artifactRequirements: 20,
    formatCompliance: 10,
    evidenceConsistency: 5,
    executionHealth: 5,
  },
};

interface EditorSectionProps {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  resetKey?: string;
}

function EditorSection({ title, children, defaultOpen = false, className, resetKey }: EditorSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    setOpen(defaultOpen);
  }, [defaultOpen, resetKey]);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className={`rounded-xl border bg-card ${className ?? ''}`}>
        <CollapsibleTrigger className="flex h-auto w-full items-center justify-between rounded-xl px-4 py-3 text-left hover:bg-muted/40">
          <span className="text-sm font-semibold text-foreground">{title}</span>
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
        </CollapsibleTrigger>
        {open ? (
          <CollapsibleContent forceMount className="border-t px-4 py-4 data-[state=open]:animate-accordion-down">
            {children}
          </CollapsibleContent>
        ) : null}
      </div>
    </Collapsible>
  );
}

function buildDraftFromTask(task: PlaybookTask, t: (key: 'nodeEditor.portDefaultInput' | 'nodeEditor.portDefaultOutput') => string): EditorDraft {
  const nodeType = getEffectiveNodeType(task);
  return {
    title: task.title,
    description: task.description,
    assignedAgentId: task.assignedAgentId,
    nodeType,
    executionMode: task.executionMode || 'agent',
    selectedAction: task.selectedAction || 'index',
    interruptBefore: task.interruptBefore,
    interruptAfter: task.interruptAfter,
    allowClarification: task.allowClarification,
    enabled: task.enabled !== false,
    notifyOnComplete: task.notifyOnComplete ?? false,
    notifyEmails: task.notifyEmails ?? [],
    inputPorts:
      nodeType === 'iterator'
        ? getDefaultIteratorInputPorts()
        : task.inputPorts?.map((p) => ({ ...p })) ??
          [{ id: 'default', name: t('nodeEditor.portDefaultInput'), artifactKind: 'text' as ArtifactKind, required: false }],
    outputPorts:
      nodeType === 'iterator'
        ? getDefaultIteratorOutputPorts()
        : task.outputPorts?.map((p) => ({ ...p })) ?? [{ id: 'default', name: t('nodeEditor.portDefaultOutput'), artifactKind: 'text' as ArtifactKind }],
    evaluationConfig: task.evaluationConfig
      ? { ...task.evaluationConfig, weights: { ...task.evaluationConfig.weights } }
      : { ...DEFAULT_EVALUATION_CONFIG, weights: { ...DEFAULT_EVALUATION_CONFIG.weights } },
    iteratorConfig: task.iteratorConfig
      ? { ...task.iteratorConfig }
      : { ...DEFAULT_ITERATOR_CONFIG },
    routerConfig: task.routerConfig
      ? {
          ...task.routerConfig,
          outputLabels: [...task.routerConfig.outputLabels],
          conditions: task.routerConfig.conditions?.map((condition) => ({ ...condition })),
        }
      : null,
    humanApprovalConfig: task.humanApprovalConfig
      ? { ...task.humanApprovalConfig }
      : null,
    retryPolicy: task.retryPolicy ?? null,
    modelId: task.modelId ?? null,
    disableAdvisorEvaluation: task.disableAdvisorEvaluation ?? false,
    expectedResult: task.expectedResult ?? null,
  };
}

function draftToSavePayload(draft: EditorDraft): Partial<PlaybookTask> {
  return {
    title: draft.title,
    description: draft.description,
    taskType: draft.nodeType === 'evaluation' ? 'evaluation' : draft.nodeType === 'iterator' ? 'iterator' : 'generic',
    nodeType: draft.nodeType,
    assignedAgentId: draft.nodeType === 'action' || draft.nodeType === 'iterator' ? null : draft.assignedAgentId,
    executionMode: (draft.nodeType === 'evaluation' || draft.nodeType === 'iterator' ? 'agent' : draft.executionMode) as import('../types').TaskExecutionMode | undefined,
    selectedAction: draft.nodeType === 'action' ? draft.selectedAction : undefined,
    interruptBefore: draft.interruptBefore,
    interruptAfter: draft.interruptAfter,
    allowClarification: draft.allowClarification,
    enabled: draft.enabled,
    notifyOnComplete: draft.notifyOnComplete,
    notifyEmails: draft.notifyOnComplete ? draft.notifyEmails : [],
    inputPorts: draft.nodeType === 'iterator' ? getDefaultIteratorInputPorts() : [...draft.inputPorts],
    outputPorts: draft.nodeType === 'iterator' ? getDefaultIteratorOutputPorts() : [...draft.outputPorts],
    evaluationConfig: draft.evaluationConfig,
    iteratorConfig: draft.nodeType === 'iterator' ? draft.iteratorConfig : null,
    routerConfig: draft.nodeType === 'router' ? draft.routerConfig : null,
    humanApprovalConfig: draft.nodeType === 'human_approval' ? draft.humanApprovalConfig : null,
    retryPolicy: isStepLikeNodeType(draft.nodeType) && draft.retryPolicy ? draft.retryPolicy : null,
    modelId: isStepLikeNodeType(draft.nodeType) ? draft.modelId : null,
    disableAdvisorEvaluation: draft.disableAdvisorEvaluation,
    expectedResult: draft.expectedResult,
  };
}

function isStepLikeNodeType(nodeType: PlaybookNodeType): boolean {
  return nodeType === 'agent' || nodeType === 'action' || nodeType === 'evaluation';
}

interface Props {
  playbookId: string | null;
  task: PlaybookTask | null;
  allTasks?: PlaybookTask[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (taskId: string, data: Partial<PlaybookTask>) => void;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function PlaybookNodeEditor({ playbookId, task, allTasks = [], open, onOpenChange, onSave }: Props) {
  const agents = useAgents();
  const fetchAgents = useAgentStore((s) => s.fetchAgents);
  const models = useModels();
  const fetchModels = useModelsStore((s) => s.fetchModels);
  const fetchTaskReplays = usePlaybookStore((s) => s.fetchTaskReplays);
  const activateTaskReplay = usePlaybookStore((s) => s.activateTaskReplay);
  const updateTaskReplayFormatGuide = usePlaybookStore((s) => s.updateTaskReplayFormatGuide);
  const fetchEvaluationBaseline = usePlaybookStore((s) => s.fetchEvaluationBaseline);
  const fetchEvaluationExecutions = usePlaybookStore((s) => s.fetchEvaluationExecutions);
  const createEvaluationBaselineFromExecution = usePlaybookStore((s) => s.createEvaluationBaselineFromExecution);
  const createEvaluationBaselineFromCurrentExecution = usePlaybookStore((s) => s.createEvaluationBaselineFromCurrentExecution);
  const deleteEvaluationBaseline = usePlaybookStore((s) => s.deleteEvaluationBaseline);
  const { user } = useAuth();
  const { t } = useModuleTranslation('playbook');

  useEffect(() => {
    if (open) {
      fetchAgents();
      fetchModels();
    }
  }, [open, fetchAgents, fetchModels]);

  const [draft, setDraft] = useState<EditorDraft>({
    title: '',
    description: '',
    assignedAgentId: null,
    nodeType: 'agent',
    executionMode: 'agent',
    selectedAction: 'index',
    interruptBefore: false,
    interruptAfter: false,
    allowClarification: false,
    enabled: true,
    notifyOnComplete: false,
    notifyEmails: [],
    inputPorts: [],
    outputPorts: [],
    evaluationConfig: null,
    iteratorConfig: null,
    routerConfig: null,
    humanApprovalConfig: null,
    retryPolicy: null,
    modelId: null,
    disableAdvisorEvaluation: false,
    expectedResult: null,
  });

  const agentOptions = useMemo<SearchableSelectOption[]>(
    () => agents.map((agent) => ({ value: agent.id, label: agent.name })),
    [agents],
  );

  const modelOptions = useMemo<SearchableSelectOption[]>(
    () => {
      const opts = models
        .filter((model) => model.isActive || model.id === draft.modelId)
        .map((model) => ({ value: model.id, label: model.name }));
      opts.unshift({ value: '', label: t('nodeEditor.modelDefault') });
      return opts;
    },
    [models, draft.modelId, t],
  );

  const updateDraft = useCallback((patch: Partial<EditorDraft>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  }, []);

  const [emailInput, setEmailInput] = useState('');
  const [emailError, setEmailError] = useState('');
  const [replays, setReplays] = useState<ValidatedTaskReplay[]>([]);
  const [replaysLoading, setReplaysLoading] = useState(false);
  const [activatingReplayId, setActivatingReplayId] = useState<string | null>(null);
  const [editingReplay, setEditingReplay] = useState<ValidatedTaskReplay | null>(null);
  const [formatGuideDraft, setFormatGuideDraft] = useState('');
  const [preserveFormatDraft, setPreserveFormatDraft] = useState(false);
  const [savingFormatGuide, setSavingFormatGuide] = useState(false);
  const [hasInitializedDraft, setHasInitializedDraft] = useState(false);
  const [evaluationBaselineMeta, setEvaluationBaselineMeta] = useState<{ id: string; sourceExecutionId: string; createdAt: string } | null>(null);
  const [evaluationExecutions, setEvaluationExecutions] = useState<Array<{ id: string; executionId: string; createdAt: string; score?: number | null; verdict?: 'pass' | 'warning' | 'fail' | null }>>([]);
  const [selectedBaselineExecutionId, setSelectedBaselineExecutionId] = useState('');
  const [creatingEvaluationBaseline, setCreatingEvaluationBaseline] = useState(false);
  const [removingEvaluationBaseline, setRemovingEvaluationBaseline] = useState(false);
  const [baselineExecutionDialogOpen, setBaselineExecutionDialogOpen] = useState(false);
  const [viewBaselineDialogOpen, setViewBaselineDialogOpen] = useState(false);
  const [advancedEvaluationOpen, setAdvancedEvaluationOpen] = useState(false);
  const lastSuggestionSignatureRef = useRef('');

  const isEvaluationTask = draft.nodeType === 'evaluation';
  const isIteratorTask = draft.nodeType === 'iterator';
  const iteratorChildren = useMemo(
    () => (task ? allTasks.filter((candidate) => candidate.containerConfig?.parentIteratorId === task.id) : []),
    [allTasks, task],
  );
  const iteratorCandidates = useMemo(
    () => allTasks.filter((candidate) => candidate.id !== task?.id && candidate.taskType !== 'iterator'),
    [allTasks, task?.id],
  );

  useEffect(() => {
    if (task) {
      setDraft(buildDraftFromTask(task, t));
      setEmailInput('');
      setEmailError('');
      setHasInitializedDraft(false);
      setAdvancedEvaluationOpen(false);
      lastSuggestionSignatureRef.current = '';
    }
  }, [task, t]);

  useEffect(() => {
    if (!open || !task || !hasInitializedDraft) return;
    const timeoutId = window.setTimeout(() => {
      onSave(task.id, draftToSavePayload(draft));
    }, 350);

    return () => window.clearTimeout(timeoutId);
  }, [open, task, hasInitializedDraft, draft, onSave]);

  useEffect(() => {
    if (!open || !task) return;
    const timeoutId = window.setTimeout(() => {
      setHasInitializedDraft(true);
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [open, task]);

  useEffect(() => {
    let cancelled = false;

    const loadReplays = async () => {
      if (!open || !task || !playbookId) return;
      setReplaysLoading(true);
      try {
        const result = await fetchTaskReplays(playbookId, task.id);
        if (!cancelled) setReplays(result);
      } finally {
        if (!cancelled) setReplaysLoading(false);
      }
    };

    loadReplays().catch(() => {
      if (!cancelled) setReplaysLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [open, task, playbookId, fetchTaskReplays]);

  useEffect(() => {
    let cancelled = false;
    const loadEvaluationBaseline = async () => {
      setEvaluationBaselineMeta(null);
      if (!open || !task || !playbookId || draft.nodeType !== 'evaluation') return;
      try {
        const baseline = await fetchEvaluationBaseline(playbookId, task.id);
        if (!cancelled) {
          setEvaluationBaselineMeta(
            baseline
              ? { id: baseline.id, sourceExecutionId: baseline.sourceExecutionId, createdAt: baseline.createdAt }
              : null,
          );
        }
      } catch {
        if (!cancelled) setEvaluationBaselineMeta(null);
      }
    };
    void loadEvaluationBaseline();
    return () => { cancelled = true; };
  }, [open, task, playbookId, fetchEvaluationBaseline, draft.nodeType]);

  useEffect(() => {
    let cancelled = false;
    const loadEvaluationExecutions = async () => {
      setEvaluationExecutions([]);
      setSelectedBaselineExecutionId('');
      if (!open || !task || !playbookId || draft.nodeType !== 'evaluation') return;
      try {
        const entries = await fetchEvaluationExecutions(playbookId, task.id);
        if (!cancelled) {
          const mapped = entries.map((entry) => ({
            id: entry.id,
            executionId: entry.executionId,
            createdAt: entry.createdAt,
            score: entry.score ?? null,
            verdict: entry.verdict ?? null,
          }));
          setEvaluationExecutions(mapped);
          setSelectedBaselineExecutionId(mapped[0]?.executionId || '');
        }
      } catch {
        if (!cancelled) setEvaluationExecutions([]);
      }
    };
    void loadEvaluationExecutions();
    return () => { cancelled = true; };
  }, [open, task, playbookId, fetchEvaluationExecutions, draft.nodeType]);

  const hasPendingFormatGuide = replays.some((replay) => replay.preserveOutputFormat && replay.formatGuideStatus === 'pending');

  useEffect(() => {
    if (!open || !task || !playbookId || !hasPendingFormatGuide) return;

    const intervalId = window.setInterval(() => {
      void fetchTaskReplays(playbookId, task.id).then(setReplays).catch(() => undefined);
    }, 2000);

    return () => window.clearInterval(intervalId);
  }, [open, playbookId, task, hasPendingFormatGuide, fetchTaskReplays]);

  const handleNotifyToggle = useCallback((checked: boolean) => {
    updateDraft({ notifyOnComplete: checked });
    if (checked && draft.notifyEmails.length === 0 && user?.email) {
      updateDraft({ notifyEmails: [user.email] });
    }
  }, [draft.notifyEmails.length, user?.email, updateDraft]);

  const addEmail = useCallback((raw: string) => {
    const email = raw.trim().toLowerCase();
    if (!email) return;
    if (!EMAIL_REGEX.test(email)) {
      setEmailError(t('nodeEditor.invalidEmail'));
      return;
    }
    setDraft((prev) => {
      if (prev.notifyEmails.includes(email)) {
        setEmailError(t('nodeEditor.duplicateEmail'));
        return prev;
      }
      setEmailInput('');
      setEmailError('');
      return { ...prev, notifyEmails: [...prev.notifyEmails, email] };
    });
  }, [t]);

  const removeEmail = useCallback((email: string) => {
    setDraft((prev) => ({ ...prev, notifyEmails: prev.notifyEmails.filter((e) => e !== email) }));
  }, []);

  const handleEmailKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addEmail(emailInput);
    } else if (e.key === 'Backspace' && !emailInput && draft.notifyEmails.length > 0) {
      setDraft((prev) => ({ ...prev, notifyEmails: prev.notifyEmails.slice(0, -1) }));
    }
    if (emailError) setEmailError('');
  }, [emailInput, draft.notifyEmails.length, addEmail, emailError]);

  const handleEmailBlur = useCallback(() => {
    if (emailInput.trim()) addEmail(emailInput);
  }, [emailInput, addEmail]);

  if (!task) return null;

  const handleActivateReplay = async (replayId: string) => {
    if (!playbookId || !task) return;
    setActivatingReplayId(replayId);
    try {
      const replay = await activateTaskReplay(playbookId, task.id, replayId);
      setReplays((prev) =>
        prev.map((item) => ({
          ...item,
          status: item.id === replay.id ? 'active' : item.status === 'archived' ? 'archived' : 'inactive',
        })),
      );
    } finally {
      setActivatingReplayId(null);
    }
  };

  const openFormatGuideEditor = (replay: ValidatedTaskReplay) => {
    setEditingReplay(replay);
    setPreserveFormatDraft(Boolean(replay.preserveOutputFormat));
    setFormatGuideDraft(replay.outputFormatGuide || '');
  };

  const handleSaveFormatGuide = async () => {
    if (!playbookId || !task || !editingReplay) return;
    setSavingFormatGuide(true);
    try {
      const updatedReplay = await updateTaskReplayFormatGuide(playbookId, task.id, editingReplay.id, {
        preserveOutputFormat: preserveFormatDraft,
        outputFormatGuide: formatGuideDraft,
      });
      setReplays((prev) => prev.map((item) => (item.id === updatedReplay.id ? updatedReplay : item)));
      setEditingReplay(updatedReplay);
    } finally {
      setSavingFormatGuide(false);
    }
  };

  const handleCreateBaselineFromSelectedExecution = async () => {
    if (!playbookId || !task || !selectedBaselineExecutionId) return;
    setCreatingEvaluationBaseline(true);
    try {
      const baseline = await createEvaluationBaselineFromExecution(playbookId, task.id, selectedBaselineExecutionId);
      setEvaluationBaselineMeta({ id: baseline.id, sourceExecutionId: baseline.sourceExecutionId, createdAt: baseline.createdAt });
      updateDraft({ evaluationConfig: draft.evaluationConfig ? { ...draft.evaluationConfig, referenceBaselineId: baseline.id } : draft.evaluationConfig });
      setBaselineExecutionDialogOpen(false);
    } finally {
      setCreatingEvaluationBaseline(false);
    }
  };

  const handleCreateBaselineFromCurrentInputs = async () => {
    if (!playbookId || !task) return;
    const latestEvaluationExecution = evaluationExecutions[0];
    if (!latestEvaluationExecution) return;
    setCreatingEvaluationBaseline(true);
    try {
      const baseline = await createEvaluationBaselineFromCurrentExecution(playbookId, task.id, latestEvaluationExecution.executionId, latestEvaluationExecution.id);
      setEvaluationBaselineMeta({ id: baseline.id, sourceExecutionId: baseline.sourceExecutionId, createdAt: baseline.createdAt });
      updateDraft({ evaluationConfig: draft.evaluationConfig ? { ...draft.evaluationConfig, referenceBaselineId: baseline.id } : draft.evaluationConfig });
    } finally {
      setCreatingEvaluationBaseline(false);
    }
  };

  const handleRemoveBaseline = async () => {
    if (!playbookId || !task) return;
    setRemovingEvaluationBaseline(true);
    try {
      await deleteEvaluationBaseline(playbookId, task.id);
      setEvaluationBaselineMeta(null);
      updateDraft({ evaluationConfig: draft.evaluationConfig ? { ...draft.evaluationConfig, referenceBaselineId: null } : draft.evaluationConfig });
      setViewBaselineDialogOpen(false);
    } finally {
      setRemovingEvaluationBaseline(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="flex h-[88vh] w-[96vw] max-w-7xl flex-col gap-0 overflow-hidden border-border bg-background p-0 shadow-[0_28px_90px_-44px_rgba(15,23,42,0.35)]"
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader className="border-b px-6 py-4 pr-14">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <DialogTitle>{t('nodeEditor.title')}</DialogTitle>
                <DialogDescription>{draft.title || t('nodeEditor.stepTitlePlaceholder')}</DialogDescription>
              </div>
              <div className="flex items-center gap-2 rounded-full border bg-muted/40 px-3 py-1.5">
                <Label htmlFor="step-enabled" className="cursor-pointer text-xs font-medium text-muted-foreground">
                  {t('nodeEditor.enabledLabel')}
                </Label>
                <Switch id="step-enabled" checked={draft.enabled} onCheckedChange={(v) => updateDraft({ enabled: v })} />
              </div>
            </div>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="min-h-full space-y-4 bg-muted/10 p-4">
              <div className="space-y-4">
              <EditorSection title={t('nodeEditor.sectionIdentity')} defaultOpen resetKey={`${task.id}:identity`}>
                <div className="space-y-4">
                  <div className="grid grid-cols-[1fr_180px] gap-3">
                    <div className="space-y-2">
                      <Label>{t('nodeEditor.stepTitle')}</Label>
                      <Input
                        value={draft.title}
                        onChange={(e) => updateDraft({ title: e.target.value })}
                        placeholder={t('nodeEditor.stepTitlePlaceholder')}
                        maxLength={200}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{t('nodeEditor.nodeType')}</Label>
                      <select
                        value={draft.nodeType}
                        onChange={(e) => {
                          const nextType = e.target.value as PlaybookNodeType;
                          const patch: Partial<EditorDraft> = { nodeType: nextType };
                          if (nextType === 'evaluation') {
                            patch.executionMode = 'agent';
                            patch.iteratorConfig = null;
                            patch.routerConfig = null;
                            patch.humanApprovalConfig = null;
                          } else if (nextType === 'action') {
                            patch.executionMode = 'action';
                            patch.assignedAgentId = null;
                            patch.iteratorConfig = null;
                            patch.routerConfig = null;
                            patch.humanApprovalConfig = null;
                          } else if (nextType === 'iterator') {
                            patch.executionMode = 'agent';
                            patch.assignedAgentId = null;
                            patch.iteratorConfig = draft.iteratorConfig ?? { ...DEFAULT_ITERATOR_CONFIG };
                            patch.inputPorts = getDefaultIteratorInputPorts();
                            patch.outputPorts = getDefaultIteratorOutputPorts();
                            patch.routerConfig = null;
                            patch.humanApprovalConfig = null;
                            patch.retryPolicy = null;
                            patch.modelId = null;
                          } else if (nextType === 'router') {
                            patch.executionMode = 'agent';
                            patch.assignedAgentId = null;
                            patch.routerConfig = draft.routerConfig ?? { ...DEFAULT_ROUTER_CONFIG, outputLabels: [...DEFAULT_ROUTER_CONFIG.outputLabels] };
                            patch.outputPorts = draft.routerConfig?.outputLabels.map((label) => ({
                              id: label,
                              name: label,
                              artifactKind: 'text' as ArtifactKind,
                            })) ?? DEFAULT_ROUTER_CONFIG.outputLabels.map((label) => ({
                              id: label,
                              name: label,
                              artifactKind: 'text' as ArtifactKind,
                            }));
                            patch.iteratorConfig = null;
                            patch.humanApprovalConfig = null;
                            patch.retryPolicy = null;
                            patch.modelId = null;
                          } else if (nextType === 'human_approval') {
                            patch.executionMode = 'agent';
                            patch.assignedAgentId = null;
                            patch.humanApprovalConfig = draft.humanApprovalConfig ?? { ...DEFAULT_HUMAN_APPROVAL_CONFIG };
                            patch.iteratorConfig = null;
                            patch.routerConfig = null;
                            patch.retryPolicy = null;
                            patch.modelId = null;
                          } else {
                            patch.executionMode = 'agent';
                            patch.iteratorConfig = null;
                          }
                          updateDraft(patch);
                        }}
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      >
                        <option value="agent">{t('nodeEditor.nodeTypeAgent')}</option>
                        <option value="action">{t('nodeEditor.nodeTypeAction')}</option>
                        <option value="iterator">{t('nodeEditor.nodeTypeIterator')}</option>
                        <option value="evaluation">{t('nodeEditor.nodeTypeEvaluation')}</option>
                        <option value="router">{t('nodeEditor.nodeTypeRouter')}</option>
                        <option value="human_approval">{t('nodeEditor.nodeTypeHumanApproval')}</option>
                      </select>
                    </div>
                  </div>
                </div>
              </EditorSection>

              <EditorSection title={t('nodeEditor.sectionExecution')} defaultOpen resetKey={`${task.id}:execution`}>
                <div className="space-y-4">
                  {draft.nodeType === 'action' ? (
                    <div className="space-y-2">
                      <Label>{t('nodeEditor.action') || 'Action'}</Label>
                      <select
                        value={draft.selectedAction}
                        onChange={(e) => {
                          const nextAction = e.target.value as SelectedAction;
                          updateDraft({ selectedAction: nextAction });
                          onSave(task.id, {
                            executionMode: 'action',
                            assignedAgentId: null,
                            selectedAction: nextAction,
                          });
                        }}
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      >
                        <option value="index">{t('nodeEditor.actionOption.index')}</option>
                        <option value="delete">{t('nodeEditor.actionOption.delete')}</option>
                        <option value="read">{t('nodeEditor.actionOption.read')}</option>
                      </select>
                      <p className="text-xs text-muted-foreground">
                        {draft.selectedAction === 'index' && t('nodeEditor.actionHint.index')}
                        {draft.selectedAction === 'delete' && t('nodeEditor.actionHint.delete')}
                        {draft.selectedAction === 'read' && t('nodeEditor.actionHint.read')}
                      </p>
                    </div>
                  ) : (draft.nodeType === 'agent' || draft.nodeType === 'evaluation') && isStepLikeNodeType(draft.nodeType) ? (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>{t('nodeEditor.agent')}</Label>
                        <SearchableSelect
                          options={agentOptions}
                          value={draft.assignedAgentId || ''}
                          onValueChange={(v) => updateDraft({ assignedAgentId: v })}
                          placeholder={t('nodeEditor.selectAgent')}
                          searchPlaceholder={t('nodeEditor.searchAgent')}
                          emptyText={t('nodeEditor.noAgentFound')}
                        />
                        {!draft.assignedAgentId && (
                          <p className="text-xs text-destructive">{t('nodeEditor.agentRequired')}</p>
                        )}
                        {draft.nodeType === 'evaluation' && (
                          <p className="text-xs text-muted-foreground">{t('nodeEditor.evaluationAgentHint')}</p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label>{t('nodeEditor.model')}</Label>
                        <SearchableSelect
                          options={modelOptions}
                          value={draft.modelId || ''}
                          onValueChange={(v) => updateDraft({ modelId: v || null })}
                          placeholder={t('nodeEditor.selectModel')}
                          searchPlaceholder={t('nodeEditor.searchModel')}
                          emptyText={t('nodeEditor.noModelFound')}
                        />
                      </div>
                    </div>
                  ) : draft.nodeType === 'agent' || draft.nodeType === 'evaluation' ? (
                    <div className="space-y-2">
                      <Label>{t('nodeEditor.agent')}</Label>
                      <SearchableSelect
                        options={agentOptions}
                        value={draft.assignedAgentId || ''}
                        onValueChange={(v) => updateDraft({ assignedAgentId: v })}
                        placeholder={t('nodeEditor.selectAgent')}
                        searchPlaceholder={t('nodeEditor.searchAgent')}
                        emptyText={t('nodeEditor.noAgentFound')}
                      />
                      {draft.nodeType === 'evaluation' && (
                        <p className="text-xs text-muted-foreground">{t('nodeEditor.evaluationAgentHint')}</p>
                      )}
                      {!draft.assignedAgentId && (
                        <p className="text-xs text-destructive">{t('nodeEditor.agentRequired')}</p>
                      )}
                    </div>
                  ) : null}

                  <div className="space-y-2">
                    <Label>{t('nodeEditor.description')}</Label>
                    <Textarea
                      value={draft.description}
                      onChange={(e) => updateDraft({ description: e.target.value })}
                      placeholder={t('nodeEditor.descriptionPlaceholder')}
                      rows={2}
                      maxLength={20000}
                      className="resize-y"
                    />
                  </div>
                </div>
              </EditorSection>

              {!isEvaluationTask && (
                <EditorSection title={t('nodeEditor.expectedResult')} resetKey={`${task.id}:expected-result`}>
                  <div className="space-y-2">
                    <Textarea
                      value={draft.expectedResult ?? ''}
                      onChange={(e) => updateDraft({ expectedResult: e.target.value || null })}
                      placeholder={t('nodeEditor.expectedResultPlaceholder')}
                      rows={4}
                      maxLength={10000}
                    />
                    <p className="text-xs text-muted-foreground">{t('nodeEditor.expectedResultHint')}</p>
                  </div>
                </EditorSection>
              )}

              {!isEvaluationTask && (
                <EditorSection title={t('dataFlow.sectionTitle')} defaultOpen resetKey={`${task.id}:data-flow`}>
                  <PlaybookDataFlowSection
                    targetNodeId={task.id}
                    inputPortsOverride={draft.inputPorts}
                    outputPortsOverride={draft.outputPorts}
                    onInputPortsChange={(inputPorts) => updateDraft({ inputPorts })}
                    onOutputPortsChange={(outputPorts) => updateDraft({ outputPorts })}
                    canEditPorts={draft.nodeType !== 'iterator'}
                  />
                </EditorSection>
              )}

              {isStepLikeNodeType(draft.nodeType) && (
                <EditorSection title={t('nodeEditor.retryPolicy')} resetKey={`${task.id}:retry`}>
                  <div className="space-y-3">
                    <p className="text-xs text-muted-foreground">{t('nodeEditor.retryPolicyHint')}</p>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>{t('nodeEditor.retryMaxRetries')}</Label>
                        <Input
                          type="number"
                          min={0}
                          max={10}
                          value={draft.retryPolicy?.maxRetries ?? 1}
                          onChange={(e) => updateDraft({
                            retryPolicy: { ...(draft.retryPolicy ?? { ...DEFAULT_RETRY_POLICY }), maxRetries: Number(e.target.value || 0) },
                          })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>{t('nodeEditor.retryDelayMs')}</Label>
                        <Input
                          type="number"
                          min={0}
                          step={100}
                          value={draft.retryPolicy?.delayMs ?? 1000}
                          onChange={(e) => updateDraft({
                            retryPolicy: { ...(draft.retryPolicy ?? { ...DEFAULT_RETRY_POLICY }), delayMs: Number(e.target.value || 0) },
                          })}
                        />
                      </div>
                    </div>
                  </div>
                </EditorSection>
              )}

              {isIteratorTask && draft.iteratorConfig && (
                <EditorSection title={t('nodeEditor.nodeTypeIterator')} defaultOpen resetKey={`${task.id}:iterator`}>
                  <PlaybookIteratorConfigFields
                    value={draft.iteratorConfig}
                    onChange={(iteratorConfig) => updateDraft({ iteratorConfig })}
                  />
                </EditorSection>
              )}

              {draft.nodeType === 'router' && draft.routerConfig && (
                <EditorSection title={t('nodeEditor.nodeTypeRouter')} defaultOpen resetKey={`${task.id}:router`}>
                  <PlaybookRouterConfigSection
                    value={draft.routerConfig}
                    onChange={(routerConfig) =>
                      updateDraft({
                        routerConfig,
                        outputPorts: routerConfig.outputLabels.map((label) => ({
                          id: label,
                          name: label,
                          artifactKind: 'text' as ArtifactKind,
                        })),
                      })
                    }
                    tasks={allTasks}
                    targetTaskId={task.id}
                  />
                </EditorSection>
              )}

              {draft.nodeType === 'human_approval' && draft.humanApprovalConfig && (
                <EditorSection title={t('nodeEditor.nodeTypeHumanApproval')} defaultOpen resetKey={`${task.id}:human-approval`}>
                  <PlaybookHumanApprovalConfigSection
                    value={draft.humanApprovalConfig}
                    onChange={(humanApprovalConfig) => updateDraft({ humanApprovalConfig })}
                  />
                </EditorSection>
              )}

              {isEvaluationTask && draft.evaluationConfig != null && (() => {
                const ec = draft.evaluationConfig;
                return (
                  <EditorSection title={t('nodeEditor.nodeTypeEvaluation')} defaultOpen resetKey={`${task.id}:evaluation`}>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label>{t('nodeEditor.evaluationExpectation')}</Label>
                        <Textarea
                          value={ec.expectation}
                          onChange={(e) => updateDraft({ evaluationConfig: { ...ec, expectation: e.target.value } })}
                          placeholder={t('nodeEditor.evaluationExpectationPlaceholder')}
                          rows={5}
                          maxLength={10000}
                        />
                        <p className="text-xs text-muted-foreground">{t('nodeEditor.evaluationExpectationHint')}</p>
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <div className="space-y-2">
                          <Label>{t('nodeEditor.evaluationPassThreshold')}</Label>
                          <Input
                            type="number"
                            min={0}
                            max={100}
                            value={ec.passThreshold}
                            onChange={(e) => updateDraft({ evaluationConfig: { ...ec, passThreshold: Number(e.target.value || 0) } })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>{t('nodeEditor.evaluationWarningThreshold')}</Label>
                          <Input
                            type="number"
                            min={0}
                            max={100}
                            value={ec.warningThreshold}
                            onChange={(e) => updateDraft({ evaluationConfig: { ...ec, warningThreshold: Number(e.target.value || 0) } })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>{t('nodeEditor.evaluationWeight')}</Label>
                          <Input
                            type="number"
                            min={0}
                            step="0.1"
                            value={ec.weight}
                            onChange={(e) => updateDraft({ evaluationConfig: { ...ec, weight: Number(e.target.value || 0) } })}
                          />
                        </div>
                      </div>
                      <div className="rounded-lg border border-dashed p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-medium">{t('nodeEditor.evaluationBaselineTitle')}</div>
                            <div className="text-xs text-muted-foreground">{t('nodeEditor.evaluationBaselineHint')}</div>
                          </div>
                          {evaluationBaselineMeta ? (
                            <Badge variant="outline" className="border-amber-600/30 text-amber-700">
                              {t('nodeEditor.evaluationBaselineActive')}
                            </Badge>
                          ) : null}
                        </div>
                        <div className="mt-3 text-xs text-muted-foreground">
                          {evaluationBaselineMeta
                            ? `${t('nodeEditor.evaluationBaselineExecution')} ${evaluationBaselineMeta.sourceExecutionId} • ${new Date(evaluationBaselineMeta.createdAt).toLocaleString()}`
                            : t('nodeEditor.evaluationBaselineEmpty')}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button type="button" variant="outline" size="sm" onClick={() => setBaselineExecutionDialogOpen(true)}>
                            {evaluationBaselineMeta ? t('nodeEditor.evaluationBaselineReplaceFromExecution') : t('nodeEditor.evaluationBaselineSelectExecution')}
                          </Button>
                          <Button type="button" variant="outline" size="sm" disabled={creatingEvaluationBaseline || evaluationExecutions.length === 0} onClick={() => void handleCreateBaselineFromCurrentInputs()}>
                            {creatingEvaluationBaseline ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                            {evaluationBaselineMeta ? t('nodeEditor.evaluationBaselineReplaceCurrent') : t('nodeEditor.evaluationBaselineCurrent')}
                          </Button>
                          <Button type="button" variant="ghost" size="sm" disabled={!evaluationBaselineMeta} onClick={() => setViewBaselineDialogOpen(true)}>
                            {t('nodeEditor.evaluationBaselineView')}
                          </Button>
                          <Button type="button" variant="ghost" size="sm" disabled={!evaluationBaselineMeta || removingEvaluationBaseline} onClick={() => void handleRemoveBaseline()}>
                            {removingEvaluationBaseline ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                            {t('nodeEditor.evaluationBaselineRemove')}
                          </Button>
                        </div>
                      </div>
                      <Collapsible open={advancedEvaluationOpen} onOpenChange={setAdvancedEvaluationOpen}>
                        <CollapsibleTrigger asChild>
                          <Button type="button" variant="ghost" className="w-full justify-between px-0 text-sm font-medium">
                            {t('nodeEditor.evaluationAdvanced')}
                            <ChevronDown className={`h-4 w-4 transition-transform ${advancedEvaluationOpen ? 'rotate-180' : ''}`} />
                          </Button>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="space-y-4 pt-2 data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
                          <div className="space-y-2">
                            <Label>{t('nodeEditor.evaluationRubricVersion')}</Label>
                            <Input value={ec.rubricVersion} onChange={(e) => updateDraft({ evaluationConfig: { ...ec, rubricVersion: e.target.value } })} />
                          </div>
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            {([
                              ['semanticMatch', 'nodeEditor.evaluationWeightSemantic'],
                              ['referenceMatch', 'nodeEditor.evaluationWeightReference'],
                              ['artifactRequirements', 'nodeEditor.evaluationWeightArtifact'],
                              ['formatCompliance', 'nodeEditor.evaluationWeightFormat'],
                              ['evidenceConsistency', 'nodeEditor.evaluationWeightEvidence'],
                              ['executionHealth', 'nodeEditor.evaluationWeightExecution'],
                            ] as const).map(([key, labelKey]) => (
                              <div key={key} className="space-y-2">
                                <Label>{t(labelKey)}</Label>
                                <Input type="number" min={0} value={ec.weights[key]} onChange={(e) => updateDraft({ evaluationConfig: { ...ec, weights: { ...ec.weights, [key]: Number(e.target.value || 0) } } })} />
                              </div>
                            ))}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    </div>
                  </EditorSection>
                );
              })()}
              </div>

              {isIteratorTask && draft.iteratorConfig && (
                <EditorSection title={t('nodeEditor.iteratorChildren')} resetKey={`${task.id}:iterator-children`}>
                  <div className="space-y-2 rounded-lg border bg-background p-3">
                    <div className="space-y-2">
                      {iteratorCandidates.map((candidate) => {
                        const checked = candidate.containerConfig?.parentIteratorId === task.id;
                        return (
                          <label key={candidate.id} className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                onSave(candidate.id, {
                                  containerConfig: {
                                    parentIteratorId: e.target.checked ? task.id : null,
                                  },
                                });
                              }}
                            />
                            <span>{candidate.title}</span>
                          </label>
                        );
                      })}
                      {iteratorCandidates.length === 0 && (
                        <p className="text-xs text-muted-foreground">{t('nodeEditor.iteratorChildrenEmpty')}</p>
                      )}
                    </div>
                    {iteratorChildren.length > 0 && (
                      <p className="text-xs text-muted-foreground">{t('iterator.childCount', { count: iteratorChildren.length })}</p>
                    )}
                  </div>
                </EditorSection>
              )}
              <EditorSection title={t('nodeEditor.sectionReplays')} resetKey={`${task.id}:replays`}>
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {task.hasValidatedReplay && (
                      <Badge variant="outline" className="border-amber-600/30 text-amber-700">
                        {t('nodeEditor.replayActiveVersion', { version: task.activeReplayVersion || 1 })}
                      </Badge>
                    )}
                    {task.activeReplayPreserveOutputFormat && (
                      <Badge variant="outline" className="border-sky-600/30 text-sky-700">
                        {t('nodeEditor.replayFormatPreserved')}
                      </Badge>
                    )}
                    {task.activeReplayPreserveOutputFormat && task.activeReplayFormatGuideStatus === 'pending' && (
                      <Badge variant="outline" className="border-sky-600/30 text-sky-700">
                        {t('nodeEditor.replayGuidePending')}
                      </Badge>
                    )}
                    {task.activeReplayPreserveOutputFormat && task.activeReplayFormatGuideStatus === 'failed' && (
                      <Badge variant="outline" className="border-red-600/30 text-red-700">
                        {t('nodeEditor.replayGuideFailed')}
                      </Badge>
                    )}
                    {task.activeReplayIsStale && (
                      <Badge variant="outline" className="border-orange-600/30 text-orange-700">
                        {t('execution.staleResult')}
                      </Badge>
                    )}
                  </div>

                  {(task.hasOutputFormatTemplate || task.activeOutputFormatStatus) && (
                    <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-3 text-xs text-sky-800">
                      <div className="flex flex-wrap items-center gap-2">
                        {task.hasOutputFormatTemplate && (
                          <Badge variant="outline" className="border-sky-600/30 text-sky-700">
                            {t('nodeEditor.replayTemplateVersion', { version: task.activeOutputFormatTemplateVersion || 1 })}
                          </Badge>
                        )}
                        {task.activeOutputFormatStatus === 'pending' && (
                          <Badge variant="outline" className="border-sky-600/30 text-sky-700">
                            {t('nodeEditor.replayTemplatePending')}
                          </Badge>
                        )}
                        {task.activeOutputFormatStatus === 'failed' && (
                          <Badge variant="outline" className="border-red-600/30 text-red-700">
                            {t('nodeEditor.replayTemplateFailed')}
                          </Badge>
                        )}
                      </div>
                      {task.activeOutputFormatError && (
                        <div className="mt-2 text-xs text-red-700">{task.activeOutputFormatError}</div>
                      )}
                      <div className="mt-2 text-xs text-muted-foreground">
                        {t('nodeEditor.replayTemplateHint')}
                      </div>
                    </div>
                  )}

                  {task.activeReplayIsStale && task.activeReplayStaleReasons && task.activeReplayStaleReasons.length > 0 && (
                    <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-3 text-xs text-orange-800">
                      <div className="font-medium">{t('nodeEditor.replayWarningTitle')}</div>
                      <div className="mt-1">{task.activeReplayStaleReasons.join(' • ')}</div>
                    </div>
                  )}

                  {replaysLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t('nodeEditor.replayLoading')}
                    </div>
                  ) : replays.length > 0 ? (
                    <div className="space-y-2">
                      {replays.map((replay) => (
                        <div key={replay.id} className="rounded-lg border bg-background p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-sm font-medium">{t('nodeEditor.replayVersionLabel', { version: replay.validationVersion })}</div>
                              <div className="text-xs text-muted-foreground">
                                {t('nodeEditor.replayExecutionLabel', { execution: replay.referenceExecutionNumber })} • {new Date(replay.createdAt).toLocaleString()}
                              </div>
                            </div>
                            {replay.status === 'active' ? (
                              <Badge>{t('nodeEditor.replayActive')}</Badge>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={activatingReplayId === replay.id}
                                onClick={() => handleActivateReplay(replay.id)}
                              >
                                {activatingReplayId === replay.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t('nodeEditor.replayActivate')}
                              </Button>
                            )}
                          </div>
                          <div className="mt-2 text-xs text-muted-foreground">
                            {t('nodeEditor.replayToolCallCount', { count: replay.toolCalls.length })}
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            {replay.preserveOutputFormat && (
                              <Badge variant="outline" className="border-sky-600/30 text-sky-700">
                                {t('nodeEditor.replayFormatPreserved')}
                              </Badge>
                            )}
                            {replay.preserveOutputFormat && replay.formatGuideStatus === 'pending' && (
                              <Badge variant="outline" className="border-sky-600/30 text-sky-700">
                                {t('nodeEditor.replayGuidePending')}
                              </Badge>
                            )}
                            {replay.preserveOutputFormat && replay.formatGuideStatus === 'failed' && (
                              <Badge variant="outline" className="border-red-600/30 text-red-700">
                                {t('nodeEditor.replayGuideFailed')}
                              </Badge>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => openFormatGuideEditor(replay)}
                            >
                              {t('nodeEditor.replayEditFormatGuide')}
                            </Button>
                          </div>
                          {replay.isStale && replay.staleReasons && replay.staleReasons.length > 0 && (
                            <div className="mt-2 rounded border border-orange-500/30 bg-orange-500/5 p-2 text-xs text-orange-800">
                              {replay.staleReasons.join(' • ')}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">
                      {t('nodeEditor.replayEmpty')}
                    </div>
                  )}
                </div>
              </EditorSection>

              <EditorSection title={t('nodeEditor.interruptSettings')} resetKey={`${task.id}:interrupts`}>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="interrupt-before" className="text-sm font-normal">
                      {t('nodeEditor.interruptBefore')}
                    </Label>
                    <Switch
                      id="interrupt-before"
                      checked={draft.interruptBefore}
                      onCheckedChange={(v) => updateDraft({ interruptBefore: v })}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label htmlFor="interrupt-after" className="text-sm font-normal">
                      {t('nodeEditor.interruptAfter')}
                    </Label>
                    <Switch
                      id="interrupt-after"
                      checked={draft.interruptAfter}
                      onCheckedChange={(v) => updateDraft({ interruptAfter: v })}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label htmlFor="allow-clarification" className="text-sm font-normal">
                      {t('nodeEditor.allowClarification')}
                    </Label>
                    <Switch
                      id="allow-clarification"
                      checked={draft.allowClarification}
                      onCheckedChange={(v) => updateDraft({ allowClarification: v })}
                    />
                  </div>
                </div>
              </EditorSection>

              <EditorSection title={t('nodeEditor.notificationSettings')} resetKey={`${task.id}:notifications`}>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="notify-on-complete" className="text-sm font-normal">
                      {t('nodeEditor.notifyOnComplete')}
                    </Label>
                    <Switch
                      id="notify-on-complete"
                      checked={draft.notifyOnComplete}
                      onCheckedChange={handleNotifyToggle}
                    />
                  </div>

                  {draft.notifyOnComplete && (
                    <div className="space-y-2">
                      <Label className="text-sm font-normal">{t('nodeEditor.notifyEmails')}</Label>
                      <div className="flex min-h-[38px] flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5">
                        {draft.notifyEmails.map((email) => (
                          <span
                            key={email}
                            className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground"
                          >
                            {email}
                            <button
                              type="button"
                              onClick={() => removeEmail(email)}
                              className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20"
                            >
                              <span className="text-xs">x</span>
                            </button>
                          </span>
                        ))}
                        <input
                          type="email"
                          value={emailInput}
                          onChange={(e) => {
                            setEmailInput(e.target.value);
                            if (emailError) setEmailError('');
                          }}
                          onKeyDown={handleEmailKeyDown}
                          onBlur={handleEmailBlur}
                          placeholder={draft.notifyEmails.length === 0 ? t('nodeEditor.notifyEmailPlaceholder') : ''}
                          className="min-w-[120px] flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                        />
                      </div>
                      {emailError && (
                        <p className="text-xs text-destructive">{emailError}</p>
                      )}
                      <p className="text-xs text-muted-foreground">{t('nodeEditor.notifyEmailHint')}</p>
                    </div>
                  )}
                </div>
              </EditorSection>

              <EditorSection title={t('nodeEditor.advisorSettings')} resetKey={`${task.id}:advisor`}>
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-1">
                    <Label htmlFor="disable-advisor" className="text-sm font-normal">
                      {t('nodeEditor.disableAdvisorEvaluation')}
                    </Label>
                    <div className="text-xs text-muted-foreground">
                      {t('nodeEditor.disableAdvisorEvaluationHint')}
                    </div>
                  </div>
                  <Switch
                    id="disable-advisor"
                    checked={draft.disableAdvisorEvaluation}
                    onCheckedChange={(v) => updateDraft({ disableAdvisorEvaluation: v })}
                  />
                </div>
              </EditorSection>
            </div>
          </div>
      </DialogContent>
      </Dialog>

      <Dialog open={!!editingReplay} onOpenChange={(open) => {
        if (!open) {
          setEditingReplay(null);
          setFormatGuideDraft('');
          setPreserveFormatDraft(false);
        }
      }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('nodeEditor.formatGuideTitle')}</DialogTitle>
            <DialogDescription>
              {t('nodeEditor.formatGuideDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <div className="text-sm font-medium">{t('nodeEditor.formatGuidePreserve')}</div>
                <div className="text-xs text-muted-foreground">
                  {t('nodeEditor.formatGuidePreserveHint')}
                </div>
              </div>
              <Switch checked={preserveFormatDraft} onCheckedChange={setPreserveFormatDraft} />
            </div>
            <div className="space-y-2">
              <Label>{t('nodeEditor.formatGuideLabel')}</Label>
              {editingReplay?.preserveOutputFormat && editingReplay.formatGuideStatus === 'pending' && (
                <div className="rounded-md border border-sky-500/30 bg-sky-500/5 p-3 text-xs text-sky-800">
                  {t('nodeEditor.formatGuidePending')}
                </div>
              )}
              {editingReplay?.formatGuideStatus === 'failed' && (
                <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-800">
                  {t('nodeEditor.formatGuideFailed')}{editingReplay.formatGuideError ? `: ${editingReplay.formatGuideError}` : '.'}
                </div>
              )}
              <Textarea
                value={formatGuideDraft}
                onChange={(e) => setFormatGuideDraft(e.target.value)}
                rows={10}
                placeholder={t('nodeEditor.formatGuidePlaceholder')}
              />
            </div>
            {editingReplay?.referenceOutput && (
              <div className="space-y-2">
                <Label>{t('nodeEditor.formatGuideReference')}</Label>
                <div className="max-h-52 overflow-auto rounded-md border bg-muted/20 p-3 text-xs whitespace-pre-wrap">
                  {editingReplay.referenceOutput}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setEditingReplay(null);
                setFormatGuideDraft('');
                setPreserveFormatDraft(false);
              }}
              disabled={savingFormatGuide}
            >
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void handleSaveFormatGuide()} disabled={savingFormatGuide}>
              {savingFormatGuide ? `${t('common.save')}...` : t('nodeEditor.formatGuideSave')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={baselineExecutionDialogOpen} onOpenChange={setBaselineExecutionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('nodeEditor.evaluationBaselineDialogTitle')}</DialogTitle>
            <DialogDescription>{t('nodeEditor.evaluationBaselineDialogDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label>{t('nodeEditor.evaluationBaselineExecutionPicker')}</Label>
            <select value={selectedBaselineExecutionId} onChange={(e) => setSelectedBaselineExecutionId(e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
              <option value="">{t('nodeEditor.evaluationBaselineExecutionPlaceholder')}</option>
              {evaluationExecutions.map((entry) => (
                <option key={entry.id} value={entry.executionId}>
                  {entry.executionId} • {entry.verdict === 'pass'
                    ? t('nodeEditor.evaluationVerdictPass')
                    : entry.verdict === 'warning'
                      ? t('nodeEditor.evaluationVerdictWarning')
                      : entry.verdict === 'fail'
                        ? t('nodeEditor.evaluationVerdictFail')
                        : t('execution.status.completed')} • {entry.score ?? 0}
                </option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setBaselineExecutionDialogOpen(false)}>{t('common.cancel')}</Button>
            <Button type="button" disabled={!selectedBaselineExecutionId || creatingEvaluationBaseline} onClick={() => void handleCreateBaselineFromSelectedExecution()}>
              {creatingEvaluationBaseline ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t('nodeEditor.evaluationBaselineConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={viewBaselineDialogOpen} onOpenChange={setViewBaselineDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('nodeEditor.evaluationBaselineView')}</DialogTitle>
            <DialogDescription>{t('nodeEditor.evaluationBaselineHint')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <div><span className="font-medium">{t('nodeEditor.evaluationBaselineExecution')}</span> {evaluationBaselineMeta?.sourceExecutionId || '-'}</div>
            <div><span className="font-medium">{t('nodeEditor.evaluationBaselineCreatedAt')}</span> {evaluationBaselineMeta ? new Date(evaluationBaselineMeta.createdAt).toLocaleString() : '-'}</div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setViewBaselineDialogOpen(false)}>{t('nodeEditor.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
