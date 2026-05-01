import { createContext, useContext, useMemo, useState, useCallback, useEffect } from 'react';
import { type NodeProps, Handle, Position, useUpdateNodeInternals } from '@xyflow/react';
import { Bot, Copy, Trash2, Play, Loader2, SkipForward, Power, PlayCircle, Pencil, FileText, Cable, X, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  Node,
  NodeHeader,
  NodeTitle,
  NodeContent,
} from '@/components/ai-elements/node';
import { PlaybookStatusBadge } from './PlaybookStatusBadge';
import { InputFilesPopover } from './InputFilesPopover';
import { BaselineBadgePopover } from './BaselineBadgePopover';
import { PortLabel } from './PortLabel';
import { useModuleTranslation } from '@/modules/localization';
import { useAgentStore } from '@/modules/agent/store';
import { CreateEditAgentDialog } from '@/modules/agent/components/CreateEditAgentDialog';
import type { UserAgentFormValues } from '@/modules/agent/components/AgentFormSchema';
import type { Agent } from '@/modules/agent/types';
import { usePlaybookStore } from '../store';
import { cn } from '@/lib/utils';
import { PORT_COLORS } from '../utils/port-colors';
import { migrateTask } from '../utils/migrate-ports';
import { detectPortHit } from '../utils/port-hit-detection';
import type { ArtifactKind, PlaybookNodeData, StepStatus, InputFile, TaskInputPort, TaskOutputPort, ToolBinding } from '../types';

export interface NodeContextMenuActions {
  onEdit: (nodeId: string) => void;
  onClone: (nodeId: string) => void;
  onDelete: (nodeId: string) => void;
  onToggleEnabled: (nodeId: string) => void;
  onExecuteStep: (nodeId: string) => void;
  onResumeFromStep: (nodeId: string) => void;
  onSkipStep: (nodeId: string) => void;
  onSaveBaseline: (nodeId: string) => void;
  onGrabOutputFormat: (nodeId: string) => void;
  onRemoveReplayBaseline: (playbookId: string, taskId: string, replayId: string) => Promise<void>;
  onRenameReplayBaseline: (playbookId: string, taskId: string, replayId: string, label: string | null) => Promise<void>;
  canExecute: boolean;
  isExecuting: boolean;
  canResumeFromStep: (nodeId: string) => boolean;
  canSkipStep: (nodeId: string) => boolean;
  canSaveBaseline: (nodeId: string) => boolean;
  canGrabOutputFormat: (nodeId: string) => boolean;
}

export interface ConnectorDropPayload {
  type: 'connector';
  connectorId: string;
  connectorName: string;
  actions: Array<{ key: string; label: string }>;
}

export interface NodeDataActions {
  updateNodeData: (nodeId: string, data: Partial<PlaybookNodeData>) => void;
  openOutputFormatEditor?: (nodeId: string) => void;
  onConnectorDrop?: (taskId: string, payload: ConnectorDropPayload) => void;
}

export const NodeDataActionsContext = createContext<NodeDataActions | null>(null);

export const NodeContextMenuContext = createContext<NodeContextMenuActions | null>(null);

const STATUS_RING: Record<StepStatus, string> = {
  pending: '',
  running: 'border-running shadow-md shadow-running/10',
  completed: '',
  failed: 'ring-2 ring-destructive/60',
  skipped: '',
  interrupted: 'ring-2 ring-yellow-500/60 shadow-md shadow-yellow-500/10',
};

const STATUS_HEADER_BG: Record<StepStatus, string> = {
  pending: '',
  running: 'bg-running/10',
  completed: 'bg-green-500/10',
  failed: 'bg-destructive/10',
  skipped: '',
  interrupted: 'bg-yellow-500/10',
};

