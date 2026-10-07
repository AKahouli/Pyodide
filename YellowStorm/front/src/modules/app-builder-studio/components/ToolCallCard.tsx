import { CheckIcon, Loader2Icon, TriangleIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFileViewerStore } from '@/modules/file-viewer';
import { useAppBuilderStudioStore } from '../store';
import { useAppBuilderStudioTranslation } from '../translation';
import { resolveToolInfo } from '../utils/tool-info';
import { ACTIVITY_TONE_CLASS, classifyStatus, type ActivityStatus } from '../utils/activity-status';
import type { AgentEvent } from '../types';

type ToolEvent = Extract<AgentEvent, { type: 'tool' }>;

/** Small status glyph so a running tool is visibly different from a finished one. */
function StatusGlyph({ status }: { status: ActivityStatus }) {
  if (status === 'running') {
    return <Loader2Icon className='size-3 shrink-0 animate-spin motion-reduce:animate-none' aria-hidden />;
  }
  if (status === 'success') {
    return <CheckIcon className='size-3 shrink-0' aria-hidden />;
  }
  if (status === 'error') {
    return <TriangleIcon className='size-3 shrink-0' aria-hidden />;
  }
  return null;
}

export function ToolCallCard({ event }: { event: ToolEvent }) {
  const openToolPanel = useAppBuilderStudioStore((s) => s.openToolPanel);
  const selectedToolCallId = useAppBuilderStudioStore((s) => s.selectedToolCallId);
  const closeFileViewer = useFileViewerStore((s) => s.closeViewer);
  const { t } = useAppBuilderStudioTranslation();
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
  const activity = classifyStatus(event.status);
  const statusLabel = activity === 'running'
    ? t('tool.running')
    : activity === 'error'
      ? t('tool.error')
      : activity === 'success'
        ? t('tool.success')
        : t('tool.pending');

  return (
    <button
      type='button'
      onClick={() => {
        // Mutually exclusive with the file viewer sidebar — both occupy the
        // right side and collide otherwise.
        closeFileViewer();
        openToolPanel(event.tool_call_id);
      }}
      aria-label={`${info.functionLabel} — ${statusLabel}`}
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
      <span
        className={cn(
          'ml-0.5 inline-flex items-center gap-1 border-l pl-1.5 text-[11px] font-medium',
          ACTIVITY_TONE_CLASS[activity],
        )}
      >
        <StatusGlyph status={activity} />
        <span className='sr-only'>{statusLabel}</span>
      </span>
    </button>
  );
}
