import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { AlertTriangle, ChevronRight, Info, Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import type { ExtractionLocation } from '../../types';

export interface Choice<T extends string> {
  value: T;
  label: string;
  /** A tile's picture. */
  icon?: ReactNode;
  /** A short example, e.g. “Label: value”, shown first in the tooltip. */
  hint?: string;
  /** What the choice does, shown in the tooltip. */
  help?: string;
}

const TOOLTIP = 'max-w-xs border bg-popover px-2.5 py-1.5 text-[11px] font-normal leading-snug text-popover-foreground shadow-md';

/** A small “i” showing help on hover, focus or click. Screen readers read the help as its name. */
export function HelpTip({ text, className }: Readonly<{ text: string; className?: string }>) {
  const [open, setOpen] = useState(false);
  return <TooltipProvider delayDuration={150}>
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button type='button' onClick={() => setOpen(true)}
          className={cn('inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}>
          <Info className='h-3.5 w-3.5' aria-hidden /><span className='sr-only'>{text}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side='top' className={TOOLTIP}>{text}</TooltipContent>
    </Tooltip>
  </TooltipProvider>;
}

/**
 * One step of a field's rules, folded to a line with its current setting. Its help sits behind an
 * “i”; a step with a problem stays open.
 */
export function RuleSection({ id, title, icon, summary, help, invalid, open, onToggle, children }: Readonly<{
  id: string;
  title: string;
  icon: ReactNode;
  summary?: ReactNode;
  help?: string;
  invalid?: boolean;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const shown = open || Boolean(invalid);
  return <section className='border-b last:border-b-0'>
    <div className='flex items-center gap-1 pr-1.5'>
      <button type='button' aria-expanded={shown} aria-controls={id} aria-label={title} aria-describedby={summary ? `${id}-summary` : undefined} onClick={onToggle}
        className='flex min-w-0 flex-1 items-center gap-1.5 px-2.5 py-1.5 text-left text-xs hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring'>
        <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', shown && 'rotate-90')} aria-hidden />
        <span className='flex shrink-0 text-muted-foreground' aria-hidden>{icon}</span>
        <span className='shrink-0 font-medium'>{title}</span>
        {summary && <span id={`${id}-summary`} className={cn('min-w-0 truncate text-[11px] text-muted-foreground', shown && 'sr-only')}>{summary}</span>}
        {invalid && <AlertTriangle className='ml-auto h-3.5 w-3.5 shrink-0 text-destructive' aria-label={t('mapping.rules.invalid')} />}
      </button>
      {help && <HelpTip text={help} />}
    </div>
    {shown && <div id={id} className='space-y-1.5 px-2.5 pb-2.5'>{children}</div>}
  </section>;
}

const SECTIONS_KEY = 'semantic-model.rule-sections';

/**
 * Which rule steps are open. Shared by every field and kept in this browser, so a step opened on
 * one field is open on the next.
 */
export function useOpenSections(defaults: readonly string[]) {
  const [open, setOpen] = useState<Set<string>>(() => {
    try {
      const saved: unknown = JSON.parse(globalThis.localStorage?.getItem(SECTIONS_KEY) ?? 'null');
      if (Array.isArray(saved)) return new Set(saved.filter((item): item is string => typeof item === 'string'));
    } catch { /* Not stored, or not readable: the defaults. */ }
    return new Set(defaults);
  });
  const toggle = (section: string) => setOpen((current) => {
    const next = new Set(current);
    if (next.has(section)) next.delete(section); else next.add(section);
    try { globalThis.localStorage?.setItem(SECTIONS_KEY, JSON.stringify([...next])); } catch { /* Kept for this editor only. */ }
    return next;
  });
  return { isOpen: (section: string) => open.has(section), toggle };
}

const VARIANTS = {
  segmented: {
    group: 'inline-flex rounded-md border bg-muted/40 p-0.5',
    item: 'h-6 rounded px-2.5 text-[11px] font-medium text-muted-foreground hover:text-foreground',
    checked: 'bg-background text-foreground shadow-sm',
  },
  chips: {
    group: 'flex flex-wrap gap-1.5',
    item: 'h-6 rounded-full border bg-background px-2.5 text-[11px] hover:border-primary/50 hover:bg-primary/5',
    checked: 'border-primary bg-primary/10 text-foreground ring-1 ring-primary',
  },
  tiles: {
    group: 'grid grid-cols-3 gap-1',
    item: 'flex h-9 items-center gap-1.5 rounded-md border bg-background px-1.5 text-left hover:border-primary/50 hover:bg-primary/5',
    checked: 'border-primary bg-primary/5 ring-1 ring-primary',
  },
} as const;

/**
 * One choice among a few, shown as a segmented control, chips or picture tiles. A radio group:
 * the arrow keys move the choice, and only the chosen one is in the tab order.
 */
export function ChoiceGroup<T extends string>({ label, value, options, onChange, variant, className }: Readonly<{
  label: string;
  value: T;
  options: Array<Choice<T>>;
  onChange: (value: T) => void;
  variant: keyof typeof VARIANTS;
  className?: string;
}>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const style = VARIANTS[variant];
  const current = Math.max(0, options.findIndex((option) => option.value === value));
  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const columns = variant === 'tiles' ? 3 : 1;
    const moves: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns, Home: -index, End: options.length - 1 - index };
    const move = moves[event.key];
    if (move === undefined) return;
    event.preventDefault();
    const next = (index + move + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };
  return <TooltipProvider delayDuration={300}><div role='radiogroup' aria-label={label} className={cn(style.group, className)}>
    {options.map((option, index) => {
      const checked = option.value === value;
      const button = <button key={option.value} ref={(element) => { refs.current[index] = element; }} type='button' role='radio' aria-checked={checked}
        aria-label={option.label} aria-description={option.help ?? option.hint} tabIndex={index === current ? 0 : -1}
        className={cn('transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', style.item, checked && style.checked)}
        onClick={() => onChange(option.value)} onKeyDown={(event) => onKeyDown(event, index)}>
        {option.icon}
        <span className={cn(variant === 'tiles' && 'min-w-0 text-[11px] font-medium leading-tight')}>{option.label}</span>
      </button>;
      if (!option.hint && !option.help) return button;
      return <Tooltip key={option.value}>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side='bottom' className={TOOLTIP}>
          {option.hint && <p className='font-medium'>{option.hint}</p>}
          {option.help && <p className={cn(option.hint && 'mt-0.5 text-muted-foreground')}>{option.help}</p>}
        </TooltipContent>
      </Tooltip>;
    })}
  </div></TooltipProvider>;
}

// Tiny pictures of where a value sits: faint lines of text, the label in grey, the value in the accent colour.
const TEXT = 'fill-muted-foreground/25';
const LABEL = 'fill-muted-foreground/70';
const VALUE = 'fill-primary/80';

export function LocationIcon({ location, className }: Readonly<{ location: ExtractionLocation; className?: string }>) {
  const lines = (rows: number[], from = 4) => rows.map((y) => <rect key={y} x={from} y={y} width={40 - from + 4} height={2.5} rx={1} className={TEXT} />);
  const pictures: Record<ExtractionLocation, ReactNode> = {
    auto: <>
      <rect x={4} y={5} width={12} height={4} rx={1} className={LABEL} /><rect x={19} y={5} width={16} height={4} rx={1} className={VALUE} />
      <rect x={4} y={14} width={40} height={13} rx={1.5} className='fill-none stroke-muted-foreground/40' strokeWidth={1} />
      <line x1={18} y1={14} x2={18} y2={27} className='stroke-muted-foreground/40' /><line x1={4} y1={20.5} x2={44} y2={20.5} className='stroke-muted-foreground/40' />
      <rect x={20} y={16} width={10} height={2.5} rx={1} className={VALUE} />
    </>,
    same_line: <>{lines([5, 23])}<rect x={4} y={13} width={14} height={4} rx={1} className={LABEL} /><rect x={21} y={13} width={20} height={4} rx={1} className={VALUE} /></>,
    next_line: <>{lines([24])}<rect x={4} y={5} width={16} height={4} rx={1} className={LABEL} /><rect x={4} y={13} width={26} height={4} rx={1} className={VALUE} /></>,
    table: <>
      <rect x={4} y={4} width={40} height={24} rx={1.5} className='fill-none stroke-muted-foreground/40' strokeWidth={1} />
      <line x1={20} y1={4} x2={20} y2={28} className='stroke-muted-foreground/40' /><line x1={4} y1={12} x2={44} y2={12} className='stroke-muted-foreground/40' /><line x1={4} y1={20} x2={44} y2={20} className='stroke-muted-foreground/40' />
      <rect x={7} y={14.5} width={10} height={3} rx={1} className={LABEL} /><rect x={23} y={14.5} width={16} height={3} rx={1} className={VALUE} />
    </>,
    heading: <><rect x={4} y={4} width={30} height={5} rx={1} className={VALUE} />{lines([14, 19, 24])}</>,
    after_label: <><rect x={4} y={3} width={16} height={4} rx={1} className={LABEL} />{[10, 15, 20].map((y) => <rect key={y} x={4} y={y} width={40} height={2.5} rx={1} className={VALUE} />)}
      <line x1={4} y1={26} x2={44} y2={26} strokeDasharray='2 2' className='stroke-muted-foreground/60' /></>,
    before_label: <><line x1={4} y1={4} x2={44} y2={4} strokeDasharray='2 2' className='stroke-muted-foreground/60' />{[8, 13, 18].map((y) => <rect key={y} x={4} y={y} width={40} height={2.5} rx={1} className={VALUE} />)}
      <rect x={4} y={24} width={16} height={4} rx={1} className={LABEL} /></>,
    pages: <>{[4, 17, 30].map((x, index) => <rect key={x} x={x} y={5} width={11} height={22} rx={1.5} className={index ? 'fill-primary/25 stroke-primary/80' : 'fill-none stroke-muted-foreground/40'} strokeWidth={1} />)}</>,
    anywhere: <>{lines([5, 11, 23])}<rect x={14} y={16} width={18} height={4} rx={1} className={VALUE} /><rect x={12} y={14.5} width={22} height={7} rx={2} className='fill-none stroke-primary/60' strokeDasharray='2 1.5' /></>,
  };
  return <svg viewBox='0 0 48 32' className={cn('h-7 w-11 shrink-0', className)} aria-hidden focusable='false'>{pictures[location]}</svg>;
}

/** A number box with − and + buttons. */
function Stepper({ label, value, min, max, placeholder, invalid, onChange }: Readonly<{
  label: string; value?: number; min: number; max: number; placeholder?: string; invalid?: boolean; onChange: (value: number | undefined) => void;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const step = (by: number) => onChange(Math.min(max, Math.max(min, (value || Number(placeholder) || min) + by)));
  return <div className='inline-flex items-center rounded-md border bg-background'>
    <Button type='button' size='icon' variant='ghost' className='h-7 w-7 rounded-r-none' aria-label={t('mapping.rules.stepDown', { label })} onClick={() => step(-1)}><Minus className='h-3 w-3' /></Button>
    <Input type='number' min={min} max={max} className='h-7 w-14 rounded-none border-0 px-1 text-center text-xs tabular-nums shadow-none focus-visible:ring-1' aria-label={label}
      aria-invalid={invalid} value={value || ''} placeholder={placeholder} onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))} />
    <Button type='button' size='icon' variant='ghost' className='h-7 w-7 rounded-l-none' aria-label={t('mapping.rules.stepUp', { label })} onClick={() => step(1)}><Plus className='h-3 w-3' /></Button>
  </div>;
}

// A strip with one box per page is drawn up to this many pages.
const STRIP_PAGES = 60;

/** The pages read whole: two steppers and a strip of the pages, the chosen ones in the accent colour. */
export function PageRangeControl({ fieldLabel, from, to, pageCount, invalidFrom, invalidTo, onChange }: Readonly<{
  fieldLabel: string;
  from?: number;
  to?: number;
  /** The shown document's pages, when the viewer knows them. */
  pageCount?: number;
  invalidFrom?: boolean;
  invalidTo?: boolean;
  onChange: (from: number | undefined, to: number | undefined) => void;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const max = pageCount && pageCount > 0 ? pageCount : 2000;
  const last = to ?? from ?? 1;
  const stripLength = pageCount && pageCount <= STRIP_PAGES ? pageCount : Math.min(STRIP_PAGES, Math.max(last, from ?? 1) + 2);
  // A click before the range moves its start; after it, its end; inside it, makes it end there.
  const pick = (page: number) => {
    if (!from || page < from) onChange(page, to ?? from);
    else onChange(from, page === from ? undefined : page);
  };
  return <div className='space-y-1.5'>
    <div className='flex flex-wrap items-center gap-2'>
      <Stepper label={t('mapping.rules.pagesFrom', { field: fieldLabel })} value={from} min={1} max={max} placeholder='1' invalid={invalidFrom} onChange={(value) => onChange(value ?? 0, to)} />
      <span className='text-xs text-muted-foreground'>{t('mapping.rules.pagesTo')}</span>
      <Stepper label={t('mapping.rules.pagesToFor', { field: fieldLabel })} value={to} min={1} max={max} placeholder={String(from || 1)} invalid={invalidTo} onChange={(value) => onChange(from, value)} />
      {pageCount ? <span className='text-[11px] text-muted-foreground'>{t('mapping.rules.pagesOf', { count: pageCount })}</span> : null}
    </div>
    <div className='flex flex-wrap items-end gap-0.5' role='group' aria-label={t('mapping.rules.pagesStrip')}>
      {Array.from({ length: stripLength }, (_, index) => index + 1).map((page) => {
        const chosen = Boolean(from) && page >= from! && page <= last;
        return <button key={page} type='button' tabIndex={-1} aria-hidden title={t('mapping.reading.page', { page })} onClick={() => pick(page)}
          className={cn('h-5 w-3.5 rounded-[2px] border transition-colors', chosen ? 'border-primary bg-primary/30' : 'border-muted-foreground/30 bg-background hover:border-primary/60')} />;
      })}
      {(!pageCount || pageCount > STRIP_PAGES) && <span className='ml-1 text-[10px] text-muted-foreground'>…</span>}
    </div>
  </div>;
}
