import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { PlaybookTask, ValidatedTaskReplay } from '../types';
import { ReplayBaselineSettingsDialog } from './ReplayBaselineSettingsDialog';

interface BaselineBadgePopoverProps {
  task: PlaybookTask;
  playbookId: string;
  replay: ValidatedTaskReplay | null;
  toneClassName: string;
  badgeLabel: string;
  isBusy: boolean;
  iterationIndex?: number;
  onOpenOutputFormatEditor?: (taskId: string) => Promise<void> | void;
}

export function BaselineBadgePopover({
  task,
  playbookId,
  replay,
  toneClassName,
  badgeLabel,
  isBusy,
  iterationIndex,
  onOpenOutputFormatEditor,
}: BaselineBadgePopoverProps) {
  const [open, setOpen] = useState(false);

  const displayLabel = iterationIndex != null ? `${badgeLabel} #${iterationIndex + 1}` : badgeLabel;
  const title = replay?.intentKey
    ? `${displayLabel} (${replay.intentKey}, v${replay.validationVersion})`
    : displayLabel;

  if (!replay?.id) {
    return <span title={title} className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium', toneClassName)}>{displayLabel}</span>;
  }

  return (
    <>
      <button
        type="button"
        className={cn(
          'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium',
          'cursor-pointer transition-opacity hover:opacity-90',
          toneClassName,
        )}
        title={title}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        {isBusy && <span className="h-2.5 w-2.5 animate-spin border-2 border-current border-t-transparent rounded-full" />}
        <span>{displayLabel}</span>
      </button>
      <ReplayBaselineSettingsDialog
        open={open}
        onOpenChange={setOpen}
        playbookId={playbookId}
        task={task}
        replay={replay}
        replayId={replay.id}
        onOpenOutputFormatEditor={onOpenOutputFormatEditor}
        defaultTab="overview"
      />
    </>
  );
}
