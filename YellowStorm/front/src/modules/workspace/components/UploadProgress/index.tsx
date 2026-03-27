import { useState } from 'react';

import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';

import { useWorkspaceStore, useUploadQueue, useHasActiveUploads } from '../../store';
import { UploadItem } from './UploadItem';
import { UploadProgressHeader } from './UploadProgressHeader';

export function UploadProgress() {
  const [isExpanded, setIsExpanded] = useState(true);
  const uploadQueue = useUploadQueue();
  const hasActiveUploads = useHasActiveUploads();
  const clearCompletedUploads = useWorkspaceStore((state) => state.clearCompletedUploads);

  const completedCount = uploadQueue.filter((item) => item.status === 'completed').length;
  const failedCount = uploadQueue.filter((item) => item.status === 'failed').length;
  const uploadingCount = uploadQueue.filter((item) => item.status === 'uploading').length;
  const pendingCount = uploadQueue.filter((item) => item.status === 'pending').length;

  const totalProgress = uploadQueue.length > 0 ? Math.round(uploadQueue.reduce((sum, item) => sum + item.progress, 0) / uploadQueue.length) : 0;

  const isVisible = uploadQueue.length > 0;

  return (
    <div className={`fixed bottom-4 right-4 w-[calc(100vw-2rem)] sm:w-[28rem] bg-background border rounded-lg shadow-lg z-52 transition-opacity duration-200 ${isVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
      {isVisible && <UploadProgressHeader hasActiveUploads={hasActiveUploads} uploadingCount={uploadingCount} pendingCount={pendingCount} failedCount={failedCount} isExpanded={isExpanded} canClear={!hasActiveUploads && (completedCount > 0 || failedCount > 0)} onToggle={() => setIsExpanded((prev) => !prev)} onClear={clearCompletedUploads} />}

      {hasActiveUploads && (
        <div className='px-3 py-2 border-b'>
          <Progress value={totalProgress} className='h-1.5' />
        </div>
      )}

      {isExpanded && (
        <ScrollArea className='h-auto max-h-64 overflow-y-auto'>
          <div className='p-2 space-y-1'>
            {uploadQueue.map((item) => (
              <UploadItem key={item.id} item={item} />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
