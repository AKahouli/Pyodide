import { useCallback, useRef, useState } from 'react';
import { Upload, FileUp, Link2, ChevronDown, FolderUp } from 'lucide-react';

import { useModuleTranslation } from '@/modules/localization';
import { cn } from '@/lib/utils';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

import { useWorkspaceStore, useCanWriteWorkspace } from '../store';
import { formatFileSize, extractUrlFromText } from '../utils';
import { useAllowedUploadExtensions } from '../hooks/useAllowedUploadExtensions';
import { readAutoIndexationValue } from '../hooks/useAutoIndexation';
import { readDeepSearchIndexationValue } from '../hooks/useDeepSearchIndexation';
import { AddLinkDialog } from './AddLinkDialog';

export function WorkspaceUploadDropZone({ expanded = false }: { expanded?: boolean }) {
  const canWrite = useCanWriteWorkspace();
  const uploadPageFiles = useWorkspaceStore((s) => s.uploadPageFiles);
  const selectedWorkspaceId = useWorkspaceStore((s) => s.selectedWorkspaceId);
  const addLinkDialog = useWorkspaceStore((s) => s.addLinkDialog);
  const openAddLink = useWorkspaceStore((s) => s.openAddLink);
  const closeAddLink = useWorkspaceStore((s) => s.closeAddLink);
  const { accept, maxFileSize } = useAllowedUploadExtensions();
  const { t } = useModuleTranslation('workspace');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const isUploading = useWorkspaceStore((s) => s.isUploading);
  const dragCounter = useRef(0);
  const [isDragOver, setIsDragOver] = useState(false);

  const pushFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    void uploadPageFiles(Array.from(list), {
      autoIndex: readAutoIndexationValue(),
      deepSearch: readDeepSearchIndexationValue(),
    });
  };

  const openLink = (initialUrl: string) => openAddLink({ url: initialUrl });

  const dragHasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes('Files');
  const dragHasText = (e: React.DragEvent) =>
    e.dataTransfer.types.includes('text/uri-list') || e.dataTransfer.types.includes('text/plain');

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!dragHasFiles(e) && !dragHasText(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    setIsDragOver(true);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!dragHasFiles(e) && !dragHasText(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      const hasFiles = dragHasFiles(e);
      const hasText = dragHasText(e);
      if (!hasFiles && !hasText) return;
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current = 0;
      setIsDragOver(false);
      if (hasFiles) {
        pushFiles(e.dataTransfer.files);
        return;
      }
      const raw = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
      const url = extractUrlFromText(raw);
      if (url) openLink(url);
    },
    [pushFiles],
  );

  if (!canWrite) return null;

  return (
    <>
      <div
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          'group inline-flex shrink-0 flex-wrap items-center gap-3 rounded-lg transition-colors',
          expanded && 'w-full flex-col justify-center border border-dashed border-border bg-muted/30 px-4 py-8 text-center hover:border-primary/50 hover:bg-muted/50',
          isDragOver && 'border-primary bg-primary/10',
        )}
      >
        {expanded && <><div
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary',
            isDragOver && 'scale-110',
          )}
        >
          <Upload className='h-5 w-5' />
        </div>
        <div className='min-w-0 flex-1 space-y-0.5'>
          <p className='text-sm font-medium text-foreground'>
            {t(isDragOver ? 'uploadActivity.dropHere' : 'uploadActivity.dropHint')}
          </p>
          <p className='text-xs text-muted-foreground'>
            {t('uploadActivity.limits', { size: formatFileSize(maxFileSize) })}
          </p>
        </div></>}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type='button'
              disabled={isUploading}
              className='disabled:opacity-50 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90'
            >
              <Upload className='h-4 w-4' />{t('uploadActivity.files')} <ChevronDown className='h-4 w-4' />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='center'>
            <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
              <FileUp className='me-2 h-4 w-4' /> {t('uploadActivity.files')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => folderInputRef.current?.click()}>
              <FolderUp className='me-2 h-4 w-4' /> {t('uploadActivity.folder')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openLink('')}>
              <Link2 className='me-2 h-4 w-4' /> {t('uploadActivity.link')}
            </DropdownMenuItem>
            <div className='max-w-64 border-t px-2 py-2 text-xs text-muted-foreground'>{t('uploadActivity.limits', { size: formatFileSize(maxFileSize) })}</div>
          </DropdownMenuContent>
        </DropdownMenu>

        <input
          ref={folderInputRef}
          type='file'
          multiple
          hidden
          aria-label={t('uploadActivity.folder')}
          {...{ webkitdirectory: '', directory: '' }}
          onChange={(e) => { pushFiles(e.target.files); e.target.value = ''; }}
        />
        <input
          aria-label={t('uploadActivity.files')}
          ref={fileInputRef}
          type='file'
          multiple
          hidden
          accept={accept}
          onChange={(e) => {
            pushFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {selectedWorkspaceId && (
        <AddLinkDialog
          open={addLinkDialog.open}
          onOpenChange={(o) => { if (!o) closeAddLink(); }}
          workspaceId={selectedWorkspaceId}
          initialUrl={addLinkDialog.initialUrl}
          autoStart={addLinkDialog.autoStart}
        />
      )}
    </>
  );
}
