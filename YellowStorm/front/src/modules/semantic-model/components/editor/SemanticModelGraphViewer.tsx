import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Download, Loader2, Maximize, Network, RefreshCw, Search, Tags, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { parseApiError } from '@/lib/api-error';
import { useModuleTranslation } from '@/modules/localization';
import { semanticModelApi } from '../../api';
import type { GraphOutline, SemanticGraph } from '../../types';
import { buildGraphIndex, mergeOutlines, neighbourhood, searchRecords, shownRecords, withValues, type GraphIndex, type SearchHit } from '../graph/graph-analytics';
import { GraphRecordPanel } from '../graph/GraphRecordPanel';
import { GraphOverviewPanel, type GraphHighlight, type GraphPeriod } from '../graph/GraphOverviewPanel';
import { GraphCanvas, type CanvasEdge, type CanvasLayout, type CanvasNode, type GraphCanvasHandle } from '../graph/GraphCanvas';
import { GraphExportDialog } from '../graph/GraphExportDialog';


const PALETTE = [
  '#059669', '#4f46e5', '#d97706', '#2563eb',
  '#dc2626', '#7c3aed', '#db2777', '#0891b2',
];
const MISSING_RING = '#fbbf24';
/** Beyond the drawing limit the graph opens on one bubble per concept, until people narrow it or ask to draw it all. */
export const DEFAULT_DRAW_LIMIT = 1500;
export const MIN_DRAW_LIMIT = 100;
/** Past this, an SVG drawing no longer moves smoothly: even "draw all" stops here. */
export const MAX_DRAW_LIMIT = 5000;
const LIMIT_KEY = 'semantic-model.graph.drawLimit';

const clampLimit = (value: number) => Math.min(MAX_DRAW_LIMIT, Math.max(MIN_DRAW_LIMIT, Math.round(value)));
/** The limit is a per-browser preference: storage may be missing or refused. */
function storedLimit() {
  try {
    const value = Number(window.localStorage.getItem(LIMIT_KEY));
    return value ? clampLimit(value) : DEFAULT_DRAW_LIMIT;
  } catch { return DEFAULT_DRAW_LIMIT; }
}
const CONCEPT_PREFIX = 'concept:';

interface Props {
  open: boolean;
  onClose: () => void;
  modelId: string;
  dataRevisionId?: string;
  onDataRevision?: (revisionId: string | undefined) => void;
  canEdit?: boolean;
  /** Owners and editors may take the whole graph out of the app as a file. */
  canExport?: boolean;
  onRebuildStarted?: (jobId: string) => void;
  /** A record to open once the graph is read (a chat citation's "Open in graph"); found says whether it is drawn. */
  initialRecordId?: string | null;
  onInitialRecord?: (found: boolean) => void;
  /** A centred window over the page (opened from a chat citation) instead of the whole screen. */
  modal?: boolean;
}

/** Same-named records of a concept are told apart by their first date. */
function displayLabels(index: GraphIndex) {
  const counts = new Map<string, number>();
  for (const record of index.records) counts.set(`${record.concept}:${record.label}`, (counts.get(`${record.concept}:${record.label}`) ?? 0) + 1);
  return new Map(index.records.map((record) => {
    if ((counts.get(`${record.concept}:${record.label}`) ?? 0) < 2) return [record.id, record.label];
    const qualifier = Object.values(record.dates)[0];
    return [record.id, qualifier ? `${record.label} · ${qualifier.slice(0, 10)}` : record.label];
  }));
}

/** Waits for typing to pause before searching the server. */
function useSettled<T>(value: T, delay = 250) {
  const [settled, setSettled] = useState(value);
  useEffect(() => { const timer = setTimeout(() => setSettled(value), delay); return () => clearTimeout(timer); }, [value, delay]);
  return settled;
}

