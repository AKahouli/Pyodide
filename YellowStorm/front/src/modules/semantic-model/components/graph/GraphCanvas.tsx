import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as d3Force from 'd3-force';
import * as d3Selection from 'd3-selection';
import * as d3Zoom from 'd3-zoom';
import * as d3Drag from 'd3-drag';

/** What the canvas draws: records, or one bubble per concept when there are too many records to draw. */
export interface CanvasNode {
  id: string;
  label: string;
  /** Written small under the name: the concept, or a count. */
  sub?: string;
  color: string;
  /** Radius in pixels at zoom 1. */
  size: number;
  concept: string;
  ring?: boolean;
  degree: number;
  /** Links to records not shown: the bubble wears a "+" badge that shows them, named by `moreLabel`. */
  more?: number;
  moreLabel?: string;
  /** A record opened from here: the bubble wears a "-" badge that closes it. */
  open?: boolean;
  /** A record, not a concept bubble: it wears an "i" badge that opens its details. */
  info?: boolean;
}
export interface CanvasEdge { id: string; source: string; target: string; label: string }
export type CanvasLayout = 'force' | 'concept' | 'radial';

export interface GraphCanvasHandle {
  /** Fits everything drawn, or only some of it, to the screen. */
  fit: (only?: Set<string>) => void;
  centerOn: (id: string) => void;
}

const MISSING_RING = '#fbbf24';
const MORE_BADGE = '#0284c7';
const LESS_BADGE = '#b45309';
const INFO_BADGE = '#475569';
/** Radius of a badge in pixels at zoom 1: large enough to hit. */
const BADGE_R = 10;
/** How long the layout may be worked out before the first drawing, in milliseconds. */
const PRESETTLE_MS = 300;

type SimNode = d3Force.SimulationNodeDatum & { id: string; node: CanvasNode; r: number };
type SimLink = d3Force.SimulationLinkDatum<SimNode> & { edge: CanvasEdge };

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

/** Wraps a name on two lines to fit inside its circle. */
function wrapLines(text: string, maxLen = 14): [string, string | null] {
  const qualified = text.split(' · ');
  if (qualified.length === 2 && qualified.every((part) => part.length <= maxLen)) return [qualified[0], qualified[1]];
  if (text.length <= maxLen) return [text, null];
  const mid = Math.max(text.lastIndexOf(' ', maxLen), text.lastIndexOf('-', maxLen - 1));
  if (mid > 0) return [text.slice(0, mid + (text[mid] === '-' ? 1 : 0)), text.slice(mid + 1).slice(0, maxLen)];
  return [text.slice(0, maxLen - 1) + '…', null];
}

/** Rings around a record by how many links away each other record is. */
function hopsFrom(center: string, links: CanvasEdge[]) {
  const neighbours = new Map<string, string[]>();
  for (const link of links) {
    if (!neighbours.has(link.source)) neighbours.set(link.source, []);
    if (!neighbours.has(link.target)) neighbours.set(link.target, []);
    neighbours.get(link.source)!.push(link.target);
    neighbours.get(link.target)!.push(link.source);
  }
  const hops = new Map([[center, 0]]);
  let frontier = [center];
  while (frontier.length) {
    const next: string[] = [];
    for (const id of frontier) for (const other of neighbours.get(id) ?? []) if (!hops.has(other)) { hops.set(other, hops.get(id)! + 1); next.push(other); }
    frontier = next;
  }
  return hops;
}

/**
 * The data graph drawn in SVG with d3: live physics, dragging pulls the neighbours along, hover and selection fade
 * the rest. Positions are kept between redraws, so filtering never reshuffles what stays.
 */
