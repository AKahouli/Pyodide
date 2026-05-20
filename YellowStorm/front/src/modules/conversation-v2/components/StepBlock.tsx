import { useState } from 'react';
import { CheckIcon, ChevronDownIcon, CircleIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ToolCallCard } from './ToolCallCard';
import type { AgentEvent } from '../types';

type StepEvent = Extract<AgentEvent, { type: 'step' }>;
type ToolEvent = Extract<AgentEvent, { type: 'tool' }>;

interface StepBlockProps {
  step: StepEvent;
  tools: ToolEvent[];
}

export function StepBlock({ step, tools }: StepBlockProps) {
  const [open, setOpen] = useState(true);
  const isCompleted = step.status === 'completed';

  return (
    <div className='my-2 flex flex-col'>
      <button
        type='button'
        onClick={() => setOpen((v) => !v)}
        className='group/step inline-flex items-center gap-2 truncate text-left text-sm text-foreground'
      >
        <span
          className={cn(
            'flex size-4 shrink-0 items-center justify-center rounded-full border',
            isCompleted ? 'border-transparent bg-muted-foreground/70' : 'border-muted-foreground/60',
          )}
        >
          {isCompleted ? (
            <CheckIcon className='size-2.5 text-background' />
          ) : (
            <CircleIcon className='size-2 text-muted-foreground/40' />
          )}
        </span>
        <span className='truncate font-medium'>{step.description}</span>
        <ChevronDownIcon
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>
      {tools.length > 0 && (
        <div className='flex'>
          <div className='w-6 shrink-0 self-stretch'>
            <div className='ml-2 h-full border-l border-dashed border-muted-foreground/30' />
          </div>
          <div
            className={cn(
              'flex min-w-0 flex-1 flex-col gap-1 overflow-hidden pt-2 transition-[max-height,opacity] duration-150 ease-in-out',
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