function getSemanticScoreTone(score: number): {
  ringClass: string;
  textClass: string;
  badgeClass: string;
} {
  if (score >= 90) {
    return {
      ringClass: 'text-green-600',
      textClass: 'text-green-700',
      badgeClass: 'bg-green-100 text-green-700 border-green-500/30',
    };
  }
  if (score >= 75) {
    return {
      ringClass: 'text-amber-500',
      textClass: 'text-amber-700',
      badgeClass: 'bg-amber-100 text-amber-700 border-amber-500/30',
    };
  }
  if (score >= 50) {
    return {
      ringClass: 'text-orange-500',
      textClass: 'text-orange-700',
      badgeClass: 'bg-orange-100 text-orange-700 border-orange-500/30',
    };
  }
  return {
    ringClass: 'text-red-500',
    textClass: 'text-red-700',
    badgeClass: 'bg-red-100 text-red-700 border-red-500/30',
  };
}

function SemanticScoreBadge({
  score,
}: {
  score: number;
}) {
  const { t } = useModuleTranslation('playbook');
  const radius = 14;
  const circumference = 2 * Math.PI * radius;
  const normalized = Math.max(0, Math.min(100, score));
  const dashOffset = circumference * (1 - normalized / 100);
  const tone = getSemanticScoreTone(normalized);

  return (
    <div className="flex items-center gap-2">
      <div className="relative h-9 w-9 shrink-0">
        <svg className="-rotate-90 h-9 w-9" viewBox="0 0 36 36" aria-hidden="true">
          <circle
            cx="18"
            cy="18"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            className="text-muted/50"
          />
          <circle
            cx="18"
            cy="18"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            className={tone.ringClass}
          />
        </svg>
        <div className={cn('absolute inset-0 flex items-center justify-center text-[10px] font-semibold', tone.textClass)}>
          {normalized}
        </div>
      </div>
      <div className="min-w-0">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{t('node.match')}</div>
      </div>
    </div>
  );
}

function JudgeScoreBadge({
  score,
}: {
  score: number;
}) {
  const normalizedScore = score <= 1 ? score * 100 : score;
  const tone = getSemanticScoreTone(normalizedScore);

  return (
    <Badge variant="outline" className={cn('h-6 gap-1.5 px-2 py-0 text-[10px] font-medium', tone.badgeClass)}>
      <span>{Math.round(normalizedScore)}%</span>
    </Badge>
  );
}

