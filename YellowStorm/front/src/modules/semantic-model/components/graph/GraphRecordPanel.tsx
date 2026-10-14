import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ChevronDown, ChevronRight, Copy, Crosshair, FileText, Loader2, X } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';
import { CorrectionNotice, FixValueButton, HideRecordButton, useCorrectionActions } from '../preview/RecordCorrections';
import { linkGroups, type GraphField, type GraphIndex, type GraphRecord } from './graph-analytics';

export const PANEL_WIDTH_KEY = 'semantic-model.graph.panelWidth';
const MIN_WIDTH = 320;
const MAX_WIDTH = 760;
const LONG_VALUE = 160;
/** Linked records listed per group before "and N more". */
const LINKED_SHOWN = 50;

const readWidth = () => {
  try { const stored = Number(localStorage.getItem(PANEL_WIDTH_KEY)); return stored >= MIN_WIDTH && stored <= MAX_WIDTH ? stored : 400; } catch { return 400; }
};

/** A value as people read it: dates and numbers in their own format. */
export function formatValue(field: Pick<GraphField, 'type' | 'value'>, locale: string, yes: string, no: string): string {
  const { value } = field;
  if (Array.isArray(value)) return value.map((item) => formatValue({ type: field.type, value: item }, locale, yes, no)).join(', ');
  if (typeof value === 'boolean' || (field.type === 'boolean' && (value === 'true' || value === 'false'))) return value === true || value === 'true' ? yes : no;
  if (field.type === 'number' && value !== '' && Number.isFinite(Number(value))) return Number(value).toLocaleString(locale);
  if (field.type === 'date') {
    const text = String(value);
    const date = new Date(text);
    if (!Number.isNaN(date.getTime())) return /[T ]\d{2}:\d{2}/.test(text) ? date.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) : date.toLocaleDateString(locale, { dateStyle: 'medium' });
  }
  if (value !== null && typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Everything about one record of the data graph: its values, what it is linked to, and fixes. */
export function GraphRecordPanel({ index, record, valuesLoading = false, valuesError, sourceFileName, color, modelId, canEdit, onRebuildStarted, onSelect, onCenter, onClose }: Readonly<{
  index: GraphIndex;
  /** The record, with its values once they are read. */
  record: GraphRecord;
  valuesLoading?: boolean;
  valuesError?: string | null;
  sourceFileName?: string | null;
  color: string;
  modelId: string;
  canEdit: boolean;
  onRebuildStarted?: (jobId: string) => void;
  onSelect: (id: string) => void;
  onCenter: (id: string) => void;
  onClose: () => void;
}>) {
  const { t, language } = useModuleTranslation('semantic-model');
  const [width, setWidth] = useState(readWidth);
  const [showMissing, setShowMissing] = useState(false);
  const resizing = useRef<{ x: number; width: number } | null>(null);
  const fixes = useCorrectionActions(modelId, onRebuildStarted, false);
  useEffect(() => setShowMissing(false), [record.id]);

  const startResize = (event: React.PointerEvent) => {
    resizing.current = { x: event.clientX, width };
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
  };
  const moveResize = (event: React.PointerEvent) => {
    if (!resizing.current) return;
    setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, resizing.current.width + resizing.current.x - event.clientX)));
  };
  const endResize = () => {
    if (!resizing.current) return;
    resizing.current = null;
    try { localStorage.setItem(PANEL_WIDTH_KEY, String(width)); } catch { /* the width is only a convenience */ }
  };

  const filled = record.fields.filter((field) => !field.missing);
  const missing = record.fields.filter((field) => field.missing);
  const source = sourceFileName;
  const fieldRow = (field: GraphField) => <FieldRow key={field.key} field={field} text={field.missing ? '' : formatValue(field, language, t('graphViewer.yes'), t('graphViewer.no'))}
    fix={canEdit ? <FixValueButton iconOnly className='rounded p-1 text-white/40 hover:bg-white/10 hover:text-white' label={field.label} value={field.missing ? '' : field.value} busy={fixes.busy}
      onSave={(value) => fixes.save({ action: 'edit_entity', targetIdentity: { entityId: record.id }, payload: { attribute: field.key, value } })} /> : null} />;

  return <aside className='relative flex shrink-0 flex-col border-l border-white/10 text-white' style={{ width, background: 'rgba(255,255,255,0.03)' }} aria-label={t('graphViewer.recordPanel')}>
    <div role='separator' aria-orientation='vertical' aria-label={t('graphViewer.resizePanel')} title={t('graphViewer.resizePanel')}
      className='absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize hover:bg-white/10'
      onPointerDown={startResize} onPointerMove={moveResize} onPointerUp={endResize} onPointerCancel={endResize} />
    <header className='flex items-start gap-2 border-b border-white/10 px-4 py-3'>
      <div className='min-w-0 flex-1'>
        <span className='inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium' style={{ background: `${color}33`, color: 'white' }}>
          <span className='h-2 w-2 rounded-full' style={{ background: color }} />{record.conceptLabel}
        </span>
        <h3 className='mt-1.5 break-words text-base font-semibold leading-snug'>{record.label}</h3>
        <p className='mt-1 text-[11px] text-white/45'>{t('graphViewer.recordSummary', { filled: filled.length, total: record.fields.length, links: index.degree.get(record.id) ?? 0 })}</p>
      </div>
      <button type='button' onClick={() => onCenter(record.id)} className='rounded p-1 text-white/40 hover:bg-white/10 hover:text-white' aria-label={t('graphViewer.centerOn')} title={t('graphViewer.centerOn')}><Crosshair className='h-4 w-4' /></button>
      <button type='button' onClick={onClose} className='rounded p-1 text-white/40 hover:bg-white/10 hover:text-white' aria-label={t('graphViewer.closeRecord')}><X className='h-4 w-4' /></button>
    </header>

    {/* Room at the bottom so the assistant's button never covers the last lines. */}
    <div className='flex-1 space-y-5 overflow-y-auto px-4 pb-24 pt-3'>
      {source ? <p className='flex items-center gap-2 text-xs text-sky-300/80'><FileText className='h-3.5 w-3.5 shrink-0' /><span className='truncate' title={String(source)}>{String(source)}</span></p> : null}

      <section aria-label={t('graphViewer.values')}>
        <h4 className='mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/40'>{t('graphViewer.values')}</h4>
        {!record.fields.length && <p className='text-xs italic text-white/35'>{t('graphViewer.noAttributes')}</p>}
        {valuesLoading && <p className='flex items-center gap-2 py-2 text-xs text-white/45' role='status'><Loader2 className='h-3.5 w-3.5 animate-spin' />{t('graphViewer.loadingValues')}</p>}
        {valuesError && <p className='py-2 text-xs text-red-400' role='alert'>{valuesError}</p>}
        {!valuesLoading && !valuesError && <dl className='divide-y divide-white/5'>{filled.map(fieldRow)}</dl>}
        {missing.length > 0 && <div className='mt-2'>
          <button type='button' aria-expanded={showMissing} onClick={() => setShowMissing(!showMissing)} className='flex items-center gap-1 text-xs text-amber-400/80 hover:text-amber-300'>
            {showMissing ? <ChevronDown className='h-3.5 w-3.5' /> : <ChevronRight className='h-3.5 w-3.5' />}{t('graphViewer.missingCount', { count: missing.length })}
          </button>
          {showMissing && <dl className='mt-1 divide-y divide-white/5'>{missing.map(fieldRow)}</dl>}
        </div>}
      </section>

      <LinkedRecords index={index} record={record} onSelect={onSelect} />

      {canEdit && <div className='space-y-2'>
        <HideRecordButton busy={fixes.busy} onHide={() => fixes.save({ action: 'remove_entity', targetIdentity: { entityId: record.id } })} />
        <CorrectionNotice actions={fixes} />
      </div>}
    </div>
  </aside>;
}

