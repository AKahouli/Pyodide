import { EyeOffIcon, FileIcon, LockIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { CodeArtifact } from '@/components/ai-elements/code-artifact';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useConversationV2Translation } from '../../translation';
import { formatBytes, languageFromPath } from '../../utils/app-source';

interface AppSourceFileViewerProps {
  path: string;
  content: string | Uint8Array | null | undefined;
}

/** Read-only source viewer — users can inspect generated files but not edit them. */
export function AppSourceFileViewer({ path, content }: AppSourceFileViewerProps) {
  const { t } = useConversationV2Translation();
  const filename = path.split('/').pop() || path;

  if (content == null) {
    return (
      <div className='flex size-full flex-col items-center justify-center gap-2 px-6 text-center'>
        <FileIcon className='size-8 text-muted-foreground/50' />
        <p className='text-sm text-muted-foreground'>{t('nodepod.selectFile')}</p>
      </div>
    );
  }

  if (content instanceof Uint8Array) {
    return (
      <div className='flex size-full flex-col items-center justify-center gap-2 px-6 text-center'>
        <EyeOffIcon className='size-8 text-muted-foreground/50' />
        <p className='text-sm font-medium'>{filename}</p>
        <p className='text-xs text-muted-foreground'>
          {t('nodepod.binaryFile', { size: formatBytes(content.byteLength) })}
        </p>
      </div>
    );
  }

  return (
    <div className='flex size-full min-h-0 flex-col'>
      <header className='flex shrink-0 items-center gap-2 border-b px-3 py-2'>
        <code className='min-w-0 flex-1 truncate text-xs text-muted-foreground' title={path}>
          {path}
        </code>
        <Badge variant='secondary' className='gap-1 text-[10px] font-normal uppercase tracking-wide'>
          <LockIcon className='size-2.5' />
          {t('nodepod.readOnly')}
        </Badge>
      </header>
      <ScrollArea className='min-h-0 flex-1'>
        <div className='p-2'>
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
