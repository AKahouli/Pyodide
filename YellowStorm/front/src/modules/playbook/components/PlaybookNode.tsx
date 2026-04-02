import { createContext, useContext, useMemo, useState } from 'react';
import { type NodeProps, Handle, Position } from '@xyflow/react';
import { Bot, Copy, Trash2, Play, Loader2, SkipForward, Power, PlayCircle, Pencil } from 'lucide-react';
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
import { PortLabel } from './PortLabel';
import { ArtifactBadge } from './ArtifactBadge';
import { useModuleTranslation } from '@/modules/localization';
import { useAgentStore } from '@/modules/agent/store';
import { usePlaybookStore } from '../store';
import { cn } from '@/lib/utils';
import { PORT_COLORS } from '../utils/port-colors';
import { migrateTask } from '../utils/migrate-ports';
import type { PlaybookNodeData, StepStatus, InputFile, TaskInputPort, TaskOutputPort } from '../types';

export interface NodeContextMenuActions {
  onEdit: (nodeId: string) => void;
  onClone: (nodeId: string) => void;
  onDelete: (nodeId: string) => void;
  onToggleEnabled: (nodeId: string) => void;
  onExecuteStep: (nodeId: string) => void;
  onResumeFromStep: (nodeId: string) => void;
  onSkipStep: (nodeId: string) => void;
  canExecute: boolean;
  isExecuting: boolean;
  canResumeFromStep: (nodeId: string) => boolean;
  canSkipStep: (nodeId: string) => boolean;
}

export interface NodeDataActions {
  updateNodeData: (nodeId: string, data: Partial<PlaybookNodeData>) => void;
  openOutputFormatEditor?: (nodeId: string) => void;
}

export const NodeDataActionsContext = createContext<NodeDataActions | null>(null);

export const NodeContextMenuContext = createContext<NodeContextMenuActions | null>(null);

const STATUS_RING: Record<StepStatus, string> = {
  pending: '',
  running: 'border-primary/40 ring-1 ring-primary/40 shadow-md shadow-primary/10',
  completed: '',
  failed: 'ring-2 ring-destructive/60',
  skipped: '',
  interrupted: 'ring-2 ring-yellow-500/60 shadow-md shadow-yellow-500/10',
};

