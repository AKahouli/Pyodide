import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as d3Force from 'd3-force';
import * as d3Selection from 'd3-selection';
import * as d3Zoom from 'd3-zoom';
import * as d3Drag from 'd3-drag';
import { BarChart3, Loader2, Maximize, RefreshCw, Search, Tags, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { parseApiError } from '@/lib/api-error';
import { useModuleTranslation } from '@/modules/localization';
import { semanticModelApi } from '../../api';
import type { AgeGraphEdge, AgeGraphNode, SemanticGraph } from '../../types';
import { buildGraphIndex, neighbourhood, searchRecords, shownRecords, type GraphIndex, type GraphLink, type GraphRecord } from '../graph/graph-analytics';
import { GraphRecordPanel } from '../graph/GraphRecordPanel';
import { GraphOverviewPanel, type GraphHighlight, type GraphPeriod } from '../graph/GraphOverviewPanel';

const PALETTE = [
  '#059669', '#4f46e5', '#d97706', '#2563eb',
  '#dc2626', '#7c3aed', '#db2777', '#0891b2',
];
const MISSING_RING = '#fbbf24';

type Layout = 'force' | 'concept' | 'radial';

type SimNode = d3Force.SimulationNodeDatum & { id: string; record: GraphRecord; r: number };
type SimLink = d3Force.SimulationLinkDatum<SimNode> & { link: GraphLink };

interface Props {
  open: boolean;
  onClose: () => void;
  modelId: string;
  dataRevisionId?: string;
  onDataRevision?: (revisionId: string | undefined) => void;
  canEdit?: boolean;
  onRebuildStarted?: (jobId: string) => void;
}

/** Moves the view to a transform over a moment, so people see where it went. */
function animateTo(svgEl: SVGSVGElement, zoom: d3Zoom.ZoomBehavior<SVGSVGElement, unknown>, target: d3Zoom.ZoomTransform) {
  // A hidden page draws no frames: go there at once.
  if (document.hidden) { d3Selection.select(svgEl).call(zoom.transform, target); return; }
  const start = d3Zoom.zoomTransform(svgEl);
  const began = performance.now();
  const step = (now: number) => {
    const progress = Math.min(1, (now - began) / 400);
    const eased = progress < 0.5 ? 2 * progress * progress : 1 - (-2 * progress + 2) ** 2 / 2;
    const mix = (from: number, to: number) => from + (to - from) * eased;
    d3Selection.select(svgEl).call(zoom.transform, d3Zoom.zoomIdentity.translate(mix(start.x, target.x), mix(start.y, target.y)).scale(mix(start.k, target.k)));
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** A record drawn bigger the more it is linked, so hubs stand out. */
const radiusOf = (degree: number) => 24 + Math.min(26, Math.sqrt(degree) * 5);

// Wrap long text into 2 lines to fit inside the circle
function wrapLines(text: string, maxLen = 14): [string, string | null] {
  const qualified = text.split(' · ');
  if (qualified.length === 2 && qualified.every((part) => part.length <= maxLen)) return [qualified[0], qualified[1]];
  if (text.length <= maxLen) return [text, null];
  const mid = Math.max(text.lastIndexOf(' ', maxLen), text.lastIndexOf('-', maxLen - 1));
  if (mid > 0) return [text.slice(0, mid + (text[mid] === '-' ? 1 : 0)), text.slice(mid + 1).slice(0, maxLen)];
  return [text.slice(0, maxLen - 1) + '…', null];
}

/** Same-named records of a concept are told apart by their first other value (e.g. a date). */
function displayLabels(index: GraphIndex) {
  const counts = new Map<string, number>();
  for (const record of index.records) counts.set(`${record.concept}:${record.label}`, (counts.get(`${record.concept}:${record.label}`) ?? 0) + 1);
  return new Map(index.records.map((record) => {
    if ((counts.get(`${record.concept}:${record.label}`) ?? 0) < 2) return [record.id, record.label];
    const qualifier = record.fields.find((field) => !field.missing && String(field.value) !== record.label)?.value;
    return [record.id, qualifier == null ? record.label : `${record.label} · ${String(qualifier)}`];
  }));
}

export function SemanticModelGraphViewer({ open, onClose, modelId, dataRevisionId, onDataRevision, canEdit = false, onRebuildStarted }: Props) {
  const { t } = useModuleTranslation('semantic-model');
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(false);
  const [ageNodes, setAgeNodes] = useState<AgeGraphNode[]>([]);
  const [ageEdges, setAgeEdges] = useState<AgeGraphEdge[]>([]);
  const [modelGraph, setModelGraph] = useState<SemanticGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [focusDepth, setFocusDepth] = useState<0 | 1 | 2>(0);
  const [layout, setLayout] = useState<Layout>('force');
  const [linkNames, setLinkNames] = useState(false);
  const [highlight, setHighlight] = useState<GraphHighlight | null>(null);
  const [period, setPeriod] = useState<GraphPeriod | null>(null);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);

  // Where each record was last drawn, and whether this graph was fitted to the screen yet.
  const positions = useRef(new Map<string, { x: number; y: number }>());
  const fitted = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSelectedId(null);
    setHighlight(null);
    try {
      const [{ nodes, edges, dataRevisionId: loadedRevisionId }, structure] = await Promise.all([
        semanticModelApi.getAgeGraph(modelId, dataRevisionId),
        semanticModelApi.graph(modelId),
      ]);
      // New data opens on a new layout.
      fitted.current = false;
      positions.current.clear();
      setAgeNodes(nodes);
      if (loadedRevisionId) onDataRevision?.(loadedRevisionId);
      setAgeEdges(edges);
      setModelGraph(structure);
    } catch (err: unknown) {
      setError(parseApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, [dataRevisionId, modelId, onDataRevision]);

  useEffect(() => {
    if (open && modelId) void load();
  }, [open, modelId, load]);

  const index = useMemo(() => buildGraphIndex(ageNodes, ageEdges, modelGraph), [ageNodes, ageEdges, modelGraph]);
  const labels = useMemo(() => displayLabels(index), [index]);
  const colorOf = useCallback((concept: string) => {
    const position = index.concepts.findIndex((item) => item.key === concept);
    return PALETTE[position >= 0 ? position % PALETTE.length : 0];
  }, [index]);
  const selected = selectedId ? index.byId.get(selectedId) ?? null : null;

  // What is drawn: concepts shown, inside the period kept, near the focused record.
  const visible = useMemo(() => {
    const near = focusDepth && selectedId && index.byId.has(selectedId) ? neighbourhood(index, selectedId, focusDepth) : null;
    return shownRecords(index, { hidden, near, period, keep: selectedId });
  }, [index, hidden, focusDepth, selectedId, period]);
  const visibleKey = useMemo(() => [...visible].sort().join(','), [visible]);
  const radialCenter = layout === 'radial' ? selectedId : null;

  // ── D3 ─────────────────────────────────────────────────────────────────────
  const zoomRef = useRef<d3Zoom.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const simNodesRef = useRef<SimNode[]>([]);
  const drawn = useRef<{
    node?: d3Selection.Selection<SVGGElement, SimNode, SVGGElement, unknown>;
    link?: d3Selection.Selection<SVGLineElement, SimLink, SVGGElement, unknown>;
    linkLabel?: d3Selection.Selection<SVGTextElement, SimLink, SVGGElement, unknown>;
  }>({});
  const hovered = useRef<string | null>(null);

  /** Fits the records drawn — or only some of them — to the screen. */
  const fit = useCallback((animate = true, only?: Set<string>) => {
    const svgEl = svgRef.current;
    const box = containerRef.current?.getBoundingClientRect();
    const nodes = only ? simNodesRef.current.filter((node) => only.has(node.id)) : simNodesRef.current;
    if (!svgEl || !box || !box.width || !nodes.length || !zoomRef.current) return;
    const xs = nodes.map((node) => node.x ?? 0);
    const ys = nodes.map((node) => node.y ?? 0);
    const [minX, maxX, minY, maxY] = [Math.min(...xs) - 60, Math.max(...xs) + 60, Math.min(...ys) - 60, Math.max(...ys) + 60];
    const scale = Math.min(1.6, box.width / (maxX - minX), box.height / (maxY - minY));
    const transform = d3Zoom.zoomIdentity.translate(box.width / 2 - ((minX + maxX) / 2) * scale, box.height / 2 - ((minY + maxY) / 2) * scale).scale(scale);
    if (animate) animateTo(svgEl, zoomRef.current, transform);
    else d3Selection.select(svgEl).call(zoomRef.current.transform, transform);
  }, []);

  const centerOn = useCallback((id: string) => {
    const svgEl = svgRef.current;
    const box = containerRef.current?.getBoundingClientRect();
    const node = simNodesRef.current.find((item) => item.id === id);
    if (!svgEl || !box?.width || !node || !zoomRef.current) return;
    const scale = Math.max(d3Zoom.zoomTransform(svgEl).k, 1);
    const transform = d3Zoom.zoomIdentity.translate(box.width / 2 - (node.x ?? 0) * scale, box.height / 2 - (node.y ?? 0) * scale).scale(scale);
    animateTo(svgEl, zoomRef.current, transform);
  }, []);

  /** Selects a record, shows its concept again if it was hidden, and brings it to the middle. */
  const goTo = useCallback((id: string) => {
    const record = index.byId.get(id);
    if (!record) return;
    setHidden((current) => (current.has(record.concept) ? new Set([...current].filter((key) => key !== record.concept)) : current));
    setSelectedId(id);
    setTimeout(() => centerOn(id), 60);
  }, [index, centerOn]);

  // Emphasis — selection, hover, highlight, link names — restyles what is drawn without moving it.
  const restyle = useCallback(() => {
    const { node, link, linkLabel } = drawn.current;
    if (!node || !link || !linkLabel) return;
    const focus = hovered.current ?? selectedId;
    const near = focus ? new Set([focus, ...(index.linksOf.get(focus) ?? []).map((item) => (item.source === focus ? item.target : item.source))]) : null;
    const touches = (item: SimLink) => Boolean(focus && (item.link.source === focus || item.link.target === focus));
    const lit = (item: SimLink) => (highlight?.links ? highlight.links.has(item.link.id) : highlight ? highlight.ids.has(item.link.source) && highlight.ids.has(item.link.target) : touches(item));
    node.attr('opacity', (item) => (highlight ? (highlight.ids.has(item.id) ? 1 : 0.15) : near ? (near.has(item.id) ? 1 : 0.3) : 1));
    node.select<SVGCircleElement>('circle.body')
      .attr('stroke', (item) => (item.id === selectedId ? '#ffffff' : 'rgba(255,255,255,0.18)'))
      .attr('stroke-width', (item) => (item.id === selectedId ? 4 : 2.5));
    link.attr('stroke', (item) => (lit(item) ? (highlight ? '#fbbf24' : 'rgba(255,255,255,0.7)') : 'rgba(255,255,255,0.15)'))
      .attr('stroke-width', (item) => (lit(item) ? 2.5 : 1.25))
      .attr('opacity', (item) => (highlight ? (lit(item) ? 1 : 0.2) : near ? (touches(item) ? 1 : 0.25) : 1));
    linkLabel.attr('display', (item) => (linkNames || lit(item) ? null : 'none'));
  }, [selectedId, highlight, linkNames, index]);
  const restyleRef = useRef(restyle);
  restyleRef.current = restyle;
  useEffect(() => restyle(), [restyle]);
  // What the overview singles out is brought into view.
  useEffect(() => { if (highlight) fit(true, highlight.ids); }, [highlight, fit]);

  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;
    const svgEl = svgRef.current;
    const d3svg = d3Selection.select(svgEl);
    d3svg.selectAll('*').remove();
    drawn.current = {};
    simNodesRef.current = [];
    if (!open || !index.records.length) return;

    const { width, height } = containerRef.current.getBoundingClientRect();
    d3svg.attr('width', width).attr('height', height);

    // Arrowheads sit on the edge of each circle, so each record has its own marker size.
    const defs = d3svg.append('defs');
    const markerFor = (r: number) => {
      const id = `ag-arrow-${Math.round(r)}`;
      if (defs.select(`#${id}`).empty()) {
        defs.append('marker').attr('id', id).attr('viewBox', '0 -5 10 10').attr('refX', r + 11).attr('refY', 0)
          .attr('markerWidth', 6).attr('markerHeight', 6).attr('orient', 'auto')
          .append('path').attr('d', 'M0,-5L10,0L0,5').attr('fill', 'rgba(255,255,255,0.35)');
      }
      return `url(#${id})`;
    };

    const g = d3svg.append('g');
    const zoom = d3Zoom.zoom<SVGSVGElement, unknown>().scaleExtent([0.05, 3]).on('zoom', (event) => g.attr('transform', event.transform.toString()));
    zoomRef.current = zoom;
    d3svg.call(zoom).on('dblclick.zoom', null);
    d3svg.on('click', () => setSelectedId(null));

    const records = index.records.filter((record) => visible.has(record.id));
    const fresh = records.some((record) => !positions.current.has(record.id));
    const simNodes: SimNode[] = records.map((record) => {
      const known = positions.current.get(record.id);
      return {
        id: record.id, record, r: radiusOf(index.degree.get(record.id) ?? 0),
        x: known?.x ?? width / 2 + (Math.random() - 0.5) * 400,
        y: known?.y ?? height / 2 + (Math.random() - 0.5) * 400,
      };
    });
    simNodesRef.current = simNodes;
    const simLinks: SimLink[] = index.links.filter((item) => visible.has(item.source) && visible.has(item.target))
      .map((item) => ({ link: item, source: item.source, target: item.target }));

    const sim = d3Force.forceSimulation<SimNode>(simNodes)
      .force('link', d3Force.forceLink<SimNode, SimLink>(simLinks).id((d) => d.id).distance(160).strength(layout === 'force' ? 0.35 : 0.05))
      .force('charge', d3Force.forceManyBody<SimNode>().strength(-320))
      .force('collision', d3Force.forceCollide<SimNode>((d) => d.r + 10))
      .alphaDecay(0.03);
    // A gentle pull to the middle keeps unlinked groups from drifting off.
    if (layout === 'force') sim.force('center', d3Force.forceCenter(width / 2, height / 2))
      .force('x', d3Force.forceX<SimNode>(width / 2).strength(0.08)).force('y', d3Force.forceY<SimNode>(height / 2).strength(0.08));
    if (layout === 'concept') {
      // One column per concept, in the legend's order.
      const shown = index.concepts.filter((concept) => records.some((record) => record.concept === concept.key));
      const step = 420;
      const columnX = (concept: string) => width / 2 + (shown.findIndex((item) => item.key === concept) - (shown.length - 1) / 2) * step;
      sim.force('x', d3Force.forceX<SimNode>((d) => columnX(d.record.concept)).strength(0.6)).force('y', d3Force.forceY<SimNode>(height / 2).strength(0.04));
    }
    if (layout === 'radial') {
      // Rings by how many links away from the selected record.
      const hops = radialCenter ? neighbourhood(index, radialCenter, 6) : new Map<string, number>();
      const outer = Math.max(1, ...hops.values()) + 1;
      sim.force('r', d3Force.forceRadial<SimNode>((d) => (hops.get(d.id) ?? outer) * 220, width / 2, height / 2).strength(0.9));
      const center = simNodes.find((node) => node.id === radialCenter);
      if (center) { center.fx = width / 2; center.fy = height / 2; }
    }

    const link = g.append('g').selectAll<SVGLineElement, SimLink>('line').data(simLinks).join('line')
      .attr('marker-end', (d) => markerFor(radiusOf(index.degree.get(d.link.target) ?? 0)));

    const linkLabel = g.append('g').selectAll<SVGTextElement, SimLink>('text').data(simLinks).join('text')
      .text((d) => d.link.label)
      .attr('fill', 'rgba(255,255,255,0.6)').attr('font-size', 10).attr('font-family', 'system-ui, sans-serif')
      .attr('text-anchor', 'middle').attr('pointer-events', 'none')
      .attr('paint-order', 'stroke').attr('stroke', '#0f0f1a').attr('stroke-width', 3);

    const drag = d3Drag.drag<SVGGElement, SimNode>()
      .on('start', (event, d) => { if (!event.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
      .on('end', (event, d) => { if (!event.active) sim.alphaTarget(0); if (d.id !== radialCenter) { d.fx = null; d.fy = null; } });

    const node = g.append('g').selectAll<SVGGElement, SimNode>('g').data(simNodes).join('g')
      .attr('role', 'button').attr('tabindex', 0)
      .attr('aria-label', (d) => `${d.record.label} · ${d.record.conceptLabel}`)
      .style('cursor', 'pointer')
      .on('click', (event, d) => { event.stopPropagation(); setSelectedId(d.id); })
      .on('dblclick', (event, d) => { event.stopPropagation(); setSelectedId(d.id); setFocusDepth((depth) => depth || 1); })
      .on('keydown', (event: KeyboardEvent, d) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedId(d.id); } })
      .on('mouseenter', (_event, d) => { hovered.current = d.id; restyleRef.current(); })
      .on('mouseleave', () => { hovered.current = null; restyleRef.current(); })
      .call(drag);

    // Records missing values wear an amber ring, so gaps show on the graph itself.
    node.filter((d) => d.record.missing > 0).append('circle')
      .attr('r', (d) => d.r + 5).attr('fill', 'none').attr('stroke', MISSING_RING).attr('stroke-width', 2).attr('stroke-dasharray', '4 3').attr('opacity', 0.85);
    node.append('circle').attr('class', 'body').attr('r', (d) => d.r).attr('fill', (d) => colorOf(d.record.concept));
    node.append('title').text((d) => `${d.record.label} · ${d.record.conceptLabel}${d.record.missing ? ` · ${t('graphViewer.missingCount', { count: d.record.missing })}` : ''}`);

    node.each(function (d) {
      const group = d3Selection.select(this);
      const maxLen = Math.max(8, Math.round(d.r / 3));
      const [line1, line2] = wrapLines(labels.get(d.id) ?? d.record.label, maxLen);
      const yOff = line2 ? -7 : 0;
      const text = (dy: number, value: string, size: number, fill: string, weight = 700) => group.append('text')
        .attr('text-anchor', 'middle').attr('dy', dy).attr('fill', fill).attr('font-size', size).attr('font-weight', weight)
        .attr('font-family', 'system-ui, sans-serif').attr('pointer-events', 'none').text(value);
      text(yOff, line1, 10, 'white');
      if (line2) text(yOff + 13, line2.length > maxLen ? `${line2.slice(0, maxLen - 1)}…` : line2, 10, 'white');
      if (d.r >= 30) text(line2 ? yOff + 26 : 16, d.record.conceptLabel, 8, 'rgba(255,255,255,0.55)', 400);
    });

    const draw = () => {
      link.attr('x1', (d) => (d.source as SimNode).x ?? 0).attr('y1', (d) => (d.source as SimNode).y ?? 0)
        .attr('x2', (d) => (d.target as SimNode).x ?? 0).attr('y2', (d) => (d.target as SimNode).y ?? 0);
      linkLabel.attr('x', (d) => (((d.source as SimNode).x ?? 0) + ((d.target as SimNode).x ?? 0)) / 2)
        .attr('y', (d) => (((d.source as SimNode).y ?? 0) + ((d.target as SimNode).y ?? 0)) / 2 - 4);
      node.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
      for (const item of simNodes) positions.current.set(item.id, { x: item.x ?? 0, y: item.y ?? 0 });
    };
    sim.on('tick', draw);
    // The layout is worked out before it is drawn, so the graph opens settled and fitted to the screen;
    // after that, dragging a record moves its neighbours live.
    sim.stop();
    if (!fresh) sim.alpha(0.6);
    sim.tick(fresh ? 300 : 150);
    draw();
    if (!fitted.current) { fitted.current = true; fit(false); }

    drawn.current = { node, link, linkLabel };
    restyleRef.current();
    return () => { sim.stop(); };
    // visibleKey stands for `visible`; labels and colours follow the index.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index, visibleKey, layout, radialCenter]);


  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName);
      if (event.key === '/' && !typing) { event.preventDefault(); searchRef.current?.focus(); return; }
      if (event.key !== 'Escape' || typing) return;
      // Escape steps back one thing at a time: the selection, then the view.
      if (selectedId) setSelectedId(null); else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, selectedId]);

  useEffect(() => { if (!selectedId) setFocusDepth(0); }, [selectedId]);

  const results = useMemo(() => searchRecords(index, query), [index, query]);
  const pick = (id: string) => { goTo(id); setQuery(''); setSearchOpen(false); };
  const toggleConcept = (concept: string) => setHidden((current) => {
    const next = new Set(current);
    if (next.has(concept)) next.delete(concept); else next.add(concept);
    return next;
  });
  const onlyConcept = (concept: string) => setHidden(new Set(index.concepts.filter((item) => item.key !== concept).map((item) => item.key)));
  const filtered = hidden.size > 0 || Boolean(period) || focusDepth > 0;
  const clearFilters = () => { setHidden(new Set()); setPeriod(null); setFocusDepth(0); };

  if (!open) return null;

  const tool = 'h-8 gap-1.5 px-2 text-xs text-white/70 hover:bg-white/10 hover:text-white';
  const pressed = 'bg-white/15 text-white';

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: '#0f0f1a' }}>
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
            {!results.length && <li className="px-3 py-2 text-xs text-white/45">{t('graphViewer.noMatch')}</li>}
            {results.map(({ record, field }) => <li key={record.id} role="option" aria-selected={false}>
              <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => pick(record.id)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-white/10">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorOf(record.concept) }} />
                <span className="min-w-0 flex-1"><span className="block truncate text-sm text-white">{record.label}</span>
                  {field && <span className="block truncate text-[11px] text-white/45">{field.label}: {String(field.value)}</span>}</span>
                <span className="shrink-0 text-[11px] text-white/40">{record.conceptLabel}</span>
              </button>
            </li>)}
          </ul>}
        </div>
        <div className="flex-1" />
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
            const shown = !hidden.has(concept.key);
            return <button key={concept.key} type="button" aria-pressed={shown} onClick={() => toggleConcept(concept.key)}
              title={shown ? t('graphViewer.hideConcept', { concept: concept.label }) : t('graphViewer.showConcept', { concept: concept.label })}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-1 text-xs hover:bg-white/10 ${shown ? 'text-white/75' : 'text-white/30 line-through'}`}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colorOf(concept.key), opacity: shown ? 1 : 0.3 }} />
              {concept.label}<span className="tabular-nums text-white/40">{concept.count}</span>
            </button>;
          })}
          {hidden.size > 0 && <button type="button" onClick={() => setHidden(new Set())} className="px-2 text-xs text-sky-300 hover:underline">{t('graphViewer.showAll')}</button>}
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {overviewOpen && index.records.length > 0 && <GraphOverviewPanel index={index} colorOf={colorOf} onSelect={goTo} highlight={highlight} onHighlight={setHighlight}
          onOnlyConcept={onlyConcept} period={period} onPeriod={setPeriod} onClose={() => setOverviewOpen(false)} />}

        <div ref={containerRef} className="relative flex-1 overflow-hidden">
          {/* Tools over the canvas */}
          {index.records.length > 0 && <div className="absolute left-3 top-3 z-10 flex flex-wrap items-center gap-1 rounded-lg border border-white/10 bg-[#15152a]/90 p-1 backdrop-blur" role="toolbar" aria-label={t('graphViewer.tools')}>
            <Button variant="ghost" size="sm" className={`${tool} ${overviewOpen ? pressed : ''}`} aria-pressed={overviewOpen} aria-label={t('graphViewer.overview')} title={t('graphViewer.overview')} onClick={() => setOverviewOpen(!overviewOpen)}><BarChart3 className="h-3.5 w-3.5" /><span className="hidden lg:inline">{t('graphViewer.overview')}</span></Button>
            <Button variant="ghost" size="sm" className={tool} onClick={() => fit()} title={t('graphViewer.fit')}><Maximize className="h-3.5 w-3.5" /><span className="hidden lg:inline">{t('graphViewer.fit')}</span></Button>
            <Button variant="ghost" size="sm" className={`${tool} ${linkNames ? pressed : ''}`} aria-pressed={linkNames} aria-label={t('graphViewer.linkNames')} onClick={() => setLinkNames(!linkNames)} title={t('graphViewer.linkNamesHelp')}><Tags className="h-3.5 w-3.5" /><span className="hidden lg:inline">{t('graphViewer.linkNames')}</span></Button>
            <label className="flex items-center gap-1 px-1 text-xs text-white/50">{t('graphViewer.layout')}
              <select value={layout} onChange={(event) => setLayout(event.target.value as Layout)} className="h-7 rounded-md border border-white/15 bg-[#1a1a2b] px-1.5 text-xs text-white">
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
          </div>}

          {/* What is shown, and what narrows it */}
          {index.records.length > 0 && <div className="absolute bottom-3 left-3 z-10 flex flex-wrap items-center gap-2 text-xs text-white/55" role="status">
            <span>{t('graphViewer.showing', { shown: visible.size, total: index.records.length })}</span>
            {focusDepth > 0 && selected && <span className="rounded-full bg-white/10 px-2 py-0.5">{t('graphViewer.focusOn', { record: selected.label, count: focusDepth })}</span>}
            {period && <span className="rounded-full bg-white/10 px-2 py-0.5">{t('graphViewer.periodActive', { from: period.from, to: period.to })}</span>}
            {highlight && !overviewOpen && <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-amber-200">{highlight.reason} <button type="button" className="ml-1 underline" onClick={() => setHighlight(null)}>{t('graphViewer.clearHighlight')}</button></span>}
            {filtered && <button type="button" onClick={clearFilters} className="text-sky-300 hover:underline">{t('graphViewer.clearFilters')}</button>}
            <span className="flex items-center gap-1 text-white/40"><span className="inline-block h-3 w-3 rounded-full border-2 border-dashed" style={{ borderColor: MISSING_RING }} />{t('graphViewer.missingLegend')}</span>
          </div>}

          {loading && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 text-white/50">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">{t('graphViewer.loading')}</span>
            </div>
          )}
          {!loading && error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
              <p className="text-sm text-red-400">{error}</p>
              <Button variant="outline" size="sm" onClick={() => void load()} className="border-white/20 text-white hover:bg-white/10">
                {t('graphViewer.retry')}
              </Button>
            </div>
          )}
          {!loading && !error && ageNodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-white/40">
              {t('graphViewer.empty')}
            </div>
          )}
          <svg ref={svgRef} className="h-full w-full" />
        </div>

        {selected && <GraphRecordPanel key={selected.id} index={index} record={selected} color={colorOf(selected.concept)} modelId={modelId} canEdit={canEdit}
          onRebuildStarted={onRebuildStarted} onSelect={goTo} onCenter={centerOn} onClose={() => setSelectedId(null)} />}
      </div>
    </div>
  );
}
