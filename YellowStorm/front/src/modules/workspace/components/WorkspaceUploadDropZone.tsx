import { useCallback, useRef, useState } from 'react';
import { Upload, FileUp, Link2, ChevronDown } from 'lucide-react';

import { cn } from '@/lib/utils';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

import { useWorkspaceStore, useCanWriteWorkspace } from '../store';
import { MAX_FILE_SIZE, MAX_FILES_PER_UPLOAD, formatFileSize, extractUrlFromText } from '../utils';
import { useAllowedUploadExtensions } from '../hooks/useAllowedUploadExtensions';
import { readAutoIndexationValue } from '../hooks/useAutoIndexation';
import { readDeepSearchIndexationValue } from '../hooks/useDeepSearchIndexation';
import { AddLinkDialog } from './AddLinkDialog';

export function WorkspaceUploadDropZone() {
  const canWrite = useCanWriteWorkspace();
  const uploadPageFiles = useWorkspaceStore((s) => s.uploadPageFiles);
  const selectedWorkspaceId = useWorkspaceStore((s) => s.selectedWorkspaceId);
  const { accept } = useAllowedUploadExtensions();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);
  const [isDragOver, setIsDragOver] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkInitialUrl, setLinkInitialUrl] = useState('');

  const pushFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    void uploadPageFiles(Array.from(list), {
      autoIndex: readAutoIndexationValue(),
      deepSearch: readDeepSearchIndexationValue(),
    });
  };

  const openLink = (initialUrl: string) => {
    setLinkInitialUrl(initialUrl);
    setLinkOpen(true);
  };

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
          'group flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors',
          'border-border bg-muted/30 hover:border-primary/50 hover:bg-muted/50',
          isDragOver && 'border-primary bg-primary/10',
        )}
      >
        <div
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary transition-transform',
            isDragOver && 'scale-110',
          )}
        >
          <Upload className='h-5 w-5' />
        </div>
        <div className='space-y-0.5'>
          <p className='text-sm font-medium text-foreground'>
            {isDragOver ? 'Déposez ici' : 'Glissez un fichier ou un lien ici'}
          </p>
          <p className='text-xs text-muted-foreground'>
            jusqu'à {MAX_FILES_PER_UPLOAD} fichiers, max {formatFileSize(MAX_FILE_SIZE)} chacun
          </p>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type='button'
              className='mt-1 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90'
            >
              Ajouter <ChevronDown className='h-4 w-4' />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='center'>
            <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
              <FileUp className='mr-2 h-4 w-4' /> Importer un document
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openLink('')}>
              <Link2 className='mr-2 h-4 w-4' /> Ajouter un lien
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <input
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
          open={linkOpen}
          onOpenChange={setLinkOpen}
          workspaceId={selectedWorkspaceId}
          initialUrl={linkInitialUrl}
        />
      )}
    </>
  );
}
