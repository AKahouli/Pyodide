import { useState } from 'react';
import { AlertTriangle, Bot, CheckCircle2, ChevronDown, ChevronRight, ExternalLink, Heading, ListChecks, Plus, RefreshCw, SlidersHorizontal, Sparkles, Tag, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import type { AiExtractionSettings, DocumentFieldReading, DocumentLabelSuggestion, ExtractionLocation, ExtractionRules, SourceExtractionStrategy, SourceFieldMapping } from '../../types';

export const STRATEGIES: SourceExtractionStrategy[] = ['deterministic', 'rules_then_ai', 'ai'];
const LOCATIONS: ExtractionLocation[] = ['auto', 'same_line', 'next_line', 'table', 'after_label', 'before_label', 'heading', 'pages', 'anywhere'];
const TRANSFORMS = ['none', 'trim', 'upper', 'lower', 'date_iso'] as const;
const MAX_LABELS = 10;
const MAX_PAGES = 2000;
const MAX_PAGE_SPAN = 50;
// Suggestions shown before "Show all".
const SUGGESTIONS_SHOWN = 12;

/** Locations reading a passage bounded by other labels. */
function usesBoundary(location: ExtractionLocation) {
  return location === 'after_label' || location === 'before_label';
}

/** Ready-made patterns; each also reads in the runtime's regular expressions. */
export const PATTERN_PRESETS = {
  date: String.raw`\d{4}-\d{2}-\d{2}|\d{1,2}[/.]\d{1,2}[/.]\d{4}|\d{1,2}(?:er)? [A-Za-zéû]+ \d{4}`,
  amount: String.raw`[-+]?\d[\d .,]*\d(?: ?(?:€|EUR|\$|USD|%))?`,
  reference: String.raw`[A-Z]{2,}[-_/]?\d[\w-]*`,
  number: String.raw`\d+(?:[.,]\d+)?`,
  email: String.raw`[\w.+-]+@[\w-]+\.[\w.-]+`,
} as const;
type PatternPreset = keyof typeof PATTERN_PRESETS;

function presetOf(pattern?: string): PatternPreset | undefined {
  return (Object.keys(PATTERN_PRESETS) as PatternPreset[]).find((key) => PATTERN_PRESETS[key] === pattern);
}

export function usesRules(strategy?: SourceExtractionStrategy) {
  return (strategy ?? 'deterministic') !== 'ai';
}

export function usesAi(mappings: SourceFieldMapping[]) {
  return mappings.some((mapping) => mapping.mode === 'extract' && (mapping.extractionStrategy === 'ai' || mapping.extractionStrategy === 'rules_then_ai'));
}

/** How a document mapping reads a concept field it has no saved row for yet. */
export function newDocumentField(key: string, strategy: SourceExtractionStrategy = 'deterministic'): SourceFieldMapping {
  return key === 'source_document'
    ? { sourceField: 'document_name', targetAttribute: key, mode: 'metadata' }
    : { sourceField: null, targetAttribute: key, mode: 'extract', extractionStrategy: strategy };
}

/**
 * One row per concept field, in the concept's order. Saved rows are kept as they are; a field added
 * to the concept since the mapping was saved gets a row read like most of the other fields, and a
 * row for a field the concept no longer has is dropped.
 */
export function withConceptFields(saved: SourceFieldMapping[], attributes: ReadonlyArray<{ key: string }>): { mappings: SourceFieldMapping[]; added: string[] } {
  const byKey = new Map(saved.map((mapping) => [mapping.targetAttribute, mapping]));
  const counts = new Map<SourceExtractionStrategy, number>();
  for (const mapping of saved) {
    if (mapping.mode !== 'extract') continue;
    const strategy = mapping.extractionStrategy ?? 'deterministic';
    counts.set(strategy, (counts.get(strategy) ?? 0) + 1);
  }
  const strategy = [...counts].sort((left, right) => right[1] - left[1])[0]?.[0];
  const added: string[] = [];
  const mappings = attributes.map((attribute) => {
    const existing = byKey.get(attribute.key);
    if (existing) return existing;
    added.push(attribute.key);
    return newDocumentField(attribute.key, strategy);
  });
  return { mappings, added };
}

/** A pattern the browser cannot read is very likely wrong for the runtime too. */
export function patternProblem(pattern?: string) {
  if (!pattern?.trim()) return null;
  try {
    new RegExp(pattern);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Why the pages to read are not valid, as a translation key, or null. */
export function pagesProblem(pages?: ExtractionRules['pages']) {
  if (!pages || !Number.isInteger(pages.from) || pages.from < 1) return 'mapping.rules.pagesFromRequired';
  if (pages.from > MAX_PAGES) return 'mapping.rules.pagesRange';
  if (pages.to === undefined) return null;
  if (!Number.isInteger(pages.to) || pages.to > MAX_PAGES) return 'mapping.rules.pagesRange';
  if (pages.to < pages.from) return 'mapping.rules.pagesOrder';
  if (pages.to - pages.from + 1 > MAX_PAGE_SPAN) return 'mapping.rules.pagesSpan';
  return null;
}

/** True when the runtime would refuse these rules: a broken pattern, a missing one, or pages out of bounds. */
export function rulesProblem(rules?: ExtractionRules) {
  if (patternProblem(rules?.pattern)) return true;
  if (rules?.location === 'anywhere' && !rules.pattern?.trim()) return true;
  return rules?.location === 'pages' && Boolean(pagesProblem(rules.pages));
}

/** Labels found across a few documents of the source, offered as labels a value follows. */
export interface LabelSuggestions {
  status: 'loading' | 'error' | 'ready';
  labels: DocumentLabelSuggestion[];
  documentsRead: number;
  onRetry?: () => void;
  /** Hovering or focusing a suggestion shows where it is in the document. */
  onPreview?: (suggestion: DocumentLabelSuggestion) => void;
}

/** One click to read every extracted field the same way; each field can still be changed alone. */
export function ReadAllFieldsBar({ mappings, onApply }: Readonly<{ mappings: SourceFieldMapping[]; onApply: (strategy: SourceExtractionStrategy) => void }>) {
  const { t } = useModuleTranslation('semantic-model');
  const extracted = mappings.filter((mapping) => mapping.mode === 'extract');
  if (!extracted.length) return null;
  const strategies = new Set(extracted.map((mapping) => mapping.extractionStrategy ?? 'deterministic'));
  const current = strategies.size === 1 ? [...strategies][0] : null;
  return <div className='flex flex-wrap items-center gap-2 rounded-lg bg-muted/40 p-2' role='group' aria-label={t('mapping.readAll.label')}>
    <span className='text-xs text-muted-foreground'>{t('mapping.readAll.label')}</span>
    {STRATEGIES.map((strategy) => <Button key={strategy} type='button' size='sm' variant={current === strategy ? 'default' : 'outline'} className='h-7 px-2.5 text-xs'
      aria-pressed={current === strategy} onClick={() => onApply(strategy)}>
      <StrategyIcon strategy={strategy} />{t(`mapping.strategy.${strategy}`)}
    </Button>)}
    {!current && <span className='text-xs text-muted-foreground'>{t('mapping.readAll.mixed')}</span>}
  </div>;
}

function StrategyIcon({ strategy }: Readonly<{ strategy: SourceExtractionStrategy }>) {
  if (strategy === 'ai') return <Bot className='mr-1 h-3.5 w-3.5' />;
  if (strategy === 'rules_then_ai') return <Sparkles className='mr-1 h-3.5 w-3.5' />;
  return <ListChecks className='mr-1 h-3.5 w-3.5' />;
}

/**
 * The rules of one field: which labels the value follows, where it sits, what it looks like and
 * how it is cleaned up. Collapsed to a one-line summary until opened.
 */
export function FieldRulesEditor({ fieldLabel, rules, onChange, suggestions }: Readonly<{
  fieldLabel: string;
  rules?: ExtractionRules;
  onChange: (rules: ExtractionRules | undefined) => void;
  suggestions?: LabelSuggestions;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const [open, setOpen] = useState(false);
  const [draftLabel, setDraftLabel] = useState('');
  const [draftBoundary, setDraftBoundary] = useState('');
  // A section heading picked while the place is "auto": offer to read the whole section instead.
  const [headingHint, setHeadingHint] = useState<string | null>(null);
  const boundaryLabels = rules?.boundaryLabels ?? [];
  const labels = rules?.labels ?? [];
  const location = rules?.location ?? 'auto';
  const [customPattern, setCustomPattern] = useState(false);
  // An empty custom pattern is not stored, so "Custom" (and reading anywhere, which needs one) keeps the box open.
  const preset: PatternPreset | 'custom' | 'none' = rules?.pattern
    ? presetOf(rules.pattern) ?? 'custom'
    : customPattern || location === 'anywhere' ? 'custom' : 'none';
  // "After “Contract No.” · After the label, on the same line · matches A reference": the rules in one line.
  const summaryLabels = (labels.length ? labels : [fieldLabel]).map((label) => `“${label}”`).join(', ');
  const withoutLabels = location === 'heading' || location === 'anywhere' || location === 'pages';
  const summaryBoundary = usesBoundary(location) && boundaryLabels.length
    ? ` · ${t(`mapping.rules.summaryBoundary.${location}`, { labels: boundaryLabels.map((label) => `“${label}”`).join(', ') })}` : '';
  const summaryPages = location === 'pages' && rules?.pages && !pagesProblem(rules.pages)
    ? ` · ${pageRange(t, rules.pages.from, rules.pages.to)}` : '';
  const summary = (withoutLabels ? '' : `${t('mapping.rules.summaryLabels', { labels: summaryLabels })} · `)
    + t(`mapping.rules.where.${location}`) + summaryBoundary + summaryPages
    + (rules?.pattern ? ` · ${t('mapping.rules.summaryPattern', { pattern: preset !== 'custom' && preset !== 'none' ? t(`mapping.rules.preset.${preset}`) : rules.pattern })}` : '');
  const problem = patternProblem(rules?.pattern);
  const needsPattern = location === 'anywhere' && !rules?.pattern?.trim();
  const pagesError = location === 'pages' ? pagesProblem(rules?.pages) : null;
  const update = (patch: Partial<ExtractionRules>) => {
    const next: ExtractionRules = { ...rules, ...patch };
    // Boundaries and pages only mean something for the places that use them.
    if (!usesBoundary(next.location ?? 'auto') || !next.boundaryLabels?.length) delete next.boundaryLabels;
    if (next.location === 'pages') next.pages ??= { from: 1 };
    else delete next.pages;
    // Nothing set means the plain default reading: store no rules at all.
    const empty = !next.labels?.length && (next.location ?? 'auto') === 'auto' && !next.pattern
      && (next.transform ?? 'none') === 'none' && (next.occurrence ?? 'unique') === 'unique' && !next.firstPageOnly;
    onChange(empty ? undefined : next);
  };
  const addLabel = (value = draftLabel) => {
    const label = value.trim();
    if (label && !labels.includes(label) && labels.length < MAX_LABELS) update({ labels: [...labels, label] });
    setDraftLabel('');
  };
  const addBoundary = () => {
    const label = draftBoundary.trim().slice(0, 200);
    if (label && !boundaryLabels.includes(label) && boundaryLabels.length < MAX_LABELS) update({ boundaryLabels: [...boundaryLabels, label] });
    setDraftBoundary('');
  };
  const addSuggestion = (suggestion: DocumentLabelSuggestion) => {
    addLabel(suggestion.label);
    setHeadingHint(suggestion.kind === 'heading' && location === 'auto' ? suggestion.label : null);
  };
  // An emptied box is kept as 0 (from) or no end (to), so the inline error says what is missing.
  const setPage = (key: 'from' | 'to', text: string) => {
    const value = text === '' ? undefined : Number(text);
    const from = key === 'from' ? value ?? 0 : rules?.pages?.from ?? 0;
    const to = key === 'to' ? value : rules?.pages?.to;
    update({ pages: to === undefined ? { from } : { from, to } });
  };
  const id = `rules-${fieldLabel.replaceAll(/\W+/g, '-')}`;

  return <div className='rounded-lg border border-dashed'>
    <button type='button' className='flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] text-muted-foreground hover:bg-muted/50'
      aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
      {open ? <ChevronDown className='h-3.5 w-3.5 shrink-0' /> : <ChevronRight className='h-3.5 w-3.5 shrink-0' />}
      <span className='shrink-0 font-medium text-foreground'>{t('mapping.rules.title')}</span>
      <span className='min-w-0 truncate'>{summary}</span>
      {(problem || needsPattern || pagesError) && <AlertTriangle className='ml-auto h-3.5 w-3.5 shrink-0 text-destructive' aria-label={t('mapping.rules.invalid')} />}
    </button>
    {open && <div id={id} className='grid gap-3 border-t p-3 sm:grid-cols-2'>
      {location !== 'pages' && <div className='space-y-1.5 sm:col-span-2'>
        <Label className='text-xs' htmlFor={`${id}-label`}>{t('mapping.rules.labels')}</Label>
        <div className='flex flex-wrap items-center gap-1.5'>
          {labels.map((label) => <span key={label} className='inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs'>
            {label}
            <button type='button' aria-label={t('mapping.rules.removeLabel', { label })} onClick={() => update({ labels: labels.filter((item) => item !== label) })}><X className='h-3 w-3' /></button>
          </span>)}
          <Input id={`${id}-label`} className='h-7 w-44 text-xs' value={draftLabel} placeholder={labels.length ? t('mapping.rules.addLabel') : fieldLabel}
            onChange={(event) => setDraftLabel(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addLabel(); } }} />
          <Button type='button' size='sm' variant='ghost' className='h-7 px-2 text-xs' disabled={!draftLabel.trim() || labels.length >= MAX_LABELS} onClick={() => addLabel()}><Plus className='mr-1 h-3 w-3' />{t('mapping.rules.add')}</Button>
        </div>
        <p className='text-[11px] text-muted-foreground'>{t('mapping.rules.labelsHelp', { field: fieldLabel })}</p>
        {headingHint && location === 'auto' && <p role='status' className='flex flex-wrap items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/5 px-2 py-1.5 text-[11px] text-sky-800 dark:text-sky-300'>
          <Heading className='h-3.5 w-3.5 shrink-0' />
          <span className='min-w-0 flex-1'>{t('mapping.rules.headingHint', { label: headingHint })}</span>
          <Button type='button' size='sm' variant='outline' className='h-6 px-2 text-[11px]' onClick={() => { update({ location: 'after_label' }); setHeadingHint(null); }}>{t('mapping.rules.headingHintUse')}</Button>
          <button type='button' className='rounded p-0.5 hover:bg-sky-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring' aria-label={t('mapping.rules.headingHintDismiss')} onClick={() => setHeadingHint(null)}><X className='h-3 w-3' /></button>
        </p>}
        {suggestions && <LabelSuggestionChips suggestions={suggestions} added={labels} full={labels.length >= MAX_LABELS} onAdd={addSuggestion} />}
      </div>}

      <div className='space-y-1.5'>
        <Label className='text-xs'>{t('mapping.rules.location')}</Label>
        <Select value={location} onValueChange={(value: ExtractionLocation) => update({ location: value })}>
          <SelectTrigger className='h-8 text-xs' aria-label={t('mapping.rules.locationFor', { field: fieldLabel })}><SelectValue /></SelectTrigger>
          <SelectContent>{LOCATIONS.map((item) => <SelectItem key={item} value={item}>{t(`mapping.rules.where.${item}`)}</SelectItem>)}</SelectContent>
        </Select>
        <p className='text-[11px] text-muted-foreground'>{t(`mapping.rules.whereHelp.${location}`)}</p>
      </div>

      {usesBoundary(location) && <div className='space-y-1.5 sm:col-span-2'>
        <Label className='text-xs' htmlFor={`${id}-boundary`}>{t(`mapping.rules.boundary.${location}`)}</Label>
        <div className='flex flex-wrap items-center gap-1.5'>
          {boundaryLabels.map((label) => <span key={label} className='inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs'>
            {label}
            <button type='button' aria-label={t('mapping.rules.removeBoundary', { label })} onClick={() => update({ boundaryLabels: boundaryLabels.filter((item) => item !== label) })}><X className='h-3 w-3' /></button>
          </span>)}
          <Input id={`${id}-boundary`} className='h-7 w-44 text-xs' value={draftBoundary} maxLength={200} placeholder={t('mapping.rules.boundaryPlaceholder')}
            onChange={(event) => setDraftBoundary(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addBoundary(); } }} />
          <Button type='button' size='sm' variant='ghost' className='h-7 px-2 text-xs' disabled={!draftBoundary.trim() || boundaryLabels.length >= MAX_LABELS} onClick={addBoundary}><Plus className='mr-1 h-3 w-3' />{t('mapping.rules.add')}</Button>
        </div>
        <p className='text-[11px] text-muted-foreground'>{t(`mapping.rules.boundaryHelp.${location}`)}</p>
      </div>}

      {location === 'pages' && <div className='space-y-1.5'>
        <Label className='text-xs'>{t('mapping.rules.pages')}</Label>
        <div className='flex items-center gap-2'>
          <Input type='number' min={1} max={MAX_PAGES} className='h-8 w-20 text-xs' aria-label={t('mapping.rules.pagesFrom', { field: fieldLabel })}
            aria-invalid={pagesError === 'mapping.rules.pagesFromRequired'}
            value={rules?.pages?.from || ''} placeholder='1' onChange={(event) => setPage('from', event.target.value)} />
          <span className='text-xs text-muted-foreground'>{t('mapping.rules.pagesTo')}</span>
          <Input type='number' min={1} max={MAX_PAGES} className='h-8 w-20 text-xs' aria-label={t('mapping.rules.pagesToFor', { field: fieldLabel })}
            aria-invalid={Boolean(pagesError) && pagesError !== 'mapping.rules.pagesFromRequired'}
            value={rules?.pages?.to ?? ''} placeholder={String(rules?.pages?.from || 1)} onChange={(event) => setPage('to', event.target.value)} />
        </div>
        {pagesError ? <p role='alert' className='text-[11px] text-destructive'>{t(pagesError, { max: MAX_PAGES, span: MAX_PAGE_SPAN })}</p>
          : <p className='text-[11px] text-muted-foreground'>{t('mapping.rules.pagesHelp', { span: MAX_PAGE_SPAN })}</p>}
      </div>}

      <div className='space-y-1.5'>
        <Label className='text-xs'>{t('mapping.rules.pattern')}</Label>
        <Select value={preset} onValueChange={(value) => {
          setCustomPattern(value === 'custom');
          update({ pattern: value === 'none' || value === 'custom' ? (value === 'custom' ? rules?.pattern || undefined : undefined) : PATTERN_PRESETS[value as PatternPreset] });
        }}>
          <SelectTrigger className='h-8 text-xs' aria-label={t('mapping.rules.patternFor', { field: fieldLabel })}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value='none'>{t('mapping.rules.preset.none')}</SelectItem>
            {(Object.keys(PATTERN_PRESETS) as PatternPreset[]).map((item) => <SelectItem key={item} value={item}>{t(`mapping.rules.preset.${item}`)}</SelectItem>)}
            <SelectItem value='custom'>{t('mapping.rules.preset.custom')}</SelectItem>
          </SelectContent>
        </Select>
        {preset !== 'none' && <Input className='h-8 font-mono text-xs' value={rules?.pattern ?? ''} aria-label={t('mapping.rules.patternText', { field: fieldLabel })}
          aria-invalid={Boolean(problem || needsPattern)} placeholder={String.raw`CNT-\d{4}-\d{4}`} maxLength={200}
          onChange={(event) => update({ pattern: event.target.value || undefined })} />}
        {problem && <p role='alert' className='text-[11px] text-destructive'>{t('mapping.rules.patternInvalid', { problem })}</p>}
        {needsPattern && <p role='alert' className='text-[11px] text-destructive'>{t('mapping.rules.patternRequired')}</p>}
        {!problem && !needsPattern && <p className='text-[11px] text-muted-foreground'>{t('mapping.rules.patternHelp')}</p>}
      </div>

      <div className='space-y-1.5'>
        <Label className='text-xs'>{t('mapping.rules.transform')}</Label>
        <Select value={rules?.transform ?? 'none'} onValueChange={(value: NonNullable<ExtractionRules['transform']>) => update({ transform: value })}>
          <SelectTrigger className='h-8 text-xs' aria-label={t('mapping.rules.transformFor', { field: fieldLabel })}><SelectValue /></SelectTrigger>
          <SelectContent>{TRANSFORMS.map((item) => <SelectItem key={item} value={item}>{t(`mapping.rules.transformOption.${item}`)}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      <div className='space-y-1.5'>
        <Label className='text-xs'>{t('mapping.rules.occurrence')}</Label>
        <Select value={rules?.occurrence ?? 'unique'} onValueChange={(value: NonNullable<ExtractionRules['occurrence']>) => update({ occurrence: value })}>
          <SelectTrigger className='h-8 text-xs' aria-label={t('mapping.rules.occurrenceFor', { field: fieldLabel })}><SelectValue /></SelectTrigger>
          <SelectContent>{(['unique', 'first'] as const).map((item) => <SelectItem key={item} value={item}>{t(`mapping.rules.occurrenceOption.${item}`)}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      <label className='flex items-center gap-2 text-xs sm:col-span-2'>
        <input type='checkbox' checked={Boolean(rules?.firstPageOnly)} onChange={(event) => update({ firstPageOnly: event.target.checked })} />
        {t('mapping.rules.firstPageOnly')}
      </label>
    </div>}
  </div>;
}

type Translate = (key: 'mapping.reading.page' | 'mapping.reading.pages', params: { page: number; pageEnd?: number }) => string;

/** "Page 3", or "Pages 3–4" for a passage over several pages. */
export function pageRange(t: Translate, page: number, pageEnd?: number | null) {
  return pageEnd && pageEnd !== page ? t('mapping.reading.pages', { page, pageEnd }) : t('mapping.reading.page', { page });
}

/**
 * "Found in your documents": labels and headings recurring across a few documents of the source,
 * most shared first. A click adds one; hovering or focusing one shows it in the document.
 */
export function LabelSuggestionChips({ suggestions, added, full, onAdd }: Readonly<{
  suggestions: LabelSuggestions;
  added: string[];
  full: boolean;
  onAdd: (suggestion: DocumentLabelSuggestion) => void;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState('');
  const taken = new Set(added.map((label) => label.toLocaleLowerCase()));
  const available = suggestions.labels.filter((item) => !taken.has(item.label.toLocaleLowerCase()));
  const query = filter.trim().toLocaleLowerCase();
  const matching = query ? available.filter((item) => item.label.toLocaleLowerCase().includes(query)) : available;
  const shown = showAll || query ? matching : matching.slice(0, SUGGESTIONS_SHOWN);

  return <div className='space-y-1.5 rounded-lg bg-muted/30 p-2' role='group' aria-label={t('mapping.suggestions.title')}>
    <div className='flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground'>
      <Sparkles className='h-3 w-3' />{t('mapping.suggestions.title')}
      {suggestions.status === 'ready' && suggestions.documentsRead > 0 && <span className='font-normal'>· {t('mapping.suggestions.read', { count: suggestions.documentsRead })}</span>}
    </div>
    {suggestions.status === 'loading' && <div className='flex flex-wrap gap-1.5' aria-busy='true' aria-label={t('mapping.suggestions.loading')}>
      {[64, 96, 80, 112, 72].map((width) => <Skeleton key={width} className='h-6 rounded-full' style={{ width }} />)}
    </div>}
    {suggestions.status === 'error' && <p role='alert' className='flex items-center gap-1.5 text-[11px] text-destructive'>
      <AlertTriangle className='h-3.5 w-3.5 shrink-0' />{t('mapping.suggestions.error')}
      {suggestions.onRetry && <Button type='button' size='sm' variant='ghost' className='h-6 px-1.5 text-[11px]' onClick={suggestions.onRetry}><RefreshCw className='mr-1 h-3 w-3' />{t('action.retry')}</Button>}
    </p>}
    {suggestions.status === 'ready' && !available.length && <p className='text-[11px] text-muted-foreground'>
      {suggestions.labels.length ? t('mapping.suggestions.allAdded') : t('mapping.suggestions.empty')}
    </p>}
    {suggestions.status === 'ready' && available.length > 0 && <>
      {available.length > SUGGESTIONS_SHOWN && <Input className='h-7 text-xs' value={filter} onChange={(event) => setFilter(event.target.value)}
        placeholder={t('mapping.suggestions.filter')} aria-label={t('mapping.suggestions.filter')} />}
      {full && <p className='text-[11px] text-muted-foreground'>{t('mapping.suggestions.full')}</p>}
      <div className='flex flex-wrap gap-1.5'>
        {shown.map((item) => <button key={`${item.kind}:${item.label}`} type='button' disabled={full}
          className='inline-flex max-w-full items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-xs transition-colors hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50'
          title={item.example ? t('mapping.suggestions.example', { example: item.example }) : undefined}
          aria-label={t('mapping.suggestions.add', { label: item.label, kind: t(`mapping.suggestions.kind.${item.kind}`), count: item.documents, total: suggestions.documentsRead })}
          onMouseEnter={() => suggestions.onPreview?.(item)} onFocus={() => suggestions.onPreview?.(item)}
          onClick={() => onAdd(item)}>
          {item.kind === 'heading' ? <Heading className='h-3 w-3 shrink-0 text-sky-600 dark:text-sky-400' aria-hidden /> : <Tag className='h-3 w-3 shrink-0 text-muted-foreground' aria-hidden />}
          <span className='truncate'>{item.label}</span>
          <span className='shrink-0 text-[10px] tabular-nums text-muted-foreground'>{item.documents}/{suggestions.documentsRead}</span>
        </button>)}
        {query && !matching.length && <span className='text-[11px] text-muted-foreground'>{t('mapping.suggestions.noMatch')}</span>}
      </div>
      {!query && matching.length > SUGGESTIONS_SHOWN && <Button type='button' size='sm' variant='ghost' className='h-6 px-1.5 text-[11px]' aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>
        {showAll ? t('mapping.suggestions.showLess') : t('mapping.suggestions.showAll', { count: matching.length })}
      </Button>}
    </>}
  </div>;
}

const LIMIT_KEYS: Array<{ key: keyof AiExtractionSettings; min: number; max: number }> = [
  { key: 'maxBlocks', min: 10, max: 500 },
  { key: 'maxCharacters', min: 2000, max: 400000 },
  { key: 'longDocumentCharacters', min: 1000, max: 2000000 },
  { key: 'blocksPerField', min: 1, max: 50 },
];

export function limitProblem(value: Partial<AiExtractionSettings>) {
  return LIMIT_KEYS.find(({ key, min, max }) => value[key] !== undefined && (!Number.isInteger(value[key]) || value[key]! < min || value[key]! > max));
}

/** Fields for the four AI reading limits; an empty field falls back to `placeholder`. */
export function AiLimitFields({ value, placeholder, onChange, idPrefix }: Readonly<{
  value: Partial<AiExtractionSettings>;
  placeholder?: AiExtractionSettings;
  onChange: (value: Partial<AiExtractionSettings>) => void;
  idPrefix: string;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  return <div className='grid gap-3 sm:grid-cols-2'>
    {LIMIT_KEYS.map(({ key, min, max }) => {
      const current = value[key];
      const invalid = current !== undefined && (!Number.isInteger(current) || current < min || current > max);
      return <div key={key} className='space-y-1'>
        <Label htmlFor={`${idPrefix}-${key}`} className='text-xs'>{t(`mapping.ai.${key}`)}</Label>
        <Input id={`${idPrefix}-${key}`} type='number' min={min} max={max} className='h-8 text-xs' aria-invalid={invalid}
          value={current ?? ''} placeholder={placeholder ? String(placeholder[key]) : undefined}
          onChange={(event) => {
            const text = event.target.value;
            const next = { ...value };
            if (text === '') delete next[key]; else next[key] = Number(text);
            onChange(next);
          }} />
        <p className={cn('text-[11px]', invalid ? 'text-destructive' : 'text-muted-foreground')}>
          {invalid ? t('mapping.ai.range', { min: min.toLocaleString(), max: max.toLocaleString() }) : t(`mapping.ai.${key}Help`)}
        </p>
      </div>;
    })}
  </div>;
}

/** This source's AI reading limits, starting from the admin defaults; only what is changed is kept. */
export function AiLimitsEditor({ defaults, value, onChange }: Readonly<{
  defaults?: AiExtractionSettings;
  value: Partial<AiExtractionSettings>;
  onChange: (value: Partial<AiExtractionSettings>) => void;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const overridden = Object.keys(value).length > 0;
  const [open, setOpen] = useState(overridden);
  const effective = defaults ? { ...defaults, ...value } : undefined;
  return <div className='rounded-xl border'>
    <button type='button' className='flex w-full items-center gap-2 p-3 text-left text-xs hover:bg-muted/40' aria-expanded={open} onClick={() => setOpen(!open)}>
      <SlidersHorizontal className='h-4 w-4 shrink-0 text-muted-foreground' />
      <span className='font-medium'>{t('mapping.ai.title')}</span>
      <span className='min-w-0 flex-1 truncate text-muted-foreground'>
        {effective ? t(overridden ? 'mapping.ai.summaryChanged' : 'mapping.ai.summaryDefault', {
          blocks: effective.maxBlocks.toLocaleString(), characters: effective.maxCharacters.toLocaleString(),
          long: effective.longDocumentCharacters.toLocaleString(), perField: effective.blocksPerField,
        }) : ''}
      </span>
      {open ? <ChevronDown className='h-4 w-4 shrink-0' /> : <ChevronRight className='h-4 w-4 shrink-0' />}
    </button>
    {open && <div className='space-y-3 border-t p-3'>
      <p className='text-[11px] text-muted-foreground'>{t('mapping.ai.help')}</p>
      <AiLimitFields idPrefix='mapping-ai' value={value} placeholder={defaults} onChange={onChange} />
      {overridden && <Button type='button' size='sm' variant='ghost' className='h-7 px-2 text-xs' onClick={() => onChange({})}>{t('mapping.ai.reset')}</Button>}
    </div>}
  </div>;
}

/** What a preview read for one field, or why it found nothing, with what to try next. */
export function FieldReadingResult({ fieldLabel, reading, onOpenQuote }: Readonly<{
  fieldLabel: string;
  reading: DocumentFieldReading;
  onOpenQuote?: (quote: string, page?: number | null) => void;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const found = reading.reason === 'found';
  const computed = reading.method === 'computed';
  const method = t(`mapping.reading.method.${reading.method}`);
  const values = (reading.values ?? []).map((value) => `“${value}”`).join(', ');
  return <div className={cn('rounded-lg p-2 text-xs', found ? 'bg-muted/50' : 'border border-amber-500/40 bg-amber-500/5')}>
    <div className='flex items-start justify-between gap-2'>
      <div className='min-w-0'>
        <p className='font-medium'>{fieldLabel}</p>
        {found ? <p className='break-words'>{String(reading.value ?? '')}</p>
          : <p className='text-amber-800 dark:text-amber-300'>{t(`mapping.reading.reason.${reading.reason}`, { values, detail: reading.detail ?? '' })}</p>}
        {!found && reading.rules && <p className='mt-0.5 text-muted-foreground'>{t('mapping.reading.rulesFirst', { reason: t(`mapping.reading.reason.${reading.rules.reason}`, { values: (reading.rules.values ?? []).map((value) => `“${value}”`).join(', '), detail: '' }) })}</p>}
        {!found && <p className='mt-0.5 text-muted-foreground'>{t(`mapping.reading.hint.${reading.reason}`)}</p>}
        {computed && reading.input && <p className='mt-0.5 truncate text-muted-foreground'>{t('mapping.reading.computedFrom', { input: reading.input })}</p>}
      </div>
      <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px]', found ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-muted text-muted-foreground')}>
        {found ? <CheckCircle2 className='h-3 w-3' /> : <AlertTriangle className='h-3 w-3' />}{method}
      </span>
    </div>
    {found && reading.quote && <button type='button' className='mt-1 flex w-full items-start gap-1 text-left text-[11px] text-primary hover:underline'
      onClick={() => onOpenQuote?.(reading.quote!, reading.page)}>
      <ExternalLink className='mt-0.5 h-3 w-3 shrink-0' /><span className='line-clamp-2'>{reading.page ? `${pageRange(t, reading.page, reading.pageEnd)} · ` : ''}{reading.quote}</span>
    </button>}
  </div>;
}
