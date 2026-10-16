import { CodeBlock, CodeBlockCopyButton } from '@/components/ai-elements/code-block';
import type { ToolContent } from '../../../types';

type Mcp = Extract<ToolContent, { kind: 'mcp' }>;

export function McpToolView({ content }: { content: Mcp }) {
  const code = JSON.stringify(content.result, null, 2);

  return (
    <div className='flex h-full min-h-0 flex-col gap-2'>
      <header className='shrink-0 text-xs text-muted-foreground'>
        <code className='font-medium text-foreground'>{content.server}</code>
        <span> · </span>
        <code>{content.tool}</code>
      </header>
      <div className='min-h-0 flex-1 overflow-auto'>
        <CodeBlock code={code} language='json'>
          <CodeBlockCopyButton code={code} className='h-7 w-7' />
        </CodeBlock>
      </div>
    </div>
  );
}
