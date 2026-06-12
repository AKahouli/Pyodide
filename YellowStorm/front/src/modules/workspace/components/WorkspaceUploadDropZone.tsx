import { useCallback, useRef, useState } from 'react';
import { Upload } from 'lucide-react';

import { cn } from '@/lib/utils';

import { useWorkspaceStore } from '../store';
import { ACCEPT_EXTENSIONS, MAX_FILE_SIZE, MAX_FILES_PER_UPLOAD, formatFileSize } from '../utils';
import { useAutoIndexation } from '../hooks/useAutoIndexation';

export function WorkspaceUploadDropZone() {
  const uploadPageFiles = useWorkspaceStore((s) => s.uploadPageFiles);
  const { enabled: autoIndex } = useAutoIndexation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);
  const [isDragOver, setIsDragOver] = useState(false);

  const pushFiles = useCallback(
    (list: FileList | null) => {
      if (!list || list.length === 0) return;
      void uploadPageFiles(Array.from(list), { autoIndex });
    },
    [uploadPageFiles, autoIndex],
  );

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    setIsDragOver(true);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
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
      if (!e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current = 0;
      setIsDragOver(false);
      pushFiles(e.dataTransfer.files);
    },
    [pushFiles],
  );

  return (
    <button
      type='button'
      onClick={() => fileInputRef.current?.click()}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      aria-label="Glissez vos fichiers ici ou cliquez pour les sélectionner"
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
          {isDragOver ? 'Déposez pour téléverser' : 'Glissez vos fichiers ici'}
        </p>
        <p className='text-xs text-muted-foreground'>
          ou cliquez pour parcourir · jusqu'à {MAX_FILES_PER_UPLOAD} fichiers, max {formatFileSize(MAX_FILE_SIZE)} chacun
        </p>
        <p className='text-[11px] text-muted-foreground/80'>
          PDF, Word, Excel, PowerPoint, TXT, CSV, MD, JSON, Images
        </p>
      </div>
      <input
        ref={fileInputRef}
        type='file'
        multiple
        hidden
        accept={ACCEPT_EXTENSIONS}
        onChange={(e) => {
          pushFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </button>
  );
}
