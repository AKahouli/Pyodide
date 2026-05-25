import type { ReactNode } from 'react';
import { CheckCircleIcon, CircleIcon, ClockIcon, XCircleIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useConversationV2Translation } from '../translation';

type StatusKind = 'pending' | 'running' | 'success' | 'error';

const KIND_BY_STATUS: Record<string, StatusKind> = {
  pending: 'pending',
  queued: 'pending',
  running: 'running',
  in_progress: 'running',
  success: 'success',
  completed: 'success',
  ok: 'success',
  error: 'error',
  failed: 'error',
};

const VARIANT: Record<StatusKind, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'outline',
  running: 'secondary',
  success: 'secondary',
  error: 'destructive',
};

export function StepBadge({ status }: { status: string }) {
  const { t } = useConversationV2Translation();
  const kind: StatusKind = KIND_BY_STATUS[status] ?? 'pending';

  const icon: Record<StatusKind, ReactNode> = {
    pending: <CircleIcon className='size-3' />,
    running: <ClockIcon className='size-3 animate-pulse' />,
    success: <CheckCircleIcon className='size-3 text-green-600' />,
    error: <XCircleIcon className='size-3 text-destructive' />,
  };

  const label: Record<StatusKind, string> = {
    pending: t('tool.pending'),
    running: t('tool.running'),
    success: t('tool.success'),
    error: t('tool.error'),
  };

  return (
    <Badge variant={VARIANT[kind]} className='gap-1.5 rounded-full text-xs font-normal'>
      {icon[kind]}
      {label[kind]}
    </Badge>
  );
}
