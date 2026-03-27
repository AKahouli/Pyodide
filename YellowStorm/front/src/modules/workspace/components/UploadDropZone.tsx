/**
 * Upload Drop Zone
 * Invisible wrapper that shows overlay when files are dragged over
 */

import { useState, useCallback, useRef } from 'react';
import { Upload } from 'lucide-react';
import { toast } from 'sonner';
import { useModuleTranslation } from '@/modules/localization';
import { useWorkspaceStore, useSelectedWorkspace } from '../store';
import { validateFiles } from '../utils';

interface UploadDropZoneProps {
  children: React.ReactNode;
}

export function UploadDropZone({ children }: UploadDropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounter = useRef(0);
  const { t } = useModuleTranslation('workspace');

  const selectedWorkspace = useSelectedWorkspace();
  const addFilesToQueue = useWorkspaceStore((state) => state.addFilesToQueue);
  const startUpload = useWorkspaceStore((state) => state.startUpload);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      dragCounter.current = 0;

      if (!selectedWorkspace) {
        toast.error(t('upload.dropzone.selectWorkspace'));
        return;
      }

      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;

      const { validFiles } = validateFiles(files);
      if (validFiles.length === 0) return;

      addFilesToQueue(validFiles, selectedWorkspace.id);
      startUpload();
    },
    [selectedWorkspace, addFilesToQueue, startUpload],
  );

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;

    if (e.dataTransfer.types.includes('Files')) {
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;

    if (dragCounter.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  return (
    <div className='relative flex-1 flex flex-col min-h-0 min-w-0' onDrop={handleDrop} onDragEnter={handleDragEnter} onDragLeave={handleDragLeave} onDragOver={handleDragOver}>
      {children}

      {/* Drag overlay */}
      {isDragOver && (
        <div className='absolute inset-0 z-50 bg-background/95 backdrop-blur-sm flex flex-col items-center justify-center border-2 border-dashed border-primary rounded-lg'>
          <Upload className='h-16 w-16 text-primary mb-4 animate-pulse' />
          <h3 className='text-xl font-semibold text-foreground mb-2'>{t('upload.dropzone.title')}</h3>
          <p className='text-sm text-muted-foreground'>{t('upload.dropzone.supported')}</p>
        </div>
      )}
    </div>
  );
}