function FieldRow({ field, text, fix }: Readonly<{ field: GraphField; text: string; fix: React.ReactNode }>) {
  const { t } = useModuleTranslation('semantic-model');
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const long = text.length > LONG_VALUE || text.split('\n').length > 3;
  const copy = () => { void navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }); };
  return <div className='group py-2'>
    <dt className='flex items-center gap-1 text-[11px] text-white/45'>
      <span className='min-w-0 flex-1 truncate' title={field.key}>{field.label}</span>
      {!field.missing && <button type='button' onClick={copy} className='rounded p-1 text-white/30 opacity-0 hover:bg-white/10 hover:text-white focus:opacity-100 group-hover:opacity-100' aria-label={t('graphViewer.copyValue', { field: field.label })} title={t('graphViewer.copyValue', { field: field.label })}>
        {copied ? <Check className='h-3 w-3 text-emerald-400' /> : <Copy className='h-3 w-3' />}</button>}
      {fix}
    </dt>
    <dd className={field.missing ? 'text-sm italic text-amber-400/60' : 'text-sm leading-snug text-white/90'}>
      {field.missing ? t('graphViewer.missingValue') : <>
        <span className={`block whitespace-pre-wrap break-words ${long && !expanded ? 'line-clamp-3' : ''}`}>{text}</span>
        {long && <button type='button' onClick={() => setExpanded(!expanded)} className='mt-0.5 text-[11px] text-sky-300 hover:underline'>{expanded ? t('graphViewer.showLess') : t('graphViewer.showMore')}</button>}
      </>}
    </dd>
  </div>;
}

