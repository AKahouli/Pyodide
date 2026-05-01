import { useState, useEffect, useMemo, useCallback, useRef, type KeyboardEvent } from 'react';
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
import { ChevronDown, Loader2, X, Plus, Trash2, GripVertical } from 'lucide-react';
import { useAgents, useAgentStore } from '@/modules/agent/store';
import { useAuth } from '@/modules/auth';
import { usePlaybookStore } from '../store';
import type {
  PlaybookTask,
  ValidatedTaskReplay,
  TaskInputPort,
  TaskOutputPort,
  ArtifactKind,
  SelectedAction,
  PlaybookEvaluationConfig,
  PlaybookNodeType,
} from '../types';
import { useModuleTranslation } from '@/modules/localization';
import { PORT_COLORS } from '../utils/port-colors';
import { getPortColor } from '../utils/port-colors';

const MIN_WIDTH = 320;
const MAX_WIDTH = 720;
const DEFAULT_WIDTH = 420;

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
  disableAdvisorEvaluation: boolean;
  expectedResult: string | null;
}

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

function buildDraftFromTask(task: PlaybookTask): EditorDraft {
  const nodeType: PlaybookNodeType = task.taskType === 'evaluation'
    ? 'evaluation'
    : task.executionMode === 'action'
      ? 'action'
      : 'agent';
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
    inputPorts: task.inputPorts?.map((p) => ({ ...p })) ?? [{ id: 'default', name: 'Input', artifactKind: 'text' as ArtifactKind, required: false }],
    outputPorts: task.outputPorts?.map((p) => ({ ...p })) ?? [{ id: 'default', name: 'Output', artifactKind: 'text' as ArtifactKind }],
    evaluationConfig: task.evaluationConfig
      ? { ...task.evaluationConfig, weights: { ...task.evaluationConfig.weights } }
      : { ...DEFAULT_EVALUATION_CONFIG, weights: { ...DEFAULT_EVALUATION_CONFIG.weights } },
    disableAdvisorEvaluation: task.disableAdvisorEvaluation ?? false,
    expectedResult: task.expectedResult ?? null,
  };
}

function draftToSavePayload(draft: EditorDraft): Partial<PlaybookTask> {
  return {
    title: draft.title,
    description: draft.description,
    taskType: draft.nodeType === 'evaluation' ? 'evaluation' : 'generic',
    assignedAgentId: draft.nodeType === 'action' ? null : draft.assignedAgentId,
    executionMode: (draft.nodeType === 'evaluation' ? 'agent' : draft.executionMode) as import('../types').TaskExecutionMode | undefined,
    selectedAction: draft.nodeType === 'action' ? draft.selectedAction : undefined,
    interruptBefore: draft.interruptBefore,
    interruptAfter: draft.interruptAfter,
    allowClarification: draft.allowClarification,
    enabled: draft.enabled,
    notifyOnComplete: draft.notifyOnComplete,
    notifyEmails: draft.notifyOnComplete ? draft.notifyEmails : [],
    inputPorts: [...draft.inputPorts],
    outputPorts: [...draft.outputPorts],
    evaluationConfig: draft.evaluationConfig,
    disableAdvisorEvaluation: draft.disableAdvisorEvaluation,
    expectedResult: draft.expectedResult,
  };
}

