import { useMemo } from 'react';
import { ChevronDown, ChevronUp, CheckCircle2, Loader2, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';

type UploadProgressHeaderProps = Readonly<{
  hasActiveUploads: boolean;
  uploadingCount: number;
  pendingCount: number;
  failedCount: number;
  isExpanded: boolean;
  canClear: boolean;
  onToggle: () => void;
  onClear: () => void;
}>;

export function UploadProgressHeader({ hasActiveUploads, uploadingCount, pendingCount, failedCount, isExpanded, canClear, onToggle, onClear }: UploadProgressHeaderProps) {
  const { t } = useModuleTranslation('workspace');

  const headerLabel = useMemo(() => {
    if (hasActiveUploads) {
      return t('upload.header.uploading', { count: uploadingCount + pendingCount });
    }
    if (failedCount > 0) {
      return t('upload.header.failed', { count: failedCount });
    }
    return t('upload.header.complete');
  }, [t, hasActiveUploads, uploadingCount, pendingCount, failedCount]);

  return (
    <div className='flex items-center justify-between p-3 border-b cursor-pointer' onClick={onToggle}>
      <div className='flex items-center gap-2'>
        {hasActiveUploads ? <Loader2 className='h-4 w-4 animate-spin text-primary' /> : failedCount > 0 ? <XCircle className='h-4 w-4 text-destructive' /> : <CheckCircle2 className='h-4 w-4 text-green-500' />}
        <span className='text-sm font-medium'>{headerLabel}</span>
      </div>

      <div className='flex items-center gap-1'>
        {canClear && (
          <Button
            variant='ghost'
            size='sm'
            className='h-7 text-xs'
            onClick={(event) => {
              event.stopPropagation();
              onClear();
            }}>
            {t('upload.header.clear')}
          </Button>
        )}
        {isExpanded ? <ChevronDown className='h-4 w-4' /> : <ChevronUp className='h-4 w-4' />}
      </div>
    </div>
  );
}
