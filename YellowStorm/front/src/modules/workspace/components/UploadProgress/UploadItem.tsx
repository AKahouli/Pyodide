import { useMemo, useCallback } from 'react';
import { FileText, Clock, Loader2, CheckCircle2, XCircle, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useModuleTranslation } from '@/modules/localization';

import { useWorkspaceStore } from '../../store';
import { formatFileSize } from '../../utils';
import type { UploadQueueItem } from '../../types';

type UploadItemProps = Readonly<{ item: UploadQueueItem }>;

export function UploadItem({ item }: UploadItemProps) {
  const cancelUpload = useWorkspaceStore((state) => state.cancelUpload);
  const removeFromQueue = useWorkspaceStore((state) => state.removeFromQueue);
  const { t } = useModuleTranslation('workspace');

  const handleCancel = useCallback(() => {
    if (item.status === 'pending') {
      cancelUpload(item.id);
    } else if (item.status === 'completed' || item.status === 'failed') {
      removeFromQueue(item.id);
    }
  }, [cancelUpload, removeFromQueue, item.id, item.status]);

  const statusLabel = useMemo(() => {
    if (item.status === 'pending') return t('upload.item.pending');
    if (item.status === 'uploading') return t('upload.item.uploading');
    if (item.status === 'completed') return t('upload.item.completed');
    if (item.status === 'failed') return t('upload.item.failed');
    return '';
  }, [item.status, t]);

  const handleLabel = useMemo(() => {
    if (item.status === 'pending') return t('upload.item.actions.cancel');
    if (item.status === 'completed' || item.status === 'failed') return t('upload.item.actions.dismiss');
    return '';
  }, [item.status, t]);

  return (
    <div className='flex items-center gap-3 py-2 px-3 hover:bg-muted/50 rounded-md'>
      <div className='shrink-0'>
        {item.status === 'pending' && <Clock className='h-4 w-4 text-muted-foreground' />}
        {item.status === 'uploading' && <Loader2 className='h-4 w-4 text-primary animate-spin' />}
        {item.status === 'completed' && <CheckCircle2 className='h-4 w-4 text-green-500' />}
        {item.status === 'failed' && <XCircle className='h-4 w-4 text-destructive' />}
      </div>

      <div className='flex-1 min-w-0'>
        <div className='flex items-center gap-2 min-w-0'>
          <FileText className='h-4 w-4 text-muted-foreground shrink-0' />
          <span className='text-sm truncate inline-block w-48'>{item.file.name}</span>
          <span className='text-xs text-muted-foreground shrink-0'>{formatFileSize(item.file.size)}</span>
          <span className='text-xs text-muted-foreground shrink-0'>{statusLabel}</span>
        </div>

        {item.status === 'uploading' && (
          <div className='flex items-center gap-2 mt-1'>
            <Progress value={item.progress} className='h-1.5 flex-1' />
            <span className='text-xs text-muted-foreground w-10 text-right'>{item.progress}%</span>
          </div>
        )}

        {item.status === 'failed' && item.error && <p className='text-xs text-destructive mt-1 truncate'>{item.error}</p>}
      </div>

      {(item.status === 'pending' || item.status === 'completed' || item.status === 'failed') && (
        <Button variant='ghost' size='icon' className='h-6 w-6 shrink-0' onClick={handleCancel} aria-label={handleLabel}>
          <X className='h-3 w-3' />
        </Button>
      )}
    </div>
  );
}
