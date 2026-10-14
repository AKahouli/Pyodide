import { useState, type ReactNode } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { HelpTip } from '../form/FormParts';

export const OPEN_KEY = 'semantic-model.settings-open';

/** Which panes are open, remembered per browser under ``key``. */
export function readOpen(key = OPEN_KEY): Record<string, boolean> {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? '{}') as unknown;
    return value && typeof value === 'object' ? value as Record<string, boolean> : {};
  } catch {
    return {};
  }
}

export function writeOpen(key: string, open: Record<string, boolean>) {
  try {
    localStorage.setItem(key, JSON.stringify(open));
  } catch {
    // Remembering is a convenience only.
  }
}

/**
 * One folded group of settings, so a long form reads as a list of topics: Admin > Semantic models,
 * the parts of a rule editor. Which panes are open is remembered per browser, unless the form
 * holds that itself (``open`` and ``onOpenChange``).
 */
export function SettingsPane({ id, title, help, icon, summary, attention, open: controlled, onOpenChange, className, children }: Readonly<{
  id: string;
  title: ReactNode;
  help?: string;
  icon?: ReactNode;
  /** One line shown beside the title, e.g. the values in force. */
  summary?: ReactNode;
  /** Something in the pane needs fixing: marked on the title, so it shows while folded. */
  attention?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  children: ReactNode;
}>) {
  const [remembered, setRemembered] = useState(() => readOpen()[id] ?? false);
  const open = controlled ?? remembered;
  const toggle = () => {
    const next = !open;
    if (onOpenChange) {
      onOpenChange(next);
      return;
    }
    setRemembered(next);
    writeOpen(OPEN_KEY, { ...readOpen(), [id]: next });
  };
  return <section className={cn('rounded-lg border bg-card', className)} aria-label={typeof title === 'string' ? title : undefined}>
    <div className='flex items-center gap-1 pe-3'>
      <button type='button' className='flex min-w-0 flex-1 items-center gap-2 px-4 py-3 text-start hover:bg-muted/40'
        aria-expanded={open} aria-controls={`settings-pane-${id}`} onClick={toggle}>
        {open ? <ChevronDown className='h-4 w-4 shrink-0 text-muted-foreground' /> : <ChevronRight className='h-4 w-4 shrink-0 text-muted-foreground' />}
        {icon}
        <h3 className='shrink-0 text-sm font-semibold'>{title}</h3>
        {attention && <AlertTriangle className='h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400' aria-hidden />}
        {summary && <span className={cn('min-w-0 flex-1 truncate text-xs', attention ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground')}>{summary}</span>}
      </button>
      {help && <HelpTip text={help} />}
    </div>
    {open && <div id={`settings-pane-${id}`} className='space-y-4 border-t p-4'>{children}</div>}
  </section>;
}
