import { useState, useEffect, useMemo, useCallback, useRef, forwardRef, useImperativeHandle, type KeyboardEvent, type ReactNode } from 'react';
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
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SearchableSelect, type SearchableSelectOption } from '@/components/ui/searchable-select';
import { AlertCircle, ArrowLeft, Check, ChevronDown, Loader2, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useAgents, useAgentStore } from '@/modules/agent/store';
import { useAuth } from '@/modules/auth';
import { useModels, useModelsStore } from '@/modules/models';
import { usePlaybookStore } from '../store';
import { PlaybookIteratorConfigFields } from './PlaybookIteratorConfigFields';
import { PlaybookRouterConfigSection } from './PlaybookRouterConfigSection';
import { PlaybookHumanApprovalConfigSection } from './PlaybookHumanApprovalConfigSection';
import { PlaybookDataFlowSection } from './PlaybookDataFlowSection';
import { HitlBlockerCenter } from './HitlBlockerCenter';
import { HitlPolicySummaryCard } from './HitlPolicySummaryCard';
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
import { handleApiError } from '@/lib/api-error';
import {
  getDefaultIteratorInputPorts,
  getDefaultIteratorOutputPorts,
} from '../hooks/helpers/node-serializer';
import { getEffectiveNodeType } from '../utils/node-type';
import { getNodeCapabilities } from '../utils/node-capabilities';
import { generateExpectedOutputFormat } from '../utils/replay-reference-defaults';

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
  deepSearch: boolean;
  dynamicReasoningEnabled: boolean;
  stepReplayMode: NonNullable<PlaybookTask['stepReplayMode']>;
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

type EditorTab = 'setup' | 'quality' | 'oversight';

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
    executionMode: nodeType === 'action' ? 'action' : task.executionMode || 'agent',
    selectedAction: task.selectedAction || 'index',
    interruptBefore: task.interruptBefore,
    interruptAfter: task.interruptAfter,
    allowClarification: task.allowClarification,
    enabled: task.enabled !== false,
    notifyOnComplete: task.notifyOnComplete ?? false,
    notifyEmails: task.notifyEmails ?? [],
    inputPorts:
      nodeType === 'iterator'
        ? getIteratorInputPorts(task.inputPorts)
        : task.inputPorts?.map((p) => ({ ...p })) ??
          [{ id: 'default', name: t('nodeEditor.portDefaultInput'), artifactKind: 'text' as ArtifactKind, required: false }],
    outputPorts:
      nodeType === 'iterator'
        ? getIteratorOutputPorts(task.outputPorts)
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
    deepSearch: task.deepSearch ?? false,
    dynamicReasoningEnabled: task.dynamicReasoning?.enabled ?? false,
    stepReplayMode: task.stepReplayMode ?? 'live',
  };
}

function areDraftValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function draftToSavePayload(
  draft: EditorDraft,
  originalDraft?: EditorDraft | null,
  originalTask?: PlaybookTask | null,
): Partial<PlaybookTask> {
  const capabilities = getNodeCapabilities(draft.nodeType);
  const fullPayload: Partial<PlaybookTask> = {
    title: draft.title,
    description: draft.description,
    taskType: draft.nodeType === 'evaluation' ? 'evaluation' : draft.nodeType === 'iterator' ? 'iterator' : 'generic',
    nodeType: draft.nodeType,
    assignedAgentId: capabilities.requiresAgent ? draft.assignedAgentId : null,
    executionMode: (draft.nodeType === 'action'
      ? 'action'
      : draft.nodeType === 'evaluation' || draft.nodeType === 'iterator'
        ? 'agent'
        : draft.executionMode) as import('../types').TaskExecutionMode | undefined,
    selectedAction: draft.nodeType === 'action' ? draft.selectedAction : undefined,
    interruptBefore: draft.interruptBefore,
    interruptAfter: draft.interruptAfter,
    allowClarification: draft.allowClarification,
    enabled: draft.enabled,
    notifyOnComplete: draft.notifyOnComplete,
    notifyEmails: draft.notifyOnComplete ? draft.notifyEmails : [],
    inputPorts: draft.nodeType === 'iterator' ? getIteratorInputPorts(draft.inputPorts) : [...draft.inputPorts],
    outputPorts: draft.nodeType === 'iterator' ? getIteratorOutputPorts(draft.outputPorts) : [...draft.outputPorts],
    evaluationConfig: draft.evaluationConfig,
    iteratorConfig: draft.nodeType === 'iterator' ? draft.iteratorConfig : null,
    routerConfig: draft.nodeType === 'router' ? draft.routerConfig : null,
    humanApprovalConfig: draft.nodeType === 'human_approval' ? draft.humanApprovalConfig : null,
    retryPolicy: capabilities.supportsRetry && draft.retryPolicy ? draft.retryPolicy : null,
    modelId: capabilities.supportsModel ? draft.modelId : null,
    disableAdvisorEvaluation: capabilities.supportsAdvisorEvaluation ? draft.disableAdvisorEvaluation : undefined,
    expectedResult: capabilities.supportsExpectedResult ? draft.expectedResult : undefined,
    deepSearch: capabilities.supportsDeepSearch ? draft.deepSearch : undefined,
    dynamicReasoning: capabilities.supportsDynamicReasoning
      ? { enabled: draft.dynamicReasoningEnabled }
      : undefined,
    stepReplayMode: capabilities.supportsReference ? draft.stepReplayMode : undefined,
  };

  if (!originalDraft || draft.nodeType !== originalDraft.nodeType) return fullPayload;

  const payload: Partial<PlaybookTask> = {};
  const copyWhenChanged = <K extends keyof EditorDraft, P extends keyof PlaybookTask>(draftKey: K, payloadKey: P) => {
    if (!areDraftValuesEqual(draft[draftKey], originalDraft[draftKey])) {
      (payload as Record<string, unknown>)[payloadKey] = (fullPayload as Record<string, unknown>)[payloadKey];
    }
  };

  copyWhenChanged('title', 'title');
  copyWhenChanged('description', 'description');
  copyWhenChanged('assignedAgentId', 'assignedAgentId');
  copyWhenChanged('executionMode', 'executionMode');
  copyWhenChanged('selectedAction', 'selectedAction');
  copyWhenChanged('interruptBefore', 'interruptBefore');
  copyWhenChanged('interruptAfter', 'interruptAfter');
  copyWhenChanged('allowClarification', 'allowClarification');
  copyWhenChanged('enabled', 'enabled');
  copyWhenChanged('notifyOnComplete', 'notifyOnComplete');
  copyWhenChanged('notifyEmails', 'notifyEmails');
  copyWhenChanged('inputPorts', 'inputPorts');
  copyWhenChanged('outputPorts', 'outputPorts');
  copyWhenChanged('evaluationConfig', 'evaluationConfig');
  copyWhenChanged('iteratorConfig', 'iteratorConfig');
  copyWhenChanged('routerConfig', 'routerConfig');
  copyWhenChanged('humanApprovalConfig', 'humanApprovalConfig');
  copyWhenChanged('retryPolicy', 'retryPolicy');
  copyWhenChanged('modelId', 'modelId');
  copyWhenChanged('disableAdvisorEvaluation', 'disableAdvisorEvaluation');
  copyWhenChanged('expectedResult', 'expectedResult');
  copyWhenChanged('deepSearch', 'deepSearch');
  copyWhenChanged('dynamicReasoningEnabled', 'dynamicReasoning');
  copyWhenChanged('stepReplayMode', 'stepReplayMode');

  if (draft.notifyOnComplete !== originalDraft.notifyOnComplete) {
    payload.notifyEmails = fullPayload.notifyEmails;
  }
  if (
    draft.nodeType === 'action'
    && originalTask?.executionMode !== 'action'
    && !areDraftValuesEqual(draft.selectedAction, originalDraft.selectedAction)
  ) {
    payload.executionMode = 'action';
  }

  return payload;
}

