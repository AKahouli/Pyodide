import { cn } from '@/lib/utils';
import { useFileViewerStore } from '@/modules/file-viewer';
import { useConversationV2Store } from '../store';
import { useConversationV2Translation } from '../translation';
import { resolveToolInfo } from '../utils/tool-info';
import type { AgentEvent } from '../types';

type ToolEvent = Extract<AgentEvent, { type: 'tool' }>;

export function ToolCallCard({ event }: { event: ToolEvent }) {
  const openToolPanel = useConversationV2Store((s) => s.openToolPanel);
  const selectedToolCallId = useConversationV2Store((s) => s.selectedToolCallId);
  const closeFileViewer = useFileViewerStore((s) => s.closeViewer);
  const { t } = useConversationV2Translation();
  const info = resolveToolInfo(event.name, event.function, event.args);

  // `message_notify_user` / `message_ask_user` is rendered as a plain
  // paragraph in the conversation (no pill, no panel) — that's how Manus
  // surfaces agent commentary.
  if (info.isMessageTool) {
    const text = typeof event.args?.text === 'string' ? event.args.text : '';
    if (!text) return null;
    return (
      <p className='my-1 whitespace-pre-line text-sm text-muted-foreground'>{text}</p>
    );
  }

  const isActive = selectedToolCallId === event.tool_call_id;
  return (
    <button
      type='button'
      onClick={() => {
        // Mutually exclusive with the file viewer sidebar — both occupy the
        // right side and collide otherwise.
        closeFileViewer();
        openToolPanel(event.tool_call_id);
      }}
      aria-label={t('tool.openDetails')}
      className={cn(
        'group/tool not-prose my-1 inline-flex max-w-full items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-left transition-colors hover:bg-accent/40',
        isActive && 'border-primary/60 bg-accent/30',
      )}
    >
      <info.Icon className='size-3.5 shrink-0 text-foreground' />
      <span className='truncate text-xs text-muted-foreground'>{info.functionLabel}</span>
      {info.functionArg && (
        <code className='truncate rounded bg-muted px-1 font-mono text-[11px] text-foreground/80'>
          {info.functionArg}
        </code>
      )}
    </button>
  );
}
