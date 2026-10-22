import { useId, useState } from 'react';
import { CheckIcon, ChevronDownIcon, Loader2Icon, TriangleIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ToolCallCard } from './ToolCallCard';
import { ACTIVITY_TONE_CLASS, classifyStatus, type ActivityStatus } from '../utils/activity-status';
import type { AgentEvent } from '../types';

type StepEvent = Extract<AgentEvent, { type: 'step' }>;
type ToolEvent = Extract<AgentEvent, { type: 'tool' }>;

interface StepBlockProps {
  step: StepEvent;
  tools: ToolEvent[];
}

function StepGlyph({ status }: { status: ActivityStatus }) {
  if (status === 'running') {
    return <Loader2Icon className='size-2.5 animate-spin motion-reduce:animate-none' aria-hidden />;
  }
  if (status === 'success') {
    return <CheckIcon className='size-2.5' aria-hidden />;
  }
  if (status === 'error') {
    return <TriangleIcon className='size-2.5' aria-hidden />;
  }
  return <span className='size-1.5 rounded-full bg-current opacity-60' aria-hidden />;
}

export function StepBlock({ step, tools }: StepBlockProps) {
  const [open, setOpen] = useState(true);
  const panelId = useId();
  const activity = classifyStatus(step.status);
  const isCompleted = activity === 'success';

  return (
    <div className='my-2 flex flex-col'>
      <button
        type='button'
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className={cn(
          'group/step inline-flex items-center gap-2 truncate text-start text-sm transition-colors',
          activity === 'error' ? 'text-fail' : 'text-foreground',
        )}
      >
        <span
          className={cn(
            'flex size-4 shrink-0 items-center justify-center rounded-full border',
            isCompleted
              ? 'border-transparent bg-muted-foreground/70 text-background'
              : ACTIVITY_TONE_CLASS[activity],
          )}
        >
          <StepGlyph status={activity} />
        </span>
        <span className='truncate font-medium'>{step.description}</span>
        <ChevronDownIcon
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none',
            open && 'rotate-180',
          )}
        />
      </button>
      {tools.length > 0 && (
        <div className='flex'>
          <div className='w-6 shrink-0 self-stretch'>
            <div className='ms-2 h-full border-l border-dashed border-muted-foreground/30' />
          </div>
          <div
            id={panelId}
            className={cn(
              'flex min-w-0 flex-1 flex-col gap-1 overflow-hidden pt-2 transition-[max-height,opacity] duration-150 ease-in-out motion-reduce:transition-none',
              open ? 'max-h-[100000px] opacity-100' : 'max-h-0 opacity-0',
            )}
          >
            {tools.map((tool) => (
              <ToolCallCard key={tool.tool_call_id} event={tool} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