export function SemanticModelGraphViewer({ open, onClose, modelId, dataRevisionId, onDataRevision, canEdit = false, canExport = false, onRebuildStarted, initialRecordId, onInitialRecord, modal = false }: Props) {
  const { t, language } = useModuleTranslation('semantic-model');
  const canvas = useRef<GraphCanvasHandle>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(false);
  const [outline, setOutline] = useState<GraphOutline | null>(null);
  const [loadCount, setLoadCount] = useState(0);
  const [modelGraph, setModelGraph] = useState<SemanticGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [focusDepth, setFocusDepth] = useState<0 | 1 | 2>(0);
  const [layout, setLayout] = useState<CanvasLayout>('force');
  const [drawLimit, setDrawLimitState] = useState(storedLimit);
  const [limitDraft, setLimitDraft] = useState(String(drawLimit));
  const [linkNames, setLinkNames] = useState(false);
  const [highlight, setHighlight] = useState<GraphHighlight | null>(null);
  const [period, setPeriod] = useState<GraphPeriod | null>(null);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [drawAll, setDrawAll] = useState(false);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  // A large graph is read in part: the concept whose records are read ('' for a share of every concept), and a read around one record.
  const [serverConcept, setServerConcept] = useState('');
  const [expanding, setExpanding] = useState(false);
  const [expandError, setExpandError] = useState<string | null>(null);
  const [pendingOpen, setPendingOpen] = useState<string | null>(null);
  const revision = outline?.dataRevisionId ?? dataRevisionId;
  const windowed = Boolean(outline?.truncated);
  const totals = outline?.totals ?? null;

  /** Keeps a new drawing limit for this browser; a value out of range is brought back into it. */
  const setDrawLimit = (value: number) => {
    const limit = Number.isFinite(value) && value > 0 ? clampLimit(value) : drawLimit;
    setDrawLimitState(limit);
    setLimitDraft(String(limit));
    try { window.localStorage.setItem(LIMIT_KEY, String(limit)); } catch { /* kept for this visit only */ }
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSelectedId(null);
    setHighlight(null);
    setExpandError(null);
    try {
      const [loaded, structure] = await Promise.all([
        semanticModelApi.getGraphOutline(modelId, dataRevisionId, serverConcept ? { conceptId: serverConcept } : undefined),
        semanticModelApi.graph(modelId),
      ]);
      setOutline(loaded);
      setLoadCount((count) => count + 1);
      if (loaded.dataRevisionId) onDataRevision?.(loaded.dataRevisionId);
      setModelGraph(structure);
    } catch (err: unknown) {
      setError(parseApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, [dataRevisionId, modelId, onDataRevision, serverConcept]);

  useEffect(() => {
    if (open && modelId) void load();
  }, [open, modelId, load]);
  // The concept read belongs to the model and the visit: a closed viewer starts again from a share of every concept.
  useEffect(() => { if (!open) setServerConcept(''); }, [open]);

  /** Reads the records linked to one record and adds them to those shown; false when the record is not found. */
  const expand = useCallback(async (recordId: string) => {
    setExpanding(true);
    setExpandError(null);
    try {
      const more = await semanticModelApi.getGraphOutline(modelId, revision, { focus: recordId });
      setOutline((current) => (current ? mergeOutlines(current, more) : more));
      return more.records.some((record) => record.id === recordId);
    } catch (err: unknown) {
      setExpandError(parseApiError(err).message);
      return false;
    } finally {
      setExpanding(false);
    }
  }, [modelId, revision]);

  const index = useMemo(() => buildGraphIndex(outline, modelGraph), [outline, modelGraph]);
  const conceptName = useCallback((conceptId: string) => modelGraph?.nodes.find((concept) => concept.id === conceptId)?.label ?? conceptId.replaceAll('_', ' '), [modelGraph]);
  const labels = useMemo(() => displayLabels(index), [index]);
  const conceptOrder = useMemo(() => index.concepts.map((concept) => concept.key), [index]);
  const colorOf = useCallback((concept: string) => {
    const position = conceptOrder.indexOf(concept);
    return PALETTE[position >= 0 ? position % PALETTE.length : 0];
  }, [conceptOrder]);
  const baseRecord = selectedId ? index.byId.get(selectedId) ?? null : null;

  // The selected record's values are read when it is opened.
  const values = useQuery({
    queryKey: ['semantic-model', modelId, 'graph-record', revision, selectedId],
    queryFn: () => semanticModelApi.getGraphRecord(modelId, selectedId!, revision),
    enabled: open && Boolean(baseRecord),
    staleTime: 60_000,
  });
  const selected = baseRecord && values.data?.id === baseRecord.id ? withValues(baseRecord, values.data.values) : baseRecord;

  // What is shown: concepts shown, inside the period kept, near the focused record — the selection always.
  const focusOn = focusDepth ? selectedId : null;
  const near = useMemo(() => (focusOn && index.byId.has(focusOn) ? neighbourhood(index, focusOn, focusDepth) : null), [index, focusOn, focusDepth]);
  const shown = useMemo(() => shownRecords(index, { hidden, near, period }), [index, hidden, near, period]);
  const missingSelection = selectedId && !shown.has(selectedId) && index.byId.has(selectedId) ? selectedId : null;
  const visible = useMemo(() => (missingSelection ? new Set([...shown, missingSelection]) : shown), [shown, missingSelection]);

  // Too many records to read as a drawing: one bubble per concept, unless asked, or unless what is singled out is small.
  const drawn = useMemo(() => {
    if (visible.size <= drawLimit || (drawAll && visible.size <= MAX_DRAW_LIMIT)) return visible;
    if (highlight && highlight.ids.size <= drawLimit) return new Set([...highlight.ids].filter((id) => index.byId.has(id)));
    return null;
  }, [visible, drawAll, highlight, index, drawLimit]);
  useEffect(() => { if (visible.size <= drawLimit) setDrawAll(false); }, [visible.size, drawLimit]);

  const { nodes, edges } = useMemo((): { nodes: CanvasNode[]; edges: CanvasEdge[] } => {
    if (drawn) {
      const nodes = [...drawn].map((id) => {
        const record = index.byId.get(id)!;
        const degree = index.degree.get(id) ?? 0;
        return { id, label: labels.get(id) ?? record.label, sub: record.conceptLabel, color: colorOf(record.concept), size: 24 + Math.min(26, Math.sqrt(degree) * 5), concept: record.concept, ring: record.missing > 0, degree };
      });
      const edges = index.links.filter((link) => drawn.has(link.source) && drawn.has(link.target))
        .map((link) => ({ id: link.id, source: link.source, target: link.target, label: link.label }));
      return { nodes, edges };
    }
    // One bubble per concept, the links between them counted.
    const counts = new Map<string, number>();
    for (const id of visible) { const concept = index.byId.get(id)!.concept; counts.set(concept, (counts.get(concept) ?? 0) + 1); }
    const pairs = new Map<string, CanvasEdge & { count: number }>();
    for (const link of index.links) {
      if (!visible.has(link.source) || !visible.has(link.target)) continue;
      const from = index.byId.get(link.source)!.concept;
      const to = index.byId.get(link.target)!.concept;
      const key = `${link.relation}|${from}|${to}`;
      const pair = pairs.get(key) ?? { id: key, source: CONCEPT_PREFIX + from, target: CONCEPT_PREFIX + to, label: link.label, count: 0 };
      pair.count++;
      pairs.set(key, pair);
    }
    return {
      nodes: index.concepts.filter((concept) => counts.has(concept.key)).map((concept) => ({
        id: CONCEPT_PREFIX + concept.key, label: concept.label, sub: counts.get(concept.key)!.toLocaleString(language), color: colorOf(concept.key),
        size: 40 + Math.min(60, Math.sqrt(counts.get(concept.key)!) / 2), concept: concept.key, degree: 0,
      })),
      edges: [...pairs.values()].map(({ count, ...pair }) => ({ ...pair, label: `${pair.label} · ${count.toLocaleString(language)}` })),
    };
  }, [drawn, visible, index, labels, colorOf, language]);

  /** Selects a record, shows its concept again if it was hidden, and brings it to the middle. */
  const goTo = useCallback((id: string) => {
    const record = index.byId.get(id);
    if (!record) return;
    setHidden((current) => (current.has(record.concept) ? new Set([...current].filter((key) => key !== record.concept)) : current));
    setSelectedId(id);
    // Among too many records to draw, a record opens with its neighbours.
    if (!drawn) setFocusDepth((depth) => depth || 1);
    setTimeout(() => canvas.current?.centerOn(id), 120);
  }, [index, drawn]);

  // The record asked for is opened once, after the graph it belongs to is read.
  const openedInitial = useRef<string | null>(null);
  useEffect(() => {
    if (!open || loading || !outline || !initialRecordId || openedInitial.current === initialRecordId) return;
    openedInitial.current = initialRecordId;
    const found = index.byId.has(initialRecordId);
    if (found) goTo(initialRecordId);
    if (found || !windowed) { onInitialRecord?.(found); return; }
    // The record may be among those not read yet: read it with its neighbours, then open it.
    void expand(initialRecordId).then((read) => {
      if (read) setPendingOpen(initialRecordId);
      onInitialRecord?.(read);
    });
  }, [open, loading, outline, initialRecordId, index, goTo, onInitialRecord, windowed, expand]);
  useEffect(() => {
    if (!pendingOpen || !index.byId.has(pendingOpen)) return;
    goTo(pendingOpen);
    setPendingOpen(null);
  }, [pendingOpen, index, goTo]);

  const onlyConcept = useCallback((concept: string) => setHidden(new Set(index.concepts.filter((item) => item.key !== concept).map((item) => item.key))), [index]);
  const onCanvasSelect = useCallback((id: string | null) => {
    if (id?.startsWith(CONCEPT_PREFIX)) { onlyConcept(id.slice(CONCEPT_PREFIX.length)); return; }
    setSelectedId(id);
  }, [onlyConcept]);
  const onCanvasOpen = useCallback((id: string) => {
    if (id.startsWith(CONCEPT_PREFIX)) { onlyConcept(id.slice(CONCEPT_PREFIX.length)); return; }
    setSelectedId(id);
    setFocusDepth((depth) => depth || 1);
  }, [onlyConcept]);

  // What the overview singles out is brought into view once drawn.
  useEffect(() => {
    if (!highlight) return;
    const timer = setTimeout(() => canvas.current?.fit(highlight.ids), 150);
    return () => clearTimeout(timer);
  }, [highlight, nodes]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName);
      if (event.key === '/' && !typing) { event.preventDefault(); searchRef.current?.focus(); return; }
      if (event.key !== 'Escape' || typing || exportOpen) return;
      // Escape steps back one thing at a time: the selection, then the view.
      if (selectedId) setSelectedId(null); else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, selectedId, exportOpen]);

  useEffect(() => { if (!selectedId) setFocusDepth(0); }, [selectedId]);

  // Search: names here at once, values on the server once typing pauses.
  const nameHits = useMemo(() => searchRecords(index, query), [index, query]);
  const settledQuery = useSettled(query.trim());
  const valueSearch = useQuery({
    queryKey: ['semantic-model', modelId, 'graph-search', revision, settledQuery],
    queryFn: () => semanticModelApi.searchGraph(modelId, settledQuery, revision),
    // Values are searched in the whole graph, which a graph read in part is too large for: names only.
    enabled: open && settledQuery.length >= 2 && nameHits.length < 8 && !windowed,
    staleTime: 60_000,
  });
  const results = useMemo((): SearchHit[] => {
    if (!query.trim()) return [];
    const named = new Set(nameHits.map((hit) => hit.record.id));
    const byValue = settledQuery === query.trim() ? (valueSearch.data?.hits ?? []) : [];
    const more = byValue.filter((hit) => !named.has(hit.id) && index.byId.has(hit.id)).map((hit) => {
      const record = index.byId.get(hit.id)!;
      return { record, score: 2, field: record.fields.find((field) => field.key === hit.field)?.label ?? hit.field, value: hit.value };
    });
    return [...nameHits, ...more].slice(0, 8);
  }, [query, settledQuery, nameHits, valueSearch.data, index]);
  const searching = valueSearch.isFetching || (query.trim().length >= 2 && settledQuery !== query.trim() && nameHits.length < 8);

  const pick = (id: string) => { goTo(id); setQuery(''); setSearchOpen(false); };
  const toggleConcept = (concept: string) => setHidden((current) => {
    const next = new Set(current);
    if (next.has(concept)) next.delete(concept); else next.add(concept);
    return next;
  });
  const filtered = hidden.size > 0 || Boolean(period) || focusDepth > 0;
  const clearFilters = () => { setHidden(new Set()); setPeriod(null); setFocusDepth(0); };
  const summary = !drawn && index.records.length > 0;

  if (!open) return null;

  const tool = 'h-8 gap-1.5 px-2 text-xs text-white/70 hover:bg-white/10 hover:text-white';
  const pressed = 'bg-white/15 text-white';

  return (
    <div className={modal ? 'fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 sm:p-8' : 'contents'}
      onMouseDown={modal ? (event) => { if (event.target === event.currentTarget) onClose(); } : undefined}>
    <div role={modal ? 'dialog' : undefined} aria-modal={modal || undefined} aria-label={modal ? t('graphViewer.title') : undefined}
      className={modal ? 'flex h-full max-h-[90vh] w-full max-w-7xl flex-col overflow-hidden rounded-xl border border-white/10 shadow-2xl' : 'fixed inset-0 z-50 flex flex-col'}
      style={{ background: '#0f0f1a' }}>
      {/* Header */}
      <div className="shrink-0 space-y-1.5 border-b border-white/10 px-4 py-2.5">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold text-white">{t('graphViewer.title')}</h2>
        {/* Search: a record by its name or one of its values. */}
        <div className="relative w-72 max-w-full">
          <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-white/40" />
          <input ref={searchRef} value={query} onChange={(event) => { setQuery(event.target.value); setSearchOpen(true); }}
            onFocus={() => setSearchOpen(true)} onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
            onKeyDown={(event) => { if (event.key === 'Enter' && results[0]) pick(results[0].record.id); if (event.key === 'Escape') { setQuery(''); (event.target as HTMLInputElement).blur(); } }}
            placeholder={t('graphViewer.searchPlaceholder')} aria-label={t('graphViewer.search')}
            className="h-8 w-full rounded-md border border-white/15 bg-white/5 pl-8 pr-2 text-sm text-white placeholder:text-white/35 focus:outline-none focus:ring-1 focus:ring-sky-400" />
          {searchOpen && query.trim() && <ul role="listbox" aria-label={t('graphViewer.searchResults')} className="absolute left-0 right-0 top-9 z-20 max-h-80 overflow-y-auto rounded-md border border-white/10 bg-[#1a1a2b] py-1 shadow-xl">
            {!results.length && !searching && <li className="px-3 py-2 text-xs text-white/45">{t('graphViewer.noMatch')}</li>}
            {results.map(({ record, field, value }) => <li key={record.id} role="option" aria-selected={false}>
              <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => pick(record.id)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-white/10">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorOf(record.concept) }} />
                <span className="min-w-0 flex-1"><span className="block truncate text-sm text-white">{record.label}</span>
                  {field && <span className="block truncate text-[11px] text-white/45">{field}: {value}</span>}</span>
                <span className="shrink-0 text-[11px] text-white/40">{record.conceptLabel}</span>
              </button>
            </li>)}
            {searching && <li className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-white/45"><Loader2 className="h-3 w-3 animate-spin" />{t('graphViewer.searchingValues')}</li>}
          </ul>}
        </div>
        <div className="flex-1" />
        {canExport && index.records.length > 0 && <Button variant="ghost" size="sm" className="gap-1.5 text-white/60 hover:bg-white/10 hover:text-white" disabled={windowed} onClick={() => setExportOpen(true)} title={windowed ? t('graphViewer.exportWindowed') : t('graphViewer.exportHelpShort')}>
          <Download className="h-3.5 w-3.5" /><span className="hidden sm:inline">{t('graphViewer.export')}</span>
        </Button>}
        <Button variant="ghost" size="sm" className="gap-1.5 text-white/60 hover:bg-white/10 hover:text-white" onClick={() => void load()} disabled={loading} aria-label={t('graphViewer.refresh')} title={t('graphViewer.refresh')}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </Button>
        <Button variant="ghost" size="icon" className="text-white/60 hover:bg-white/10 hover:text-white" onClick={onClose} aria-label={t('graphViewer.close')}>
          <X className="h-5 w-5" />
        </Button>
      </div>
        {/* Legend: each concept with its records; clicking shows or hides them. */}
        <div className="-ml-2 flex flex-wrap items-center gap-1" aria-label={t('graphViewer.legend')} role="group">
          {index.concepts.map((concept) => {
            const isShown = !hidden.has(concept.key);
            return <button key={concept.key} type="button" aria-pressed={isShown} onClick={() => toggleConcept(concept.key)}
              title={isShown ? t('graphViewer.hideConcept', { concept: concept.label }) : t('graphViewer.showConcept', { concept: concept.label })}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-1 text-xs hover:bg-white/10 ${isShown ? 'text-white/75' : 'text-white/30 line-through'}`}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colorOf(concept.key), opacity: isShown ? 1 : 0.3 }} />
              {concept.label}<span className="tabular-nums text-white/40">{concept.count.toLocaleString(language)}{windowed && totals?.concepts[concept.conceptId] !== undefined && totals.concepts[concept.conceptId] !== concept.count ? ` / ${totals.concepts[concept.conceptId].toLocaleString(language)}` : ''}</span>
            </button>;
          })}
          {hidden.size > 0 && <button type="button" onClick={() => setHidden(new Set())} className="px-2 text-xs text-sky-300 hover:underline">{t('graphViewer.showAll')}</button>}
          {totals && (windowed || serverConcept) && <label className="ml-auto flex items-center gap-1.5 text-xs text-white/50" title={t('graphViewer.loadConceptHelp')}>{t('graphViewer.loadConcept')}
            <select value={serverConcept} disabled={loading} onChange={(event) => setServerConcept(event.target.value)} className="h-7 max-w-[16rem] rounded-md border border-white/15 bg-[#1a1a2b] px-1.5 text-xs text-white disabled:opacity-40">
              <option value="">{t('graphViewer.allConcepts')}</option>
              {Object.entries(totals.concepts).map(([conceptId, count]) => <option key={conceptId} value={conceptId}>{t('graphViewer.conceptOption', { concept: conceptName(conceptId), records: count.toLocaleString(language) })}</option>)}
            </select>
          </label>}
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {overviewOpen && index.records.length > 0 && <GraphOverviewPanel index={index} colorOf={colorOf} onSelect={goTo} highlight={highlight} onHighlight={setHighlight}
          onOnlyConcept={onlyConcept} period={period} onPeriod={setPeriod} onClose={() => setOverviewOpen(false)} />}

        <div className="relative flex-1 overflow-hidden">
          {/* Tools over the canvas */}
          {index.records.length > 0 && <div className="absolute left-3 top-3 z-10 flex flex-wrap items-center gap-1 rounded-lg border border-white/10 bg-[#15152a]/90 p-1 backdrop-blur" role="toolbar" aria-label={t('graphViewer.tools')}>
            <Button variant="ghost" size="sm" className={`${tool} ${overviewOpen ? pressed : ''}`} aria-pressed={overviewOpen} aria-label={t('graphViewer.overview')} title={t('graphViewer.overview')} onClick={() => setOverviewOpen(!overviewOpen)}><BarChart3 className="h-3.5 w-3.5" /><span className="hidden lg:inline">{t('graphViewer.overview')}</span></Button>
            <Button variant="ghost" size="sm" className={tool} onClick={() => canvas.current?.fit()} title={t('graphViewer.fit')} aria-label={t('graphViewer.fit')}><Maximize className="h-3.5 w-3.5" /><span className="hidden lg:inline">{t('graphViewer.fit')}</span></Button>
            {windowed && <Button variant="ghost" size="sm" className={tool} disabled={!selectedId || expanding} onClick={() => { if (selectedId) void expand(selectedId).then((read) => { if (read) setFocusDepth((depth) => depth || 1); }); }} aria-label={t('graphViewer.loadNeighbours')} title={t('graphViewer.loadNeighboursHelp')}>
              {expanding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Network className="h-3.5 w-3.5" />}<span className="hidden lg:inline">{t('graphViewer.loadNeighbours')}</span></Button>}
            <Button variant="ghost" size="sm" className={`${tool} ${linkNames ? pressed : ''}`} aria-pressed={linkNames} aria-label={t('graphViewer.linkNames')} onClick={() => setLinkNames(!linkNames)} title={t('graphViewer.linkNamesHelp')}><Tags className="h-3.5 w-3.5" /><span className="hidden lg:inline">{t('graphViewer.linkNames')}</span></Button>
            <label className="flex items-center gap-1 px-1 text-xs text-white/50">{t('graphViewer.layout')}
              <select value={layout} disabled={summary} onChange={(event) => setLayout(event.target.value as CanvasLayout)} className="h-7 rounded-md border border-white/15 bg-[#1a1a2b] px-1.5 text-xs text-white disabled:opacity-40">
                <option value="force">{t('graphViewer.layoutForce')}</option>
                <option value="concept">{t('graphViewer.layoutConcept')}</option>
                <option value="radial" disabled={!selectedId}>{t('graphViewer.layoutRadial')}</option>
              </select>
            </label>
            <label className="flex items-center gap-1 px-1 text-xs text-white/50" title={t('graphViewer.focusHelp')}>{t('graphViewer.focus')}
              <select value={focusDepth} disabled={!selectedId} onChange={(event) => setFocusDepth(Number(event.target.value) as 0 | 1 | 2)} className="h-7 rounded-md border border-white/15 bg-[#1a1a2b] px-1.5 text-xs text-white disabled:opacity-40">
                <option value={0}>{t('graphViewer.focusOff')}</option>
                <option value={1}>{t('graphViewer.focusSteps', { count: 1 })}</option>
                <option value={2}>{t('graphViewer.focusSteps', { count: 2 })}</option>
              </select>
            </label>
            <label className="flex items-center gap-1 px-1 text-xs text-white/50" title={t('graphViewer.drawLimitHelp', { min: MIN_DRAW_LIMIT, max: MAX_DRAW_LIMIT })}>{t('graphViewer.drawLimit')}
              <input type="number" min={MIN_DRAW_LIMIT} max={MAX_DRAW_LIMIT} step={100} value={limitDraft}
                onChange={(event) => setLimitDraft(event.target.value)}
                onBlur={() => setDrawLimit(Number(limitDraft))}
                onKeyDown={(event) => { if (event.key === 'Enter') setDrawLimit(Number(limitDraft)); }}
                className="h-7 w-[4.5rem] rounded-md border border-white/15 bg-[#1a1a2b] px-1.5 text-xs text-white" aria-label={t('graphViewer.drawLimit')} />
            </label>
          </div>}

          {/* Too many to draw: say so, and how to narrow it. */}
          {summary && <div className="absolute left-1/2 top-16 z-10 w-[min(36rem,calc(100%-1.5rem))] -translate-x-1/2 rounded-lg border border-sky-400/20 bg-[#15152a]/95 px-4 py-3 text-xs text-white/75 shadow-xl" role="note">
            <p>{t('graphViewer.tooManyToDraw', { records: visible.size.toLocaleString(language), limit: drawLimit.toLocaleString(language) })}</p>
            {visible.size <= MAX_DRAW_LIMIT
              ? <button type="button" onClick={() => setDrawAll(true)} className="mt-1.5 text-sky-300 hover:underline">{t('graphViewer.drawAll', { records: visible.size.toLocaleString(language) })}</button>
              : <p className="mt-1.5 text-white/50">{t('graphViewer.tooManyEvenAll', { max: MAX_DRAW_LIMIT.toLocaleString(language) })}</p>}
          </div>}

          {/* What is shown, and what narrows it */}
          {index.records.length > 0 && <div className="absolute bottom-3 left-3 z-10 flex flex-wrap items-center gap-2 text-xs text-white/55" role="status">
            <span>{t('graphViewer.showing', { shown: (drawn?.size ?? visible.size).toLocaleString(language), total: index.records.length.toLocaleString(language) })}</span>
            {windowed && totals && <span className="rounded-full bg-sky-400/15 px-2 py-0.5 text-sky-200" title={t('graphViewer.windowHelp')}>{t('graphViewer.windowShowing', { shown: index.records.length.toLocaleString(language), total: (serverConcept ? totals.concepts[serverConcept] ?? index.records.length : totals.records).toLocaleString(language) })}</span>}
            {expandError && <span className="rounded-full bg-red-400/15 px-2 py-0.5 text-red-200" role="alert">{t('graphViewer.loadNeighboursFailed', { message: expandError })}</span>}
            {focusDepth > 0 && selected && <span className="rounded-full bg-white/10 px-2 py-0.5">{t('graphViewer.focusOn', { record: selected.label, count: focusDepth })}</span>}
            {period && <span className="rounded-full bg-white/10 px-2 py-0.5">{t('graphViewer.periodActive', { from: period.from, to: period.to })}</span>}
            {highlight && !overviewOpen && <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-amber-200">{highlight.reason} <button type="button" className="ml-1 underline" onClick={() => setHighlight(null)}>{t('graphViewer.clearHighlight')}</button></span>}
            {filtered && <button type="button" onClick={clearFilters} className="text-sky-300 hover:underline">{t('graphViewer.clearFilters')}</button>}
            {!summary && <span className="flex items-center gap-1 text-white/40"><span className="inline-block h-3 w-3 rounded-full border-2" style={{ borderColor: MISSING_RING }} />{t('graphViewer.missingLegend')}</span>}
          </div>}

          {loading && (
            <div className="absolute inset-0 z-20 flex items-center justify-center gap-2 text-white/50">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">{t('graphViewer.loading')}</span>
            </div>
          )}
          {!loading && error && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3">
              <p className="text-sm text-red-400">{error}</p>
              <Button variant="outline" size="sm" onClick={() => void load()} className="border-white/20 text-white hover:bg-white/10">
                {t('graphViewer.retry')}
              </Button>
            </div>
          )}
          {!loading && !error && outline && index.records.length === 0 && (
            <div className="absolute inset-0 z-20 flex items-center justify-center text-sm text-white/40">
              {t('graphViewer.empty')}
            </div>
          )}
          <GraphCanvas ref={canvas} nodes={nodes} edges={edges} dataKey={`${modelId}:${loadCount}:${summary ? 'summary' : 'records'}`}
            layout={summary ? 'force' : layout} radialCenter={layout === 'radial' ? selectedId : null} conceptOrder={conceptOrder}
            selectedId={selectedId} highlight={highlight} linkNames={linkNames || summary}
            label={t('graphViewer.canvasLabel', { shown: nodes.length })}
            onSelect={onCanvasSelect} onOpen={onCanvasOpen} />
        </div>

        {selected && <GraphRecordPanel key={selected.id} index={index} record={selected} valuesLoading={values.isLoading}
          valuesError={values.error ? parseApiError(values.error).message : null} sourceFileName={values.data?.id === selected.id ? values.data.sourceFileName : null}
          color={colorOf(selected.concept)} modelId={modelId} canEdit={canEdit}
          onRebuildStarted={onRebuildStarted} onSelect={goTo} onCenter={(id) => canvas.current?.centerOn(id)} onClose={() => setSelectedId(null)} />}
      </div>
      {canExport && exportOpen && <GraphExportDialog open={exportOpen} onOpenChange={setExportOpen} index={index} modelId={modelId} dataRevisionId={revision} colorOf={colorOf} drawLimit={drawLimit} maxDraw={MAX_DRAW_LIMIT} />}
    </div>
    </div>
  );
}
