import type { BundledLanguage } from 'shiki';
import { CodeArtifact } from '@/components/ai-elements/code-artifact';
import { Badge } from '@/components/ui/badge';
import type { ToolContent } from '../../../types';

type File = Extract<ToolContent, { kind: 'file' }>;

export function FileToolView({ content }: { content: File }) {
  const language = (content.language || 'plaintext') as BundledLanguage;
  const filename = content.path.split(/[\\/]/).pop() || content.path;

  return (
    <div className='flex h-full min-h-0 flex-col gap-2'>
      <header className='flex shrink-0 items-center justify-between gap-2 text-xs text-muted-foreground'>
        <code className='truncate'>{content.path}</code>
        {content.operation && (
          <Badge variant='outline' className='shrink-0 text-[10px] uppercase tracking-wide'>
            {content.operation}
          </Badge>
        )}
      </header>
      <div className='min-h-0 flex-1 overflow-auto'>
        <CodeArtifact code={content.content} language={language} filename={filename} className='m-0' />
      </div>
    </div>
  );
}