function getNodeTypeConversionPatch(nextType: PlaybookNodeType, draft: EditorDraft): Partial<EditorDraft> {
  const patch: Partial<EditorDraft> = { nodeType: nextType };
  if (nextType === 'evaluation') {
    return { ...patch, executionMode: 'agent', iteratorConfig: null, routerConfig: null, humanApprovalConfig: null };
  }
  if (nextType === 'action') {
    return { ...patch, executionMode: 'action', assignedAgentId: null, iteratorConfig: null, routerConfig: null, humanApprovalConfig: null };
  }
  if (nextType === 'iterator') {
    return {
      ...patch,
      executionMode: 'agent',
      assignedAgentId: null,
      iteratorConfig: draft.iteratorConfig ?? { ...DEFAULT_ITERATOR_CONFIG },
      inputPorts: getDefaultIteratorInputPorts(),
      outputPorts: getDefaultIteratorOutputPorts(),
      routerConfig: null,
      humanApprovalConfig: null,
      retryPolicy: null,
      modelId: null,
    };
  }
  if (nextType === 'router') {
    const routerConfig = draft.routerConfig ?? { ...DEFAULT_ROUTER_CONFIG, outputLabels: [...DEFAULT_ROUTER_CONFIG.outputLabels] };
    return {
      ...patch,
      executionMode: 'agent',
      assignedAgentId: null,
      routerConfig,
      outputPorts: routerConfig.outputLabels.map((label) => ({ id: label, name: label, artifactKind: 'text' as ArtifactKind })),
      iteratorConfig: null,
      humanApprovalConfig: null,
      retryPolicy: null,
      modelId: null,
    };
  }
  if (nextType === 'human_approval') {
    return {
      ...patch,
      executionMode: 'agent',
      assignedAgentId: null,
      humanApprovalConfig: draft.humanApprovalConfig ?? { ...DEFAULT_HUMAN_APPROVAL_CONFIG },
      iteratorConfig: null,
      routerConfig: null,
      retryPolicy: null,
      modelId: null,
    };
  }
  return { ...patch, executionMode: 'agent', iteratorConfig: null };
}

function getIteratorInputPorts(inputPorts?: TaskInputPort[]): TaskInputPort[] {
  const defaultCollectionPort = getDefaultIteratorInputPorts()[0];
  const existingCollectionPort = inputPorts?.find((port) => port.id === defaultCollectionPort.id || port.role === 'collection');
  const contextPorts = (inputPorts ?? [])
    .filter((port) => port.id !== defaultCollectionPort.id && port.role !== 'collection')
    .map((port) => ({ ...port, role: 'context' as const }));

  return [
    { ...defaultCollectionPort, ...existingCollectionPort, id: defaultCollectionPort.id, role: 'collection' as const },
    ...contextPorts,
  ];
}

function getIteratorOutputPorts(outputPorts?: TaskOutputPort[]): TaskOutputPort[] {
  const defaultOutputPort = getDefaultIteratorOutputPorts()[0];
  const existingOutputPort = outputPorts?.find((port) => port.id === defaultOutputPort.id);
  return [{ ...defaultOutputPort, ...existingOutputPort, id: defaultOutputPort.id }];
}

export interface PlaybookNodeEditorHandle {
  flushSave: () => void;
}

