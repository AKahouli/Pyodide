import { Circle, Loader2, CheckCircle2, XCircle, CornerDownRight, PauseCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useModuleTranslation } from '@/modules/localization/useModuleTranslation';
import type { StepStatus, ExecutionStatus } from '../types';

const statusConfig: Record<string, { icon: React.ElementType; className: string }> = {
  idle: { icon: Circle, className: 'border-transparent bg-muted text-muted-foreground' },
  pending: { icon: Circle, className: 'border-transparent bg-muted text-muted-foreground' },
  running: { icon: Loader2, className: 'border-transparent bg-primary/10 text-primary' },
  completed: { icon: CheckCircle2, className: 'border-transparent bg-green-500/10 text-green-600' },
  failed: { icon: XCircle, className: 'border-transparent bg-destructive/10 text-destructive' },
  skipped: { icon: CornerDownRight, className: 'border-transparent bg-muted text-muted-foreground' },
  interrupted: { icon: PauseCircle, className: 'border-transparent bg-yellow-500/10 text-yellow-700' },
  cancelled: { icon: XCircle, className: 'border-transparent bg-muted text-muted-foreground' },
};

interface Props {
  status: StepStatus | ExecutionStatus | 'idle';
  size?: 'sm' | 'md' | 'xs';
}

export function PlaybookStatusBadge({ status, size = 'sm' }: Props) {
  const { t } = useModuleTranslation('playbook');
  const config = statusConfig[status] || statusConfig.pending;
  const Icon = config.icon;
  const iconSize = size === 'xs' ? 'h-2.5 w-2.5' : size === 'sm' ? 'h-3 w-3' : 'h-4 w-4';
  const textClass = size === 'xs' ? 'text-[10px]' : size === 'sm' ? 'text-xs' : 'text-sm';
  const paddingClass = size === 'xs' ? 'h-5 px-1.5 py-0' : 'px-2 py-0.5';

  return (
    <Badge variant="outline" className={`gap-1 ${paddingClass} ${config.className}`}>
      <Icon className={`${iconSize} ${status === 'running' ? 'animate-spin' : ''}`} />
      <span className={textClass}>{status === 'idle' ? 'Idle' : t(`status.${status}`)}</span>
    </Badge>
  );
}
