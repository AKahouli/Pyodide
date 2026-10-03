import type { ComponentType } from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { HelpTip } from '../mapping/RuleControls';

export interface PaletteItem {
  key: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  hint: string;
  onClick: () => void;
}

const TOOLTIP = 'max-w-[15rem] border bg-popover px-2.5 py-1.5 text-popover-foreground shadow-md';
/** Sources and typed records bring data in; the rest shape the model. */
const DATA_ITEMS = new Set(['source', 'typed']);

/**
 * What can be added to the canvas, as a slim bar floating over its top-left corner: one icon each, the name
 * and what it does in a tooltip. The canvas, and the records table under it, keep the full width.
 */
export function CanvasPalette({ title, help, items }: Readonly<{ title: string; help: string; items: PaletteItem[] }>) {
  return <TooltipProvider delayDuration={150}>
    <nav aria-label={title} className='absolute left-3 top-3 z-10 flex flex-col items-center gap-0.5 rounded-xl border bg-background/95 p-1 shadow-lg backdrop-blur'>
      {items.map((item, index) => <div key={item.key} className='contents'>
        {/* A thin line between what brings data in and what shapes the model. */}
        {index > 0 && DATA_ITEMS.has(items[index - 1].key) && !DATA_ITEMS.has(item.key) && <span className='my-0.5 h-px w-5 bg-border' aria-hidden />}
        <Tooltip>
          <TooltipTrigger asChild>
            <button type='button' onClick={item.onClick} aria-label={item.label}
              className={cn('flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                DATA_ITEMS.has(item.key) ? 'text-teal-600 dark:text-teal-400' : 'text-primary')}>
              <item.icon className='h-[18px] w-[18px]' />
            </button>
          </TooltipTrigger>
          <TooltipContent side='right' className={TOOLTIP}>
            <p className='text-xs font-semibold'>{item.label}</p>
            <p className='mt-0.5 text-[11px] leading-snug text-muted-foreground'>{item.hint}</p>
          </TooltipContent>
        </Tooltip>
      </div>)}
      <span className='my-0.5 h-px w-5 bg-border' aria-hidden />
      <HelpTip text={help} className='h-7 w-7' />
    </nav>
  </TooltipProvider>;
}
