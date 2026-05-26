import { useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Clock, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PlaybookStatusBadge } from './PlaybookStatusBadge';
import { ExecutionHistoryDropdown } from './ExecutionHistoryDropdown';
import { useIsStopping } from '../store';
import type { PlaybookExecution, Playbook } from '../types';
import { useModuleTranslation } from '@/modules/localization';
import { usePlaybookStore } from '../store';

interface Props {
  execution: PlaybookExecution | null;
  playbook: Playbook | null;
}

type ExecutionModeI18nKey = 'execution.mode.replayStrict' | 'execution.mode.replayFlex' | 'execution.mode.replayAdaptive' | 'execution.mode.live';

function getExecutionModeLabel(mode?: string): ExecutionModeI18nKey {
  if (mode === 'replay_strict') return 'execution.mode.replayStrict';
  if (mode === 'replay_flex') return 'execution.mode.replayFlex';
  if (mode === 'replay_adaptive') return 'execution.mode.replayAdaptive';
  return 'execution.mode.live';
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '-';
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function getVisibleExecutionStatus(execution: PlaybookExecution): PlaybookExecution['status'] {
  if (execution.taskResults.some((taskResult) => taskResult.status === 'running')) {
    return 'running';
  }
  if (execution.taskResults.some((taskResult) => taskResult.status === 'interrupted')) {
    return 'interrupted';
  }
  return execution.status;
}

export function ExecutionHeader({ execution, playbook }: Props) {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { t } = useModuleTranslation('playbook');
  const isStopping = useIsStopping();
  const stopExecution = usePlaybookStore((s) => s.stopExecution);
  const visibleStatus = execution ? getVisibleExecutionStatus(execution) : null;
  const replayPlanningSummaries = execution?.replayPlanningByTask ? Object.values(execution.replayPlanningByTask) : [];
  const primaryReplayPlanning = replayPlanningSummaries[0] ?? null;

  const canStop = execution && (visibleStatus === 'running' || visibleStatus === 'interrupted');
  return (
    <div className="flex items-center justify-between px-4 py-2 border-b bg-background">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(`/playbooks/${id}`)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <span className="font-semibold">{playbook?.name || t('execution.playbook')}</span>
        {execution && (
          <>
            <PlaybookStatusBadge status={visibleStatus || execution.status} size="md" />
            {execution.queuePosition != null && execution.totalQueueSize != null && (
              <span className="text-sm text-muted-foreground">
                {t('execution.queuePosition', { position: execution.queuePosition, total: execution.totalQueueSize })}
              </span>
            )}
            {visibleStatus === 'running' && execution.recursionBudgetUsed != null && execution.recursionBudgetMax != null && (
              <span className="text-sm text-muted-foreground">
                {t('execution.recursionBudget', { used: execution.recursionBudgetUsed, max: execution.recursionBudgetMax })}
              </span>
            )}
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              <span>{formatDuration(execution.durationMs)}</span>
            </div>
            {execution.executionMode && execution.executionMode !== 'live' && (
              <Badge variant="outline">{t(getExecutionModeLabel(execution.executionMode))}</Badge>
            )}
            {execution.executionMode === 'replay_flex' && primaryReplayPlanning && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>{t('replayPlanning.headerLabel')}</span>
                <Badge variant="outline">v{primaryReplayPlanning.validationVersion}</Badge>
                {(primaryReplayPlanning.intentLabel || primaryReplayPlanning.intentKey) && (
                  <span>{primaryReplayPlanning.intentLabel || primaryReplayPlanning.intentKey}</span>
                )}
              </div>
            )}
            {canStop && (
              <Button
                variant="destructive"
                size="sm"
                disabled={isStopping}
                onClick={() => stopExecution(execution.playbookId, execution.id)}
              >
                <Square className="h-3.5 w-3.5 mr-1" />
                {isStopping ? t('execution.stopping') : t('execution.stop')}
              </Button>
            )}
            {visibleStatus === 'failed' && execution.error && (
              <div className="flex items-center gap-1 text-sm text-destructive">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate max-w-[300px]" title={execution.error}>
                  {execution.error}
                </span>
              </div>
            )}
          </>
        )}
      </div>
      <ExecutionHistoryDropdown />
    </div>
  );
}
