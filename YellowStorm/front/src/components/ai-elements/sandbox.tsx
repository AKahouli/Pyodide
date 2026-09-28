'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { ChevronDownIcon, Code, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import type { ComponentProps } from 'react';
import { CollapsibleTrigger, Collapsible, CollapsibleContent } from '../ui/collapsible';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';

// Tool invocation states (previously ToolUIPart['state'] from the 'ai' package).
type ToolUIPartState = 'input-streaming' | 'input-available' | 'output-available' | 'output-error';

/**
 * Extended state type that includes error state and legacy states for sandbox execution.
 */
export type SandboxState = ToolUIPartState | 'error' | 'partial-call' | 'call' | 'result';

/**
 * Returns a status badge based on the sandbox state.
 * States: "partial-call" | "call" | "result" | "error" and ToolUIPart states
 */
type SandboxStatusKey = 'sandbox.status.executing' | 'sandbox.status.completed' | 'sandbox.status.error';

function renderStatusBadge(state: SandboxState, translate: (key: SandboxStatusKey) => string) {
  switch (state) {
    case 'partial-call':
    case 'call':
    case 'input-streaming':
    case 'input-available':
      return (
        <span className='flex items-center gap-1.5 text-xs text-muted-foreground'>
          <Loader2 className='h-3 w-3 animate-spin' />
          {translate('sandbox.status.executing')}
        </span>
      );
    case 'result':
    case 'output-available':
      return (
        <span className='flex items-center gap-1.5 text-xs text-green-600 dark:text-green-500'>
          <CheckCircle2 className='h-3 w-3' />
          {translate('sandbox.status.completed')}
        </span>
      );
    case 'error':
    case 'output-error':
      return (
        <span className='flex items-center gap-1.5 text-xs text-destructive'>
          <XCircle className='h-3 w-3' />
          {translate('sandbox.status.error')}
        </span>
      );
    default:
      return null;
  }
}

export type SandboxRootProps = ComponentProps<typeof Collapsible>;

export const Sandbox = ({ className, ...props }: SandboxRootProps) => <Collapsible className={cn('not-prose group mb-4 w-full overflow-hidden rounded-md border', className)} defaultOpen={false} {...props} />;

export interface SandboxHeaderProps {
  title?: string;
  state: SandboxState;
  className?: string;
}

export const SandboxHeader = ({ className, title, state, ...props }: SandboxHeaderProps) => {
  const { t: tCommon } = useModuleTranslation('common');
  return (
    <CollapsibleTrigger className={cn('flex w-full items-center justify-between gap-4 p-3', className)} {...props}>
      <div className='flex items-center gap-2'>
        <Code className='size-4 text-muted-foreground' />
        <span className='font-medium text-sm'>{title}</span>
        {renderStatusBadge(state, tCommon)}
      </div>
      <ChevronDownIcon className='size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180' />
    </CollapsibleTrigger>
  );
};

export type SandboxContentProps = ComponentProps<typeof CollapsibleContent>;

export const SandboxContent = ({ className, ...props }: SandboxContentProps) => <CollapsibleContent className={cn('data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 outline-none data-[state=closed]:animate-out data-[state=open]:animate-in', className)} {...props} />;

export type SandboxTabsProps = ComponentProps<typeof Tabs>;

export const SandboxTabs = ({ className, ...props }: SandboxTabsProps) => <Tabs className={cn('w-full gap-0', className)} {...props} />;

export type SandboxTabsBarProps = ComponentProps<'div'>;

export const SandboxTabsBar = ({ className, ...props }: SandboxTabsBarProps) => <div className={cn('flex w-full items-center border-border border-t border-b', className)} {...props} />;

export type SandboxTabsListProps = ComponentProps<typeof TabsList>;

export const SandboxTabsList = ({ className, ...props }: SandboxTabsListProps) => <TabsList className={cn('h-auto rounded-none border-0 bg-transparent p-0', className)} {...props} />;

export type SandboxTabsTriggerProps = ComponentProps<typeof TabsTrigger>;

export const SandboxTabsTrigger = ({ className, ...props }: SandboxTabsTriggerProps) => <TabsTrigger className={cn('rounded-none border-0 border-transparent border-b-2 px-4 py-2 font-medium text-muted-foreground text-sm transition-colors data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none', className)} {...props} />;

export type SandboxTabContentProps = ComponentProps<typeof TabsContent>;

export const SandboxTabContent = ({ className, ...props }: SandboxTabContentProps) => <TabsContent className={cn('mt-0 text-sm', className)} {...props} />;
