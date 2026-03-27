import { Circle, Loader2, CheckCircle2, XCircle, CornerDownRight, PauseCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useModuleTranslation } from '@/modules/localization/useModuleTranslation';
import type { StepStatus, ExecutionStatus } from '../types';

const statusConfig: Record<string, { icon: React.ElementType; className: string }> = {
  pending: { icon: Circle, className: 'bg-muted text-muted-foreground' },
  running: { icon: Loader2, className: 'bg-primary/10 text-primary' },
  completed: { icon: CheckCircle2, className: 'bg-green-500/10 text-green-600' },
  failed: { icon: XCircle, className: 'bg-destructive/10 text-destructive' },
  skipped: { icon: CornerDownRight, className: 'bg-muted text-muted-foreground' },
  interrupted: { icon: PauseCircle, className: 'bg-yellow-500/10 text-yellow-600' },
  cancelled: { icon: XCircle, className: 'bg-muted text-muted-foreground' },
};

interface Props {
  status: StepStatus | ExecutionStatus;
  size?: 'sm' | 'md';
}

export function PlaybookStatusBadge({ status, size = 'sm' }: Props) {
  const { t } = useModuleTranslation('playbook');
  const config = statusConfig[status] || statusConfig.pending;
  const Icon = config.icon;
  const iconSize = size === 'sm' ? 'h-3 w-3' : 'h-4 w-4';

  return (
    <Badge variant="outline" className={`gap-1 ${config.className} border-none`}>
      <Icon className={`${iconSize} ${status === 'running' ? 'animate-spin' : ''}`} />
      <span className={size === 'sm' ? 'text-xs' : 'text-sm'}>{t(`status.${status}`)}</span>
    </Badge>
  );
}
