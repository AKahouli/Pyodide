import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Clock, Loader2, Check, AlertTriangle, FileX } from 'lucide-react';
import type { IndexingStatus } from '../../types';

type Props = Readonly<{
  status: IndexingStatus;
  error?: string;
}>;

export function IndexingStatusBadge({ status, error }: Props) {
  const config: Record<IndexingStatus, { icon: React.ReactNode; label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
    none: { icon: <FileX className='h-3 w-3' />, label: 'Not Indexed', variant: 'outline' },
    pending: { icon: <Clock className='h-3 w-3' />, label: 'Pending', variant: 'secondary' },
    processing: { icon: <Loader2 className='h-3 w-3 animate-spin' />, label: 'Indexing', variant: 'secondary' },
    ready: { icon: <Check className='h-3 w-3' />, label: 'Indexed', variant: 'default' },
    failed: { icon: <AlertTriangle className='h-3 w-3' />, label: 'Failed', variant: 'destructive' },
  };

  const { icon, label, variant } = config[status] || config.pending;

  const badge = (
    <Badge variant={variant} className='text-[10px] h-5 px-1.5 gap-1'>
      {icon}
      {label}
    </Badge>
  );

  if (status === 'failed' && error) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>{badge}</TooltipTrigger>
          <TooltipContent>
            <p className='max-w-xs text-sm'>{error}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return badge;
}
