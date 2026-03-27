import { createContext, useContext, useState } from 'react';
import { type NodeProps } from '@xyflow/react';
import { Bot, Pencil, Copy, Trash2, Play, Loader2, AlertTriangle, MessageSquare, Mail, ShieldAlert, SkipForward, Power, PlayCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
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
  NodeFooter,
} from '@/components/ai-elements/node';
import { PlaybookStatusBadge } from './PlaybookStatusBadge';
import { InputFilesPopover } from './InputFilesPopover';
import { useModuleTranslation } from '@/modules/localization';
import { useAgentStore } from '@/modules/agent/store';
import { usePlaybookStore } from '../store';
import { cn } from '@/lib/utils';
import type { PlaybookNodeData, StepStatus, InputFile } from '../types';

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
  running: 'border-orange-400 ring-2 ring-orange-400/40 shadow-md shadow-orange-500/10 animate-pulse [animation-duration:2.4s]',
  completed: 'ring-2 ring-green-500/60',
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

export function PlaybookNode({ id, data: rawData, selected }: NodeProps) {
  const data = rawData as unknown as PlaybookNodeData;
  const actions = useContext(NodeContextMenuContext);
  const nodeDataActions = useContext(NodeDataActionsContext);
  const { t } = useModuleTranslation('playbook');
  const getAgentById = useAgentStore((s) => s.getAgentById);
  const currentTask = usePlaybookStore((s) => s.currentPlaybook?.tasks.find((t) => t.id === id));
  const addInputFileToTask = usePlaybookStore((s) => s.addInputFileToTask);
  const removeInputFileFromTask = usePlaybookStore((s) => s.removeInputFileFromTask);

  const [isDragOver, setIsDragOver] = useState(false);

  const inputFiles = currentTask?.inputFiles ?? data.inputFiles ?? [];
  const agent = data.assignedAgentId ? getAgentById(data.assignedAgentId) : null;
  const hasInterrupt = data.interruptBefore || data.interruptAfter;
  const isConfigured = !!data.assignedAgentId;
  const status = data.stepStatus as StepStatus | undefined;
  const semanticMatch = data.stepSemanticMatch;
  const ringClass = status ? STATUS_RING[status] : '';
  const headerBgClass = status ? STATUS_HEADER_BG[status] : '';
  const isStepRunning = status === 'running';
  const isExplicitlyDisabled = data.enabled === false;
  const isEnabled = !isExplicitlyDisabled;
  const selectedClass = selected ? 'ring-2 ring-inset ring-sky-500/60 shadow-md shadow-sky-500/10' : '';
  const disabledClass = isExplicitlyDisabled ? 'opacity-60 border-dashed' : '';

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
        nodeDataActions?.updateNodeData(id, { inputFiles: [...inputFiles, payload] });
      }
    } catch {
      // Invalid payload, ignore
    }
  };

  const handleRemoveInputFile = (fileId: string) => {
    removeInputFileFromTask(id, fileId);
    const newFiles = inputFiles.filter((f) => f.id !== fileId);
    nodeDataActions?.updateNodeData(id, { inputFiles: newFiles });
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <Node
          handles={{ target: true, source: true }}
          className={cn(
            'transition-all duration-300',
            ringClass,
            selectedClass,
            disabledClass,
            isDragOver && 'ring-2 ring-primary ring-inset bg-primary/5'
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* Header */}
          <NodeHeader className={cn('transition-colors duration-300', headerBgClass)}>
            <div className="flex items-center justify-between w-full gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="flex items-center justify-center h-5 w-5 rounded bg-primary/10 text-primary text-[10px] font-bold shrink-0">
                  {data.executionOrder + 1}
                </span>
                <span className="block truncate text-sm font-semibold max-w-[230px]">
                  {data.title || t('node.untitled')}
                </span>
              </div>
              {status && (
                <div className="flex items-center justify-center">
                  <PlaybookStatusBadge status={status} size="sm" />
                </div>
              )}
            </div>
          </NodeHeader>

          {/* Content */}
          <NodeContent className="p-3 space-y-2.5">
            {/* Agent row */}
            <div className="flex items-center gap-2">
              <Bot className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              {agent ? (
                <span className="text-xs font-medium truncate">{agent.name}</span>
              ) : (
                <span className="text-xs text-muted-foreground italic">{t('node.noAgent')}</span>
              )}
            </div>

            {/* Description preview */}
            {data.description ? (
              <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{data.description}</p>
            ) : (
              <p className="text-xs text-muted-foreground/60 italic">{t('node.noDescription')}</p>
            )}

            {/* Tags row */}
          {(isExplicitlyDisabled || data.hasValidatedReplay || data.hasOutputFormatTemplate || hasInterrupt || data.allowClarification || data.notifyOnComplete || data.activeReplayIsStale) && (
              <>
                <Separator />
                <div className="flex items-center gap-1.5 flex-wrap">
                  {isExplicitlyDisabled && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 gap-1 text-slate-700 border-slate-500/30">
                      Disabled
                    </Badge>
                  )}
                  {data.hasValidatedReplay && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 gap-1 text-amber-700 border-amber-600/30">
                      Replay v{data.activeReplayVersion || 1}
                    </Badge>
                  )}
                  {data.activeReplayPreserveOutputFormat && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 gap-1 text-sky-700 border-sky-600/30">
                      Format preserved
                    </Badge>
                  )}
                  {data.hasOutputFormatTemplate && data.activeOutputFormatStatus === 'ready' && (
                    <button
                      type="button"
                      className="inline-flex items-center rounded-md border border-sky-600/30 px-1.5 py-0 text-[10px] h-4 text-sky-700 transition-colors hover:bg-sky-50"
                      onClick={(event) => {
                        event.stopPropagation();
                        nodeDataActions?.openOutputFormatEditor?.(id);
                      }}
                      title="Edit output format template"
                    >
                      Format template v{data.activeOutputFormatTemplateVersion || 1}
                    </button>
                  )}
                  {data.hasOutputFormatTemplate && data.activeOutputFormatStatus === 'pending' && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 gap-1 text-sky-700 border-sky-600/30">
                      Template pending
                    </Badge>
                  )}
                  {data.activeOutputFormatStatus === 'failed' && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 gap-1 text-red-700 border-red-600/30">
                      Template failed
                    </Badge>
                  )}
                  {data.activeReplayPreserveOutputFormat && data.activeReplayFormatGuideStatus === 'pending' && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 gap-1 text-sky-700 border-sky-600/30">
                      Guide pending
                    </Badge>
                  )}
                  {data.activeReplayPreserveOutputFormat && data.activeReplayFormatGuideStatus === 'failed' && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 gap-1 text-red-700 border-red-600/30">
                      Guide failed
                    </Badge>
                  )}
                  {data.activeReplayIsStale && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 gap-1 text-orange-700 border-orange-600/30">
                      <ShieldAlert className="h-2.5 w-2.5" />
                      Stale replay
                    </Badge>
                  )}
                  {hasInterrupt && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 gap-1 text-yellow-600 border-yellow-600/30">
                      <AlertTriangle className="h-2.5 w-2.5" />
                      {t('node.interrupt')}
                    </Badge>
                  )}
                  {data.allowClarification && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 gap-1 text-blue-600 border-blue-600/30">
                      <MessageSquare className="h-2.5 w-2.5" />
                      {t('node.clarification')}
                    </Badge>
                  )}
                  {data.notifyOnComplete && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 gap-1 text-emerald-600 border-emerald-600/30">
                      <Mail className="h-2.5 w-2.5" />
                      {t('node.notify')}
                    </Badge>
                  )}
                </div>
              </>
            )}
          </NodeContent>

          {/* Footer with execute button */}
          <NodeFooter className="flex items-center justify-between">
            <div className="min-w-0">
              {semanticMatch && status === 'completed' ? (
                <SemanticScoreBadge
                  score={semanticMatch.matchScore}
                  semantic={semanticMatch.semanticSimilarityScore}
                  evidence={semanticMatch.evidenceConsistencyScore}
                  judge={semanticMatch.judgeScore}
                />
              ) : status === 'running' ? (
                <span className="text-[10px] text-orange-600 font-medium animate-pulse">{t('node.running')}</span>
              ) : status === 'completed' ? (
                <span className="text-[10px] text-green-600 font-medium">{t('node.completed')}</span>
              ) : status === 'failed' ? (
                <span className="text-[10px] text-destructive font-medium">{t('node.failed')}</span>
              ) : status === 'interrupted' ? (
                <span className="text-[10px] text-yellow-600 font-medium">{t('node.interrupted')}</span>
              ) : isExplicitlyDisabled ? (
                <span className="text-[10px] text-slate-600 font-medium">Disabled</span>
              ) : data.activeReplayIsStale ? (
                <span className="text-[10px] text-orange-700 font-medium">Replay stale</span>
              ) : data.hasValidatedReplay ? (
                <span className="text-[10px] text-amber-700 font-medium">Replay ready</span>
              ) : !isConfigured ? (
                <span className="text-[10px] text-muted-foreground italic">{t('node.notConfigured')}</span>
              ) : (
                <span className="text-[10px] text-muted-foreground">{t('node.ready')}</span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <InputFilesPopover
                files={inputFiles}
                onRemove={handleRemoveInputFile}
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-emerald-600"
                    disabled={!isEnabled || !isConfigured || !actions?.canResumeFromStep(id)}
                    onClick={(e) => {
                      e.stopPropagation();
                      actions?.onResumeFromStep(id);
                    }}
                  >
                    <PlayCircle className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Resume from this step</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-slate-700"
                    onClick={(e) => {
                      e.stopPropagation();
                      actions?.onToggleEnabled(id);
                    }}
                  >
                    <Power className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{isEnabled ? 'Disable step' : 'Enable step'}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-amber-600"
                    disabled={!actions?.canSkipStep(id)}
                    onClick={(e) => {
                      e.stopPropagation();
                      actions?.onSkipStep(id);
                    }}
                  >
                    <SkipForward className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Skip step</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-primary"
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
                    className="h-6 w-6 text-muted-foreground hover:text-destructive"
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
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-primary"
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
            </div>
          </NodeFooter>
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
          {isEnabled ? 'Disable step' : 'Enable step'}
        </ContextMenuItem>
        <ContextMenuItem disabled={!isEnabled || !isConfigured || !actions?.canExecute} onClick={() => actions?.onExecuteStep(id)}>
          <Play className="h-4 w-4" />
          {t('node.executeStep')}
        </ContextMenuItem>
        <ContextMenuItem disabled={!isEnabled || !isConfigured || !actions?.canResumeFromStep(id)} onClick={() => actions?.onResumeFromStep(id)}>
          <PlayCircle className="h-4 w-4" />
          Resume From This Step
        </ContextMenuItem>
        <ContextMenuItem disabled={!actions?.canSkipStep(id)} onClick={() => actions?.onSkipStep(id)}>
          <SkipForward className="h-4 w-4" />
          Skip step
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
