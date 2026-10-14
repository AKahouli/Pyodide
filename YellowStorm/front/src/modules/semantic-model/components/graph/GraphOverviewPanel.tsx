import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Route, Search, X } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { useModuleTranslation } from '@/modules/localization';
import {
  countPer, dateFields, fieldCompleteness, linkedConceptPairs, monthlyCounts, mostLinked, searchRecords, shortestPath, unlinkedRecords,
  type GraphIndex, type GraphRecord,
} from './graph-analytics';

/** Records singled out on the graph by the overview, with what singled them out. */
export interface GraphHighlight { ids: Set<string>; links?: Set<string>; reason: string }

export interface GraphPeriod { concept: string; field: string; from: string; to: string }

const SELECT = 'h-7 w-full rounded-md border border-white/15 bg-[#1a1a2b] px-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-sky-400';
const BAR = '#38bdf8';

/** Figures about the whole graph; every figure leads back to its records on the graph. */
export function GraphOverviewPanel({ index, colorOf, onSelect, highlight, onHighlight, onOnlyConcept, period, onPeriod, onClose }: Readonly<{
  index: GraphIndex;
  colorOf: (concept: string) => string;
  onSelect: (id: string) => void;
  highlight: GraphHighlight | null;
  onHighlight: (highlight: GraphHighlight | null) => void;
  onOnlyConcept: (concept: string) => void;
  period: GraphPeriod | null;
  onPeriod: (period: GraphPeriod | null) => void;
  onClose: () => void;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const [open, setOpen] = useState<Record<string, boolean>>({ concepts: true });
  const section = (id: string, title: string, summary: string, body: () => React.ReactNode) => <section key={id} className='border-b border-white/10'>
    <button type='button' aria-expanded={Boolean(open[id])} onClick={() => setOpen((current) => ({ ...current, [id]: !current[id] }))} className='flex w-full items-center gap-2 px-4 py-2.5 text-start hover:bg-white/5'>
      {open[id] ? <ChevronDown className='h-4 w-4 shrink-0 text-white/50' /> : <ChevronRight className='h-4 w-4 shrink-0 text-white/50' />}
      <span className='min-w-0 flex-1'><span className='block text-xs font-semibold text-white'>{title}</span><span className='block truncate text-[11px] text-white/45'>{summary}</span></span>
    </button>
    {open[id] && <div className='px-4 pb-4'>{body()}</div>}
  </section>;

  const unlinked = useMemo(() => unlinkedRecords(index), [index]);
  const linked = useMemo(() => mostLinked(index), [index]);
  const incomplete = useMemo(() => index.records.filter((record) => record.missing > 0), [index]);
  const dated = useMemo(() => dateFields(index), [index]);
  const pairs = useMemo(() => linkedConceptPairs(index), [index]);

  return <aside className='flex w-80 shrink-0 flex-col border-r border-white/10 text-white' style={{ background: 'rgba(255,255,255,0.03)' }} aria-label={t('graphViewer.overview')}>
    <header className='flex items-center justify-between border-b border-white/10 px-4 py-3'>
      <div><h3 className='text-sm font-semibold'>{t('graphViewer.overview')}</h3>
        <p className='text-[11px] text-white/45'>{t('graphViewer.overviewSummary', { records: index.records.length, links: index.links.length })}</p></div>
      <button type='button' onClick={onClose} className='rounded p-1 text-white/40 hover:bg-white/10 hover:text-white' aria-label={t('graphViewer.closeOverview')}><X className='h-4 w-4' /></button>
    </header>
    {highlight && <div role='status' className='flex items-center gap-2 border-b border-white/10 bg-amber-400/10 px-4 py-2 text-xs text-amber-200'>
      <span className='min-w-0 flex-1'>{highlight.reason}</span>
      <button type='button' onClick={() => onHighlight(null)} className='shrink-0 underline'>{t('graphViewer.clearHighlight')}</button>
    </div>}
    <div className='flex-1 overflow-y-auto pb-24'>
      {section('concepts', t('graphViewer.perConcept'), t('graphViewer.conceptCount', { count: index.concepts.length }), () =>
        <BarList rows={[...index.concepts].sort((a, b) => b.count - a.count).map((concept) => ({
          id: concept.key, label: concept.label, value: concept.count, color: colorOf(concept.key),
          title: t('graphViewer.onlyConcept', { concept: concept.label }), onClick: () => onOnlyConcept(concept.key),
        }))} />)}

      {section('quality', t('graphViewer.completeness'), incomplete.length ? t('graphViewer.incompleteCount', { count: incomplete.length }) : t('graphViewer.allComplete'), () =>
        <Completeness index={index} onHighlight={onHighlight} />)}

      {section('unlinked', t('graphViewer.unlinked'), unlinked.length ? t('graphViewer.unlinkedCount', { count: unlinked.length }) : t('graphViewer.noneUnlinked'), () => unlinked.length
        ? <>
          <button type='button' className='mb-2 text-xs text-sky-300 hover:underline' onClick={() => onHighlight({ ids: new Set(unlinked.map((record) => record.id)), reason: t('graphViewer.unlinkedCount', { count: unlinked.length }) })}>{t('graphViewer.showOnGraph')}</button>
          <RecordList records={unlinked} colorOf={colorOf} onSelect={onSelect} />
        </>
        : <p className='text-xs text-white/45'>{t('graphViewer.noneUnlinked')}</p>)}

      {section('linked', t('graphViewer.mostLinked'), linked[0] ? t('graphViewer.mostLinkedTop', { record: linked[0].label, count: index.degree.get(linked[0].id) }) : '', () =>
        <BarList rows={linked.map((record) => ({ id: record.id, label: record.label, sub: record.conceptLabel, value: index.degree.get(record.id) ?? 0, color: BAR, title: record.label, onClick: () => onSelect(record.id) }))} />)}

      {pairs.length > 0 && section('per', t('graphViewer.countPer'), t('graphViewer.countPerHelp'), () => <CountPer index={index} pairs={pairs} onSelect={onSelect} />)}

      {dated.length > 0 && section('timeline', t('graphViewer.timeline'), period ? t('graphViewer.periodActive', { from: period.from, to: period.to }) : t('graphViewer.timelineHelp'), () =>
        <Timeline index={index} fields={dated} period={period} onPeriod={onPeriod} onHighlight={onHighlight} />)}

      {section('path', t('graphViewer.path'), t('graphViewer.pathHelp'), () => <PathFinder index={index} colorOf={colorOf} onSelect={onSelect} onHighlight={onHighlight} />)}
    </div>
  </aside>;
}

interface BarRow { id: string; label: string; sub?: string; value: number; display?: string; color: string; title?: string; onClick?: () => void }

/** Horizontal bars, one per row, the figure written beside each. */
function BarList({ rows }: Readonly<{ rows: BarRow[] }>) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return <ul className='space-y-1'>{rows.map((row) => <li key={row.id}>
    <button type='button' disabled={!row.onClick} onClick={row.onClick} title={row.title} className='group w-full rounded px-1 py-0.5 text-start hover:bg-white/5 disabled:cursor-default'>
      <span className='flex items-baseline gap-2 text-xs'>
        <span className='min-w-0 flex-1 truncate text-white/85 group-hover:text-white'>{row.label}{row.sub && <span className='ms-1 text-white/40'>· {row.sub}</span>}</span>
        <span className='shrink-0 tabular-nums text-white/70'>{row.display ?? row.value}</span>
      </span>
      <span className='mt-0.5 block h-1.5 rounded-full bg-white/5'><span className='block h-full rounded-full' style={{ width: `${Math.max(2, (row.value / max) * 100)}%`, background: row.color }} /></span>
    </button>
  </li>)}</ul>;
}

