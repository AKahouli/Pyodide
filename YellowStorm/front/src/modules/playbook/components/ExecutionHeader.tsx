import { useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Clock, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
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

function getExecutionModeLabel(mode?: string): string {
  if (mode === 'replay_strict') return 'Replay (Strict)';
  if (mode === 'replay_flex') return 'Replay (Flex)';
  if (mode === 'replay_adaptive') return 'Replay (Adaptive)';
  return 'Live';
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
            <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
              {getExecutionModeLabel(execution.executionMode)}
            </span>
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              <span>{formatDuration(execution.durationMs)}</span>
            </div>
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
