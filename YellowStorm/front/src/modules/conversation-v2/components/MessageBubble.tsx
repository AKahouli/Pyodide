import { BotIcon } from 'lucide-react';
import { Streamdown } from 'streamdown';
import { cn } from '@/lib/utils';
import { openFileViewerFromUrl } from '@/modules/file-viewer';
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
    </div>
  );
}

function AttachmentChip({ file, readOnly }: { file: FileInfo; readOnly?: boolean }) {
  return (
    <button
      type='button'
      onClick={readOnly ? undefined : () => openFileViewerFromUrl(file.url, file.name, file.content_type)}
      className={cn(
        'inline-flex items-center rounded-md border border-border bg-background/60 px-2 py-1 text-xs',
        readOnly ? 'cursor-default' : 'hover:bg-accent',
      )}
    >
      {file.name}
    </button>
  );
}