interface Props {
  playbookId: string | null;
  task: PlaybookTask | null;
  allTasks?: PlaybookTask[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (taskId: string, data: Partial<PlaybookTask>) => void;
  initialView?: 'setup' | 'quality' | 'reference';
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const PlaybookNodeEditor = forwardRef<PlaybookNodeEditorHandle, Props>(function PlaybookNodeEditor({ playbookId, task, allTasks = [], open, onOpenChange, onSave, initialView = 'setup' }, ref) {
  const agents = useAgents();
  const fetchAgents = useAgentStore((s) => s.fetchAgents);
  const models = useModels();
  const fetchModels = useModelsStore((s) => s.fetchModels);
  const fetchTaskReplays = usePlaybookStore((s) => s.fetchTaskReplays);
  const activateTaskReplay = usePlaybookStore((s) => s.activateTaskReplay);
  const deleteTaskReplay = usePlaybookStore((s) => s.deleteTaskReplay);
  const updateTaskReplayFormatGuide = usePlaybookStore((s) => s.updateTaskReplayFormatGuide);
  const renameTaskReplay = usePlaybookStore((s) => s.renameTaskReplay);
  const fetchEvaluationBaseline = usePlaybookStore((s) => s.fetchEvaluationBaseline);
  const fetchEvaluationExecutions = usePlaybookStore((s) => s.fetchEvaluationExecutions);
  const createEvaluationBaselineFromExecution = usePlaybookStore((s) => s.createEvaluationBaselineFromExecution);
  const createEvaluationBaselineFromCurrentExecution = usePlaybookStore((s) => s.createEvaluationBaselineFromCurrentExecution);
  const deleteEvaluationBaseline = usePlaybookStore((s) => s.deleteEvaluationBaseline);
  const isPlaybookDirty = usePlaybookStore((s) => s.isDirty);
  const isPlaybookSaving = usePlaybookStore((s) => s.isSaving);
  const autosaveBackoffUntil = usePlaybookStore((s) => s.autosaveBackoffUntil);
  const saveCurrentPlaybook = usePlaybookStore((s) => s.saveCurrentPlaybook);
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
    deepSearch: false,
    dynamicReasoningEnabled: false,
    stepReplayMode: 'live',
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
  const [evaluationBaselineMeta, setEvaluationBaselineMeta] = useState<{ id: string; sourceExecutionId: string; createdAt: string } | null>(null);
  const [evaluationExecutions, setEvaluationExecutions] = useState<Array<{ id: string; executionId: string; createdAt: string; score?: number | null; verdict?: 'pass' | 'warning' | 'fail' | null }>>([]);
  const [selectedBaselineExecutionId, setSelectedBaselineExecutionId] = useState('');
  const [creatingEvaluationBaseline, setCreatingEvaluationBaseline] = useState(false);
  const [removingEvaluationBaseline, setRemovingEvaluationBaseline] = useState(false);
  const [baselineExecutionDialogOpen, setBaselineExecutionDialogOpen] = useState(false);
  const [viewBaselineDialogOpen, setViewBaselineDialogOpen] = useState(false);
  const [advancedEvaluationOpen, setAdvancedEvaluationOpen] = useState(false);
  const lastSuggestionSignatureRef = useRef('');
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const taskRef = useRef(task);
  taskRef.current = task;
  const deferredCloseSaveRef = useRef<number | null>(null);
  const originalDraftRef = useRef<EditorDraft | null>(null);
  const lastSavedDraftRef = useRef<EditorDraft | null>(null);
  const hasUnsavedEditorChangesRef = useRef(false);
  const saveEditingReplayRef = useRef<() => Promise<void>>(async () => undefined);
  const hydratedTaskIdRef = useRef<string | null>(null);
  const wasOpenRef = useRef(false);
  const [replayStaleDialogOpen, setReplayStaleDialogOpen] = useState(false);
  const [removingStaleReplay, setRemovingStaleReplay] = useState(false);
  const [stepHitlDialogOpen, setStepHitlDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<EditorTab>('setup');
  const [pendingNodeType, setPendingNodeType] = useState<PlaybookNodeType | null>(null);
  const [editorSavePending, setEditorSavePending] = useState(false);
  const translationRef = useRef(t);
  translationRef.current = t;

  const prepareReplayForEditing = useCallback((replay: ValidatedTaskReplay): ValidatedTaskReplay => ({
    ...replay,
    label: replay.label?.trim() ? replay.label : translationRef.current('nodeEditor.referenceDefaultName'),
    outputFormatGuide: replay.outputFormatGuide?.trim()
      ? replay.outputFormatGuide
      : generateExpectedOutputFormat(
        replay.referenceOutput,
        (key, values) => translationRef.current(key as Parameters<typeof t>[0], values),
      ),
  }), []);

  useImperativeHandle(ref, () => ({
    flushSave: () => {
      const currentTask = taskRef.current;
      if (currentTask && hasUnsavedEditorChangesRef.current) {
        const payload = draftToSavePayload(draftRef.current, lastSavedDraftRef.current, currentTask);
        if (Object.keys(payload).length > 0) onSave(currentTask.id, payload);
        lastSavedDraftRef.current = draftRef.current;
        hasUnsavedEditorChangesRef.current = false;
        setEditorSavePending(false);
      }
      void saveEditingReplayRef.current();
    },
  }), [onSave]);

  const isEvaluationTask = draft.nodeType === 'evaluation';
  const isIteratorTask = draft.nodeType === 'iterator';
  const capabilities = getNodeCapabilities(draft.nodeType);
  const iteratorChildren = useMemo(
    () => (task ? allTasks.filter((candidate) => candidate.containerConfig?.parentIteratorId === task.id) : []),
    [allTasks, task],
  );
  const iteratorCandidates = useMemo(
    () => allTasks.filter((candidate) => candidate.id !== task?.id && candidate.taskType !== 'iterator'),
    [allTasks, task?.id],
  );

  useEffect(() => {
    const reopened = open && !wasOpenRef.current;
    wasOpenRef.current = open;

    if (!open) {
      setEditingReplay(null);
    }

    if (task && (task.id !== hydratedTaskIdRef.current || reopened)) {
      const built = buildDraftFromTask(task, t);
      setDraft(built);
      originalDraftRef.current = built;
      lastSavedDraftRef.current = built;
      hasUnsavedEditorChangesRef.current = false;
      hydratedTaskIdRef.current = task.id;
      setEmailInput('');
      setEmailError('');
      setAdvancedEvaluationOpen(false);
      setActiveTab(initialView === 'setup' ? 'setup' : 'quality');
      setPendingNodeType(null);
      setEditorSavePending(false);
      setEditingReplay(null);
      lastSuggestionSignatureRef.current = '';
    }

    if (!task) {
      hydratedTaskIdRef.current = null;
    }
  }, [initialView, open, task, t]);

  useEffect(() => {
    if (!open || !task || !editorSavePending) return;
    const timeoutId = window.setTimeout(() => {
      const payload = draftToSavePayload(draft, lastSavedDraftRef.current, task);
      if (Object.keys(payload).length > 0) onSave(task.id, payload);
      lastSavedDraftRef.current = draft;
      hasUnsavedEditorChangesRef.current = false;
      setEditorSavePending(false);
    }, 350);

    return () => window.clearTimeout(timeoutId);
  }, [open, task, editorSavePending, draft, onSave]);

  const updateEditorDraft = useCallback((patch: Partial<EditorDraft>) => {
    hasUnsavedEditorChangesRef.current = true;
    setEditorSavePending(true);
    updateDraft(patch);
  }, [updateDraft]);

  const retrySave = useCallback(() => {
    const currentTask = taskRef.current;
    if (currentTask && hasUnsavedEditorChangesRef.current) {
      const payload = draftToSavePayload(draftRef.current, lastSavedDraftRef.current, currentTask);
      if (Object.keys(payload).length > 0) onSave(currentTask.id, payload);
      lastSavedDraftRef.current = draftRef.current;
      hasUnsavedEditorChangesRef.current = false;
      setEditorSavePending(false);
    }
    void Promise.resolve().then(() => saveCurrentPlaybook({ reason: 'autosave' })).catch(handleApiError);
  }, [onSave, saveCurrentPlaybook]);

  useEffect(() => {
    let cancelled = false;

    const loadReplays = async () => {
      if (!open || !task || !playbookId) return;
      setReplaysLoading(true);
      try {
        const result = await fetchTaskReplays(playbookId, task.id);
        if (!cancelled) {
          setReplays(result);
          if (initialView === 'reference') {
            const activeReplay = result.find((replay) => replay.status === 'active') ?? result[0] ?? null;
            if (activeReplay) {
              setEditingReplay(prepareReplayForEditing(activeReplay));
            }
          }
        }
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
  }, [open, task, playbookId, fetchTaskReplays, initialView, prepareReplayForEditing]);

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
  const configurableReplay = replays.find((replay) => replay.status === 'active') ?? replays[0] ?? null;

  useEffect(() => {
    if (!open || !task || !playbookId || !hasPendingFormatGuide) return;

    const intervalId = window.setInterval(() => {
      void fetchTaskReplays(playbookId, task.id).then(setReplays).catch(() => undefined);
    }, 2000);

    return () => window.clearInterval(intervalId);
  }, [open, playbookId, task, hasPendingFormatGuide, fetchTaskReplays]);

  const handleNotifyToggle = useCallback((checked: boolean) => {
    updateEditorDraft({ notifyOnComplete: checked });
    if (checked && draft.notifyEmails.length === 0 && user?.email) {
      updateEditorDraft({ notifyEmails: [user.email] });
    }
  }, [draft.notifyEmails.length, user?.email, updateEditorDraft]);

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
      setEditorSavePending(true);
      hasUnsavedEditorChangesRef.current = true;
      return { ...prev, notifyEmails: [...prev.notifyEmails, email] };
    });
  }, [t]);

  const removeEmail = useCallback((email: string) => {
    hasUnsavedEditorChangesRef.current = true;
    setEditorSavePending(true);
    setDraft((prev) => ({ ...prev, notifyEmails: prev.notifyEmails.filter((e) => e !== email) }));
  }, []);

  const handleEmailKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addEmail(emailInput);
    } else if (e.key === 'Backspace' && !emailInput && draft.notifyEmails.length > 0) {
      hasUnsavedEditorChangesRef.current = true;
      setEditorSavePending(true);
      setDraft((prev) => ({ ...prev, notifyEmails: prev.notifyEmails.slice(0, -1) }));
    }
    if (emailError) setEmailError('');
  }, [emailInput, draft.notifyEmails.length, addEmail, emailError]);

  const handleEmailBlur = useCallback(() => {
    if (emailInput.trim()) addEmail(emailInput);
  }, [emailInput, addEmail]);

  const handleReplayUpdated = useCallback((updatedReplay: ValidatedTaskReplay) => {
    setReplays((prev) => prev.map((item) => (item.id === updatedReplay.id ? updatedReplay : item)));
    setEditingReplay(updatedReplay);
  }, []);

  const handleReplayRemoved = useCallback((removedReplayId: string) => {
    setReplays((prev) => prev.filter((item) => item.id !== removedReplayId));
    setEditingReplay((prev) => (prev?.id === removedReplayId ? null : prev));
  }, []);

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
    setEditingReplay(prepareReplayForEditing(replay));
  };

  const saveEditingReplay = useCallback(async () => {
    if (!playbookId || !task || !editingReplay) return;
    const originalReplay = replays.find((replay) => replay.id === editingReplay.id);
    if (!originalReplay) return;

    let updatedReplay = editingReplay;
    const nextLabel = editingReplay.label?.trim() || null;
    if ((originalReplay.label || null) !== nextLabel) {
      updatedReplay = await renameTaskReplay(playbookId, task.id, editingReplay.id, nextLabel);
    }
    const outputFormatChanged = (originalReplay.outputFormatGuide ?? '') !== (editingReplay.outputFormatGuide ?? '');
    const replayConfigChanged = editingReplay.replayConfig !== undefined
      && JSON.stringify(originalReplay.replayConfig) !== JSON.stringify(editingReplay.replayConfig);
    if (outputFormatChanged || replayConfigChanged) {
      updatedReplay = await updateTaskReplayFormatGuide(playbookId, task.id, editingReplay.id, {
        ...(outputFormatChanged ? { outputFormatGuide: editingReplay.outputFormatGuide ?? '' } : {}),
        ...(replayConfigChanged ? { replayConfig: editingReplay.replayConfig } : {}),
      });
    }
    handleReplayUpdated(updatedReplay);
  }, [editingReplay, handleReplayUpdated, playbookId, renameTaskReplay, replays, task, updateTaskReplayFormatGuide]);
  saveEditingReplayRef.current = saveEditingReplay;

  const closeReferenceSubview = useCallback(async () => {
    await saveEditingReplay();
    setEditingReplay(null);
  }, [saveEditingReplay]);

  const handleCreateBaselineFromSelectedExecution = async () => {
    if (!playbookId || !task || !selectedBaselineExecutionId) return;
    setCreatingEvaluationBaseline(true);
    try {
      const baseline = await createEvaluationBaselineFromExecution(playbookId, task.id, selectedBaselineExecutionId);
      setEvaluationBaselineMeta({ id: baseline.id, sourceExecutionId: baseline.sourceExecutionId, createdAt: baseline.createdAt });
      updateEditorDraft({ evaluationConfig: draft.evaluationConfig ? { ...draft.evaluationConfig, referenceBaselineId: baseline.id } : draft.evaluationConfig });
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
      updateEditorDraft({ evaluationConfig: draft.evaluationConfig ? { ...draft.evaluationConfig, referenceBaselineId: baseline.id } : draft.evaluationConfig });
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
      updateEditorDraft({ evaluationConfig: draft.evaluationConfig ? { ...draft.evaluationConfig, referenceBaselineId: null } : draft.evaluationConfig });
      setViewBaselineDialogOpen(false);
    } finally {
      setRemovingEvaluationBaseline(false);
    }
  };

  const hasStaleMakingChanges = useCallback((): boolean => {
    const orig = originalDraftRef.current;
    if (!orig) return false;
    const d = draftRef.current;
    return (
      d.description !== orig.description ||
      d.assignedAgentId !== orig.assignedAgentId ||
      d.nodeType !== orig.nodeType ||
      d.executionMode !== orig.executionMode
    );
  }, []);

  const flushAndClose = useCallback(() => {
    const currentTask = taskRef.current;
    const savePayload = currentTask && hasUnsavedEditorChangesRef.current
      ? draftToSavePayload(draftRef.current, lastSavedDraftRef.current, currentTask)
      : null;
    onOpenChange(false);
    if (savePayload && currentTask && Object.keys(savePayload).length > 0) {
      // Let the dialog close paint before rebuilding large playbooks.
      if (deferredCloseSaveRef.current !== null) {
        window.clearTimeout(deferredCloseSaveRef.current);
      }
      deferredCloseSaveRef.current = window.setTimeout(() => {
        deferredCloseSaveRef.current = null;
        onSave(currentTask.id, savePayload);
      }, 0);
    }
    lastSavedDraftRef.current = draftRef.current;
    hasUnsavedEditorChangesRef.current = false;
    setEditorSavePending(false);
    const replaySave = saveEditingReplayRef.current();
    setEditingReplay(null);
    void replaySave;
  }, [onSave, onOpenChange]);

  const handleRemoveStaleReplay = useCallback(async () => {
    const currentTask = taskRef.current;
    if (!playbookId || !currentTask?.activeReplayId) return;
    setRemovingStaleReplay(true);
    try {
      await deleteTaskReplay(playbookId, currentTask.id, currentTask.activeReplayId);
    } finally {
      setRemovingStaleReplay(false);
      setReplayStaleDialogOpen(false);
      flushAndClose();
    }
  }, [playbookId, deleteTaskReplay, flushAndClose]);

  if (!task) return null;

  const nodeTypeLabelKeys = {
    agent: 'nodeEditor.nodeTypeAgent',
    action: 'nodeEditor.nodeTypeAction',
    iterator: 'nodeEditor.nodeTypeIterator',
    evaluation: 'nodeEditor.nodeTypeEvaluation',
    router: 'nodeEditor.nodeTypeRouter',
    human_approval: 'nodeEditor.nodeTypeHumanApproval',
  } as const;
  const nodeTypeLabel = t(nodeTypeLabelKeys[draft.nodeType]);
  const pendingNodeTypeLabel = pendingNodeType ? t(nodeTypeLabelKeys[pendingNodeType]) : '';
  const readinessIssueCount = Number(draft.title.trim().length === 0)
    + Number((draft.nodeType === 'agent' || draft.nodeType === 'evaluation') && !draft.assignedAgentId);
  const saveFailed = Boolean(autosaveBackoffUntil && isPlaybookDirty);
  const saveState = saveFailed
    ? 'failed'
    : editorSavePending || isPlaybookSaving
      ? 'saving'
      : isPlaybookDirty
        ? 'queued'
        : 'saved';
  return (
    <>
      <Dialog open={open} onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          const currentTask = taskRef.current;
          if (currentTask?.hasValidatedReplay && hasStaleMakingChanges()) {
            setReplayStaleDialogOpen(true);
            return;
          }
          flushAndClose();
        } else {
          onOpenChange(nextOpen);
        }
      }}>
        <DialogContent
          className="flex h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none border-border bg-background p-0 shadow-[0_28px_90px_-44px_rgba(15,23,42,0.35)] sm:h-[88vh] sm:w-[96vw] sm:max-w-7xl sm:rounded-lg"
        >
          <DialogHeader className="border-b px-4 py-3 pr-12 sm:px-6 sm:py-4 sm:pr-14">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1">
                <DialogTitle>{t('nodeEditor.title')}</DialogTitle>
                <DialogDescription>{draft.title || t('nodeEditor.stepTitlePlaceholder')}</DialogDescription>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-3">
                <div className="flex items-center gap-2 text-xs" aria-live="polite">
                  {saveState === 'saving' && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                  {saveState === 'saved' && <Check className="h-3.5 w-3.5 text-emerald-600" />}
                  {saveState === 'queued' && <Check className="h-3.5 w-3.5 text-amber-600" />}
                  {saveState === 'failed' && <AlertCircle className="h-3.5 w-3.5 text-destructive" />}
                  <span className={saveState === 'failed' ? 'text-destructive' : 'text-muted-foreground'}>
                    {t(`nodeEditor.saveState.${saveState}`)}
                  </span>
                  {saveState === 'failed' && (
                    <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={retrySave}>
                      <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                      {t('nodeEditor.saveState.retry')}
                    </Button>
                  )}
                </div>
                <div className="flex items-center gap-2 rounded-full border bg-muted/40 px-3 py-1.5">
                  <Label htmlFor="step-enabled" className="cursor-pointer text-xs font-medium text-muted-foreground">
                    {t('nodeEditor.enabledLabel')}
                  </Label>
                  <Switch id="step-enabled" name="step-enabled" checked={draft.enabled} onCheckedChange={(v) => updateEditorDraft({ enabled: v })} />
                </div>
              </div>
            </div>
          </DialogHeader>

          {editingReplay ? (
            <div className="min-h-0 flex-1 overflow-y-auto bg-muted/10 p-4 sm:p-6">
              <div className="mx-auto max-w-6xl space-y-4">
                <div className="flex items-center gap-3">
                  <Button type="button" variant="ghost" size="sm" onClick={() => void closeReferenceSubview()}>
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    {t('nodeEditor.referenceBack')}
                  </Button>
                  <Badge variant="outline">{t('nodeEditor.replayVersionLabel', { version: editingReplay.validationVersion })}</Badge>
                  {editingReplay.status === 'active' && <Badge>{t('nodeEditor.replayActive')}</Badge>}
                </div>

                <section className="rounded-xl border bg-card">
                  <div className="border-b px-4 py-4 sm:px-5">
                    <h3 className="text-sm font-semibold">{t('nodeEditor.referenceSubviewTitle')}</h3>
                    <p className="mt-1 max-w-3xl text-xs text-muted-foreground">{t('nodeEditor.referenceSubviewHint')}</p>
                  </div>
                  <div className="space-y-5 p-4 sm:p-5">
                    <div className="max-w-xl space-y-2">
                      <Label htmlFor="reference-name">{t('baselineBadge.nameLabel')}</Label>
                      <Input
                        id="reference-name"
                        name="reference-name"
                        value={editingReplay.label || ''}
                        onChange={(event) => setEditingReplay((current) => current ? { ...current, label: event.target.value } : current)}
                        maxLength={100}
                      />
                      <p className="text-xs text-muted-foreground">{t('nodeEditor.referenceNameHint')}</p>
                    </div>

                    <div data-testid="reference-output-workspace" className="grid gap-4 lg:grid-cols-2">
                      <div className="min-w-0 space-y-2">
                        <Label id="trusted-answer-label">{t('nodeEditor.formatGuideReference')}</Label>
                        <div
                          role="region"
                          aria-labelledby="trusted-answer-label"
                          className="h-72 overflow-auto rounded-lg border bg-muted/20 p-4 text-sm leading-6 whitespace-pre-wrap break-words lg:h-[26rem]"
                        >
                          {editingReplay.referenceOutput || t('baselineBadge.overview.noTrustedAnswer')}
                        </div>
                        <p className="text-xs text-muted-foreground">{t('nodeEditor.referenceAnswerHint')}</p>
                      </div>

                      <div className="min-w-0 space-y-2">
                        <Label htmlFor="reference-output-format">{t('nodeEditor.formatGuideLabel')}</Label>
                        <Textarea
                          id="reference-output-format"
                          name="reference-output-format"
                          value={editingReplay.outputFormatGuide ?? ''}
                          onChange={(event) => setEditingReplay((current) => current ? { ...current, outputFormatGuide: event.target.value } : current)}
                          placeholder={t('nodeEditor.formatGuidePlaceholder')}
                          maxLength={10000}
                          className="h-72 resize-y bg-background leading-6 lg:h-[26rem]"
                        />
                        <p className="text-xs text-muted-foreground">{t('nodeEditor.referenceFormatHint')}</p>
                      </div>
                    </div>
                  </div>
                </section>

                <section className="rounded-xl border bg-card p-4 sm:p-5">
                  <div className="mb-3">
                    <h3 className="text-sm font-semibold">{t('nodeEditor.referenceProtections')}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">{t('nodeEditor.referenceProtectionsHint')}</p>
                  </div>
                  <div className="divide-y rounded-lg border bg-background">
                    {([
                      ['replayOutputFormat', 'nodeEditor.replayConfigOutputFormat', 'nodeEditor.replayConfigOutputFormatHint'],
                      ['replayToolTrace', 'nodeEditor.replayConfigToolTrace', 'nodeEditor.replayConfigToolTraceHint'],
                      ...(capabilities.supportsReplayReasoning
                        ? [['replayReasoningChain', 'nodeEditor.replayConfigReasoningChain', 'nodeEditor.replayConfigReasoningChainHint']]
                        : []),
                    ] as Array<[keyof NonNullable<ValidatedTaskReplay['replayConfig']>, string, string]>).map(([key, labelKey, hintKey]) => (
                      <div key={key} className="flex items-start justify-between gap-4 p-3.5">
                        <div>
                          <Label htmlFor={`reference-${key}`}>{t(labelKey as any)}</Label>
                          <p id={`reference-${key}-hint`} className="mt-1 text-xs text-muted-foreground">{t(hintKey as any)}</p>
                        </div>
                        <Switch
                          id={`reference-${key}`}
                          name={`reference-${key}`}
                          aria-describedby={`reference-${key}-hint`}
                          checked={(editingReplay.replayConfig ?? {
                            replayOutputFormat: false,
                            replayToolTrace: false,
                            replayReasoningChain: true,
                          })[key] ?? false}
                          onCheckedChange={(checked) => setEditingReplay((current) => current ? {
                            ...current,
                            replayConfig: {
                              replayOutputFormat: current.replayConfig?.replayOutputFormat ?? false,
                              replayToolTrace: current.replayConfig?.replayToolTrace ?? false,
                              replayReasoningChain: current.replayConfig?.replayReasoningChain ?? true,
                              [key]: checked,
                            },
                          } : current)}
                        />
                      </div>
                    ))}
                  </div>
                </section>

                <div className="flex flex-wrap justify-between gap-2">
                  <Button type="button" variant="destructive" onClick={() => void deleteTaskReplay(playbookId!, task.id, editingReplay.id).then(() => handleReplayRemoved(editingReplay.id))}>
                    <Trash2 className="mr-2 h-4 w-4" />
                    {t('baselineBadge.remove')}
                  </Button>
                  <Button type="button" onClick={() => void closeReferenceSubview()}>{t('common.save')}</Button>
                </div>
              </div>
            </div>
          ) : (
          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as EditorTab)} className="min-h-0 flex-1 gap-0">
            <div className="overflow-x-auto border-b bg-background px-4">
              <TabsList variant="line" aria-label={t('nodeEditor.tabs.label')} className="grid h-12 min-w-full grid-cols-3 p-0">
                {([
                  ['setup', 'nodeEditor.tabs.setup'],
                  ['quality', 'nodeEditor.tabs.quality'],
                  ['oversight', 'nodeEditor.tabs.oversight'],
                ] as const).map(([value, labelKey]) => (
                  <TabsTrigger key={value} value={value} className="h-12 min-w-0 px-2 text-xs sm:px-4 sm:text-sm">
                    {t(labelKey)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>

            <TabsContent value="setup" className="m-0 min-h-0 overflow-y-auto bg-muted/10 p-4">
              <div className="space-y-4">
                <section aria-labelledby="node-editor-details" className="rounded-xl border bg-card p-4 sm:p-5">
                  <div className="mb-4">
                    <h3 id="node-editor-details" className="text-sm font-semibold">{t('nodeEditor.tabs.setup')}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">{t('nodeEditor.tabs.setupHint')}</p>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="step-title">{t('nodeEditor.stepTitle')}</Label>
                      <Input id="step-title" name="step-title" value={draft.title} onChange={(e) => updateEditorDraft({ title: e.target.value })} placeholder={t('nodeEditor.stepTitlePlaceholder')} maxLength={200} />
                    </div>

                    <div data-testid="step-setup-row" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(8rem,0.8fr)_minmax(10rem,1.15fr)_minmax(10rem,1.35fr)_minmax(10rem,0.9fr)]">
                      <div className="min-w-0 space-y-2">
                        <Label htmlFor="step-node-type">{t('nodeEditor.nodeType')}</Label>
                        <select id="step-node-type" name="step-node-type" value={draft.nodeType} onChange={(e) => {
                          const nextType = e.target.value as PlaybookNodeType;
                          if (nextType !== draft.nodeType) setPendingNodeType(nextType);
                        }} className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm">
                          <option value="agent">{t('nodeEditor.nodeTypeAgent')}</option>
                          <option value="action">{t('nodeEditor.nodeTypeAction')}</option>
                          <option value="iterator">{t('nodeEditor.nodeTypeIterator')}</option>
                          <option value="evaluation">{t('nodeEditor.nodeTypeEvaluation')}</option>
                          <option value="router">{t('nodeEditor.nodeTypeRouter')}</option>
                          <option value="human_approval">{t('nodeEditor.nodeTypeHumanApproval')}</option>
                        </select>
                      </div>

                      {(draft.nodeType === 'agent' || draft.nodeType === 'evaluation') && (
                        <div className="min-w-0 space-y-2">
                          <Label id="step-agent-label" htmlFor="step-agent">{t('nodeEditor.agent')}</Label>
                          <SearchableSelect id="step-agent" name="step-agent" aria-labelledby="step-agent-label" options={agentOptions} value={draft.assignedAgentId || ''} onValueChange={(v) => updateEditorDraft({ assignedAgentId: v })} placeholder={t('nodeEditor.selectAgent')} searchPlaceholder={t('nodeEditor.searchAgent')} emptyText={t('nodeEditor.noAgentFound')} />
                          {!draft.assignedAgentId && <p className="text-xs text-destructive">{t('nodeEditor.agentRequired')}</p>}
                        </div>
                      )}

                      {capabilities.supportsModel && (
                        <div className="min-w-0 space-y-2">
                          <Label id="step-model-label" htmlFor="step-model">{t('nodeEditor.model')}</Label>
                          <SearchableSelect id="step-model" name="step-model" aria-labelledby="step-model-label" options={modelOptions} value={draft.modelId || ''} onValueChange={(v) => updateEditorDraft({ modelId: v || null })} placeholder={t('nodeEditor.selectModel')} searchPlaceholder={t('nodeEditor.searchModel')} emptyText={t('nodeEditor.noModelFound')} />
                        </div>
                      )}

                      {capabilities.supportsDynamicReasoning && (
                        <div className="min-w-0 space-y-2">
                          <Label htmlFor="dynamic-reasoning-enabled">{t('nodeEditor.dynamicReasoning.label')}</Label>
                          <div className="flex h-9 items-center justify-between gap-2 rounded-md border border-input bg-background px-3">
                            <span id="dynamic-reasoning-hint" className="truncate text-xs text-muted-foreground">{t('nodeEditor.dynamicReasoning.shortHint')}</span>
                            <Switch id="dynamic-reasoning-enabled" name="dynamic-reasoning-enabled" aria-describedby="dynamic-reasoning-hint" checked={draft.dynamicReasoningEnabled} onCheckedChange={(checked) => updateEditorDraft({ dynamicReasoningEnabled: checked === true })} />
                          </div>
                        </div>
                      )}
                    </div>

                    <p className="text-xs text-muted-foreground">{t(`nodeEditor.nodeTypeDescription.${draft.nodeType}`)}</p>
                    {draft.nodeType === 'evaluation' && <p className="text-xs text-muted-foreground">{t('nodeEditor.evaluationAgentHint')}</p>}

                    <div className="space-y-2">
                      <Label htmlFor="step-instructions">{t('nodeEditor.instructions')}</Label>
                      <Textarea id="step-instructions" name="step-instructions" value={draft.description} onChange={(e) => updateEditorDraft({ description: e.target.value })} placeholder={t('nodeEditor.descriptionPlaceholder')} rows={3} maxLength={20000} className="resize-y" />
                    </div>

                    <div className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm ${readinessIssueCount === 0 ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-amber-500/10 text-amber-800 dark:text-amber-300'}`}>
                      <span className="font-medium">{readinessIssueCount === 0 ? t('nodeEditor.readiness.ready') : t('nodeEditor.readiness.issues', { count: readinessIssueCount })}</span>
                      <span className="text-xs opacity-80">{nodeTypeLabel}</span>
                    </div>
                  </div>
                </section>

                {draft.nodeType === 'action' && (
                  <EditorSection title={t('nodeEditor.action')} defaultOpen resetKey={`${task.id}:action`}>
                    <div className="space-y-2">
                      <Label htmlFor="step-action">{t('nodeEditor.action')}</Label>
                      <select id="step-action" name="step-action" value={draft.selectedAction} onChange={(e) => updateEditorDraft({ selectedAction: e.target.value as SelectedAction })} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                        <option value="index">{t('nodeEditor.actionOption.index')}</option>
                        <option value="delete">{t('nodeEditor.actionOption.delete')}</option>
                        <option value="read">{t('nodeEditor.actionOption.read')}</option>
                      </select>
                      <p className="text-xs text-muted-foreground">{t(`nodeEditor.actionHint.${draft.selectedAction}`)}</p>
                    </div>
                  </EditorSection>
                )}

                {isIteratorTask && draft.iteratorConfig && (
                  <EditorSection title={t('nodeEditor.nodeTypeIterator')} defaultOpen resetKey={`${task.id}:iterator`}>
                    <PlaybookIteratorConfigFields value={draft.iteratorConfig} onChange={(iteratorConfig) => updateEditorDraft({ iteratorConfig })} />
                  </EditorSection>
                )}

                {draft.nodeType === 'router' && draft.routerConfig && (
                  <EditorSection title={t('nodeEditor.nodeTypeRouter')} defaultOpen resetKey={`${task.id}:router`}>
                    <PlaybookRouterConfigSection
                      value={draft.routerConfig}
                      onChange={(routerConfig) => updateEditorDraft({
                        routerConfig,
                        outputPorts: routerConfig.outputLabels.map((label) => ({ id: label, name: label, artifactKind: 'text' as ArtifactKind })),
                      })}
                      tasks={allTasks}
                      targetTaskId={task.id}
                    />
                  </EditorSection>
                )}

                {draft.nodeType === 'human_approval' && draft.humanApprovalConfig && (
                  <EditorSection title={t('nodeEditor.nodeTypeHumanApproval')} defaultOpen resetKey={`${task.id}:human-approval`}>
                    <PlaybookHumanApprovalConfigSection value={draft.humanApprovalConfig} onChange={(humanApprovalConfig) => updateEditorDraft({ humanApprovalConfig })} />
                  </EditorSection>
                )}

                {isIteratorTask && draft.iteratorConfig && (
                  <EditorSection title={t('nodeEditor.iteratorChildren')} defaultOpen resetKey={`${task.id}:iterator-children`}>
                    <div className="space-y-2 rounded-lg border bg-background p-3">
                      <div className="space-y-2">
                        {iteratorCandidates.map((candidate) => {
                          const checked = candidate.containerConfig?.parentIteratorId === task.id;
                          return (
                            <label key={candidate.id} className="flex items-center gap-2 text-sm">
                              <input type="checkbox" name={`iterator-child-${candidate.id}`} aria-label={candidate.title} checked={checked} onChange={(e) => {
                                onSave(candidate.id, { containerConfig: { parentIteratorId: e.target.checked ? task.id : null } });
                              }} />
                              <span>{candidate.title}</span>
                            </label>
                          );
                        })}
                        {iteratorCandidates.length === 0 && <p className="text-xs text-muted-foreground">{t('nodeEditor.iteratorChildrenEmpty')}</p>}
                      </div>
                      {iteratorChildren.length > 0 && <p className="text-xs text-muted-foreground">{t('iterator.childCount', { count: iteratorChildren.length })}</p>}
                    </div>
                  </EditorSection>
                )}

                {capabilities.supportsDeepSearch && (
                  <EditorSection title={t('nodeEditor.capabilitiesTitle')} resetKey={`${task.id}:capabilities`}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1">
                        <Label htmlFor="deep-search" className="text-sm font-medium">{t('nodeEditor.deepSearch')}</Label>
                        <p id="deep-search-description" className="text-xs text-muted-foreground">{t('nodeEditor.deepSearchDescription')}</p>
                      </div>
                      <Switch id="deep-search" name="deep-search" aria-describedby="deep-search-description" checked={draft.deepSearch} onCheckedChange={(checked) => updateEditorDraft({ deepSearch: checked })} />
                    </div>
                  </EditorSection>
                )}

                <EditorSection title={t('dataFlow.sectionTitle')} defaultOpen resetKey={`${task.id}:data-flow`}>
                    <PlaybookDataFlowSection
                      targetNodeId={task.id}
                      inputPortsOverride={draft.inputPorts}
                      outputPortsOverride={draft.outputPorts}
                      onInputPortsChange={(inputPorts) => updateEditorDraft({ inputPorts })}
                      onOutputPortsChange={(outputPorts) => updateEditorDraft({ outputPorts })}
                      canEditPorts
                      inputPortBehavior={draft.nodeType === 'iterator' ? 'iterator' : 'default'}
                      showOutputPorts
                      canEditOutputPortNames={draft.nodeType !== 'router' && draft.nodeType !== 'iterator'}
                      canEditOutputPortKinds={draft.nodeType !== 'iterator'}
                      canModifyOutputPorts={draft.nodeType !== 'router' && draft.nodeType !== 'iterator'}
                    />
                  </EditorSection>
              </div>
            </TabsContent>

            <TabsContent value="quality" className="m-0 min-h-0 overflow-y-auto bg-muted/10 p-4">
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold">{t('nodeEditor.tabs.quality')}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">{t('nodeEditor.tabs.qualityHint')}</p>
                </div>

                {capabilities.supportsExpectedResult && (
                  <EditorSection title={t('nodeEditor.expectedResult')} defaultOpen resetKey={`${task.id}:expected-result`}>
                    <div className="space-y-2">
                      <Textarea value={draft.expectedResult ?? ''} id="step-expected-result" name="step-expected-result" aria-label={t('nodeEditor.expectedResult')} onChange={(e) => updateEditorDraft({ expectedResult: e.target.value || null })} placeholder={t('nodeEditor.expectedResultPlaceholder')} rows={4} maxLength={10000} />
                      <p className="text-xs text-muted-foreground">{t('nodeEditor.expectedResultHint')}</p>
                    </div>
                  </EditorSection>
                )}

                {isEvaluationTask && draft.evaluationConfig != null && (() => {
                  const ec = draft.evaluationConfig;
                  return (
                  <EditorSection title={t('nodeEditor.nodeTypeEvaluation')} defaultOpen resetKey={`${task.id}:evaluation`}>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="step-evaluation-expectation">{t('nodeEditor.evaluationExpectation')}</Label>
                        <Textarea
                          value={ec.expectation}
                          id="step-evaluation-expectation"
                          name="step-evaluation-expectation"
                          onChange={(e) => updateEditorDraft({ evaluationConfig: { ...ec, expectation: e.target.value } })}
                          placeholder={t('nodeEditor.evaluationExpectationPlaceholder')}
                          rows={5}
                          maxLength={10000}
                        />
                        <p className="text-xs text-muted-foreground">{t('nodeEditor.evaluationExpectationHint')}</p>
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <div className="space-y-2">
                          <Label htmlFor="evaluation-pass-threshold">{t('nodeEditor.evaluationPassThreshold')}</Label>
                          <Input
                            id="evaluation-pass-threshold"
                            name="evaluation-pass-threshold"
                            type="number"
                            min={0}
                            max={100}
                            value={ec.passThreshold}
                            onChange={(e) => updateEditorDraft({ evaluationConfig: { ...ec, passThreshold: Number(e.target.value || 0) } })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="evaluation-warning-threshold">{t('nodeEditor.evaluationWarningThreshold')}</Label>
                          <Input
                            id="evaluation-warning-threshold"
                            name="evaluation-warning-threshold"
                            type="number"
                            min={0}
                            max={100}
                            value={ec.warningThreshold}
                            onChange={(e) => updateEditorDraft({ evaluationConfig: { ...ec, warningThreshold: Number(e.target.value || 0) } })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="evaluation-score-weight">{t('nodeEditor.evaluationWeight')}</Label>
                          <Input
                            id="evaluation-score-weight"
                            name="evaluation-score-weight"
                            type="number"
                            min={0}
                            step="0.1"
                            value={ec.weight}
                            onChange={(e) => updateEditorDraft({ evaluationConfig: { ...ec, weight: Number(e.target.value || 0) } })}
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
                            <Label htmlFor="evaluation-rubric-version">{t('nodeEditor.evaluationRubricVersion')}</Label>
                            <Input id="evaluation-rubric-version" name="evaluation-rubric-version" value={ec.rubricVersion} onChange={(e) => updateEditorDraft({ evaluationConfig: { ...ec, rubricVersion: e.target.value } })} />
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
                                <Label htmlFor={`evaluation-weight-${key}`}>{t(labelKey)}</Label>
                                <Input id={`evaluation-weight-${key}`} name={`evaluation-weight-${key}`} type="number" min={0} value={ec.weights[key]} onChange={(e) => updateEditorDraft({ evaluationConfig: { ...ec, weights: { ...ec.weights, [key]: Number(e.target.value || 0) } } })} />
                              </div>
                            ))}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    </div>
                  </EditorSection>
                );
                })()}

                {capabilities.supportsReference && (
                <EditorSection title={t('nodeEditor.sectionReplays')} defaultOpen resetKey={`${task.id}:replays`}>
                  <div className="space-y-3">
                    <div className="space-y-2 rounded-lg border bg-background p-3">
                      <Label htmlFor="step-replay-mode">{t('nodeEditor.referenceMode')}</Label>
                     <select
                       id="step-replay-mode"
                       name="step-replay-mode"
                       value={draft.stepReplayMode}
                       onChange={(event) => updateEditorDraft({ stepReplayMode: event.target.value as EditorDraft['stepReplayMode'] })}
                       className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                     >
                       <option value="live">{t('execution.mode.live')}</option>
                       <option value="replay_strict">{t('execution.mode.replayStrict')}</option>
                       <option value="replay_flex">{t('execution.mode.replayFlex')}</option>
                       <option value="replay_adaptive">{t('execution.mode.replayAdaptive')}</option>
                     </select>
                      <p className="text-xs text-muted-foreground">{t('nodeEditor.referenceModeHint')}</p>
                    </div>
                    {(replaysLoading || configurableReplay) && (
                      <div className="flex flex-col gap-3 rounded-lg border bg-background p-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="text-sm font-medium">{t('nodeEditor.referenceProtections')}</div>
                          <p className="mt-1 text-xs text-muted-foreground">{t('nodeEditor.referenceProtectionsHint')}</p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={replaysLoading || !configurableReplay}
                          onClick={() => configurableReplay && openFormatGuideEditor(configurableReplay)}
                        >
                          {replaysLoading ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                          {t('nodeEditor.replayConfigureReference')}
                        </Button>
                      </div>
                    )}
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
                    {task.stepReplayMode === 'replay_flex' && (
                      <Badge variant="outline" className="border-emerald-600/30 text-emerald-700">
                        {t('execution.mode.replayFlex')}
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
                            {capabilities.supportsReplayReasoning && replay.replayConfig?.replayReasoningChain && (
                              <Badge variant="outline" className="border-violet-600/30 text-violet-700">{t('nodeEditor.replayConfigReasoningChain')}</Badge>
                            )}
                            {replay.replayConfig?.replayToolTrace && (
                              <Badge variant="outline" className="border-amber-600/30 text-amber-700">{t('nodeEditor.replayConfigToolTrace')}</Badge>
                            )}
                            {replay.replayConfig?.replayOutputFormat && (
                              <Badge variant="outline" className="border-emerald-600/30 text-emerald-700">{t('nodeEditor.replayConfigOutputFormat')}</Badge>
                            )}
                            {replay.status !== 'active' && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() => openFormatGuideEditor(replay)}
                              >
                                {t('nodeEditor.replayConfigureReference')}
                              </Button>
                            )}
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
                )}

                {capabilities.supportsAdvisorEvaluation && (
                  <EditorSection title={t('nodeEditor.advisorSettings')} defaultOpen resetKey={`${task.id}:advisor`}>
                    <div className="flex items-start justify-between gap-4 rounded-lg border bg-background p-4">
                      <div className="space-y-1">
                        <Label htmlFor="advisor-evaluation" className="text-sm font-medium">{t('nodeEditor.advisorEvaluation')}</Label>
                        <p id="advisor-evaluation-description" className="text-xs text-muted-foreground">{t('nodeEditor.advisorEvaluationHint')}</p>
                      </div>
                      <Switch id="advisor-evaluation" name="advisor-evaluation" aria-describedby="advisor-evaluation-description" checked={!draft.disableAdvisorEvaluation} onCheckedChange={(checked) => updateEditorDraft({ disableAdvisorEvaluation: !checked })} />
                    </div>
                  </EditorSection>
                )}
              </div>
            </TabsContent>

            <TabsContent value="oversight" className="m-0 min-h-0 overflow-y-auto bg-muted/10 p-4">
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold">{t('nodeEditor.tabs.oversight')}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">{t('nodeEditor.tabs.oversightHint')}</p>
                </div>

                {capabilities.supportsRetry && (
                  <EditorSection title={t('nodeEditor.retryPolicy')} defaultOpen resetKey={`${task.id}:retry`}>
                    <div className="space-y-3">
                      <p className="text-xs text-muted-foreground">{t('nodeEditor.retryPolicyHint')}</p>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="step-retry-count">{t('nodeEditor.retryMaxRetries')}</Label>
                          <Input type="number" min={0} max={10} value={draft.retryPolicy?.maxRetries ?? 1} id="step-retry-count" name="step-retry-count" onChange={(e) => updateEditorDraft({ retryPolicy: { ...(draft.retryPolicy ?? { ...DEFAULT_RETRY_POLICY }), maxRetries: Number(e.target.value || 0) } })} />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="step-retry-delay">{t('nodeEditor.retryDelayMs')}</Label>
                          <Input type="number" min={0} step={100} value={draft.retryPolicy?.delayMs ?? 1000} id="step-retry-delay" name="step-retry-delay" onChange={(e) => updateEditorDraft({ retryPolicy: { ...(draft.retryPolicy ?? { ...DEFAULT_RETRY_POLICY }), delayMs: Number(e.target.value || 0) } })} />
                        </div>
                      </div>
                    </div>
                  </EditorSection>
                )}

                {playbookId && capabilities.supportsSmartHitl && (
                  <EditorSection title={t('hitl.nodeEditor.title')} defaultOpen resetKey={`${task.id}:smart-hitl`}>
                    <div className="space-y-3">
                      <Badge variant="outline">{t('nodeEditor.hitlInherited')}</Badge>
                      <HitlPolicySummaryCard flowId={playbookId} nodeId={task.id} compact />
                      <p className="text-xs text-muted-foreground">{t('hitl.nodeEditor.description')}</p>
                      <Button type="button" variant="outline" size="sm" onClick={() => setStepHitlDialogOpen(true)}>{t('hitl.nodeEditor.configure')}</Button>
                    </div>
                  </EditorSection>
                )}

                <EditorSection title={t('nodeEditor.interruptSettings')} defaultOpen resetKey={`${task.id}:interrupts`}>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="interrupt-before" className="text-sm font-normal">
                      {t('nodeEditor.interruptBefore')}
                    </Label>
                    <Switch
                      id="interrupt-before"
                      checked={draft.interruptBefore}
                      name="interrupt-before"
                      onCheckedChange={(v) => updateEditorDraft({ interruptBefore: v })}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label htmlFor="interrupt-after" className="text-sm font-normal">
                      {t('nodeEditor.interruptAfter')}
                    </Label>
                    <Switch
                      id="interrupt-after"
                      checked={draft.interruptAfter}
                      name="interrupt-after"
                      onCheckedChange={(v) => updateEditorDraft({ interruptAfter: v })}
                    />
                  </div>

                  {capabilities.supportsClarification && <div className="flex items-center justify-between">
                    <Label htmlFor="allow-clarification" className="text-sm font-normal">
                      {t('nodeEditor.allowClarification')}
                    </Label>
                    <Switch
                      id="allow-clarification"
                      checked={draft.allowClarification}
                      name="allow-clarification"
                      onCheckedChange={(v) => updateEditorDraft({ allowClarification: v })}
                    />
                  </div>}
                </div>
                </EditorSection>

                <EditorSection title={t('nodeEditor.notificationSettings')} defaultOpen resetKey={`${task.id}:notifications`}>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="notify-on-complete" className="text-sm font-normal">
                      {t('nodeEditor.notifyOnComplete')}
                    </Label>
                    <Switch
                      id="notify-on-complete"
                      name="notify-on-complete"
                      checked={draft.notifyOnComplete}
                      onCheckedChange={handleNotifyToggle}
                    />
                  </div>

                  {draft.notifyOnComplete && (
                    <div className="space-y-2">
                      <Label htmlFor="notify-email-input" className="text-sm font-normal">{t('nodeEditor.notifyEmails')}</Label>
                      <div className="flex min-h-[38px] flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5">
                        {draft.notifyEmails.map((email) => (
                          <span
                            key={email}
                            className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground"
                          >
                            {email}
                            <button
                              type="button"
                              aria-label={t('nodeEditor.removeRecipient', { email })}
                              onClick={() => removeEmail(email)}
                              className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20"
                            >
                              <span className="text-xs">x</span>
                            </button>
                          </span>
                        ))}
                        <input
                          type="email"
                          id="notify-email-input"
                          name="notify-email-input"
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
              </div>
            </TabsContent>
          </Tabs>
          )}
      </DialogContent>
      </Dialog>

      {playbookId && task && (
        <Dialog open={stepHitlDialogOpen} onOpenChange={setStepHitlDialogOpen}>
          <DialogContent className="max-h-[86vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>{t('hitl.nodeEditor.dialogTitle')}</DialogTitle>
              <DialogDescription>{task.title || t('nodeEditor.stepTitlePlaceholder')}</DialogDescription>
            </DialogHeader>
            <HitlBlockerCenter flowId={playbookId} nodeId={task.id} showMemory={false} />
          </DialogContent>
        </Dialog>
      )}

      <Dialog open={baselineExecutionDialogOpen} onOpenChange={setBaselineExecutionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('nodeEditor.evaluationBaselineDialogTitle')}</DialogTitle>
            <DialogDescription>{t('nodeEditor.evaluationBaselineDialogDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label htmlFor="evaluation-baseline-execution">{t('nodeEditor.evaluationBaselineExecutionPicker')}</Label>
            <select id="evaluation-baseline-execution" name="evaluation-baseline-execution" value={selectedBaselineExecutionId} onChange={(e) => setSelectedBaselineExecutionId(e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
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

      <AlertDialog open={pendingNodeType !== null} onOpenChange={(nextOpen) => {
        if (!nextOpen) setPendingNodeType(null);
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('nodeEditor.convert.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('nodeEditor.convert.description', { from: nodeTypeLabel, to: pendingNodeTypeLabel })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-md bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
            {t('nodeEditor.convert.warning')}
          </div>
          <AlertDialogFooter>
            <Button type="button" variant="outline" onClick={() => setPendingNodeType(null)}>
              {t('common.cancel')}
            </Button>
            <Button type="button" onClick={() => {
              if (pendingNodeType) {
                updateEditorDraft(getNodeTypeConversionPatch(pendingNodeType, draftRef.current));
                setPendingNodeType(null);
              }
            }}>
              {t('nodeEditor.convert.confirm')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={replayStaleDialogOpen} onOpenChange={setReplayStaleDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('nodeEditor.replayStaleDialogTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('nodeEditor.replayStaleDialogDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => { setReplayStaleDialogOpen(false); flushAndClose(); }}>
              {t('nodeEditor.replayStaleKeep')}
            </Button>
            <Button variant="destructive" onClick={handleRemoveStaleReplay} disabled={removingStaleReplay}>
              {removingStaleReplay && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('nodeEditor.replayStaleRemove')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
});
