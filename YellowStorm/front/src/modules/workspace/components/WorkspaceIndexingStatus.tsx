import { CheckCircle2, AlertCircle, MinusCircle, Clock3, Loader2, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import type { WorkspaceFile } from '../types';

export function WorkspaceIndexingStatus({ file }: { file: WorkspaceFile }) {
  const { t } = useModuleTranslation('workspace');
  const status = file.status === 'failed' ? 'failed' : file.status === 'uploading' ? 'uploading' : file.type === 'url' && file.status === 'processing' ? 'processing' : file.indexingStatus ?? 'none';
  const Icon = { ready: CheckCircle2, failed: AlertCircle, pending: Clock3, processing: Loader2, none: MinusCircle, uploading: Upload }[status];
  return <span title={status === 'failed' ? file.indexingError : undefined} className={cn('inline-flex items-center gap-1.5 text-xs', status === 'failed' ? 'text-destructive' : status === 'ready' ? 'text-foreground' : 'text-muted-foreground')}><Icon aria-hidden='true' className={cn('h-3.5 w-3.5 shrink-0', status === 'processing' && 'animate-spin motion-reduce:animate-none')} />{t(`explorer.status.${status}`)}</span>;
}
