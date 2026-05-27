import type { ElementType } from 'react';
import {
  Loader2, CheckCircle2, XCircle, PauseCircle, Clock, Hand, Circle,
} from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization/useModuleTranslation';
import type { PlaybookSummary, ExecutionStatus } from '../types';

const kpiStatuses: ExecutionStatus[] = [
  'pending',
  'running',
  'queued',
  'pending_approval',
  'interrupted',
  'cancelled',
  'failed',
  'completed',
];

const statusIcon: Record<string, ElementType> = {
  pending: Circle,
  running: Loader2,
  queued: Clock,
  pending_approval: Hand,
  interrupted: PauseCircle,
  cancelled: XCircle,
  failed: XCircle,
  completed: CheckCircle2,
};

const statusColor: Record<string, string> = {
  pending: 'text-muted-foreground',
  running: 'text-running',
  queued: 'text-blue-600',
  pending_approval: 'text-yellow-700',
  interrupted: 'text-yellow-700',
  cancelled: 'text-muted-foreground',
  failed: 'text-destructive',
  completed: 'text-green-600',
};

const statusBg: Record<string, string> = {
  pending: 'bg-muted',
  running: 'bg-running/10',
  queued: 'bg-blue-500/10',
  pending_approval: 'bg-yellow-500/10',
  interrupted: 'bg-yellow-500/10',
  cancelled: 'bg-muted',
  failed: 'bg-destructive/10',
  completed: 'bg-green-500/10',
};

interface Props {
  playbooks: PlaybookSummary[];
}

export function getExecutionStatusCounts(playbooks: PlaybookSummary[]): Partial<Record<ExecutionStatus, number>> {
  const counts: Partial<Record<ExecutionStatus, number>> = {};

  for (const status of kpiStatuses) {
    counts[status] = 0;
  }

  for (const playbook of playbooks) {
    const status = playbook.executionStatus;
    if (status && status in counts) {
      counts[status] = (counts[status] ?? 0) + 1;
    }
  }

  return counts;
}

export function PlaybookExecutionKpiCards({ playbooks }: Props) {
  const { t } = useModuleTranslation('playbook');

  const counts = getExecutionStatusCounts(playbooks);

  return (
    <div className="flex flex-wrap gap-3">
      {kpiStatuses.map((status) => {
        const count = counts[status] ?? 0;
        const Icon = statusIcon[status];
        return (
          <div
            key={status}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${statusBg[status]} border-border/50`}
          >
            <Icon
              className={`h-4 w-4 ${statusColor[status]} ${status === 'running' ? 'animate-spin' : ''}`}
            />
            <span className="text-sm font-semibold tabular-nums">{count}</span>
            <span className="text-xs text-muted-foreground">{t(`status.${status}`)}</span>
          </div>
        );
      })}
    </div>
  );
}