function RecordList({ records, colorOf, onSelect, limit = 30 }: Readonly<{ records: GraphRecord[]; colorOf: (concept: string) => string; onSelect: (id: string) => void; limit?: number }>) {
  const { t } = useModuleTranslation('semantic-model');
  return <ul className='space-y-0.5'>
    {records.slice(0, limit).map((record) => <li key={record.id}>
      <button type='button' onClick={() => onSelect(record.id)} className='flex w-full items-center gap-2 rounded px-1 py-0.5 text-start text-xs hover:bg-white/5' title={record.label}>
        <span className='h-2 w-2 shrink-0 rounded-full' style={{ background: colorOf(record.concept) }} />
        <span className='min-w-0 flex-1 truncate text-sky-300'>{record.label}</span>
        <span className='shrink-0 text-[11px] text-white/40'>{record.conceptLabel}</span>
      </button>
    </li>)}
    {records.length > limit && <li className='px-1 text-[11px] text-white/40'>{t('graphViewer.andMore', { count: records.length - limit })}</li>}
  </ul>;
}

/** How often each field holds a value; a field opens on the records missing it. */
function Completeness({ index, onHighlight }: Readonly<{ index: GraphIndex; onHighlight: (highlight: GraphHighlight | null) => void }>) {
  const { t } = useModuleTranslation('semantic-model');
  const [concept, setConcept] = useState(index.concepts[0]?.key ?? '');
  const result = useMemo(() => fieldCompleteness(index, concept), [index, concept]);
  const conceptLabel = index.concepts.find((item) => item.key === concept)?.label ?? concept;
  return <div className='space-y-2'>
    <select className={SELECT} value={concept} onChange={(event) => setConcept(event.target.value)} aria-label={t('graphViewer.completenessOf')}>
      {index.concepts.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
    </select>
    {!result.fields.length && <p className='text-xs text-white/45'>{t('graphViewer.noAttributes')}</p>}
    <BarList rows={result.fields.map((field) => {
      const share = result.total ? Math.round((field.filled / result.total) * 100) : 0;
      return {
        id: field.key, label: field.label, value: share, display: `${share}%`, color: share === 100 ? '#34d399' : BAR,
        title: field.missing.length ? t('graphViewer.showMissing', { count: field.missing.length, field: field.label }) : t('graphViewer.fieldComplete'),
        onClick: field.missing.length ? () => onHighlight({ ids: new Set(field.missing), reason: t('graphViewer.missingField', { count: field.missing.length, concept: conceptLabel, field: field.label }) }) : undefined,
      };
    })} />
  </div>;
}

/** "How many B per A": for each record of one concept, the linked records of another. */
function CountPer({ index, pairs, onSelect }: Readonly<{ index: GraphIndex; pairs: Array<{ group: string; counted: string }>; onSelect: (id: string) => void }>) {
  const { t } = useModuleTranslation('semantic-model');
  const label = (key: string) => index.concepts.find((concept) => concept.key === key)?.label ?? key;
  const groups = [...new Set(pairs.map((pair) => pair.group))];
  const [group, setGroup] = useState(groups[0]);
  const counted = pairs.filter((pair) => pair.group === group).map((pair) => pair.counted);
  const [choice, setChoice] = useState(counted[0]);
  const current = counted.includes(choice) ? choice : counted[0];
  const rows = useMemo(() => countPer(index, group, current), [index, group, current]);
  return <div className='space-y-2'>
    <div className='grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1.5 text-[11px] text-white/50'>
      <span>{t('graphViewer.countWhat')}</span>
      <select className={SELECT} value={current} onChange={(event) => setChoice(event.target.value)} aria-label={t('graphViewer.countWhat')}>
        {counted.map((key) => <option key={key} value={key}>{label(key)}</option>)}
      </select>
      <span>{t('graphViewer.countPerWhat')}</span>
      <select className={SELECT} value={group} onChange={(event) => setGroup(event.target.value)} aria-label={t('graphViewer.countPerWhat')}>
        {groups.map((key) => <option key={key} value={key}>{label(key)}</option>)}
      </select>
    </div>
    {!rows.length && <p className='text-xs text-white/45'>{t('graphViewer.noneLinked')}</p>}
    <BarList rows={rows.slice(0, 15).map((row) => ({ id: row.record.id, label: row.record.label, value: row.count, color: BAR, title: row.record.label, onClick: () => onSelect(row.record.id) }))} />
    {rows.length > 15 && <p className='text-[11px] text-white/40'>{t('graphViewer.andMore', { count: rows.length - 15 })}</p>}
  </div>;
}

/** Records per month of a date field, and a period that keeps only those records on the graph. */
function Timeline({ index, fields, period, onPeriod, onHighlight }: Readonly<{
  index: GraphIndex;
  fields: ReturnType<typeof dateFields>;
  period: GraphPeriod | null;
  onPeriod: (period: GraphPeriod | null) => void;
  onHighlight: (highlight: GraphHighlight | null) => void;
}>) {
  const { t, language } = useModuleTranslation('semantic-model');
  const [choice, setChoice] = useState(period ? `${period.concept}|${period.field}` : `${fields[0].concept}|${fields[0].key}`);
  const field = fields.find((item) => `${item.concept}|${item.key}` === choice) ?? fields[0];
  const months = useMemo(() => monthlyCounts(index, field.concept, field.key), [index, field.concept, field.key]);
  const ownPeriod = period && period.concept === field.concept && period.field === field.key ? period : null;
  const [range, setRange] = useState<[number, number]>(() => {
    const from = ownPeriod ? months.findIndex((month) => month.month === ownPeriod.from) : -1;
    const to = ownPeriod ? months.findIndex((month) => month.month === ownPeriod.to) : -1;
    return [Math.max(0, from), to >= 0 ? to : months.length - 1];
  });
  const [from, to] = [Math.min(range[0], months.length - 1), Math.min(range[1], months.length - 1)];
  const max = Math.max(1, ...months.map((month) => month.records.length));
  const monthName = (key: string) => new Date(`${key}-01T00:00:00Z`).toLocaleDateString(language, { month: 'short', year: 'numeric', timeZone: 'UTC' });
  const inRange = months.slice(from, to + 1).reduce((sum, month) => sum + month.records.length, 0);
  return <div className='space-y-2'>
    <select className={SELECT} value={choice} onChange={(event) => { setChoice(event.target.value); setRange([0, Number.MAX_SAFE_INTEGER]); }} aria-label={t('graphViewer.dateField')}>
      {fields.map((item) => <option key={`${item.concept}|${item.key}`} value={`${item.concept}|${item.key}`}>{item.conceptLabel} · {item.label}</option>)}
    </select>
    {/* One column per month, the chosen period bright. */}
    <div className='flex h-20 items-end gap-px' role='img' aria-label={t('graphViewer.timelineChart', { field: field.label })}>
      {months.map((month, position) => <button key={month.month} type='button' className='group flex h-full min-w-0 flex-1 items-end'
        title={`${monthName(month.month)} · ${month.records.length}`}
        onClick={() => month.records.length && onHighlight({ ids: new Set(month.records), reason: t('graphViewer.inMonth', { count: month.records.length, month: monthName(month.month) }) })}>
        <span className='block w-full rounded-t-sm group-hover:opacity-80' style={{ height: month.records.length ? `${Math.max(4, (month.records.length / max) * 100)}%` : '1px', background: position >= from && position <= to ? BAR : 'rgba(255,255,255,0.15)' }} />
      </button>)}
    </div>
    {months.length > 1 && <Slider min={0} max={months.length - 1} step={1} value={[from, to]} onValueChange={(value) => setRange([value[0], value[1]])} aria-label={t('graphViewer.period')} />}
    <p className='flex justify-between text-[11px] text-white/50'><span>{months[from] && monthName(months[from].month)}</span><span>{months[to] && monthName(months[to].month)}</span></p>
    <p className='text-[11px] text-white/50'>{t('graphViewer.inPeriod', { count: inRange, concept: field.conceptLabel })}</p>
    <div className='flex gap-2'>
      <button type='button' className='rounded-md bg-sky-500/20 px-2 py-1 text-xs text-sky-200 hover:bg-sky-500/30' onClick={() => months[from] && onPeriod({ concept: field.concept, field: field.key, from: months[from].month, to: months[to].month })}>{t('graphViewer.keepPeriod')}</button>
      {period && <button type='button' className='rounded-md px-2 py-1 text-xs text-white/60 hover:bg-white/10' onClick={() => onPeriod(null)}>{t('graphViewer.clearPeriod')}</button>}
    </div>
  </div>;
}

/** Picks one record by typing part of its name or values. */
function RecordPicker({ index, value, onChange, label, colorOf }: Readonly<{ index: GraphIndex; value: string | null; onChange: (id: string | null) => void; label: string; colorOf: (concept: string) => string }>) {
  const { t } = useModuleTranslation('semantic-model');
  const [query, setQuery] = useState('');
  const chosen = value ? index.byId.get(value) : undefined;
  const results = useMemo(() => searchRecords(index, query, 6), [index, query]);
  if (chosen) return <div className='flex items-center gap-2 rounded-md border border-white/15 px-2 py-1 text-xs'>
    <span className='h-2 w-2 shrink-0 rounded-full' style={{ background: colorOf(chosen.concept) }} />
    <span className='min-w-0 flex-1 truncate' title={chosen.label}>{chosen.label}</span>
    <button type='button' onClick={() => onChange(null)} aria-label={t('graphViewer.changeRecord', { label })} className='text-white/40 hover:text-white'><X className='h-3.5 w-3.5' /></button>
  </div>;
  return <div className='relative'>
    <Search className='pointer-events-none absolute left-2 top-1.5 h-3.5 w-3.5 text-white/40' />
    <input className={`${SELECT} ps-7`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={label} aria-label={label} />
    {results.length > 0 && <ul className='mt-1 rounded-md border border-white/10 bg-[#1a1a2b]'>{results.map(({ record }) => <li key={record.id}>
      <button type='button' onClick={() => { onChange(record.id); setQuery(''); }} className='flex w-full items-center gap-2 px-2 py-1 text-start text-xs hover:bg-white/10'>
        <span className='h-2 w-2 shrink-0 rounded-full' style={{ background: colorOf(record.concept) }} />
        <span className='min-w-0 flex-1 truncate'>{record.label}</span><span className='shrink-0 text-[11px] text-white/40'>{record.conceptLabel}</span>
      </button>
    </li>)}</ul>}
  </div>;
}

/** "How are these two records connected?": the fewest links between them, shown on the graph. */
function PathFinder({ index, colorOf, onSelect, onHighlight }: Readonly<{ index: GraphIndex; colorOf: (concept: string) => string; onSelect: (id: string) => void; onHighlight: (highlight: GraphHighlight | null) => void }>) {
  const { t } = useModuleTranslation('semantic-model');
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const path = useMemo(() => (from && to ? shortestPath(index, from, to) : undefined), [index, from, to]);
  const show = (found: NonNullable<typeof path>) => onHighlight({ ids: new Set(found.records), links: new Set(found.links.map((link) => link.id)), reason: t('graphViewer.pathFound', { count: found.links.length }) });
  return <div className='space-y-2'>
    <RecordPicker index={index} value={from} onChange={setFrom} label={t('graphViewer.pathFrom')} colorOf={colorOf} />
    <RecordPicker index={index} value={to} onChange={setTo} label={t('graphViewer.pathTo')} colorOf={colorOf} />
    {path === null && <p className='text-xs text-amber-300/80'>{t('graphViewer.pathNone')}</p>}
    {path && <>
      <ol className='space-y-0.5 text-xs'>{path.records.map((id, step) => {
        const record = index.byId.get(id)!;
        const link = path.links[step];
        return <li key={id}>
          <button type='button' onClick={() => onSelect(id)} className='flex w-full items-center gap-2 rounded px-1 py-0.5 text-start hover:bg-white/5'>
            <span className='h-2 w-2 shrink-0 rounded-full' style={{ background: colorOf(record.concept) }} /><span className='min-w-0 flex-1 truncate text-sky-300'>{record.label}</span>
          </button>
          {link && <p className='ms-4 border-l border-white/15 ps-2 text-[11px] text-white/45'>{link.source === id ? '↓' : '↑'} {link.label}</p>}
        </li>;
      })}</ol>
      <button type='button' className='flex items-center gap-1 rounded-md bg-sky-500/20 px-2 py-1 text-xs text-sky-200 hover:bg-sky-500/30' onClick={() => show(path)}><Route className='h-3.5 w-3.5' />{t('graphViewer.showOnGraph')}</button>
    </>}
  </div>;
}
