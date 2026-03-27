import { useCallback } from 'react';
import { FileIcon } from 'lucide-react';
import { openFileViewerFromUrl, isViewableFile } from '@/modules/file-viewer';
import type { AttachedFile } from '../types';

function isImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

interface MessageAttachmentsProps {
  files: AttachedFile[];
}

export function MessageAttachments({ files }: MessageAttachmentsProps) {
  const handleClick = useCallback((e: React.MouseEvent, file: AttachedFile) => {
    if (!file.downloadUrl) return;

    if (isViewableFile(file.mimeType)) {
      e.preventDefault();
      openFileViewerFromUrl(file.downloadUrl, file.originalName, file.mimeType, { displayMode: 'sidebar' });
    }
    // For non-viewable files, let the <a> tag open in a new tab as fallback
  }, []);

  if (!files.length) return null;

  return (
    <div className='flex flex-wrap gap-2 mb-2 justify-end'>
      {files.map((file) => (
        <a key={file.id} href={file.downloadUrl || undefined} target='_blank' rel='noopener noreferrer' onClick={(e) => handleClick(e, file)} className='block w-20 h-20 rounded-lg overflow-hidden border border-border hover:border-foreground/20 transition-colors cursor-pointer'>
          {isImageMimeType(file.mimeType) && file.downloadUrl ? (
            <img src={file.downloadUrl} alt={file.originalName} className='w-full h-full object-cover' />
          ) : (
            <div className='w-full h-full flex flex-col items-center justify-center bg-muted p-2'>
              <FileIcon className='w-6 h-6 text-muted-foreground' />
              <span className='text-[10px] truncate w-full text-center mt-1 text-muted-foreground'>{file.originalName}</span>
            </div>
          )}
        </a>
      ))}
    </div>
  );
}