const STATUS_HEADER_BG: Record<StepStatus, string> = {
  pending: '',
  running: 'bg-orange-500/10',
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
  semantic,
  evidence,
  judge,
}: {
  score: number;
  semantic: number;
  evidence: number;
  judge: number;
}) {
  const radius = 14;
  const circumference = 2 * Math.PI * radius;
  const normalized = Math.max(0, Math.min(100, score));
  const dashOffset = circumference * (1 - normalized / 100);
  const tone = getSemanticScoreTone(normalized);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
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
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Match</div>
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="space-y-1 text-xs">
        <div className="font-medium">Evaluation score</div>
        <div>Overall: {normalized}%</div>
        <div>Semantic: {Math.round(semantic)}%</div>
        <div>Evidence: {Math.round(evidence)}%</div>
        <div>Judge: {Math.round(judge)}%</div>
      </TooltipContent>
    </Tooltip>
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

function getInputPortTop(idx: number, total: number): string {
  if (total <= 1) return '50%';
  const step = 100 / (total + 1);
  return `${step * (idx + 1)}%`;
}

function getOutputPortTop(idx: number, total: number): string {
  if (total <= 1) return '50%';
  const step = 100 / (total + 1);
  return `${step * (idx + 1)}%`;
}

function getInputPortStyle(port: TaskInputPort, idx: number, total: number): React.CSSProperties {
  const colors = PORT_COLORS[port.artifactKind];
  return {
    top: getInputPortTop(idx, total),
    width: 12,
    height: 12,
    background: colors?.dot || 'var(--muted)',
    border: '2px solid var(--background)',
    transform: 'translateY(-50%)',
  };
}

function getOutputPortStyle(port: TaskOutputPort, idx: number, total: number): React.CSSProperties {
  const colors = PORT_COLORS[port.artifactKind];
  return {
    top: getOutputPortTop(idx, total),
    width: 12,
    height: 12,
    background: colors?.dot || 'var(--muted)',
    border: '2px solid var(--background)',
    transform: 'translateY(-50%)',
  };
}

export function PlaybookNode({ id, data: rawData, selected }: NodeProps) {
  const data = rawData as unknown as PlaybookNodeData;
  const actions = useContext(NodeContextMenuContext);
  const nodeDataActions = useContext(NodeDataActionsContext);
  const { t } = useModuleTranslation('playbook');
  const getAgentById = useAgentStore((s) => s.getAgentById);
  const currentTask = usePlaybookStore((s) => s.currentPlaybook?.tasks.find((t) => t.id === id));
  const selectedStepId = usePlaybookStore((s) => s.selectedStepId);
  const addInputFileToTask = usePlaybookStore((s) => s.addInputFileToTask);
  const removeInputFileFromTask = usePlaybookStore((s) => s.removeInputFileFromTask);

  const [isDragOver, setIsDragOver] = useState(false);
  const [hoveredHandleId, setHoveredHandleId] = useState<string | null>(null);

  const migratedTask = useMemo(() => migrateTask(data), [data]);
  const inputPorts = migratedTask.inputPorts ?? [];
  const outputPorts = migratedTask.outputPorts ?? [];
  const hasMultiplePorts = inputPorts.length > 1 || outputPorts.length > 1;

  const inputFiles = currentTask?.inputFiles ?? data.inputFiles ?? [];
  const agent = data.assignedAgentId ? getAgentById(data.assignedAgentId) : null;
  const isConfigured = !!data.assignedAgentId;
  const status = data.stepStatus as StepStatus | undefined;
  const stepArtifacts = usePlaybookStore((s) =>
    s.currentExecution?.taskResults.find((tr) => tr.taskId === id)?.artifacts,
  );
  const semanticMatch = data.stepSemanticMatch;
  const ringClass = status ? STATUS_RING[status] : '';
  const headerBgClass = status ? STATUS_HEADER_BG[status] : '';
  const isStepRunning = status === 'running';
  const isExplicitlyDisabled = data.enabled === false;
  const isEnabled = !isExplicitlyDisabled;
  const isSelected = selected || selectedStepId === id;
  const selectedClass = isSelected ? 'border-[#ffcd03] ring-2 ring-inset ring-[#ffcd03]/70 shadow-lg shadow-[#ffcd03]/30 animate-[pulse_2.8s_ease-in-out_infinite]' : '';
  const disabledClass = isExplicitlyDisabled ? 'opacity-60 border-dashed' : '';
  const replayBadgeLabel = currentTask?.activeReplayVersion
    ? t('detail.badges.replayBaseline', { version: currentTask.activeReplayVersion })
    : t('detail.badges.baseline');
  const showReplayBadge = Boolean(currentTask?.hasValidatedReplay || currentTask?.isSavingReplayBaseline);
  const showOutputFormatBadge = Boolean(currentTask?.hasOutputFormatTemplate || currentTask?.isCapturingOutputFormat);
  const outputFormatBadgeLabel = currentTask?.activeOutputFormatTemplateVersion
    ? t('detail.badges.outputFormatTemplate', { version: currentTask.activeOutputFormatTemplateVersion })
    : t('detail.badges.outputFormat');

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    try {
      const payload = JSON.parse(e.dataTransfer.getData('application/json')) as InputFile;
      if (payload && payload.type && payload.id && payload.name) {
        addInputFileToTask(id, payload);
      }
    } catch {
      // Invalid payload, ignore
    }
  };

  const handleRemoveInputFile = (fileId: string) => {
    removeInputFileFromTask(id, fileId);
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <Node
          handles={false}
          className={cn(
            'group transition-all duration-300',
            ringClass,
            selectedClass,
            disabledClass,
            isDragOver && 'ring-2 ring-primary ring-inset bg-primary/5'
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* Input ports — left side */}
          {inputPorts.map((port, idx) => (
            <div key={port.id} className="relative">
              <Handle
                id={`in-${port.id}`}
                type="target"
                position={Position.Left}
                style={getInputPortStyle(port, idx, inputPorts.length)}
                onMouseEnter={() => setHoveredHandleId(`in-${port.id}`)}
                onMouseLeave={() => setHoveredHandleId(null)}
              />
              {hoveredHandleId === `in-${port.id}` && (
                <PortLabel name={port.name} kind={port.artifactKind} position="left" />
              )}
              {port.required && hasMultiplePorts && (
                <span className="absolute -top-1 -left-1 z-50 flex h-2 w-2 items-center justify-center rounded-full bg-red-500 ring-1 ring-background text-[7px] leading-none text-white">*</span>
              )}
            </div>
          ))}

          {/* Output ports — right side */}
          {outputPorts.map((port, idx) => (
            <div key={port.id} className="relative">
              <Handle
                id={`out-${port.id}`}
                type="source"
                position={Position.Right}
                style={getOutputPortStyle(port, idx, outputPorts.length)}
                onMouseEnter={() => setHoveredHandleId(`out-${port.id}`)}
                onMouseLeave={() => setHoveredHandleId(null)}
              />
              {hoveredHandleId === `out-${port.id}` && (
                <PortLabel name={port.name} kind={port.artifactKind} position="right" />
              )}
            </div>
          ))}

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
              <Bot className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className={cn('truncate text-xs', agent ? 'font-medium' : 'italic text-muted-foreground')}>
                {agent ? agent.name : t('node.noAgent')}
              </span>
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

            {(showReplayBadge || showOutputFormatBadge) && (
              <div className="flex flex-wrap items-center gap-1.5">
                {showReplayBadge && (
                  <NodeMetaBadge
                    label={replayBadgeLabel}
                    busy={Boolean(currentTask?.isSavingReplayBaseline)}
                    toneClassName={currentTask?.activeReplayIsStale
                      ? 'border-orange-500/30 bg-orange-100 text-orange-700'
                      : 'border-amber-500/30 bg-amber-100 text-amber-700'}
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

            {stepArtifacts && stepArtifacts.length > 0 && (
              <ArtifactBadge artifacts={stepArtifacts} />
            )}

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
                    semantic={semanticMatch.semanticSimilarityScore}
                    evidence={semanticMatch.evidenceConsistencyScore}
                    judge={semanticMatch.judgeScore}
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
        </Node>
      </ContextMenuTrigger>

      <ContextMenuContent>
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
        <ContextMenuSeparator />
        <ContextMenuItem className="text-destructive focus:text-destructive" onClick={() => actions?.onDelete(id)}>
          <Trash2 className="h-4 w-4" />
          {t('nodeContextMenu.delete')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
