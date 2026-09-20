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
      <div className='flex size-full flex-col items-center justify-center gap-4 bg-gradient-to-b from-muted/30 to-background px-6 text-center'>
        <div className='flex size-14 items-center justify-center rounded-2xl border border-border/60 bg-card shadow-sm'>
          <FileIcon className='size-6 text-muted-foreground/50' />
        </div>
        <div className='max-w-xs space-y-1.5'>
          <p className='text-sm font-semibold tracking-tight'>{t('nodepod.selectFile')}</p>
          <p className='text-xs leading-relaxed text-muted-foreground'>{t('nodepod.explorerHint')}</p>
        </div>
      </div>
    );
  }

  if (content instanceof Uint8Array) {
    return (
      <div className='flex size-full flex-col items-center justify-center gap-4 bg-gradient-to-b from-muted/30 to-background px-6 text-center'>
        <div className='flex size-14 items-center justify-center rounded-2xl border border-border/60 bg-card shadow-sm'>
          <EyeOffIcon className='size-6 text-muted-foreground/50' />
        </div>
        <div className='max-w-xs space-y-1.5'>
          <p className='text-sm font-semibold tracking-tight'>{filename}</p>
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
      <header className='flex h-11 shrink-0 items-center gap-2.5 border-b border-border/80 bg-card/60 px-3 backdrop-blur-sm'>
        <div className='flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/80'>
          <FileTypeIcon className='size-3.5 text-muted-foreground' />
        </div>
        <div className='min-w-0 flex-1'>
          <p className='truncate text-xs font-semibold tracking-tight' title={filename}>
            {filename}
          </p>
          <p className='truncate text-[10px] text-muted-foreground' title={path}>
            {path}
          </p>
        </div>
        <Badge
          variant='outline'
          className='hidden h-6 shrink-0 border-border/70 px-2 text-[10px] font-normal tabular-nums sm:inline-flex'
        >
          {lineCount} {t('nodepod.lines')}
        </Badge>
        <Badge
          variant='secondary'
          className='h-6 gap-1 shrink-0 px-2 text-[10px] font-medium uppercase tracking-wide'
        >
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
