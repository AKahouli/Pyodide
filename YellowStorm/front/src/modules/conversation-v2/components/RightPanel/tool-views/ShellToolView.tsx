import {
  Terminal,
  TerminalActions,
  TerminalContent,
  TerminalCopyButton,
  TerminalHeader,
  TerminalTitle,
} from '@/components/ai-elements/terminal';
import type { ToolContent } from '../../../types';
import { useConversationV2Translation } from '../../../translation';

type Shell = Extract<ToolContent, { kind: 'shell' }>;

export function ShellToolView({ content }: { content: Shell }) {
  const { t } = useConversationV2Translation();

  return (
    <div className='flex h-full min-h-0 flex-col gap-2'>
      <Terminal output={content.output} className='min-h-0 flex-1'>
        <TerminalHeader>
          <TerminalTitle>
            <span className='truncate font-mono text-xs'>$ {content.command}</span>
          </TerminalTitle>
          <TerminalActions>
            <TerminalCopyButton aria-label={t('tools.shell.copy')} />
          </TerminalActions>
        </TerminalHeader>
        <TerminalContent className='max-h-none min-h-0 flex-1' />
      </Terminal>
      <footer className='shrink-0 text-xs text-muted-foreground'>
        {t('tools.shell.exitCode', { code: content.exit_code })}
      </footer>
    </div>
  );
}
