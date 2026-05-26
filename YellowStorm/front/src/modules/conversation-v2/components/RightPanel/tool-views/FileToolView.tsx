import { useState } from 'react';
import { ExternalLinkIcon, Loader2 } from 'lucide-react';
import type { BundledLanguage } from 'shiki';
import { toast } from 'sonner';
import { CodeArtifact } from '@/components/ai-elements/code-artifact';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  openFileViewerFromUrl,
  getMimeTypeFromFilename,
  useFileViewerDisplayMode,
} from '@/modules/file-viewer';
import { conversationV2Api } from '../../../api';
import { useConversationV2Store } from '../../../store';
import type { ToolContent } from '../../../types';

type File = Extract<ToolContent, { kind: 'file' }>;

export function FileToolView({ content }: { content: File }) {
  const language = (content.language || 'plaintext') as BundledLanguage;
  const filename = content.path.split(/[\\/]/).pop() || content.path;
  const displayMode = useFileViewerDisplayMode();
  const closeRightPanel = useConversationV2Store((s) => s.closeRightPanel);
  const [opening, setOpening] = useState(false);

  const handleOpenInViewer = async () => {
    if (opening || !content.path) return;
    setOpening(true);
    try {
      const { url } = await conversationV2Api.getFileSignedUrl(content.path);
      const mimeType = getMimeTypeFromFilename(filename) ?? 'application/octet-stream';
      // Mutually exclusive with the tool-detail right panel — both occupy the
      // right side and collide otherwise.
      closeRightPanel();
      openFileViewerFromUrl(url, filename, mimeType, { displayMode });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      toast.error('Failed to open file', { description: message });
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className='flex h-full min-h-0 flex-col gap-2'>
      <header className='flex shrink-0 items-center justify-between gap-2 text-xs text-muted-foreground'>
        <code className='truncate'>{content.path}</code>
        <div className='flex shrink-0 items-center gap-1.5'>
          {content.operation && (
            <Badge variant='outline' className='text-[10px] uppercase tracking-wide'>
              {content.operation}
            </Badge>
          )}
          <Button
            type='button'
            size='sm'
            variant='outline'
            onClick={handleOpenInViewer}
            disabled={opening || !content.path}
            className='h-7 gap-1 px-2 text-xs'
          >
            {opening ? <Loader2 className='size-3 animate-spin' /> : <ExternalLinkIcon className='size-3' />}
            Open
          </Button>
        </div>
      </header>
      <div className='min-h-0 flex-1 overflow-auto'>
        <CodeArtifact code={content.content} language={language} filename={filename} className='m-0' />
      </div>
    </div>
  );
}