function JudgeStateBadge({ status }: { status?: string }) {
  const { t } = useModuleTranslation('playbook');
  if (!status || status === 'idle') return null;
  const isRunning = status === 'evaluating';
  const label = isRunning ? t('node.advisorState.evaluating') : t('node.advisorState.evaluated');
  const tone = isRunning
    ? 'border-sky-500/30 bg-sky-100 text-sky-700'
    : status === 'failed'
      ? 'border-red-500/30 bg-red-50 text-red-700'
      : 'border-emerald-500/30 bg-emerald-100 text-emerald-700';

  return (
    <Badge variant="outline" className={cn('h-6 gap-1.5 px-2 py-0 text-[10px] font-medium', tone)}>
      {isRunning && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
      <span>{status === 'failed' ? t('node.advisorState.failed') : label}</span>
    </Badge>
  );
}

function NodeMetaBadge({
  label,
  toneClassName,
  busy = false,
  onClick,
}: {
  label: string;
  toneClassName: string;
  busy?: boolean;
  onClick?: () => void;
}) {
  const className = cn(
    'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium',
    toneClassName,
    onClick && 'cursor-pointer transition-opacity hover:opacity-90',
  );

  if (onClick) {
    return (
      <button type="button" className={className} onClick={onClick}>
        {busy && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
        <span>{label}</span>
      </button>
    );
  }

  return (
    <span className={className}>
      {busy && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
      <span>{label}</span>
    </span>
  );
}

function getInputPortStyle(port: TaskInputPort): React.CSSProperties {
  const colors = PORT_COLORS[port.artifactKind];
  return {
    background: colors?.raw || 'hsl(var(--muted))',
    border: '2px solid hsl(var(--background))',
  };
}

function getOutputPortStyle(port: TaskOutputPort): React.CSSProperties {
  const colors = PORT_COLORS[port.artifactKind];
  return {
    background: colors?.raw || 'hsl(var(--muted))',
    border: '2px solid hsl(var(--background))',
  };
}

function getPortTopPercent(idx: number, total: number): number {
  if (total <= 1) return 50;
  const step = 100 / (total + 1);
  return step * (idx + 1);
}

export function PlaybookNode({ id, data: rawData, selected }: NodeProps) {
  const data = rawData as unknown as PlaybookNodeData;
  const actions = useContext(NodeContextMenuContext);
  const nodeDataActions = useContext(NodeDataActionsContext);
  const { t } = useModuleTranslation('playbook');
  const getAgentById = useAgentStore((s) => s.getAgentById);
  const currentTask = usePlaybookStore((s) => s.currentPlaybook?.tasks.find((t) => t.id === id));
  const playbookId = usePlaybookStore((s) => s.currentPlaybook?.id ?? null);
  const selectedStepId = usePlaybookStore((s) => s.selectedStepId);
  const addInputFileToTask = usePlaybookStore((s) => s.addInputFileToTask);
  const removeInputFileFromTask = usePlaybookStore((s) => s.removeInputFileFromTask);

  const [isDragOver, setIsDragOver] = useState(false);
  const [dragOverPortId, setDragOverPortId] = useState<string | null>(null);
  const [dragPortCompatible, setDragPortCompatible] = useState<boolean | null>(null);
  const [agentDialogOpen, setAgentDialogOpen] = useState(false);
  const [agentDialogSaving, setAgentDialogSaving] = useState(false);
  const updateAgent = useAgentStore((s) => s.updateAgent);
  const updateNodeInternals = useUpdateNodeInternals();

  const migratedTask = useMemo(() => migrateTask(data), [data]);
  const inputPorts = migratedTask.inputPorts ?? [];
  const outputPorts = migratedTask.outputPorts ?? [];
  const hasMultiplePorts = inputPorts.length > 1 || outputPorts.length > 1;

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, inputPorts.length, outputPorts.length, updateNodeInternals]);

  const inputFiles = currentTask?.inputFiles ?? data.inputFiles ?? [];
  const portFileMap = useMemo(() => {
    const map: Record<string, InputFile> = {};
    for (const f of inputFiles) {
      if (f.portId) map[f.portId] = f;
    }
    return map;
  }, [inputFiles]);
  const effectiveTask = currentTask || data;
  const agentId = effectiveTask.assignedAgentId;
  const agent = agentId ? getAgentById(agentId) : null;
  const isActionMode = effectiveTask.executionMode === 'action';
  const isConfigured = effectiveTask.taskType === 'evaluation'
    ? !!(effectiveTask.assignedAgentId && (effectiveTask.evaluationConfig?.expectation || effectiveTask.evaluationConfig?.referenceBaselineId))
    : isActionMode ? !!effectiveTask.selectedAction : !!effectiveTask.assignedAgentId;
  const selectedActionLabel = effectiveTask.selectedAction
    ? `${String(effectiveTask.selectedAction).charAt(0).toUpperCase()}${String(effectiveTask.selectedAction).slice(1)}`
    : null;
  const status = data.stepStatus as StepStatus | undefined;
  const semanticMatch = data.stepSemanticMatch;
  const judgeStatus = data.stepJudgeStatus;
  const judgeResult = data.stepJudgeResult;
  const ringClass = status ? STATUS_RING[status] : '';
  const headerBgClass = status ? STATUS_HEADER_BG[status] : '';
  const isStepRunning = status === 'running';
  const isExplicitlyDisabled = data.enabled === false;
  const isEnabled = !isExplicitlyDisabled;
  const isSelected = selected || selectedStepId === id;
  const selectedClass = isSelected
    ? 'border-2 border-[#ffcd03] ring-4 ring-inset ring-[#ffcd03]/60 shadow-lg shadow-[#ffcd03]/25 animate-[pulse_4.5s_ease-in-out_infinite]'
    : '';
  const disabledClass = isExplicitlyDisabled ? 'opacity-60 border-dashed' : '';
  const replayBadgeLabel = currentTask?.activeReplayLabel
    ? currentTask.activeReplayVersion
      ? t('baselineBadge.versionedLabel', { label: currentTask.activeReplayLabel, version: currentTask.activeReplayVersion })
      : t('baselineBadge.customLabel', { label: currentTask.activeReplayLabel })
    : currentTask?.activeReplayVersion
      ? t('detail.badges.replayBaseline', { version: currentTask.activeReplayVersion })
      : t('detail.badges.baseline');
  const showReplayBadge = Boolean(currentTask?.hasValidatedReplay || currentTask?.isSavingReplayBaseline);
  const showOutputFormatBadge = Boolean(currentTask?.hasOutputFormatTemplate || currentTask?.isCapturingOutputFormat);
  const showOptimizationBadge = Boolean(effectiveTask?.advisorOptimizedAt);
  const outputFormatBadgeLabel = currentTask?.activeOutputFormatTemplateVersion
    ? t('detail.badges.outputFormatTemplate', { version: currentTask.activeOutputFormatTemplateVersion })
    : t('detail.badges.outputFormat');
  const toolBindings = currentTask?.toolBindings ?? data.toolBindings ?? [];
  const removeToolBindingFromTask = usePlaybookStore((s) => s.removeToolBindingFromTask);

  const resolveDragPayload = useCallback((e: React.DragEvent): InputFile | null => {
    try {
      const raw = e.dataTransfer.getData('application/json');
      if (!raw) return null;
      const payload = JSON.parse(raw);
      if (payload && payload.type && payload.id && payload.name) return payload as InputFile;
    } catch { /* noop */ }
    return null;
  }, []);

  const resolveConnectorDragPayload = useCallback((e: React.DragEvent): ConnectorDropPayload | null => {
    try {
      const raw = e.dataTransfer.getData('application/json');
      if (!raw) return null;
      const payload = JSON.parse(raw);
      if (payload?.type === 'connector' && payload?.connectorId) return payload as ConnectorDropPayload;
    } catch { /* noop */ }
    return null;
  }, []);

  const handleAgentDialogSave = useCallback(async (data: UserAgentFormValues) => {
    if (!agent) return;
    setAgentDialogSaving(true);
    try {
      await updateAgent(agent.id, {
        name: data.name,
        agentType: data.agentType,
        role: data.role,
        description: data.description,
        temperature: data.temperature,
        model: data.model || undefined,
        instruction: data.instruction,
        ignorePrePrompt: data.ignorePrePrompt,
        knowledgeBases: data.knowledgeBases,
        tools: data.tools,
        skills: data.skills,
        disabledSkills: data.disabledSkills,
        connectors: data.connectors,
        isActive: data.isActive,
        isDefaultForType: data.isDefaultForType,
      });
      setAgentDialogOpen(false);
    } catch {
      // handled by store toast
    } finally {
      setAgentDialogSaving(false);
    }
  }, [agent, updateAgent]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragOver(true);

    if (inputPorts.length <= 1) {
      setDragOverPortId(null);
      setDragPortCompatible(null);
      return;
    }

    const nodeEl = e.currentTarget as HTMLDivElement;
    const rect = nodeEl.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    const nodeHeight = rect.height;
    const hit = detectPortHit(inputPorts, offsetY, nodeHeight);

    if (hit) {
      setDragOverPortId(hit.port.id);
      setDragPortCompatible(null);
    } else {
      setDragOverPortId(null);
      setDragPortCompatible(null);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    const nodeEl = e.currentTarget as HTMLDivElement;
    const rect = nodeEl.getBoundingClientRect();
    const { clientX, clientY } = e;
    if (
      clientX < rect.left || clientX > rect.right ||
      clientY < rect.top || clientY > rect.bottom
    ) {
      setIsDragOver(false);
      setDragOverPortId(null);
      setDragPortCompatible(null);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    setDragOverPortId(null);
    setDragPortCompatible(null);

    const connectorPayload = resolveConnectorDragPayload(e);
    if (connectorPayload) {
      nodeDataActions?.onConnectorDrop?.(id, connectorPayload);
      return;
    }

    const payload = resolveDragPayload(e);
    if (!payload) return;

    if (inputPorts.length <= 1) {
      const portId = inputPorts.length === 1 ? inputPorts[0].id : undefined;
      addInputFileToTask(id, { ...payload, portId });
      return;
    }

    const nodeEl = e.currentTarget as HTMLDivElement;
    const rect = nodeEl.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    const nodeHeight = rect.height;
    const hit = detectPortHit(inputPorts, offsetY, nodeHeight);

    if (hit) {
      addInputFileToTask(id, { ...payload, portId: hit.port.id });
    } else {
      addInputFileToTask(id, payload);
    }
  };

  const handleRemoveInputFile = (fileId: string) => {
    removeInputFileFromTask(id, fileId);
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Node
          handles={false}
          className={cn(
            'group transition-all duration-300',
            ringClass,
            selectedClass,
            disabledClass,
            isDragOver && !dragOverPortId && 'ring-2 ring-primary ring-inset bg-primary/5',
            isDragOver && dragOverPortId && dragPortCompatible === true && 'ring-2 ring-green-400/50 ring-inset bg-green-50/30',
            isDragOver && dragOverPortId && dragPortCompatible === false && 'ring-2 ring-red-400/50 ring-inset bg-red-50/20',
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* Input ports — left side */}
          <div className="absolute left-0 inset-y-0 z-10 w-0 pointer-events-none">
          {inputPorts.map((port, idx) => {
            const isPortDragTarget = isDragOver && dragOverPortId === port.id;
            const portColors = PORT_COLORS[port.artifactKind];
            const boundFile = portFileMap[port.id];
            const top = `${getPortTopPercent(idx, inputPorts.length)}%`;

            return (
              <div
                key={port.id}
                className="absolute left-0 z-10 flex items-center -translate-y-1/2 pointer-events-auto"
                style={{ top }}
              >
                <Handle
                  id={port.id}
                  type="target"
                  position={Position.Left}
                  className="!w-3 !h-3"
                  style={{ ...getInputPortStyle(port), top: 0 }}
                />
                {boundFile && !isPortDragTarget && (
                  <div
                    className="absolute left-0 -translate-x-1/2 z-20 w-5 h-5 rounded-full pointer-events-none"
                    style={{ background: portColors?.raw || 'hsl(var(--muted))', opacity: 0.2 }}
                  />
                )}
                {isPortDragTarget && (
                  <div
                    className={cn(
                      'absolute left-0 -translate-x-1/2 z-30 w-6 h-6 rounded-full animate-pulse pointer-events-none',
                      dragPortCompatible === true
                        ? 'ring-2 ring-green-400/70 bg-green-400/10'
                        : dragPortCompatible === false
                          ? 'ring-2 ring-red-400/70 bg-red-400/10'
                          : 'ring-2 ring-primary/50 bg-primary/10',
                    )}
                  />
                )}
                {/* Persistent label */}
                <PortLabel
                  name={boundFile?.name || port.name}
                  kind={port.artifactKind}
                  position="left"
                  selected={isSelected}
                />
                {port.required && hasMultiplePorts && (
                  <span className="absolute -top-1 -left-1 z-50 flex h-2 w-2 items-center justify-center rounded-full bg-red-500 ring-1 ring-background text-[7px] leading-none text-white">*</span>
                )}
              </div>
            );
          })}
          </div>

          {/* Output ports — right side */}
          <div className="absolute right-0 inset-y-0 z-10 w-0 pointer-events-none">
          {outputPorts.map((port, idx) => (
            <div
              key={port.id}
              className="absolute right-0 z-10 flex items-center -translate-y-1/2 pointer-events-auto"
              style={{ top: `${getPortTopPercent(idx, outputPorts.length)}%` }}
            >
              <Handle
                id={port.id}
                type="source"
                position={Position.Right}
                className="!w-3 !h-3"
                style={{ ...getOutputPortStyle(port), top: 0 }}
              />
              <PortLabel name={port.name} kind={port.artifactKind} position="right" selected={isSelected} />
            </div>
          ))}
          </div>

          <NodeHeader className={cn('transition-colors duration-300', headerBgClass)}>
            <div className="flex items-center justify-between w-full gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className={cn(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold',
                  isSelected ? 'bg-[#ffcd03] text-black' : 'bg-primary/10 text-primary',
                )}>
                  {data.executionOrder + 1}
                </span>
                <NodeTitle className="block max-w-[210px] truncate text-sm font-semibold">
                  {data.title || t('node.untitled')}
                </NodeTitle>
              </div>
              {status && (
                <div className="flex items-center justify-center">
                  <PlaybookStatusBadge status={status} size="xs" />
                </div>
              )}
            </div>
          </NodeHeader>

          <NodeContent className="p-3 space-y-2.5">
            <div className="flex items-center gap-2">
              {isActionMode ? (
                <>
                  <Bot className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className={cn(
                    'truncate text-xs',
                    selectedActionLabel ? 'font-medium' : 'italic text-muted-foreground',
                  )}>
                    {selectedActionLabel || t('node.notConfigured')}
                  </span>
                </>
              ) : agent ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-2 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/10 transition-colors cursor-pointer max-w-full"
                      onClick={(e) => {
                        e.stopPropagation();
                        setAgentDialogOpen(true);
                      }}
                    >
                      <Bot className="h-2.5 w-2.5 shrink-0" />
                      <span className="truncate">{agent.name}</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{t('node.agentBadge.editAgent')}</TooltipContent>
                </Tooltip>
              ) : (
                <>
                  <Bot className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="truncate text-xs italic text-muted-foreground">
                    {t('node.noAgent')}
                  </span>
                </>
              )}
              {!isConfigured && (
                <Badge variant="outline" className="h-5 border-dashed px-1.5 py-0 text-[10px] text-muted-foreground">
                  {t('node.notConfigured')}
                </Badge>
              )}
            </div>

            {data.description ? (
              <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{data.description}</p>
            ) : (
              <p className="text-xs text-muted-foreground/60 italic">{t('node.noDescription')}</p>
            )}

            {(showReplayBadge || showOutputFormatBadge || showOptimizationBadge) && (
              <div className="flex flex-wrap items-center gap-1.5">
                {showOptimizationBadge && (
                  <NodeMetaBadge
                    label={t('node.badges.optimized')}
                    toneClassName="border-violet-500/30 bg-violet-100 text-violet-700"
                  />
                )}
                {showReplayBadge && (
                  <BaselineBadgePopover
                    taskId={id}
                    playbookId={playbookId || ''}
                    replayId={currentTask?.activeReplayId}
                    label={currentTask?.activeReplayLabel}
                    toneClassName={currentTask?.activeReplayIsStale
                      ? 'border-orange-500/30 bg-orange-100 text-orange-700'
                      : 'border-amber-500/30 bg-amber-100 text-amber-700'}
                    badgeLabel={replayBadgeLabel}
                    isBusy={Boolean(currentTask?.isSavingReplayBaseline)}
                    onRemove={actions?.onRemoveReplayBaseline ?? (() => Promise.resolve())}
                    onRename={actions?.onRenameReplayBaseline ?? (() => Promise.resolve())}
                  />
                )}
                {showOutputFormatBadge && (
                  <NodeMetaBadge
                    label={outputFormatBadgeLabel}
                    busy={Boolean(currentTask?.isCapturingOutputFormat || currentTask?.activeOutputFormatStatus === 'pending')}
                    toneClassName={currentTask?.activeOutputFormatStatus === 'failed'
                      ? 'border-red-500/30 bg-red-50 text-red-700'
                      : 'border-sky-500/30 bg-sky-100 text-sky-700'}
                    onClick={nodeDataActions?.openOutputFormatEditor ? () => nodeDataActions.openOutputFormatEditor?.(id) : undefined}
                  />
                )}
              </div>
            )}

            {toolBindings.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                {toolBindings.filter((b) => b.isEnabled !== false).map((binding) => (
                  <Tooltip key={binding.id}>
                    <TooltipTrigger asChild>
                      <Badge
                        variant="outline"
                        className="h-5 gap-1 px-1.5 py-0 text-[10px] font-medium border-sky-500/30 bg-sky-50 text-sky-700 cursor-default"
                      >
                        <Cable className="h-2.5 w-2.5" />
                        <span className="truncate max-w-[80px]">{binding.connectorName || binding.connectorId}</span>
                        <button
                          type="button"
                          className="ml-0.5 hover:text-red-500 transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeToolBindingFromTask(id, binding.id);
                          }}
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="text-xs">
                      <div>{binding.connectorName || binding.connectorId}</div>
                      <div className="text-muted-foreground">{binding.actions.filter((a) => a.isEnabled !== false).length} action(s)</div>
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            )}

            {(judgeStatus && judgeStatus !== 'idle') || judgeResult ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <JudgeStateBadge status={judgeStatus} />
                {judgeResult && (
                  <JudgeScoreBadge
                    score={judgeResult.overallScore}
                  />
                )}
              </div>
            ) : null}

            <div className="flex items-center justify-between gap-2 pt-1">
              <div className="flex min-w-0 items-center gap-2">
                <InputFilesPopover
                  files={inputFiles}
                  onRemove={handleRemoveInputFile}
                  alwaysVisible={inputFiles.length > 0}
                />
                {semanticMatch && status === 'completed' ? (
                  <SemanticScoreBadge
                    score={semanticMatch.matchScore}
                  />
                ) : null}
              </div>
              <div className="flex items-center gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-primary"
                      disabled={!isEnabled || !isConfigured || !actions?.canExecute || actions?.isExecuting}
                      onClick={(e) => {
                        e.stopPropagation();
                        actions?.onExecuteStep(id);
                      }}
                    >
                      {isStepRunning ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{t('node.executeStep')}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                      onClick={(e) => {
                        e.stopPropagation();
                        actions?.onToggleEnabled(id);
                      }}
                    >
                      <Power className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{isEnabled ? t('node.disable') : t('node.enable')}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                      onClick={(e) => {
                        e.stopPropagation();
                        actions?.onClone(id);
                      }}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{t('nodeContextMenu.clone')}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        actions?.onDelete(id);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{t('nodeContextMenu.delete')}</TooltipContent>
                </Tooltip>
              </div>
            </div>
          </NodeContent>
          {isStepRunning && (
            <div className="absolute inset-0 rounded-md pointer-events-none z-10 animate-running-node-glow" />
          )}
        </Node>
      </ContextMenuTrigger>

      <ContextMenuContent>
        <ContextMenuItem disabled={!isEnabled || !isConfigured || !actions?.canExecute} onClick={() => actions?.onExecuteStep(id)}>
          <Play className="h-4 w-4" />
          {t('node.executeStep')}
        </ContextMenuItem>
        <ContextMenuItem disabled={!isEnabled || !isConfigured || !actions?.canResumeFromStep(id)} onClick={() => actions?.onResumeFromStep(id)}>
          <PlayCircle className="h-4 w-4" />
          {t('node.resumeFromStep')}
        </ContextMenuItem>
        <ContextMenuItem disabled={!actions?.canSkipStep(id)} onClick={() => actions?.onSkipStep(id)}>
          <SkipForward className="h-4 w-4" />
          {t('node.skip')}
        </ContextMenuItem>
        <ContextMenuItem disabled={!actions?.canSaveBaseline(id)} onClick={() => actions?.onSaveBaseline(id)}>
          <FileText className="h-4 w-4" />
          {t('nodeContextMenu.saveBaseline')}
        </ContextMenuItem>
        <ContextMenuItem disabled={!actions?.canGrabOutputFormat(id)} onClick={() => actions?.onGrabOutputFormat(id)}>
          <FileText className="h-4 w-4" />
          {t('nodeContextMenu.saveOutputFormat')}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => actions?.onEdit(id)}>
          <Pencil className="h-4 w-4" />
          {t('nodeContextMenu.edit')}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => actions?.onClone(id)}>
          <Copy className="h-4 w-4" />
          {t('nodeContextMenu.clone')}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => actions?.onToggleEnabled(id)}>
          <Power className="h-4 w-4" />
          {isEnabled ? t('node.disable') : t('node.enable')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem className="text-destructive focus:text-destructive" onClick={() => actions?.onDelete(id)}>
          <Trash2 className="h-4 w-4" />
          {t('nodeContextMenu.delete')}
        </ContextMenuItem>
      </ContextMenuContent>
      {agent && (
        <CreateEditAgentDialog
          open={agentDialogOpen}
          onOpenChange={setAgentDialogOpen}
          agent={agent}
          onSave={handleAgentDialogSave}
          saving={agentDialogSaving}
        />
      )}
    </ContextMenu>
  );
}