interface Props {
  playbookId: string | null;
  task: PlaybookTask | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (taskId: string, data: Partial<PlaybookTask>) => void;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function PlaybookNodeEditor({ playbookId, task, open, onOpenChange, onSave }: Props) {
  const agents = useAgents();
  const fetchAgents = useAgentStore((s) => s.fetchAgents);
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
    if (open) fetchAgents();
  }, [open, fetchAgents]);

  const agentOptions = useMemo<SearchableSelectOption[]>(
    () => agents.map((agent) => ({ value: agent.id, label: agent.name })),
    [agents],
  );

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
    disableAdvisorEvaluation: false,
    expectedResult: null,
  });

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
  const [panelWidth, setPanelWidth] = useState(DEFAULT_WIDTH);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);
  const lastSuggestionSignatureRef = useRef('');

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    dragStartX.current = e.clientX;
    dragStartWidth.current = panelWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [panelWidth]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = dragStartX.current - e.clientX;
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragStartWidth.current + delta));
      setPanelWidth(next);
    };
    const handleMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const isEvaluationTask = draft.nodeType === 'evaluation';

  useEffect(() => {
    if (task) {
      setDraft(buildDraftFromTask(task));
      setEmailInput('');
      setEmailError('');
      setHasInitializedDraft(false);
      lastSuggestionSignatureRef.current = '';
    }
  }, [task]);

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

  useEffect(() => {
    if (!open || !task || !playbookId) return;
    if (!replays.some((replay) => replay.preserveOutputFormat && replay.formatGuideStatus === 'pending')) return;

    const intervalId = window.setInterval(() => {
      void fetchTaskReplays(playbookId, task.id).then(setReplays).catch(() => undefined);
    }, 2000);

    return () => window.clearInterval(intervalId);
  }, [open, playbookId, task, replays, fetchTaskReplays]);

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

  if (!task || !open) return null;

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
      <div
        className="fixed right-0 top-0 z-50 flex h-full flex-col border-l bg-background shadow-xl"
        style={{ width: panelWidth }}
      >
        <div
          className="absolute left-0 top-0 z-10 flex h-full w-3 cursor-col-resize items-center justify-center hover:bg-primary/10"
          onMouseDown={handleResizeStart}
        >
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </div>

        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-semibold">{t('nodeEditor.title')}</h2>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Label htmlFor="step-enabled" className="text-xs font-normal text-muted-foreground cursor-pointer">
                {t('nodeEditor.enabledLabel')}
              </Label>
              <Switch id="step-enabled" checked={draft.enabled} onCheckedChange={(v) => updateDraft({ enabled: v })} />
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          <div className="space-y-4">
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
                } else if (nextType === 'action') {
                  patch.executionMode = 'action';
                  patch.assignedAgentId = null;
                } else {
                  patch.executionMode = 'agent';
                }
                updateDraft(patch);
              }}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="agent">{t('nodeEditor.nodeTypeAgent')}</option>
              <option value="action">{t('nodeEditor.nodeTypeAction')}</option>
              <option value="evaluation">{t('nodeEditor.nodeTypeEvaluation')}</option>
            </select>
          </div>

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
                <option value="index">Index</option>
                <option value="delete">Delete</option>
                <option value="read">Read</option>
              </select>
              <p className="text-xs text-muted-foreground">
                {draft.selectedAction === 'index' && 'Index documents from input ports into the vector store.'}
                {draft.selectedAction === 'delete' && 'Delete documents from the workspace.'}
                {draft.selectedAction === 'read' && 'Read document content for downstream processing.'}
              </p>
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
              rows={10}
              maxLength={20000}
            />
          </div>

          {!isEvaluationTask && (
            <div className="space-y-2">
              <Label>{t('nodeEditor.expectedResult')}</Label>
              <Textarea
                value={draft.expectedResult ?? ''}
                onChange={(e) => updateDraft({ expectedResult: e.target.value || null })}
                placeholder={t('nodeEditor.expectedResultPlaceholder')}
                rows={4}
                maxLength={10000}
              />
              <p className="text-xs text-muted-foreground">{t('nodeEditor.expectedResultHint')}</p>
            </div>
          )}

          {isEvaluationTask && draft.evaluationConfig != null && (() => {
            const ec = draft.evaluationConfig!;
            return (
            <div className="space-y-4 rounded-md border p-3">
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
              <div className="grid grid-cols-3 gap-3">
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
              <div className="rounded-md border border-dashed p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">{t('nodeEditor.evaluationBaselineTitle')}</div>
                    <div className="text-xs text-muted-foreground">{t('nodeEditor.evaluationBaselineHint')}</div>
                  </div>
                  {evaluationBaselineMeta ? (
                    <Badge variant="outline" className="text-amber-700 border-amber-600/30">
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
                  <div className="grid grid-cols-2 gap-3">
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
          );
          })()}

          {draft.nodeType !== 'evaluation' && (
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium">{t('ports.inputPorts')}</h4>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => {
                  const id = `in-${crypto.randomUUID().slice(0, 8)}`;
                  updateDraft({ inputPorts: [...draft.inputPorts, { id, name: 'Input', artifactKind: 'text', required: false }] });
                }}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                {t('ports.addInput')}
              </Button>
            </div>
            {draft.inputPorts.length === 0 && (
              <p className="text-xs text-muted-foreground">No input ports defined.</p>
            )}
            {draft.inputPorts.map((port, idx) => (
              <div key={port.id} className="flex items-center gap-2 rounded-md border p-2">
                <div className={`w-3 h-3 rounded-full shrink-0 ${getPortColor(port.artifactKind)}`} />
                <input
                  type="text"
                  value={port.name}
                  onChange={(e) => {
                    const updated = [...draft.inputPorts];
                    updated[idx] = { ...updated[idx], name: e.target.value };
                    updateDraft({ inputPorts: updated });
                  }}
                  className="flex-1 min-w-0 bg-transparent text-sm outline-none border-b border-transparent focus:border-primary"
                  placeholder={t('ports.portName')}
                />
                <select
                  value={port.artifactKind}
                  onChange={(e) => {
                    const updated = [...draft.inputPorts];
                    updated[idx] = { ...updated[idx], artifactKind: e.target.value as ArtifactKind };
                    updateDraft({ inputPorts: updated });
                  }}
                  className="h-7 text-xs rounded border bg-background px-1"
                >
                  {(['text', 'document', 'code', 'image', 'data', 'dashboard'] as const).map((kind) => (
                    <option key={kind} value={kind}>{t(`artifactKind.${kind}`)}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    const updated = [...draft.inputPorts];
                    updated[idx] = { ...updated[idx], required: !updated[idx].required };
                    updateDraft({ inputPorts: updated });
                  }}
                  className={`text-xs px-1.5 py-0.5 rounded border ${port.required ? 'bg-primary/10 text-primary border-primary/30' : 'text-muted-foreground border-muted'}`}
                  title={port.required ? t('ports.required') : t('ports.optional')}
                >
                  {port.required ? t('ports.required') : t('ports.optional')}
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() => updateDraft({ inputPorts: draft.inputPorts.filter((_, i) => i !== idx) })}
                  title={t('ports.removePort')}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
          )}

          {draft.nodeType !== 'evaluation' && (
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium">{t('ports.outputPorts')}</h4>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => {
                  const id = `out-${crypto.randomUUID().slice(0, 8)}`;
                  updateDraft({ outputPorts: [...draft.outputPorts, { id, name: 'Output', artifactKind: 'text' }] });
                }}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                {t('ports.addOutput')}
              </Button>
            </div>
            {draft.outputPorts.length === 0 && (
              <p className="text-xs text-muted-foreground">No output ports defined.</p>
            )}
            {draft.outputPorts.map((port, idx) => (
              <div key={port.id} className="flex items-center gap-2 rounded-md border p-2">
                <div className={`w-3 h-3 rounded-full shrink-0 ${getPortColor(port.artifactKind)}`} />
                <input
                  type="text"
                  value={port.name}
                  onChange={(e) => {
                    const updated = [...draft.outputPorts];
                    updated[idx] = { ...updated[idx], name: e.target.value };
                    updateDraft({ outputPorts: updated });
                  }}
                  className="flex-1 min-w-0 bg-transparent text-sm outline-none border-b border-transparent focus:border-primary"
                  placeholder={t('ports.portName')}
                />
                <select
                  value={port.artifactKind}
                  onChange={(e) => {
                    const updated = [...draft.outputPorts];
                    updated[idx] = { ...updated[idx], artifactKind: e.target.value as ArtifactKind };
                    updateDraft({ outputPorts: updated });
                  }}
                  className="h-7 text-xs rounded border bg-background px-1"
                >
                  {(['text', 'document', 'code', 'image', 'data', 'dashboard'] as const).map((kind) => (
                    <option key={kind} value={kind}>{t(`artifactKind.${kind}`)}</option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() => updateDraft({ outputPorts: draft.outputPorts.filter((_, i) => i !== idx) })}
                  title={t('ports.removePort')}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
          )}

          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium">Replay baselines</h4>
              <div className="flex items-center gap-2">
                {task.hasValidatedReplay && (
                  <Badge variant="outline" className="text-amber-700 border-amber-600/30">
                    Active v{task.activeReplayVersion || 1}
                  </Badge>
                )}
                {task.activeReplayPreserveOutputFormat && (
                  <Badge variant="outline" className="text-sky-700 border-sky-600/30">
                    Format preserved
                  </Badge>
                )}
                {task.activeReplayPreserveOutputFormat && task.activeReplayFormatGuideStatus === 'pending' && (
                  <Badge variant="outline" className="text-sky-700 border-sky-600/30">
                    Guide pending
                  </Badge>
                )}
                {task.activeReplayPreserveOutputFormat && task.activeReplayFormatGuideStatus === 'failed' && (
                  <Badge variant="outline" className="text-red-700 border-red-600/30">
                    Guide failed
                  </Badge>
                )}
                {task.activeReplayIsStale && (
                  <Badge variant="outline" className="text-orange-700 border-orange-600/30">
                    Stale replay
                  </Badge>
                )}
              </div>
            </div>
            {(task.hasOutputFormatTemplate || task.activeOutputFormatStatus) && (
              <div className="rounded-md border border-sky-500/20 bg-sky-500/5 p-3 text-xs text-sky-800">
                <div className="flex flex-wrap items-center gap-2">
                  {task.hasOutputFormatTemplate && (
                    <Badge variant="outline" className="text-sky-700 border-sky-600/30">
                      Format template v{task.activeOutputFormatTemplateVersion || 1}
                    </Badge>
                  )}
                  {task.activeOutputFormatStatus === 'pending' && (
                    <Badge variant="outline" className="text-sky-700 border-sky-600/30">
                      Template pending
                    </Badge>
                  )}
                  {task.activeOutputFormatStatus === 'failed' && (
                    <Badge variant="outline" className="text-red-700 border-red-600/30">
                      Template failed
                    </Badge>
                  )}
                </div>
                {task.activeOutputFormatError && (
                  <div className="mt-2 text-xs text-red-700">{task.activeOutputFormatError}</div>
                )}
                <div className="mt-2 text-xs text-muted-foreground">
                  Output format templates are captured independently from replay baselines.
                </div>
              </div>
            )}
            {task.activeReplayIsStale && task.activeReplayStaleReasons && task.activeReplayStaleReasons.length > 0 && (
              <div className="rounded-md border border-orange-500/30 bg-orange-500/5 p-3 text-xs text-orange-800">
                <div className="font-medium">Replay baseline warning</div>
                <div className="mt-1">{task.activeReplayStaleReasons.join(' • ')}</div>
              </div>
            )}
            {replaysLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading replay baselines
              </div>
            ) : replays.length > 0 ? (
              <div className="space-y-2">
                {replays.map((replay) => (
                  <div key={replay.id} className="rounded-md border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">Version {replay.validationVersion}</div>
                        <div className="text-xs text-muted-foreground">
                          Execution #{replay.referenceExecutionNumber} • {new Date(replay.createdAt).toLocaleString()}
                        </div>
                      </div>
                      {replay.status === 'active' ? (
                        <Badge>Active</Badge>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={activatingReplayId === replay.id}
                          onClick={() => handleActivateReplay(replay.id)}
                        >
                          {activatingReplayId === replay.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Activate'}
                        </Button>
                      )}
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      {replay.toolCalls.length} tool call{replay.toolCalls.length === 1 ? '' : 's'}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      {replay.preserveOutputFormat && (
                        <Badge variant="outline" className="text-sky-700 border-sky-600/30">
                          Format preserved
                        </Badge>
                      )}
                      {replay.preserveOutputFormat && replay.formatGuideStatus === 'pending' && (
                        <Badge variant="outline" className="text-sky-700 border-sky-600/30">
                          Guide pending
                        </Badge>
                      )}
                      {replay.preserveOutputFormat && replay.formatGuideStatus === 'failed' && (
                        <Badge variant="outline" className="text-red-700 border-red-600/30">
                          Guide failed
                        </Badge>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => openFormatGuideEditor(replay)}
                      >
                        Edit format guide
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
                No replay baseline yet. Save one from a successful execution step.
              </div>
            )}
          </div>

          <div className="space-y-3 pt-2">
            <h4 className="text-sm font-medium">{t('nodeEditor.interruptSettings')}</h4>

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

          <div className="space-y-3 pt-2">
            <h4 className="text-sm font-medium">{t('nodeEditor.notificationSettings')}</h4>

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
                <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 min-h-[38px]">
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
                        <X className="h-3 w-3" />
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
                    className="flex-1 min-w-[120px] bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                  />
                </div>
                {emailError && (
                  <p className="text-xs text-destructive">{emailError}</p>
                )}
                <p className="text-xs text-muted-foreground">{t('nodeEditor.notifyEmailHint')}</p>
              </div>
            )}
          </div>

          <div className="space-y-3 pt-2">
            <h4 className="text-sm font-medium">{t('nodeEditor.advisorSettings')}</h4>

            <div className="flex items-center justify-between">
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
          </div>
        </div>

        </div>
      </div>

      <Dialog open={!!editingReplay} onOpenChange={(open) => {
        if (!open) {
          setEditingReplay(null);
          setFormatGuideDraft('');
          setPreserveFormatDraft(false);
        }
      }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit format guide</DialogTitle>
            <DialogDescription>
              Adjust the replay output-format guide used by Replay (Flex) and Replay (Adaptive).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <div className="text-sm font-medium">Preserve output format</div>
                <div className="text-xs text-muted-foreground">
                  When enabled, replay synthesis will follow this guide.
                </div>
              </div>
              <Switch checked={preserveFormatDraft} onCheckedChange={setPreserveFormatDraft} />
            </div>
            <div className="space-y-2">
              <Label>Format guide</Label>
              {editingReplay?.preserveOutputFormat && editingReplay.formatGuideStatus === 'pending' && (
                <div className="rounded-md border border-sky-500/30 bg-sky-500/5 p-3 text-xs text-sky-800">
                  Format guide generation is pending. You can wait for the generated guide or replace it manually here.
                </div>
              )}
              {editingReplay?.formatGuideStatus === 'failed' && (
                <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-800">
                  Format guide generation failed{editingReplay.formatGuideError ? `: ${editingReplay.formatGuideError}` : '.'}
                </div>
              )}
              <Textarea
                value={formatGuideDraft}
                onChange={(e) => setFormatGuideDraft(e.target.value)}
                rows={10}
                placeholder="Describe the output structure to preserve during replay synthesis."
              />
            </div>
            {editingReplay?.referenceOutput && (
              <div className="space-y-2">
                <Label>Validated output reference</Label>
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
              Cancel
            </Button>
            <Button onClick={() => void handleSaveFormatGuide()} disabled={savingFormatGuide}>
              {savingFormatGuide ? 'Saving...' : 'Save format guide'}
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
                  {entry.executionId} • {entry.verdict || 'completed'} • {entry.score ?? 0}
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
