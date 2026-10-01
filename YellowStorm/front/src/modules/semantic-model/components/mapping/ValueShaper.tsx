import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { BookOpen, Loader2, Ruler, Scissors, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import type { DocumentFieldReading, ExtractionLocation, ExtractionTake, ExtractionTakeUnit } from '../../types';
import { ChoiceGroup } from './RuleControls';

export const TAKE_UNITS: ExtractionTakeUnit[] = ['characters', 'words', 'lines'];
export const MAX_TAKE = 20000;
// Without a text to measure, the slider still reaches a useful length.
const DEFAULT_SLIDER_MAX = 200;
const MAX_MATCHES = 50;

type Span = [start: number, end: number];

/** Where each character, word or line of `raw` starts and ends. */
export function unitSpans(raw: string, unit: ExtractionTakeUnit): Span[] {
  if (unit === 'characters') return Array.from({ length: raw.length }, (_, index) => [index, index + 1]);
  if (unit === 'words') return [...raw.matchAll(/\S+/g)].map((match) => [match.index, match.index + match[0].length]);
  const spans: Span[] = [];
  let start = 0;
  for (const line of raw.split('\n')) {
    spans.push([start, start + line.replace(/\r$/, '').length]);
    start += line.length + 1;
  }
  return spans;
}

/** The part of `raw` a take keeps, as [start, end) offsets; everything without one. */
export function keptRange(raw: string, take?: ExtractionTake): Span {
  if (!take) return [0, raw.length];
  const spans = unitSpans(raw, take.unit);
  if (!spans.length || take.count >= spans.length) return [0, raw.length];
  const count = Math.max(1, take.count);
  return take.from === 'start' ? [0, spans[count - 1][1]] : [spans[spans.length - count][0], raw.length];
}

/**
 * How many units to keep for a cut at `offset`: from the start, every unit beginning before it
 * (so a click inside a word keeps that word); from the end, every unit ending after it.
 */
export function countForCut(raw: string, offset: number, from: ExtractionTake['from'], unit: ExtractionTakeUnit) {
  const spans = unitSpans(raw, unit);
  const count = from === 'start' ? spans.filter(([start]) => start < offset).length : spans.filter(([, end]) => end > offset).length;
  return Math.min(MAX_TAKE, Math.max(1, count));
}

/** Pattern matches in the kept text, best effort: a pattern the browser cannot read shows none. */
export function patternMatches(text: string, pattern?: string): Span[] {
  if (!pattern?.trim()) return [];
  try {
    const matches: Span[] = [];
    for (const match of text.matchAll(new RegExp(pattern, 'gu'))) {
      if (match[0].length) matches.push([match.index, match.index + match[0].length]);
      if (matches.length >= MAX_MATCHES) break;
    }
    return matches;
  } catch {
    return [];
  }
}

/** Offset of a DOM position inside the raw text box, counted in characters of the text. */
function textOffset(container: HTMLElement, node: Node, offset: number) {
  const range = document.createRange();
  range.selectNodeContents(container);
  try { range.setEnd(node, offset); } catch { return null; }
  return range.toString().length;
}

function caretAt(x: number, y: number) {
  const view = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const position = view.caretPositionFromPoint?.(x, y);
  if (position) return { node: position.offsetNode, offset: position.offset };
  const range = view.caretRangeFromPoint?.(x, y);
  return range ? { node: range.startContainer, offset: range.startOffset } : null;
}

type SelectionBar = { start: number; end: number; text: string; top: number; left: number };
export type ShaperAction = 'stop_at' | 'start_after' | 'label';

/**
 * The text the place found for a field, with the part kept highlighted and what the rules make of
 * it. The cut is set with the controls, by clicking in the text, or by dragging its handle; a
 * selection offers to use it as a label or a boundary.
 */
export function ValueShaper({ fieldLabel, reading, pending, location, take, pattern, onTake, onAction, onRead }: Readonly<{
  fieldLabel: string;
  reading?: DocumentFieldReading;
  /** The document is being read again with the current rules. */
  pending?: boolean;
  location: ExtractionLocation;
  take?: ExtractionTake;
  pattern?: string;
  onTake: (take: ExtractionTake | undefined) => void;
  onAction: (action: ShaperAction, text: string) => void;
  onRead?: () => void;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const raw = reading?.raw ?? '';
  const textRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [ghost, setGhost] = useState<number | null>(null);
  const [bar, setBar] = useState<SelectionBar | null>(null);
  const [dragging, setDragging] = useState(false);
  const unit = take?.unit ?? 'characters';
  const mode = take?.from ?? 'all';
  const units = useMemo(() => (raw ? unitSpans(raw, unit).length : 0), [raw, unit]);
  const sliderMax = Math.min(MAX_TAKE, Math.max(1, units || DEFAULT_SLIDER_MAX, take?.count ?? 1));
  const [keptStart, keptEnd] = keptRange(raw, take);
  const matches = useMemo(() => patternMatches(raw.slice(keptStart, keptEnd), pattern).map(([start, end]): Span => [start + keptStart, end + keptStart]),
    [raw, keptStart, keptEnd, pattern]);
  const cut = take?.from === 'end' ? keptStart : keptEnd;

  const setMode = (next: string) => {
    if (next === 'all') { onTake(undefined); return; }
    const from = next as ExtractionTake['from'];
    // A first cut keeps about half of the text found, so the change shows right away.
    const count = take?.count ?? Math.max(1, Math.min(MAX_TAKE, Math.ceil((units || DEFAULT_SLIDER_MAX) / 2)));
    onTake({ from, count, unit });
  };
  const setCount = (count: number) => {
    if (!take || !Number.isFinite(count)) return;
    onTake({ ...take, count: Math.min(MAX_TAKE, Math.max(1, Math.round(count))) });
  };
  const cutAt = (offset: number) => {
    if (take) onTake({ ...take, count: countForCut(raw, offset, take.from, take.unit) });
  };
  const offsetAtPoint = (x: number, y: number) => {
    const caret = caretAt(x, y);
    return caret && textRef.current?.contains(caret.node) ? textOffset(textRef.current, caret.node, caret.offset) : null;
  };

  // Dragging the handle moves the cut to the character under the pointer.
  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent) => {
      const offset = offsetAtPoint(event.clientX, event.clientY);
      if (offset !== null) cutAt(offset);
    };
    const stop = () => setDragging(false);
    globalThis.addEventListener('pointermove', move);
    globalThis.addEventListener('pointerup', stop);
    return () => { globalThis.removeEventListener('pointermove', move); globalThis.removeEventListener('pointerup', stop); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging, take, raw]);

  const onMouseUp = () => {
    const box = textRef.current;
    const selection = globalThis.getSelection?.();
    if (!box || !selection || !selection.rangeCount || !selection.anchorNode || !box.contains(selection.anchorNode)) return;
    if (selection.isCollapsed) {
      setBar(null);
      const offset = textOffset(box, selection.focusNode!, selection.focusOffset);
      if (offset !== null) cutAt(offset);
      return;
    }
    const range = selection.getRangeAt(0);
    const start = textOffset(box, range.startContainer, range.startOffset);
    const end = textOffset(box, range.endContainer, range.endOffset);
    if (start === null || end === null || end <= start) return;
    // Some environments cannot measure a range; the bar then sits at the top of the text.
    const rect = typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : null;
    const frame = wrapperRef.current?.getBoundingClientRect();
    setBar({
      start, end, text: raw.slice(start, end).trim().slice(0, 200),
      top: rect ? Math.max(0, rect.top - (frame?.top ?? 0) - 34) : 0,
      left: rect ? Math.max(0, rect.left - (frame?.left ?? 0)) : 0,
    });
  };
  const onMouseMove = (event: ReactMouseEvent) => {
    if (!take || dragging) return;
    const offset = offsetAtPoint(event.clientX, event.clientY);
    if (offset === null) { setGhost(null); return; }
    const [start, end] = keptRange(raw, { ...take, count: countForCut(raw, offset, take.from, take.unit) });
    setGhost(take.from === 'start' ? end : start);
  };
  const onHandleKey = (event: KeyboardEvent) => {
    if (!take) return;
    const step = event.shiftKey ? 10 : 1;
    // Moving the handle right keeps more from the start, and less from the end.
    const grow = take.from === 'start' ? 1 : -1;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') { event.preventDefault(); setCount(take.count + (event.key === 'ArrowUp' ? step : step * grow)); }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') { event.preventDefault(); setCount(take.count - (event.key === 'ArrowDown' ? step : step * grow)); }
    if (event.key === 'Home') { event.preventDefault(); setCount(1); }
    if (event.key === 'End') { event.preventDefault(); setCount(units || take.count); }
  };
  const keepSelection = () => {
    if (!bar) return;
    const from = take?.from ?? 'start';
    const count = from === 'start' ? countForCut(raw, bar.end, 'start', unit) : countForCut(raw, bar.start, 'end', unit);
    onTake({ from, count, unit });
    setBar(null);
  };
  const act = (action: ShaperAction) => {
    if (bar?.text) onAction(action, bar.text);
    setBar(null);
    globalThis.getSelection?.()?.removeAllRanges();
  };

  // The text cut into pieces: dropped or kept, inside a pattern match or not, with the handle at the cut.
  const points = [...new Set([0, raw.length, keptStart, keptEnd, ...matches.flat(), ...(ghost === null ? [] : [ghost])])].sort((left, right) => left - right);
  const pieces = points.slice(0, -1).map((start, index) => {
    const end = points[index + 1];
    return { start, end, kept: start >= keptStart && end <= keptEnd, match: matches.some(([from, to]) => start >= from && end <= to) };
  });
  const handle = take && raw ? <span role='slider' tabIndex={0} aria-label={t('mapping.rules.take.handle', { field: fieldLabel })}
    aria-valuemin={1} aria-valuemax={sliderMax} aria-valuenow={take.count} aria-valuetext={t(`mapping.rules.take.amount.${take.unit}`, { count: take.count })}
    onKeyDown={onHandleKey} onPointerDown={(event) => { event.preventDefault(); setDragging(true); }}
    className='relative mx-px inline-block h-[1.1em] w-1 cursor-ew-resize rounded-full bg-primary align-text-bottom outline-none ring-offset-1 focus-visible:ring-2 focus-visible:ring-ring' /> : null;
  const ghostMark = <span aria-hidden className='inline-block h-[1.1em] w-0 border-l border-dashed border-primary/70 align-text-bottom' />;
  const status = reading && reading.reason !== 'found'
    ? t(`mapping.reading.reason.${reading.reason}`, { values: (reading.values ?? []).map((value) => `“${value}”`).join(', '), detail: reading.detail ?? '' }) : null;

  return <div className='space-y-2 rounded-lg border bg-muted/20 p-2.5' role='group' aria-label={t('mapping.rules.take.title', { field: fieldLabel })}>
    <div className='flex flex-wrap items-center gap-2'>
      <span className='flex items-center gap-1 text-xs font-medium'><Scissors className='h-3.5 w-3.5 text-muted-foreground' />{t('mapping.rules.take.keep')}</span>
      <ChoiceGroup variant='segmented' label={t('mapping.rules.take.keepFor', { field: fieldLabel })} value={mode} onChange={setMode}
        options={(['all', 'start', 'end'] as const).map((item) => ({ value: item, label: t(`mapping.rules.take.mode.${item}`) }))} />
    </div>
    {take && <div className='flex flex-wrap items-center gap-2'>
      <Input type='number' min={1} max={MAX_TAKE} className='h-7 w-20 text-xs tabular-nums' value={take.count}
        aria-label={t('mapping.rules.take.count', { field: fieldLabel })} onChange={(event) => setCount(Number(event.target.value))} />
      <Select value={unit} onValueChange={(value: ExtractionTakeUnit) => onTake({ ...take, unit: value })}>
        <SelectTrigger className='h-7 w-32 text-xs' aria-label={t('mapping.rules.take.unitFor', { field: fieldLabel })}><SelectValue /></SelectTrigger>
        <SelectContent>{TAKE_UNITS.map((item) => <SelectItem key={item} value={item} className='text-xs'>{t(`mapping.rules.take.unit.${item}`)}</SelectItem>)}</SelectContent>
      </Select>
      <input type='range' min={1} max={sliderMax} value={Math.min(take.count, sliderMax)} className='h-1.5 min-w-24 flex-1 cursor-pointer accent-primary'
        aria-label={t('mapping.rules.take.slider', { field: fieldLabel })} onChange={(event) => setCount(Number(event.target.value))} />
    </div>}

    {raw ? <div ref={wrapperRef} className='relative'>
      <div ref={textRef} data-testid='shaper-text' className={cn('max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-md border bg-background p-2 text-xs leading-relaxed',
        take && 'cursor-text')} onMouseUp={onMouseUp} onMouseMove={onMouseMove} onMouseLeave={() => setGhost(null)}>
        {pieces.map((piece) => <span key={piece.start}>
          {take?.from === 'end' && piece.start === cut && handle}
          {ghost !== null && ghost !== cut && piece.start === ghost && ghostMark}
          <span className={cn(piece.kept ? 'rounded-sm bg-primary/15 text-foreground' : 'text-muted-foreground/60 line-through decoration-muted-foreground/30',
            piece.match && 'underline decoration-primary decoration-2 underline-offset-2')}>{raw.slice(piece.start, piece.end)}</span>
          {take?.from === 'start' && piece.end === cut && handle}
          {ghost !== null && ghost !== cut && piece.end === ghost && piece.end === raw.length && ghostMark}
        </span>)}
      </div>
      {bar && <div role='toolbar' aria-label={t('mapping.rules.take.selection')} className='absolute z-10 flex flex-wrap gap-1 rounded-md border bg-popover p-1 shadow-md' style={{ top: bar.top, left: bar.left }}>
        {location === 'after_label' && <Button type='button' size='sm' variant='ghost' className='h-6 px-2 text-[11px]' onClick={() => act('stop_at')}>{t('mapping.rules.take.stopAt')}</Button>}
        {location === 'before_label' && <Button type='button' size='sm' variant='ghost' className='h-6 px-2 text-[11px]' onClick={() => act('start_after')}>{t('mapping.rules.take.startAfter')}</Button>}
        {location !== 'pages' && location !== 'anywhere' && location !== 'heading' && <Button type='button' size='sm' variant='ghost' className='h-6 px-2 text-[11px]' onClick={() => act('label')}><Tag className='mr-1 h-3 w-3' />{t('mapping.rules.take.useAsLabel')}</Button>}
        <Button type='button' size='sm' variant='ghost' className='h-6 px-2 text-[11px]' onClick={keepSelection}><Ruler className='mr-1 h-3 w-3' />{t('mapping.rules.take.keepLength')}</Button>
      </div>}
      <p className='mt-1 text-[11px] text-muted-foreground'>{take ? t('mapping.rules.take.clickHint') : t('mapping.rules.take.selectHint')}</p>
    </div> : <div className='flex flex-wrap items-center gap-2 rounded-md border border-dashed p-3 text-[11px] text-muted-foreground'>
      <BookOpen className='h-3.5 w-3.5 shrink-0' />
      <span className='min-w-0 flex-1'>{status ?? t('mapping.rules.take.placeholder')}</span>
      {onRead && <Button type='button' size='sm' variant='outline' className='h-6 px-2 text-[11px]' disabled={pending} onClick={onRead}>
        {pending && <Loader2 className='mr-1 h-3 w-3 animate-spin' />}{t('mapping.live.readNow')}
      </Button>}
    </div>}

    {raw && <p className='flex flex-wrap items-center gap-1.5 text-xs' aria-live='polite'>
      <span className='text-muted-foreground'>{t('mapping.rules.take.result')}</span>
      {pending && <Loader2 className='h-3 w-3 animate-spin text-muted-foreground' aria-label={t('mapping.live.reading')} />}
      {reading?.reason === 'found'
        ? <span className={cn('max-w-full truncate rounded-full bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-800 dark:text-emerald-300', pending && 'opacity-60')}>{String(reading.value ?? '')}</span>
        : <span className='rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-800 dark:text-amber-300'>{status}</span>}
    </p>}
  </div>;
}
