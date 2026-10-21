import { useState } from 'react';
import { ChevronDown, ChevronUp, RotateCw, X } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';
import { Progress } from '@/components/ui/progress';
import { useWorkspaceStore } from '../store';
import { readAutoIndexationValue } from '../hooks/useAutoIndexation';
import { readDeepSearchIndexationValue } from '../hooks/useDeepSearchIndexation';

/** Upload progress and indexing are separate stages; storage completion is never readiness. */
export function WorkspaceUploadActivity() {
  const { t } = useModuleTranslation('workspace');
  const [expanded, setExpanded] = useState(false);
  const workspaceId = useWorkspaceStore((s) => s.selectedWorkspaceId);
  const queue = useWorkspaceStore((s) => s.uploadQueue);
  const files = useWorkspaceStore((s) => s.pageFiles);
  const isUploading = useWorkspaceStore((s) => s.isUploading);
  const cancel = useWorkspaceStore((s) => s.cancelUpload);
  const retry = useWorkspaceStore((s) => s.retryPageUpload);
  const dismiss = useWorkspaceStore((s) => s.clearCompletedUploads);
  const items = queue.filter((item) => item.workspaceId === workspaceId);
  const indexing = files.filter((file) => file.indexingStatus === 'pending' || file.indexingStatus === 'processing').length;
  const failedIndexing = files.filter((file) => file.indexingStatus === 'failed').length;
  const active = items.filter((item) => item.status === 'pending' || item.status === 'uploading').length;
  const failed = items.filter((item) => item.status === 'failed').length;
  const completed = items.filter((item) => item.status === 'completed').length;
  if (!items.length && !indexing && !failedIndexing) return null;
  return (
    <section className='rounded-lg border border-border bg-muted/20' aria-label={t('uploadActivity.title')}>
      <div className='flex flex-wrap items-center gap-3 px-3 py-2 text-xs'>
        <button type='button' aria-expanded={expanded} onClick={() => setExpanded(!expanded)} className='flex items-center gap-2 rounded text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'>
          {expanded ? <ChevronUp className='h-4 w-4' /> : <ChevronDown className='h-4 w-4' />}
          {t('uploadActivity.title')}
        </button>
        <span role='status' className='text-muted-foreground'>{t('uploadActivity.summary', { completed, total: items.length, active, failed })}</span>
        <span className='text-muted-foreground'>{t('uploadActivity.indexingSummary', { count: indexing, failed: failedIndexing })}</span>
        {completed > 0 && <button type='button' onClick={dismiss} disabled={isUploading} className='disabled:opacity-50 ms-auto rounded px-2 py-1 text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring'>{t('uploadActivity.dismiss')}</button>}
      </div>
      {expanded && <div className='max-h-64 space-y-2 overflow-y-auto border-t border-border p-3'>
        <p className='text-xs text-muted-foreground'>{t('uploadActivity.stages')}</p>
        {items.map((item) => <div key={item.id} className='flex items-center gap-3 text-xs'>
          <div className='min-w-0 flex-1'>
            <div className='flex items-center justify-between gap-3'><span className='truncate' title={item.file.webkitRelativePath || item.file.name}>{item.file.webkitRelativePath || item.file.name}</span><span className='shrink-0 tabular-nums text-muted-foreground'>{t(`uploadActivity.${item.status}`)} {item.status === 'uploading' && `${item.progress}%`}</span></div>
            {(item.status === 'uploading' || item.status === 'pending') && <Progress value={item.progress} aria-label={item.file.name} className='mt-1 h-1' />}
            {item.error && <p className='mt-1 break-words text-destructive'>{item.error}</p>}
          </div>
          {item.status === 'pending' && <button type='button' aria-label={t('uploadActivity.cancel', { name: item.file.name })} onClick={() => cancel(item.id)} className='rounded p-1 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring'><X className='h-4 w-4' /></button>}
          {item.status === 'failed' && <button type='button' disabled={isUploading} aria-label={t('uploadActivity.retry', { name: item.file.name })} onClick={() => void retry(item.id, { autoIndex: readAutoIndexationValue(), deepSearch: readDeepSearchIndexationValue() })} className='rounded p-1 hover:bg-muted disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring'><RotateCw className='h-4 w-4' /></button>}
        </div>)}
      </div>}
    </section>
  );
}
