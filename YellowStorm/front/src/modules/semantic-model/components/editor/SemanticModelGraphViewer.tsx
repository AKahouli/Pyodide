import { useCallback, useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { CheckCircle2, FileText, Loader2, RefreshCw, X, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { parseApiError } from '@/lib/api-error';
import { useModuleTranslation } from '@/modules/localization';
import { semanticModelApi } from '../../api';
import type { AgeGraphNode, AgeGraphEdge } from '../../types';

const NODE_R = 42;
const PALETTE = [
  '#059669', '#4f46e5', '#d97706', '#2563eb',
  '#dc2626', '#7c3aed', '#db2777', '#0891b2',
];

function labelColor(label: string, allLabels: string[]): string {
  const idx = allLabels.indexOf(label);
  return PALETTE[idx >= 0 ? idx % PALETTE.length : 0];
}

type SimNode = d3.SimulationNodeDatum & {
  id: string;
  displayLabel: string;
  type: string;
  raw: AgeGraphNode;
};

type SimLink = d3.SimulationLinkDatum<SimNode> & {
  id: string;
  edgeLabel: string;
};

interface NodeMeta {
  nodeTypeLabel: string;
  attributes: { key: string; label: string; value: unknown }[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  modelId: string;
}

// Wrap long text into 2 lines to fit inside the circle
function wrapLines(text: string, maxLen = 11): [string, string | null] {
  if (text.length <= maxLen) return [text, null];
  const mid = text.lastIndexOf(' ', maxLen);
  if (mid > 0) return [text.slice(0, mid), text.slice(mid + 1).slice(0, maxLen)];
  return [text.slice(0, maxLen) + '…', null];
}

export function SemanticModelGraphViewer({ open, onClose, modelId }: Props) {
  const { t } = useModuleTranslation('semantic-model');
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const simRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null);

  const [loading, setLoading] = useState(false);
  const [ageNodes, setAgeNodes] = useState<AgeGraphNode[]>([]);
  const [ageEdges, setAgeEdges] = useState<AgeGraphEdge[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<AgeGraphNode | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    setSelectedNode(null);
    semanticModelApi
      .getAgeGraph(modelId)
      .then(({ nodes, edges }) => {
        setAgeNodes(nodes);
        setAgeEdges(edges);
      })
      .catch((err: unknown) => setError(parseApiError(err).message))
      .finally(() => setLoading(false));
  }, [modelId]);

  useEffect(() => {
    if (open && modelId) load();
  }, [open, modelId, load]);

  // ── D3 force graph ──────────────────────────────────────────────────────────
  useEffect(() => {
    simRef.current?.stop();
    if (!svgRef.current || !containerRef.current) return;

    const svgEl = svgRef.current;
    const d3svg = d3.select(svgEl);
    d3svg.selectAll('*').remove();

    if (!ageNodes.length) return;

    const { width, height } = containerRef.current.getBoundingClientRect();
    d3svg.attr('width', width).attr('height', height);

    // Arrowhead marker
    d3svg
      .append('defs')
      .append('marker')
      .attr('id', 'ag-arrow')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', NODE_R + 11)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', 'rgba(255,255,255,0.25)');

    // Zoom group
    const g = d3svg.append('g');
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.05, 3])
      .on('zoom', (ev) => g.attr('transform', ev.transform.toString()));
    d3svg.call(zoom);

    // Deselect on background click
    d3svg.on('click', () => setSelectedNode(null));

    // Data
    const allTypes = [...new Set(ageNodes.map((n) => n.label))];

    const simNodes: SimNode[] = ageNodes.map((n) => ({
      id: n.id,
      displayLabel: String(n.properties.record_label ?? n.id),
      type: n.label,
      raw: n,
      x: width / 2 + (Math.random() - 0.5) * 300,
      y: height / 2 + (Math.random() - 0.5) * 300,
    }));

    const nodeById = new Map(simNodes.map((n) => [n.id, n]));

    const simLinks: SimLink[] = ageEdges
      .filter((e) => nodeById.has(e.sourceId) && nodeById.has(e.targetId))
      .map((e) => ({ id: e.id, edgeLabel: e.label, source: e.sourceId, target: e.targetId }));

    // Simulation — stays alive for continuous animation
    const sim = d3
      .forceSimulation<SimNode>(simNodes)
      .force(
        'link',
        d3.forceLink<SimNode, SimLink>(simLinks).id((d) => d.id).distance(170).strength(0.35),
      )
      .force('charge', d3.forceManyBody<SimNode>().strength(-500))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide<SimNode>(NODE_R + 12))
      .alphaDecay(0.018); // slow decay → longer warm animation

    // Links
    const link = g
      .append('g')
      .selectAll<SVGLineElement, SimLink>('line')
      .data(simLinks)
      .join('line')
      .attr('stroke', 'rgba(255,255,255,0.18)')
      .attr('stroke-width', 1.5)
      .attr('marker-end', 'url(#ag-arrow)');

    // Link labels
    const linkLabel = g
      .append('g')
      .selectAll<SVGTextElement, SimLink>('text')
      .data(simLinks)
      .join('text')
      .text((d) => d.edgeLabel)
      .attr('fill', 'rgba(255,255,255,0.4)')
      .attr('font-size', 9)
      .attr('font-family', 'system-ui, sans-serif')
      .attr('text-anchor', 'middle')
      .attr('pointer-events', 'none');

    // Node groups
    const drag = d3
      .drag<SVGGElement, SimNode>()
      .on('start', (ev, d) => {
        if (!ev.active) sim.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (ev, d) => {
        d.fx = ev.x;
        d.fy = ev.y;
      })
      .on('end', (ev, d) => {
        if (!ev.active) sim.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    const node = g
      .append('g')
      .selectAll<SVGGElement, SimNode>('g')
      .data(simNodes)
      .join('g')
      .style('cursor', 'grab')
      .on('click', (ev, d) => {
        ev.stopPropagation();
        setSelectedNode(d.raw);
      })
      .call(drag);

    // Circle
    node
      .append('circle')
      .attr('r', NODE_R)
      .attr('fill', (d) => labelColor(d.type, allTypes))
      .attr('stroke', 'rgba(255,255,255,0.18)')
      .attr('stroke-width', 2.5);

    // Label text (up to 2 lines)
    node.each(function (d) {
      const g = d3.select(this);
      const [line1, line2] = wrapLines(d.displayLabel);
      const yOff = line2 ? -7 : 0;

      g.append('text')
        .attr('text-anchor', 'middle')
        .attr('dy', yOff)
        .attr('fill', 'white')
        .attr('font-size', 10)
        .attr('font-weight', 700)
        .attr('font-family', 'system-ui, sans-serif')
        .attr('pointer-events', 'none')
        .text(line1);

      if (line2) {
        g.append('text')
          .attr('text-anchor', 'middle')
          .attr('dy', yOff + 13)
          .attr('fill', 'white')
          .attr('font-size', 10)
          .attr('font-weight', 700)
          .attr('font-family', 'system-ui, sans-serif')
          .attr('pointer-events', 'none')
          .text(line2.length > 11 ? line2.slice(0, 10) + '…' : line2);
      }

      // Type sublabel
      g.append('text')
        .attr('text-anchor', 'middle')
        .attr('dy', line2 ? yOff + 26 : 16)
        .attr('fill', 'rgba(255,255,255,0.5)')
        .attr('font-size', 8)
        .attr('font-family', 'system-ui, sans-serif')
        .attr('pointer-events', 'none')
        .text(d.type);
    });

    // Tick — updates positions each animation frame
    sim.on('tick', () => {
      link
        .attr('x1', (d) => (d.source as SimNode).x ?? 0)
        .attr('y1', (d) => (d.source as SimNode).y ?? 0)
        .attr('x2', (d) => (d.target as SimNode).x ?? 0)
        .attr('y2', (d) => (d.target as SimNode).y ?? 0);

      linkLabel
        .attr('x', (d) => (((d.source as SimNode).x ?? 0) + ((d.target as SimNode).x ?? 0)) / 2)
        .attr('y', (d) => (((d.source as SimNode).y ?? 0) + ((d.target as SimNode).y ?? 0)) / 2 - 4);

      node.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    simRef.current = sim;
    return () => sim.stop();
  }, [ageNodes, ageEdges]);

  const selectedMeta = selectedNode?.properties._meta as NodeMeta | undefined;
  const allTypes = [...new Set(ageNodes.map((n) => n.label))];

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: '#0f0f1a' }}>
      {/* Header */}
      <div className="flex items-center justify-between shrink-0 px-6 py-3 border-b border-white/10">
        <h2 className="text-sm font-semibold text-white">{t('graphViewer.title')}</h2>
        <div className="flex items-center gap-3 flex-wrap">
          {allTypes.map((lbl) => (
            <div key={lbl} className="flex items-center gap-1.5">
              <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: labelColor(lbl, allTypes) }} />
              <span className="text-xs text-white/60">{lbl}</span>
            </div>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="text-white/60 hover:text-white hover:bg-white/10 gap-1.5"
            onClick={load}
            disabled={loading}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-white/60 hover:text-white hover:bg-white/10"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* SVG canvas */}
        <div ref={containerRef} className="flex-1 relative overflow-hidden">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 text-white/50">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">{t('graphViewer.loading')}</span>
            </div>
          )}
          {!loading && error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
              <p className="text-sm text-red-400">{error}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={load}
                className="text-white border-white/20 hover:bg-white/10"
              >
                {t('graphViewer.retry')}
              </Button>
            </div>
          )}
          {!loading && !error && ageNodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-white/40 text-sm">
              {t('graphViewer.empty')}
            </div>
          )}
          <svg ref={svgRef} className="w-full h-full" />
        </div>

        {/* Attribute detail panel */}
        {selectedNode && selectedMeta && (
          <div
            className="w-72 shrink-0 border-l border-white/10 flex flex-col"
            style={{ background: 'rgba(255,255,255,0.03)' }}
          >
            <div className="flex items-start justify-between px-4 py-3 border-b border-white/10">
              <div className="min-w-0">
                <p className="text-xs text-white/40 uppercase tracking-wide font-medium">
                  {selectedMeta.nodeTypeLabel}
                </p>
                <p className="text-sm font-semibold text-white mt-0.5 break-words">
                  {String(selectedNode.properties.record_label ?? selectedNode.id)}
                </p>
              </div>
              <button
                onClick={() => setSelectedNode(null)}
                className="ml-2 shrink-0 text-white/30 hover:text-white/70 transition-colors mt-0.5"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Source document */}
            {(() => {
              const srcFile = selectedNode.properties.source_file_name;
              const hasSrc = srcFile && srcFile !== '__missing__';
              return (
                <div className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
                  <FileText className={`h-3.5 w-3.5 shrink-0 ${hasSrc ? 'text-blue-400/70' : 'text-amber-500/60'}`} />
                  {hasSrc ? (
                    <span className="text-xs text-blue-300/80 truncate" title={String(srcFile)}>
                      {String(srcFile)}
                    </span>
                  ) : (
                    <span className="text-xs text-amber-500/50 italic">{t('graphViewer.missingValue')}</span>
                  )}
                </div>
              );
            })()}

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5">
              {selectedMeta.attributes.length === 0 && (
                <p className="text-xs text-white/30 italic">{t('graphViewer.noAttributes')}</p>
              )}
              {selectedMeta.attributes.map((attr) => {
                const isMissing =
                  attr.value === null ||
                  attr.value === undefined ||
                  attr.value === '' ||
                  attr.value === '__missing__';
                return (
                  <div key={attr.key} className="flex items-start gap-2">
                    {isMissing ? (
                      <XCircle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-500/60" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0 text-emerald-400" />
                    )}
                    <div className="min-w-0">
                      <p className="text-xs text-white/45 leading-none">{attr.label}</p>
                      <p
                        className={`text-xs mt-0.5 break-words leading-snug ${
                          isMissing ? 'text-amber-500/50 italic' : 'text-white/85'
                        }`}
                      >
                        {isMissing ? t('graphViewer.missingValue') : String(attr.value)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
