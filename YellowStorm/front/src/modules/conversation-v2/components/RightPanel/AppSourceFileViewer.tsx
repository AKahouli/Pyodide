import { EyeOffIcon, FileIcon, LockIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { CodeArtifact } from '@/components/ai-elements/code-artifact';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useConversationV2Translation } from '../../translation';
import { fileIconForName, formatBytes, languageFromPath } from '../../utils/app-source';

interface AppSourceFileViewerProps {
  path: string;
  content: string | Uint8Array | null | undefined;
}

/** Read-only source viewer — users can inspect generated files but not edit them. */
export function AppSourceFileViewer({ path, content }: AppSourceFileViewerProps) {
  const { t } = useConversationV2Translation();
  const filename = path.split('/').pop() || path;
  const FileTypeIcon = fileIconForName(filename);

  if (content == null) {
    return (
      <div className='flex size-full flex-col items-center justify-center gap-3 px-6 text-center bg-muted/10'>
        <div className='flex size-14 items-center justify-center rounded-2xl bg-muted/60'>
          <FileIcon className='size-7 text-muted-foreground/45' />
        </div>
        <div className='space-y-1'>
          <p className='text-sm font-medium text-foreground/80'>{t('nodepod.selectFile')}</p>
          <p className='text-xs text-muted-foreground'>{t('nodepod.explorerHint')}</p>
        </div>
      </div>
    );
  }

  if (content instanceof Uint8Array) {
    return (
      <div className='flex size-full flex-col items-center justify-center gap-3 px-6 text-center bg-muted/10'>
        <div className='flex size-14 items-center justify-center rounded-2xl bg-muted/60'>
          <EyeOffIcon className='size-7 text-muted-foreground/45' />
        </div>
        <div className='space-y-1'>
          <p className='text-sm font-medium'>{filename}</p>
          <p className='text-xs text-muted-foreground'>
            {t('nodepod.binaryFile', { size: formatBytes(content.byteLength) })}
          </p>
        </div>
      </div>
    );
  }

  const lineCount = content.split('\n').length;

  return (
    <div className='flex h-full min-h-0 flex-col overflow-hidden bg-background'>
      <header className='flex shrink-0 items-center gap-2 border-b bg-card/40 px-3 py-2'>
        <div className='flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/70'>
          <FileTypeIcon className='size-3.5 text-muted-foreground' />
        </div>
        <div className='min-w-0 flex-1'>
          <p className='truncate text-xs font-medium' title={filename}>{filename}</p>
          <p className='truncate text-[10px] text-muted-foreground' title={path}>{path}</p>
        </div>
        <Badge variant='outline' className='shrink-0 text-[10px] font-normal tabular-nums'>
          {lineCount} {t('nodepod.lines')}
        </Badge>
        <Badge variant='secondary' className='gap-1 shrink-0 text-[10px] font-normal uppercase tracking-wide'>
          <LockIcon className='size-2.5' />
          {t('nodepod.readOnly')}
        </Badge>
      </header>
      <ScrollArea className='min-h-0 flex-1'>
        <div className='p-3'>
          <CodeArtifact
            code={content}
            language={languageFromPath(path)}
            filename={filename}
            className='m-0'
          />
        </div>
      </ScrollArea>
    </div>
  );
}
