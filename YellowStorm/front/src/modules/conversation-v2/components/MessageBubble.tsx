import { useState } from 'react';
import { BotIcon } from 'lucide-react';
import { Streamdown } from 'streamdown';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { openFileViewerFromUrl, getMimeTypeFromFilename } from '@/modules/file-viewer';
import { conversationV2Api } from '../api';
import { useConversationV2Store } from '../store';
import type { AgentEvent, FileInfo } from '../types';
import { TypewriterStreamdown } from './TypewriterStreamdown';

type MessageEvent = Extract<AgentEvent, { type: 'message' }>;

interface MessageBubbleProps {
  event: MessageEvent;
  readOnly?: boolean;
  /** Hide the assistant avatar/header when the previous node is also from the assistant. */
  hideAssistantHeader?: boolean;
  /** Animate the assistant reply as a typewriter (fresh live message). */
  animate?: boolean;
}

export function MessageBubble({ event, readOnly, hideAssistantHeader, animate }: MessageBubbleProps) {
  const isUser = event.role === 'user';
  const attachments = event.attachments ?? [];
  const content = event.content ?? '';

  if (isUser) {
    return (
      <div className='group/msg my-3 flex w-full flex-col items-end gap-1'>
        {attachments.length > 0 && (
          <div className='flex w-fit max-w-[90%] flex-wrap justify-end gap-1'>
            {attachments.map((file) => (
              <AttachmentChip key={file.id} file={file} readOnly={readOnly} />
            ))}
          </div>
        )}
        <div className='max-w-[90%] rounded-2xl rounded-br-none border border-border bg-muted/60 px-3 py-2 text-sm text-foreground shadow-sm dark:bg-muted/40'>
          <Streamdown className='whitespace-pre-wrap break-words'>{content}</Streamdown>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('group/msg flex w-full flex-col gap-1', hideAssistantHeader ? 'mt-0' : 'mt-3')}>
      {!hideAssistantHeader && (
        <div className='flex items-center gap-1.5 text-foreground'>
          <BotIcon className='size-5 shrink-0' />
          <span className='text-sm font-medium leading-none'>YelloStorm</span>
        </div>
      )}
      <TypewriterStreamdown text={content} enabled={!!animate} />

      {attachments.length > 0 && (
        <div className='flex w-fit max-w-[90%] flex-wrap gap-1'>
          {attachments.map((file) => (
            <AttachmentChip key={file.id} file={file} readOnly={readOnly} />
          ))}
        </div>
      )}

      {event.modelId && (
        <div className='mt-1 flex items-center gap-2 text-xs'>
          <span className='rounded-md border border-border px-1.5 py-0.5 opacity-60'>
            {event.modelId}
          </span>
        </div>
      )}
    </div>
  );
}

function AttachmentChip({ file, readOnly }: { file: FileInfo; readOnly?: boolean }) {
  const [loading, setLoading] = useState(false);
  const closeRightPanel = useConversationV2Store((s) => s.closeRightPanel);

  const handleClick = async () => {
    if (readOnly || loading) return;
    setLoading(true);
    try {
      const { url } = await conversationV2Api.getFileSignedUrl(file.path);
      // Prefer filename-derived MIME — the AI service often leaves content_type
      // empty or sets `application/octet-stream`, which falls through to the
      // UnsupportedRenderer even for .txt/.md/.json the viewer can clearly handle.
      const mimeType =
        getMimeTypeFromFilename(file.name) ?? file.content_type ?? 'application/octet-stream';
      // Mutually exclusive with the tool-detail right panel; both occupy the
      // right side and would collide otherwise.
      closeRightPanel();
      openFileViewerFromUrl(url, file.name, mimeType, { displayMode: 'sidebar' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      toast.error('Failed to open file', { description: message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type='button'
      onClick={readOnly ? undefined : handleClick}
      disabled={loading}
      className={cn(
        'inline-flex items-center rounded-md border border-border bg-background/60 px-2 py-1 text-xs',
        readOnly ? 'cursor-default' : 'hover:bg-accent',
        loading && 'opacity-60',
      )}
    >
      {file.name}
    </button>
  );
}
