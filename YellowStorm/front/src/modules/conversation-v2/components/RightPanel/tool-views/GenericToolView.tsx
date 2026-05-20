import { CodeBlock, CodeBlockCopyButton } from '@/components/ai-elements/code-block';
import type { ToolContent } from '../../../types';
import { useConversationV2Translation } from '../../../translation';

type Generic = Extract<ToolContent, { kind: 'generic' }>;

export function GenericToolView({ content }: { content: Generic }) {
  const { t } = useConversationV2Translation();
  const code = JSON.stringify(content.data, null, 2);

  return (
    <div className='flex h-full min-h-0 flex-col gap-2'>
      <header className='shrink-0 text-xs font-medium text-foreground'>{t('tools.generic.title')}</header>
      <div className='min-h-0 flex-1 overflow-auto'>
        <CodeBlock code={code} language='json'>
          <CodeBlockCopyButton code={code} className='h-7 w-7' />
        </CodeBlock>
      </div>
    </div>
  );
}
