/**
 * Upload Button
 * Button that opens file picker for document upload
 */

import { useRef, useCallback } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useModuleTranslation } from '@/modules/localization';
import { useWorkspaceStore, useSelectedWorkspace } from '../store';
import { validateFiles, ACCEPT_EXTENSIONS } from '../utils';

interface UploadButtonProps {
  folderId?: string;
}

export function UploadButton({ folderId }: UploadButtonProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { t } = useModuleTranslation('workspace');

  const selectedWorkspace = useSelectedWorkspace();
  const addFilesToQueue = useWorkspaceStore((state) => state.addFilesToQueue);
  const startUpload = useWorkspaceStore((state) => state.startUpload);
  const isUploading = useWorkspaceStore((state) => state.isUploading);

  const handleClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      if (files.length === 0) return;

      if (!selectedWorkspace) {
        toast.error(t('upload.dropzone.selectWorkspace'));
        return;
      }

      const { validFiles } = validateFiles(files);
      if (validFiles.length > 0) {
        addFilesToQueue(validFiles, selectedWorkspace.id, folderId);
        startUpload();
      }

      // Reset input so the same file can be selected again
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [selectedWorkspace, addFilesToQueue, startUpload, folderId],
  );

  return (
    <>
      <input ref={fileInputRef} type='file' accept={ACCEPT_EXTENSIONS} multiple className='hidden' onChange={handleFileChange} />
      {/* Mobile: icon-only button */}
      <Button variant='outline' size='icon' className='h-8 w-8 md:hidden' onClick={handleClick} disabled={!selectedWorkspace || isUploading} title={t('upload.button.add')}>
        <Plus className='h-4 w-4' />
      </Button>
      {/* Desktop: full button with text */}
      <Button variant='outline' size='sm' className='hidden md:flex' onClick={handleClick} disabled={!selectedWorkspace || isUploading}>
        <Plus className='h-4 w-4 mr-2' />
        {t('upload.button.add')}
      </Button>
    </>
  );
}
