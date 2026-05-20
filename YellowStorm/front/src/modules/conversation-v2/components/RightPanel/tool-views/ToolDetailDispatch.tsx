import { useShallow } from 'zustand/react/shallow';
import { useConversationV2Store } from '../../../store';
import { useConversationV2Translation } from '../../../translation';
import { resolveToolInfo } from '../../../utils/tool-info';
import type { AgentEvent } from '../../../types';
import { BrowserToolView } from './BrowserToolView';
import { ShellToolView } from './ShellToolView';
import { FileToolView } from './FileToolView';
import { SearchToolView } from './SearchToolView';
import { McpToolView } from './McpToolView';
import { GenericToolView } from './GenericToolView';

type ToolEvent = Extract<AgentEvent, { type: 'tool' }>;

export function ToolDetailDispatch() {
  const { t } = useConversationV2Translation();
  const { event, isLive } = useConversationV2Store(
    useShallow((s) => {
      const id = s.selectedToolCallId;
      const found = id ? (s.events.find((e) => e.type === 'tool' && e.tool_call_id === id) ?? null) : null;
      return {
        event: found,
        isLive: !!id && id === s.liveToolCallId && s.streaming,
      };
    }),
  );

  if (!event || event.type !== 'tool') {
    return <div className='text-sm text-muted-foreground'>{t('rightPanel.empty')}</div>;
  }

  const info = resolveToolInfo(event.name, event.function, event.args);

  return (
    <div className='flex h-full min-h-0 flex-col gap-3'>
      <header className='flex items-center gap-2'>
        <div className='flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted'>
          <info.Icon className='size-5 text-foreground' />
        </div>
        <div className='flex min-w-0 flex-1 flex-col gap-1'>
          <div className='text-xs text-muted-foreground'>
            {t('rightPanel.subtitle')} <span className='text-foreground'>{info.groupLabel}</span>
          </div>
          <div className='inline-flex max-w-full items-center gap-1.5 self-start truncate rounded-full border bg-card px-2.5 py-1 text-xs text-muted-foreground'>
            <span className='truncate'>{info.functionLabel}</span>
            {info.functionArg && (
              <code className='truncate rounded bg-muted px-1 font-mono text-[11px] text-foreground/80'>
                {info.functionArg}
              </code>
            )}
          </div>
        </div>
      </header>
      <div className='flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card/40'>
        <ToolBody event={event} isLive={isLive} />
      </div>
    </div>
  );
}

function ToolBody({ event, isLive }: { event: ToolEvent; isLive: boolean }) {
  const content = event.content;

  // When a browser tool is live but its content hasn't arrived yet (CALLING state),
  // still mount BrowserToolView so the VNC session stays alive and doesn't disconnect
  // between consecutive browser actions.
  if (!content) {
    if (event.name === 'browser') {
      return <BrowserToolView content={{ kind: 'browser', screenshot_url: '', url: event.args?.url as string }} isLive={isLive} />;
    }
    return <GenericToolView content={{ kind: 'generic', data: event.args }} />;
  }
  switch (content.kind) {
    case 'browser':
      return <BrowserToolView content={content} isLive={isLive} />;
    case 'shell':
      return <ShellToolView content={content} />;
    case 'file':
      return <FileToolView content={content} />;
    case 'search':
      return <SearchToolView content={content} />;
    case 'mcp':
      return <McpToolView content={content} />;
    case 'generic':
      return <GenericToolView content={content} />;
    default:
      return <GenericToolView content={{ kind: 'generic', data: event.args }} />;
  }
}
