'use client';

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { BotIcon, ChevronDownIcon, SearchIcon } from 'lucide-react';
import type { ComponentProps } from 'react';

export type TaskItemFileProps = ComponentProps<'div'>;

export const TaskItemFile = ({ children, className, ...props }: TaskItemFileProps) => (
  <div className={cn('inline-flex items-center gap-1 rounded-md border bg-secondary px-1.5 py-0.5 text-foreground text-xs', className)} {...props}>
    {children}
  </div>
);

export type TaskItemProps = ComponentProps<'div'>;

export const TaskItem = ({ children, className, ...props }: TaskItemProps) => (
  <div className={cn('text-muted-foreground text-sm', className)} {...props}>
    {children}
  </div>
);

export type TaskProps = ComponentProps<typeof Collapsible>;

export const Task = ({ defaultOpen = true, className, ...props }: TaskProps) => <Collapsible className={cn(className)} defaultOpen={defaultOpen} {...props} />;

export type TaskTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
  title: string;
  active?: boolean;
};

export const TaskTrigger = ({ children, className, title, active = false, ...props }: TaskTriggerProps) => (
  <CollapsibleTrigger asChild className={cn('group', className)} {...props}>
    {children ?? (
      <button type='button' data-active={active || undefined} className={cn('flex w-full cursor-pointer items-center gap-2 overflow-hidden text-sm text-muted-foreground transition-colors hover:text-foreground', active && 'text-foreground')}>
        <span className='relative flex size-8 shrink-0 items-center justify-center' aria-hidden='true'>
          {active && <span className='absolute inset-0 animate-ping rounded-lg bg-primary/15 [animation-duration:2s] motion-reduce:animate-none' />}
          <BotIcon className={cn('relative size-6 transition-colors', active && 'animate-pulse text-primary motion-reduce:animate-none')} />
        </span>
        <span className='text-md shrink-0 font-medium'>{title}</span>
        <ChevronDownIcon className='size-4 shrink-0 transition-transform group-data-[state=open]:rotate-180' />
        <span className='relative h-px min-w-8 flex-1 overflow-hidden bg-border' aria-hidden='true'>
          {active && <span className='absolute inset-y-0 left-0 w-1/3 animate-agent-scan bg-gradient-to-r from-transparent via-primary to-transparent motion-reduce:animate-none' />}
        </span>
      </button>
    )}
  </CollapsibleTrigger>
);

export type TaskContentProps = ComponentProps<typeof CollapsibleContent>;

export const TaskContent = ({ children, className, ...props }: TaskContentProps) => (
  <CollapsibleContent className={cn('data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in', className)} {...props}>
    <div className='mt-4 space-y-2 border-muted border-l-2 pl-4'>{children}</div>
  </CollapsibleContent>
);

export type TaskDiagnosticsTriggerProps = ComponentProps<'button'>;

export const TaskDiagnosticsTrigger = ({ className, ...props }: TaskDiagnosticsTriggerProps) => (
  <button type='button' className={cn('flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', className)} {...props}>
    <SearchIcon className='size-4' aria-hidden='true' />
  </button>
);
