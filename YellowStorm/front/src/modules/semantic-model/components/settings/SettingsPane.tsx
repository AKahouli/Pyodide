import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { HelpTip } from '../form/FormParts';

export const OPEN_KEY = 'semantic-model.settings-open';

function readOpen(): Record<string, boolean> {
  try {
    const value = JSON.parse(localStorage.getItem(OPEN_KEY) ?? '{}') as unknown;
    return value && typeof value === 'object' ? value as Record<string, boolean> : {};
  } catch {
    return {};
  }
}

/**
 * One group of Admin > Semantic models settings, folded by default so the page reads as a list of
 * topics. Which panes are open is remembered per browser.
 */
export function SettingsPane({ id, title, help, icon, summary, children }: Readonly<{
  id: string;
  title: ReactNode;
  help?: string;
  icon?: ReactNode;
  /** One line shown beside the title, e.g. the values in force. */
  summary?: ReactNode;
  children: ReactNode;
}>) {
  const [open, setOpen] = useState(() => readOpen()[id] ?? false);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify({ ...readOpen(), [id]: next }));
    } catch {
      // Remembering is a convenience only.
    }
  };
  return <section className='rounded-lg border bg-card'>
    <div className='flex items-center gap-1 pr-3'>
      <button type='button' className='flex min-w-0 flex-1 items-center gap-2 px-4 py-3 text-left hover:bg-muted/40'
        aria-expanded={open} aria-controls={`settings-pane-${id}`} onClick={toggle}>
        {open ? <ChevronDown className='h-4 w-4 shrink-0 text-muted-foreground' /> : <ChevronRight className='h-4 w-4 shrink-0 text-muted-foreground' />}
        {icon}
        <h3 className='shrink-0 text-sm font-semibold'>{title}</h3>
        {summary && <span className='min-w-0 flex-1 truncate text-xs text-muted-foreground'>{summary}</span>}
      </button>
      {help && <HelpTip text={help} />}
    </div>
    {open && <div id={`settings-pane-${id}`} className='space-y-4 border-t p-4'>{children}</div>}
  </section>;
}