export const GraphCanvas = forwardRef<GraphCanvasHandle, Readonly<{
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  /** Changes when new data is loaded: positions start afresh. */
  dataKey: string;
  layout: CanvasLayout;
  radialCenter: string | null;
  conceptOrder: string[];
  selectedId: string | null;
  highlight: { ids: Set<string>; links?: Set<string> } | null;
  linkNames: boolean;
  /** The record being read from the server: its bubble pulses. */
  busyId?: string | null;
  label: string;
  /** Names of the "-" and "i" badges, each followed by the record's name. */
  badgeLabels: { less: string; info: string };
  onSelect: (id: string | null) => void;
  onOpen: (id: string) => void;
  /** The "+" badge: show one more level around the record. */
  onExpand: (id: string) => void;
  /** The "-" badge: close what the record opened. */
  onCollapse: (id: string) => void;
  /** The "i" badge: open the record's details. */
  onInfo: (id: string) => void;
}>>(function GraphCanvas(props, ref) {
  const container = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<d3Zoom.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const simNodes = useRef<SimNode[]>([]);
  const positions = useRef(new Map<string, { x: number; y: number }>());
  const fitted = useRef(false);
  const hovered = useRef<string | null>(null);
  const drawn = useRef<{
    node?: d3Selection.Selection<SVGGElement, SimNode, SVGGElement, unknown>;
    link?: d3Selection.Selection<SVGLineElement, SimLink, SVGGElement, unknown>;
    linkLabel?: d3Selection.Selection<SVGTextElement, SimLink, SVGGElement, unknown>;
  }>({});
  const live = useRef(props);
  live.current = props;

  const fit = (only?: Set<string>, animate = true) => {
    const svgEl = svgRef.current;
    const box = container.current?.getBoundingClientRect();
    const nodes = only ? simNodes.current.filter((node) => only.has(node.id)) : simNodes.current;
    if (!svgEl || !box?.width || !nodes.length || !zoomRef.current) return;
    let [minX, maxX, minY, maxY] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const node of nodes) {
      minX = Math.min(minX, (node.x ?? 0) - node.r); maxX = Math.max(maxX, (node.x ?? 0) + node.r);
      minY = Math.min(minY, (node.y ?? 0) - node.r); maxY = Math.max(maxY, (node.y ?? 0) + node.r);
    }
    [minX, maxX, minY, maxY] = [minX - 40, maxX + 40, minY - 40, maxY + 40];
    const scale = Math.min(1.6, box.width / (maxX - minX), box.height / (maxY - minY));
    const transform = d3Zoom.zoomIdentity.translate(box.width / 2 - ((minX + maxX) / 2) * scale, box.height / 2 - ((minY + maxY) / 2) * scale).scale(scale);
    if (animate) animateTo(svgEl, zoomRef.current, transform);
    else d3Selection.select(svgEl).call(zoomRef.current.transform, transform);
  };
  const centerOn = (id: string) => {
    const svgEl = svgRef.current;
    const box = container.current?.getBoundingClientRect();
    const node = simNodes.current.find((item) => item.id === id);
    if (!svgEl || !box?.width || !node || !zoomRef.current) return;
    const scale = Math.max(d3Zoom.zoomTransform(svgEl).k, 1);
    animateTo(svgEl, zoomRef.current, d3Zoom.zoomIdentity.translate(box.width / 2 - (node.x ?? 0) * scale, box.height / 2 - (node.y ?? 0) * scale).scale(scale));
  };
  useImperativeHandle(ref, () => ({ fit: (only) => fit(only), centerOn }));

  // Emphasis — selection, hover, highlight, link names — restyles what is drawn without moving it.
  const restyle = () => {
    const { node, link, linkLabel } = drawn.current;
    if (!node || !link || !linkLabel) return;
    const { selectedId, highlight, linkNames } = live.current;
    const focus = hovered.current ?? selectedId;
    const near = focus ? new Set([focus]) : null;
    if (focus) link.each((item) => { if (item.edge.source === focus) near!.add(item.edge.target); if (item.edge.target === focus) near!.add(item.edge.source); });
    const touches = (item: SimLink) => Boolean(focus && (item.edge.source === focus || item.edge.target === focus));
    const lit = (item: SimLink) => (highlight?.links ? highlight.links.has(item.edge.id) : highlight ? highlight.ids.has(item.edge.source) && highlight.ids.has(item.edge.target) : touches(item));
    node.attr('opacity', (item) => (highlight ? (highlight.ids.has(item.id) ? 1 : 0.15) : near ? (near.has(item.id) ? 1 : 0.3) : 1));
    node.select<SVGCircleElement>('circle.body')
      .attr('stroke', (item) => (item.id === selectedId ? '#ffffff' : 'rgba(255,255,255,0.18)'))
      .attr('stroke-width', (item) => (item.id === selectedId ? 4 : 2.5));
    link.attr('stroke', (item) => (lit(item) ? (highlight ? '#fbbf24' : 'rgba(255,255,255,0.7)') : 'rgba(255,255,255,0.15)'))
      .attr('stroke-width', (item) => (lit(item) ? 2.5 : 1.25))
      .attr('opacity', (item) => (highlight ? (lit(item) ? 1 : 0.2) : near ? (touches(item) ? 1 : 0.25) : 1));
    linkLabel.attr('display', (item) => (linkNames || lit(item) ? null : 'none'));
  };
  const restyleRef = useRef(restyle);
  restyleRef.current = restyle;

  // The record being read pulses; it is added and removed apart from restyle so hovering never restarts the pulse.
  const markBusy = () => {
    const { node } = drawn.current;
    if (!node) return;
    const busyId = live.current.busyId ?? null;
    node.each(function (d) {
      const group = d3Selection.select(this);
      const ring = group.select<SVGCircleElement>('circle.busy');
      if (d.id !== busyId) { ring.remove(); return; }
      if (!ring.empty()) return;
      const pulse = group.insert('circle', 'circle.body').attr('class', 'busy').attr('fill', 'none').attr('stroke', '#38bdf8').attr('stroke-width', 4).attr('pointer-events', 'none');
      pulse.append('animate').attr('attributeName', 'r').attr('values', `${d.r + 6};${d.r + 20};${d.r + 6}`).attr('dur', '1.1s').attr('repeatCount', 'indefinite');
      pulse.append('animate').attr('attributeName', 'opacity').attr('values', '1;0.15;1').attr('dur', '1.1s').attr('repeatCount', 'indefinite');
    });
  };
  const markBusyRef = useRef(markBusy);
  markBusyRef.current = markBusy;

  // New data: positions start afresh and the first drawing is fitted.
  useEffect(() => { positions.current.clear(); fitted.current = false; }, [props.dataKey]);

  const { nodes, edges, layout, radialCenter, conceptOrder } = props;
  useEffect(() => {
    if (!svgRef.current || !container.current) return;
    const svgEl = svgRef.current;
    const d3svg = d3Selection.select(svgEl);
    d3svg.selectAll('*').remove();
    drawn.current = {};
    simNodes.current = [];
    if (!nodes.length) return;

    const { width, height } = container.current.getBoundingClientRect();
    d3svg.attr('width', width).attr('height', height);

    // Arrowheads sit on the edge of each circle, so each size has its own marker.
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
    const zoom = d3Zoom.zoom<SVGSVGElement, unknown>().scaleExtent([0.03, 3]).on('zoom', (event) => g.attr('transform', event.transform.toString()));
    zoomRef.current = zoom;
    d3svg.call(zoom).on('dblclick.zoom', null);
    d3svg.on('click', () => live.current.onSelect(null));

    const fresh = nodes.some((node) => !positions.current.has(node.id));
    // New records start spread in proportion to how many there are, so the forces have less to undo.
    const spread = Math.max(400, Math.sqrt(nodes.length) * 70);
    const byId = new Map<string, SimNode>();
    const sim0: SimNode[] = nodes.map((node) => {
      const known = positions.current.get(node.id);
      const item = { id: node.id, node, r: node.size, x: known?.x ?? width / 2 + (Math.random() - 0.5) * spread, y: known?.y ?? height / 2 + (Math.random() - 0.5) * spread };
      byId.set(node.id, item);
      return item;
    });
    // A record new to the drawing starts next to a neighbour already placed.
    for (const edge of edges) {
      const [a, b] = [byId.get(edge.source), byId.get(edge.target)];
      if (!a || !b) continue;
      if (!positions.current.has(a.id) && positions.current.has(b.id)) { a.x = b.x! + (Math.random() - 0.5) * 60; a.y = b.y! + (Math.random() - 0.5) * 60; }
      if (!positions.current.has(b.id) && positions.current.has(a.id)) { b.x = a.x! + (Math.random() - 0.5) * 60; b.y = a.y! + (Math.random() - 0.5) * 60; }
    }
    simNodes.current = sim0;
    const simLinks: SimLink[] = edges.filter((edge) => byId.has(edge.source) && byId.has(edge.target))
      .map((edge) => ({ edge, source: edge.source, target: edge.target }));

    const sim = d3Force.forceSimulation<SimNode>(sim0)
      .force('link', d3Force.forceLink<SimNode, SimLink>(simLinks).id((d) => d.id).distance(160).strength(layout === 'force' ? 0.35 : 0.05))
      .force('charge', d3Force.forceManyBody<SimNode>().strength(-320).theta(0.9))
      .force('collision', d3Force.forceCollide<SimNode>((d) => d.r + 10))
      .alphaDecay(0.03);
    // A gentle pull to the middle keeps unlinked groups from drifting off.
    if (layout === 'force') sim.force('center', d3Force.forceCenter(width / 2, height / 2))
      .force('x', d3Force.forceX<SimNode>(width / 2).strength(0.08)).force('y', d3Force.forceY<SimNode>(height / 2).strength(0.08));
    if (layout === 'concept') {
      // One column per concept, in the legend's order.
      const shown = conceptOrder.filter((concept) => nodes.some((node) => node.concept === concept));
      const columnX = (concept: string) => width / 2 + (shown.indexOf(concept) - (shown.length - 1) / 2) * 420;
      sim.force('x', d3Force.forceX<SimNode>((d) => columnX(d.node.concept)).strength(0.6)).force('y', d3Force.forceY<SimNode>(height / 2).strength(0.04));
    }
    if (layout === 'radial') {
      // Rings by how many links away from the selected record.
      const hops = radialCenter ? hopsFrom(radialCenter, edges) : new Map<string, number>();
      const outer = Math.max(1, ...hops.values()) + 1;
      sim.force('r', d3Force.forceRadial<SimNode>((d) => (hops.get(d.id) ?? outer) * 220, width / 2, height / 2).strength(0.9));
      const center = byId.get(radialCenter ?? '');
      if (center) { center.fx = width / 2; center.fy = height / 2; }
    }

    const link = g.append('g').selectAll<SVGLineElement, SimLink>('line').data(simLinks).join('line')
      .attr('marker-end', (d) => markerFor(byId.get(d.edge.target)!.r));
    const linkLabel = g.append('g').selectAll<SVGTextElement, SimLink>('text').data(simLinks).join('text')
      .text((d) => d.edge.label)
      .attr('fill', 'rgba(255,255,255,0.6)').attr('font-size', 10).attr('font-family', 'system-ui, sans-serif')
      .attr('text-anchor', 'middle').attr('pointer-events', 'none')
      .attr('paint-order', 'stroke').attr('stroke', '#0f0f1a').attr('stroke-width', 3);

    const drag = d3Drag.drag<SVGGElement, SimNode>()
      .on('start', (event, d) => { if (!event.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
      .on('end', (event, d) => { if (!event.active) sim.alphaTarget(0); if (d.id !== radialCenter) { d.fx = null; d.fy = null; } });

    const node = g.append('g').selectAll<SVGGElement, SimNode>('g').data(sim0).join('g')
      .attr('role', 'button').attr('tabindex', 0)
      .attr('aria-label', (d) => [d.node.label, d.node.sub].filter(Boolean).join(' · '))
      .style('cursor', 'pointer')
      .on('click', (event, d) => { event.stopPropagation(); live.current.onSelect(d.id); })
      .on('dblclick', (event, d) => { event.stopPropagation(); live.current.onOpen(d.id); })
      .on('keydown', (event: KeyboardEvent, d) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); live.current.onSelect(d.id); } })
      .on('mouseenter', (_event, d) => { hovered.current = d.id; restyleRef.current(); })
      .on('mouseleave', () => { hovered.current = null; restyleRef.current(); })
      .call(drag);

    // Records missing values wear an amber ring, so gaps show on the graph itself.
    node.filter((d) => Boolean(d.node.ring)).append('circle')
      .attr('r', (d) => d.r + 5).attr('fill', 'none').attr('stroke', MISSING_RING).attr('stroke-width', 2).attr('stroke-dasharray', '4 3').attr('opacity', 0.85);
    node.append('circle').attr('class', 'body').attr('r', (d) => d.r).attr('fill', (d) => d.node.color);
    node.append('title').text((d) => [d.node.label, d.node.sub].filter(Boolean).join(' · '));
    node.each(function (d) {
      const group = d3Selection.select(this);
      const maxLen = Math.max(8, Math.round(d.r / 3));
      const [line1, line2] = wrapLines(d.node.label, maxLen);
      const yOff = line2 ? -7 : 0;
      const text = (dy: number, value: string, size: number, fill: string, weight = 700) => group.append('text')
        .attr('text-anchor', 'middle').attr('dy', dy).attr('fill', fill).attr('font-size', size).attr('font-weight', weight)
        .attr('font-family', 'system-ui, sans-serif').attr('pointer-events', 'none').text(value);
      text(yOff, line1, 10, 'white');
      if (line2) text(yOff + 13, line2.length > maxLen ? `${line2.slice(0, maxLen - 1)}…` : line2, 10, 'white');
      if (d.node.sub && d.r >= 30) text(line2 ? yOff + 26 : 16, d.node.sub, 8, 'rgba(255,255,255,0.55)', 400);
    });

    // Badges on a bubble are buttons of their own: a click on one never selects, drags or deselects.
    const addBadge = (which: d3Selection.Selection<SVGGElement, SimNode, SVGGElement, unknown>, name: string, dx: number, dy: number,
      glyph: string, fill: string, label: (d: SimNode) => string, act: (id: string) => void) => {
      const badge = which.append('g').attr('class', `badge-${name}`).attr('role', 'button').attr('tabindex', 0)
        .attr('aria-label', label).style('cursor', 'pointer')
        // Sat just outside the rim, so a badge never covers the name inside the bubble.
        .attr('transform', (d) => { const out = (d.r + BADGE_R * 0.7) / Math.hypot(dx, dy); return `translate(${out * dx},${out * dy})`; })
        .on('mousedown', (event) => event.stopPropagation())
        .on('touchstart', (event) => event.stopPropagation())
        .on('dblclick', (event) => event.stopPropagation())
        .on('click', (event, d) => { event.stopPropagation(); act(d.id); })
        .on('keydown', (event: KeyboardEvent, d) => {
          event.stopPropagation();
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); act(d.id); }
        });
      badge.append('title').text(label);
      badge.append('circle').attr('r', BADGE_R).attr('fill', fill).attr('stroke', '#ffffff').attr('stroke-width', 1.5);
      badge.append('text').attr('text-anchor', 'middle').attr('dy', 4).attr('fill', 'white').attr('font-size', 13).attr('font-weight', 700)
        .attr('font-family', 'system-ui, sans-serif').attr('pointer-events', 'none').text(glyph);
    };
    addBadge(node.filter((d) => (d.node.more ?? 0) > 0), 'more', 0.72, -0.72, '+', MORE_BADGE, (d) => d.node.moreLabel ?? '+', (id) => live.current.onExpand(id));
    addBadge(node.filter((d) => Boolean(d.node.open)), 'less', -0.72, -0.72, '−', LESS_BADGE, (d) => `${live.current.badgeLabels.less} · ${d.node.label}`, (id) => live.current.onCollapse(id));
    addBadge(node.filter((d) => Boolean(d.node.info)), 'info', 0.72, 0.72, 'i', INFO_BADGE, (d) => `${live.current.badgeLabels.info} · ${d.node.label}`, (id) => live.current.onInfo(id));

    const draw = () => {
      link.attr('x1', (d) => (d.source as SimNode).x ?? 0).attr('y1', (d) => (d.source as SimNode).y ?? 0)
        .attr('x2', (d) => (d.target as SimNode).x ?? 0).attr('y2', (d) => (d.target as SimNode).y ?? 0);
      linkLabel.attr('x', (d) => (((d.source as SimNode).x ?? 0) + ((d.target as SimNode).x ?? 0)) / 2)
        .attr('y', (d) => (((d.source as SimNode).y ?? 0) + ((d.target as SimNode).y ?? 0)) / 2 - 4);
      node.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
      for (const item of sim0) positions.current.set(item.id, { x: item.x ?? 0, y: item.y ?? 0 });
    };
    sim.on('tick', draw);
    // The layout is worked out before it is drawn for a moment at most, so the page never freezes; it then finishes
    // settling live — the part people see move — and dragging a record moves its neighbours.
    sim.stop();
    if (!fresh) sim.alpha(0.6);
    const budgetEnd = performance.now() + PRESETTLE_MS;
    for (let tick = 0; tick < (fresh ? 300 : 100) && performance.now() < budgetEnd; tick++) sim.tick();
    draw();
    const firstDrawing = !fitted.current;
    if (firstDrawing) { fitted.current = true; fit(undefined, false); }
    // A big graph still settling is fitted again once it has.
    if (firstDrawing && sim.alpha() > 0.1) sim.on('end.fit', () => fit());
    sim.alpha(Math.min(sim.alpha(), 0.5)).restart();

    drawn.current = { node, link, linkLabel };
    restyleRef.current();
    markBusyRef.current();
    return () => { sim.stop(); };
    // `fit` reads refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, layout, radialCenter, conceptOrder]);

  useEffect(() => { restyleRef.current(); }, [props.selectedId, props.highlight, props.linkNames]);
  useEffect(() => { markBusyRef.current(); }, [props.busyId]);

  return <div ref={container} className='relative h-full w-full'>
    <svg ref={svgRef} className='h-full w-full' role='group' aria-label={props.label} />
  </div>;
});