/** What the record is linked to, by relationship; each linked record opens on the graph. */
function LinkedRecords({ index, record, onSelect }: Readonly<{ index: GraphIndex; record: GraphRecord; onSelect: (id: string) => void }>) {
  const { t } = useModuleTranslation('semantic-model');
  const groups = useMemo(() => linkGroups(index, record.id), [index, record.id]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  useEffect(() => setOpen({}), [record.id]);
  return <section aria-label={t('graphViewer.linked')}>
    <h4 className='mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/40'>{t('graphViewer.linked')}</h4>
    {!groups.length && <p className='text-xs italic text-white/35'>{t('graphViewer.noLinks')}</p>}
    <ul className='space-y-1'>{groups.map((group) => {
      const key = `${group.relation}|${group.outgoing}|${group.conceptLabel}`;
      const isOpen = open[key] ?? group.records.length <= 3;
      const Arrow = group.outgoing ? ArrowRight : ArrowLeft;
      return <li key={key}>
        <button type='button' aria-expanded={isOpen} onClick={() => setOpen({ ...open, [key]: !isOpen })} className='flex w-full items-center gap-1.5 rounded px-1 py-1 text-start text-xs text-white/70 hover:bg-white/5'>
          {isOpen ? <ChevronDown className='h-3.5 w-3.5 shrink-0' /> : <ChevronRight className='h-3.5 w-3.5 shrink-0' />}
          <span className='truncate'>{group.label}</span><Arrow className='h-3 w-3 shrink-0 text-white/40' />
          <span className='truncate font-medium text-white/90'>{group.records.length} {group.conceptLabel}</span>
        </button>
        {isOpen && <ul className='ms-5 border-l border-white/10 ps-2'>{group.records.slice(0, LINKED_SHOWN).map((other) => <li key={other.id}>
          <button type='button' onClick={() => onSelect(other.id)} className='w-full truncate rounded px-1.5 py-0.5 text-start text-xs text-sky-300 hover:bg-white/5 hover:underline' title={other.label}>{other.label}</button>
        </li>)}
          {group.records.length > LINKED_SHOWN && <li className='px-1.5 py-0.5 text-[11px] text-white/40'>{t('graphViewer.andMore', { count: group.records.length - LINKED_SHOWN })}</li>}
        </ul>}
      </li>;
    })}</ul>
  </section>;
}
