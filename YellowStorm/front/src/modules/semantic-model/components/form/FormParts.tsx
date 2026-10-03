import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { HelpTip } from '../mapping/RuleControls';

/**
 * The building blocks every form of the model editor shares, so they read alike: a title with its
 * explanation behind an “i”, a small label over each input, inputs of one size, and room between parts.
 */

export { HelpTip };

/** Room above each part of a form, with a line. */
export const FORM_SECTION = 'space-y-3 border-t pt-6';
/** One line of input: text, select trigger. */
export const INPUT = 'h-9 text-sm';
/** A compact input inside a row or a table. */
export const INPUT_COMPACT = 'h-8 text-sm';
/** A text area that grows by hand. */
export const TEXTAREA = 'min-h-[4.5rem] resize-y text-sm';
/** A quiet button that deletes something. */
export const DELETE_BUTTON = 'border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive';
/** A list of rows in one bordered box. */
export const ROW_LIST = 'divide-y rounded-lg border';

/** A part's title, with what it is for behind an “i” rather than spelled out under it. */
export function SectionHeader({ title, help, count, icon, children, className }: Readonly<{
  title: ReactNode; help?: string; count?: number; icon?: ReactNode; children?: ReactNode; className?: string;
}>) {
  return <div className={cn('flex min-h-7 items-center gap-1', className)}>
    {icon}
    <h3 className='text-sm font-semibold'>{title}</h3>
    {count !== undefined && <span className='rounded-full bg-muted px-1.5 text-[11px] font-medium tabular-nums text-muted-foreground'>{count}</span>}
    {help && <HelpTip text={help} />}
    {children && <div className='ml-auto flex items-center gap-1'>{children}</div>}
  </div>;
}

/** A small label over its input, its explanation behind an “i”. */
export function FormField({ label, help, htmlFor, children, className }: Readonly<{
  label: ReactNode; help?: string; htmlFor?: string; children: ReactNode; className?: string;
}>) {
  return <div className={cn('space-y-1.5', className)}>
    <div className='flex items-center gap-1'>
      <Label htmlFor={htmlFor} className='text-xs font-medium text-muted-foreground'>{label}</Label>
      {help && <HelpTip text={help} />}
    </div>
    {children}
  </div>;
}

/** A folded part (advanced settings): a chevron that turns when open. */
export function FoldedSection({ title, children, defaultOpen }: Readonly<{ title: ReactNode; children: ReactNode; defaultOpen?: boolean }>) {
  return <details className='group border-t pt-6' open={defaultOpen}>
    <summary className='flex cursor-pointer list-none items-center gap-1 text-sm font-semibold [&::-webkit-details-marker]:hidden'>
      <ChevronRight className='h-4 w-4 text-muted-foreground transition-transform group-open:rotate-90' aria-hidden />{title}
    </summary>
    <div className='mt-4 space-y-4'>{children}</div>
  </details>;
}
