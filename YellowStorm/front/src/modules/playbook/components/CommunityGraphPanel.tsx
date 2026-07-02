import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as d3 from 'd3';
import { Loader2, RefreshCw, X, FileText, Network, Tag, GitBranch, Quote, Layers } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { fetchCommunityGraph, type CommunityGraphData } from '@/modules/workspace/api';
import { useModuleTranslation } from '@/modules/localization';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string | null;
}

interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  type: 'document' | 'concept';
  label: string;
  fullLabel?: string;
  community?: string | null;
  hl?: string[];
  ll?: string[];
  toc?: string;
  metadata?: Record<string, unknown>;
  level?: string;
  docFreq?: number;
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  weight: number;
  linkType: 'explicit' | 'shared_concept' | 'concept_link';
  rel_type?: string;
  hl_jaccard?: number;
  ll_jaccard?: number;
  semantic_cosine?: number;
  shared_hl?: string[];
  shared_ll?: string[];
  citation_raw_text?: string;
  citation_type?: string;
  citation_confidence?: number;
  levels?: string[];
  level?: string;
}

const COMM_COLORS = ['#6366f1', '#0891b2', '#059669', '#d97706', '#dc2626', '#7c3aed', '#db2777', '#0d9488', '#ea580c', '#65a30d', '#be123c', '#4338ca', '#0e7490', '#15803d'];

function getColorForCommunity(commId: string | null | undefined, ccMap: Record<string, string>): string {
  if (!commId) return '#94a3b8';
  return ccMap[commId] ?? '#94a3b8';
}

function formatMetadataValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function shouldDisplayMetaKey(key: string): boolean {
  const hidden = ['description_embedding', 'full_text'];
  return !hidden.includes(key);
}

interface DetailData {
  type: 'document' | 'concept';
  label: string;
  fullLabel?: string;
  toc?: string;
  hl?: string[];
  ll?: string[];
  community?: string | null;
  metadata?: Record<string, unknown>;
  level?: string;
  docFreq?: number;
  explicitEdges?: Array<{ weight: number; otherLabel: string; hl_jaccard: number; ll_jaccard: number; semantic_cosine: number }>;
  citationEdges?: Array<{ weight: number; otherLabel: string; rawText?: string; citeType?: string; confidence?: number }>;
  citedByEdges?: Array<{ otherLabel: string; rawText?: string }>;
  sharedEdges?: Array<{ count: number; otherLabel: string }>;
  communityInfo?: { level: number; memberCount: number; dominantHl: string[]; dominantLl: string[] };
}

function MetaBadge({ value, color }: { value: unknown; color: string }) {
  const text = formatMetadataValue(value);
  const display = text.length > 60 ? text.slice(0, 57) + '…' : text;
  return (
    <span
      className="inline-block px-2 py-0.5 rounded text-[10px] font-medium"
      style={{ backgroundColor: `${color}15`, color, border: `1px solid ${color}30` }}
    >
      {display}
    </span>
  );
}

function DetailSection({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4 rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex items-center gap-1.5 mb-2">
        {icon}
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</span>
      </div>
      {children}
    </div>
  );
}

export function CommunityGraphPanel({ open, onOpenChange, workspaceId }: Props) {
  const { t } = useModuleTranslation('playbook');
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<CommunityGraphData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConcepts, setShowConcepts] = useState(false);
  const [detail, setDetail] = useState<DetailData | null>(null);
  const simulationRef = useRef<d3.Simulation<GraphNode, GraphLink> | null>(null);

  const loadGraph = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchCommunityGraph(workspaceId);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load graph');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (open && workspaceId) {
      void loadGraph();
    }
    if (!open) {
      setData(null);
      setDetail(null);
      if (simulationRef.current) {
        simulationRef.current.stop();
        simulationRef.current = null;
      }
    }
  }, [open, workspaceId, loadGraph]);

  const ccMap = useMemo(() => {
    const map: Record<string, string> = {};
    data?.communities?.forEach((c, i) => {
      map[c.id] = COMM_COLORS[i % COMM_COLORS.length];
    });
    return map;
  }, [data]);

  const buildGraph = useCallback(() => {
    if (!data?.documents || !svgRef.current || !containerRef.current) return;

    if (simulationRef.current) {
      simulationRef.current.stop();
    }

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const g = svg.append('g');
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.15, 6])
      .on('zoom', (event) => g.attr('transform', event.transform));
    svg.call(zoom);

    const rect = containerRef.current.getBoundingClientRect();
    const width = rect.width || 800;
    const height = rect.height || 600;
    svg.attr('width', width).attr('height', height);

    const docMap = new Map(data.documents.map((d) => [d.id, d]));
    const nodes: GraphNode[] = [];
    const links: GraphLink[] = [];

    data.documents.forEach((d) => {
      nodes.push({
        id: d.id,
        type: 'document',
        label: (d.file_name || d.description || '').slice(0, 35),
        fullLabel: d.file_name || d.description,
        community: d.community_id,
        hl: d.hl_concepts,
        ll: d.ll_concepts,
        toc: d.toc_text,
        metadata: d.metadata,
      });
    });

    data.edges.forEach((e) => {
      links.push({
        source: e.source, target: e.target, weight: e.weight, linkType: 'explicit',
        rel_type: e.relationship_type, hl_jaccard: e.hl_jaccard, ll_jaccard: e.ll_jaccard,
        semantic_cosine: e.semantic_cosine, shared_hl: e.shared_hl, shared_ll: e.shared_ll,
        citation_raw_text: e.citation_raw_text, citation_type: e.citation_type, citation_confidence: e.citation_confidence,
      });
    });

    data.shared_concept_edges.forEach((e) => {
      links.push({ source: e.source, target: e.target, weight: e.shared_count, linkType: 'shared_concept', levels: e.shared_levels });
    });

    if (showConcepts) {
      data.concepts.filter((c) => c.level === 'HL').sort((a, b) => b.doc_freq - a.doc_freq).slice(0, 25).forEach((c) => {
        nodes.push({ id: `c-${c.id}`, type: 'concept', label: c.label, level: c.level, docFreq: c.doc_freq });
      });
      data.concept_document_links.forEach((l) => {
        if (nodes.find((n) => n.id === `c-${l.concept_id}`) && nodes.find((n) => n.id === l.document_id)) {
          links.push({ source: `c-${l.concept_id}`, target: l.document_id, weight: 0.3, linkType: 'concept_link', level: l.level });
        }
      });
    }

    const sim = d3.forceSimulation<GraphNode>(nodes)
      .velocityDecay(0.65)
      .alphaDecay(0.04)
      .force('link', d3.forceLink<GraphNode, GraphLink>(links)
        .id((d) => d.id)
        .distance((d) => d.linkType === 'concept_link' ? 70 : d.linkType === 'shared_concept' ? 120 : 140)
        .strength(0.5))
      .force('charge', d3.forceManyBody<GraphNode>().strength((d) => d.type === 'concept' ? -60 : -550).distanceMax(500))
      .force('center', d3.forceCenter(width / 2, height / 2).strength(0.06))
      .force('x', d3.forceX(width / 2).strength(0.04))
      .force('y', d3.forceY(height / 2).strength(0.04))
      .force('collision', d3.forceCollide<GraphNode>().radius((d) => d.type === 'concept' ? 18 : 42).strength(0.9));

    simulationRef.current = sim;

    // Links
    const linkSel = g.append('g').attr('stroke-linecap', 'round').selectAll('line').data(links).join('line')
      .attr('stroke', (d) => {
        if (d.linkType === 'shared_concept') return '#f59e0b';
        if (d.linkType === 'concept_link') return 'rgba(99,102,241,0.2)';
        if (d.rel_type === 'CITES') return '#dc2626';
        return '#818cf8';
      })
      .attr('stroke-width', (d) => d.linkType === 'concept_link' ? 1 : Math.max(d.weight * 4, 1.5))
      .attr('stroke-dasharray', (d) => {
        if (d.linkType === 'shared_concept') return '6,4';
        if (d.linkType === 'concept_link') return '2,4';
        if (d.rel_type === 'CITES') return '4,3';
        return null;
      })
      .attr('stroke-opacity', (d) => d.linkType === 'concept_link' ? 0.25 : 0.6);

    // Nodes
    const node = g.append('g').selectAll('g').data(nodes).join('g')
      .style('cursor', 'pointer')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .call(d3.drag<SVGGElement, GraphNode, GraphNode>()
        .on('start', (event, d) => { if (!event.active) sim.alphaTarget(0.15).restart(); d.fx = d.x; d.fy = d.y; })
        .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
        .on('end', (event, d) => { if (!event.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }) as any);

    // Document nodes — circle with community color and subtle halo
    const docNodes = node.filter((d) => d.type === 'document');
    docNodes.append('circle').attr('r', 26).attr('fill', (d) => getColorForCommunity(d.community, ccMap)).attr('opacity', 0.12);
    docNodes.append('circle').attr('r', 18).attr('fill', (d) => getColorForCommunity(d.community, ccMap))
      .attr('stroke', '#fff').attr('stroke-width', 2.5).attr('opacity', 0.92);
    docNodes.append('circle').attr('r', 6).attr('fill', '#fff').attr('opacity', 0.7);

    // Concept nodes — small rounded square
    node.filter((d) => d.type === 'concept').append('rect')
      .attr('width', 10).attr('height', 10).attr('x', -5).attr('y', -5)
      .attr('rx', 2).attr('fill', '#6366f1').attr('opacity', 0.65);

    // Labels
    docNodes.append('text').text((d) => d.label).attr('dy', 34)
      .attr('text-anchor', 'middle').attr('fill', '#374151').attr('font-size', '9.5px')
      .attr('font-weight', '600').attr('pointer-events', 'none')
      .each(function () { const t = d3.select(this); const txt = t.text(); if (txt.length > 30) t.text(txt.slice(0, 28) + '…'); });
    node.filter((d) => d.type === 'concept').append('text').text((d) => d.label).attr('dy', 16)
      .attr('text-anchor', 'middle').attr('fill', '#4b5563').attr('font-size', '8.5px').attr('pointer-events', 'none');

    // Hover effect
    node.style('transition', 'opacity 0.2s')
      .on('mouseenter', function () { d3.select(this).select('circle:nth-child(2)').attr('r', 22).attr('opacity', 1); })
      .on('mouseleave', function () { d3.select(this).select('circle:nth-child(2)').attr('r', 18).attr('opacity', 0.92); });

    node.on('click', (_event, d) => {
      _event.stopPropagation();
      if (d.type === 'document') {
        const explicitE = data.edges.filter((e) => (e.source === d.id || e.target === d.id) && e.relationship_type !== 'CITES');
        const citeE = data.edges.filter((e) => e.source === d.id && e.relationship_type === 'CITES');
        const citedByE = data.edges.filter((e) => e.target === d.id && e.relationship_type === 'CITES');
        const sharedE = data.shared_concept_edges.filter((e) => e.source === d.id || e.target === d.id);
        const comm = data.communities.find((c) => c.id === d.community);
        setDetail({
          type: 'document', label: d.label, fullLabel: d.fullLabel, toc: d.toc, hl: d.hl, ll: d.ll,
          community: d.community, metadata: d.metadata,
          explicitEdges: explicitE.map((e) => {
            const oid = e.source === d.id ? e.target : e.source;
            const od = docMap.get(oid);
            return { weight: e.weight, otherLabel: od ? (od.file_name || od.description).slice(0, 50) : oid.slice(0, 8), hl_jaccard: e.hl_jaccard, ll_jaccard: e.ll_jaccard, semantic_cosine: e.semantic_cosine };
          }),
          citationEdges: citeE.map((e) => {
            const od = docMap.get(e.target);
            return { weight: e.weight, otherLabel: od ? (od.file_name || od.description).slice(0, 50) : e.target.slice(0, 8), rawText: e.citation_raw_text, citeType: e.citation_type, confidence: e.citation_confidence };
          }),
          citedByEdges: citedByE.map((e) => {
            const od = docMap.get(e.source);
            return { otherLabel: od ? (od.file_name || od.description).slice(0, 50) : e.source.slice(0, 8), rawText: e.citation_raw_text };
          }),
          sharedEdges: sharedE.map((e) => {
            const oid = e.source === d.id ? e.target : e.source;
            const od = docMap.get(oid);
            return { count: e.shared_count, otherLabel: od ? (od.file_name || od.description).slice(0, 50) : oid.slice(0, 8) };
          }),
          communityInfo: comm ? { level: comm.level, memberCount: comm.member_count, dominantHl: comm.dominant_hl, dominantLl: comm.dominant_ll } : undefined,
        });
      } else {
        setDetail({ type: 'concept', label: d.label, level: d.level, docFreq: d.docFreq });
      }
    });

    sim.on('tick', () => {
      linkSel
        .attr('x1', (d: unknown) => { const l = d as GraphLink; return (typeof l.source === 'object' ? l.source.x : 0) ?? 0; })
        .attr('y1', (d: unknown) => { const l = d as GraphLink; return (typeof l.source === 'object' ? l.source.y : 0) ?? 0; })
        .attr('x2', (d: unknown) => { const l = d as GraphLink; return (typeof l.target === 'object' ? l.target.x : 0) ?? 0; })
        .attr('y2', (d: unknown) => { const l = d as GraphLink; return (typeof l.target === 'object' ? l.target.y : 0) ?? 0; });
      node.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    sim.alpha(1).restart();
    svg.transition().duration(600).call(zoom.transform, d3.zoomIdentity.translate(width / 2, height / 2).scale(0.7));
  }, [data, showConcepts, ccMap]);

  useEffect(() => {
    if (data) buildGraph();
  }, [data, buildGraph]);

  useEffect(() => {
    const handleResize = () => {
      if (svgRef.current && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        d3.select(svgRef.current).attr('width', rect.width).attr('height', rect.height);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const stats = data?.documents ? {
    docs: data.documents.length,
    comms: (data.communities ?? []).length,
    concepts: (data.concepts ?? []).length,
    explicit: (data.edges ?? []).length,
    cites: (data.edges ?? []).filter((e) => e.relationship_type === 'CITES').length,
    shared: (data.shared_concept_edges ?? []).length,
  } : null;

  const metaEntries = detail?.metadata
    ? Object.entries(detail.metadata).filter(([k]) => shouldDisplayMetaKey(k))
    : [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-full p-0 flex flex-col">
        <SheetHeader className="px-4 pt-4 pb-2 shrink-0">
          <SheetTitle className="flex items-center gap-2">
            <Network className="h-4 w-4" />
            {t('graphPanel.title')}
          </SheetTitle>
          <SheetDescription>{t('graphPanel.description')}</SheetDescription>
        </SheetHeader>

        <div className="flex items-center gap-2 px-4 pb-2 shrink-0">
          <Button variant="outline" size="sm" onClick={() => void loadGraph()} disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
            {t('graphPanel.refresh')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowConcepts((p) => !p)} className={showConcepts ? 'bg-primary text-primary-foreground' : ''}>
            {t('graphPanel.toggleConcepts')}
          </Button>
        </div>

        {/* Stats bar */}
        {stats && (
          <div className="flex flex-wrap gap-3 px-4 pb-2 text-[11px] shrink-0">
            {[
              { label: t('graphPanel.stats.docs'), value: stats.docs, color: '#6366f1' },
              { label: t('graphPanel.stats.communities'), value: stats.comms, color: '#059669' },
              { label: t('graphPanel.stats.concepts'), value: stats.concepts, color: '#0891b2' },
              { label: t('graphPanel.stats.edges'), value: stats.explicit, color: '#d97706' },
              { label: t('graphPanel.stats.citations'), value: stats.cites, color: '#dc2626' },
            ].map((s) => (
              <div key={s.label} className="flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
                <span className="text-muted-foreground">{s.label}</span>
                <span className="font-bold">{s.value}</span>
              </div>
            ))}
          </div>
        )}

        {/* Community legend */}
        {data?.communities && data.communities.length > 0 && (
          <div className="flex flex-wrap gap-2 px-4 pb-2 shrink-0">
            {data.communities.map((c, i) => (
              <div key={c.id} className="flex items-center gap-1.5 text-[10px]">
                <span className="h-3 w-3 rounded-full border border-white shadow-sm" style={{ backgroundColor: COMM_COLORS[i % COMM_COLORS.length] }} />
                <span className="text-muted-foreground">L{c.level} · {c.member_count} docs</span>
              </div>
            ))}
          </div>
        )}

        {error && <div className="px-4 pb-2 text-sm text-destructive shrink-0">{error}</div>}

        <div className="flex-1 flex relative overflow-hidden">
          <div ref={containerRef} className="flex-1 relative">
            <svg ref={svgRef} className="w-full h-full" />
          </div>

          {/* Detail panel */}
          {detail && (
            <div className="w-[360px] border-l bg-background/95 backdrop-blur shrink-0">
              <ScrollArea className="h-full">
                <div className="p-4">
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ backgroundColor: detail.community ? `${getColorForCommunity(detail.community, ccMap)}20` : '#f1f5f9' }}>
                        {detail.type === 'document' ? <FileText className="h-4 w-4" style={{ color: detail.community ? getColorForCommunity(detail.community, ccMap) : '#64748b' }} /> : <Tag className="h-4 w-4 text-indigo-500" />}
                      </div>
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {detail.type === 'document' ? t('graphPanel.detail.document') : t('graphPanel.detail.concept')}
                      </span>
                    </div>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDetail(null)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>

                  {/* Title */}
                  <h3 className="text-sm font-bold mb-3 leading-snug">
                    {detail.fullLabel ?? detail.label}
                  </h3>

                  {detail.type === 'document' && (
                    <>
                      {/* Metadata */}
                      {metaEntries.length > 0 && (
                        <DetailSection icon={<Layers className="h-3 w-3 text-violet-500" />} title="Metadata">
                          <div className="space-y-1.5">
                            {metaEntries.map(([key, value]) => (
                              <div key={key} className="flex flex-col gap-0.5">
                                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">{key.replace(/_/g, ' ')}</span>
                                <span className="text-xs leading-relaxed">{formatMetadataValue(value)}</span>
                              </div>
                            ))}
                          </div>
                        </DetailSection>
                      )}

                      {/* TOC */}
                      {detail.toc && (
                        <DetailSection icon={<FileText className="h-3 w-3 text-blue-500" />} title={t('graphPanel.detail.toc')}>
                          <p className="text-xs whitespace-pre-wrap leading-relaxed text-muted-foreground">{detail.toc}</p>
                        </DetailSection>
                      )}

                      {/* HL Concepts */}
                      {detail.hl && detail.hl.length > 0 && (
                        <DetailSection icon={<Tag className="h-3 w-3 text-indigo-500" />} title={t('graphPanel.detail.hlConcepts', { count: detail.hl.length })}>
                          <div className="flex flex-wrap gap-1">
                            {detail.hl.map((c) => <MetaBadge key={c} value={c} color="#4f46e5" />)}
                          </div>
                        </DetailSection>
                      )}

                      {/* LL Concepts */}
                      {detail.ll && detail.ll.length > 0 && (
                        <DetailSection icon={<Tag className="h-3 w-3 text-emerald-500" />} title={t('graphPanel.detail.llConcepts', { count: detail.ll.length })}>
                          <div className="flex flex-wrap gap-1">
                            {detail.ll.map((c) => <MetaBadge key={c} value={c} color="#059669" />)}
                          </div>
                        </DetailSection>
                      )}

                      {/* Community */}
                      {detail.communityInfo && (
                        <DetailSection icon={<Layers className="h-3 w-3 text-amber-500" />} title={t('graphPanel.detail.community')}>
                          <div className="flex items-center gap-3 mb-2">
                            <div className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: detail.community ? getColorForCommunity(detail.community, ccMap) : '#94a3b8' }}>
                              {detail.communityInfo.level}
                            </div>
                            <span className="text-xs text-muted-foreground">{t('graphPanel.detail.communityLevel')}: {detail.communityInfo.level} · {detail.communityInfo.memberCount} {t('graphPanel.detail.communityMembers')}</span>
                          </div>
                          {detail.communityInfo.dominantHl.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {detail.communityInfo.dominantHl.map((c) => <MetaBadge key={c} value={c} color="#d97706" />)}
                            </div>
                          )}
                        </DetailSection>
                      )}

                      {/* Edges */}
                      {detail.explicitEdges && detail.explicitEdges.length > 0 && (
                        <DetailSection icon={<GitBranch className="h-3 w-3 text-indigo-500" />} title={t('graphPanel.detail.explicitEdges', { count: detail.explicitEdges.length })}>
                          <div className="space-y-2">
                            {detail.explicitEdges.map((e, i) => (
                              <div key={i} className="rounded-md border border-border/60 p-2 bg-background">
                                <p className="text-xs font-medium mb-1">{e.otherLabel}</p>
                                <div className="flex gap-3 text-[10px] text-muted-foreground">
                                  <span>w: <b className="text-indigo-600">{e.weight.toFixed(3)}</b></span>
                                  <span>HL: <b>{e.hl_jaccard.toFixed(2)}</b></span>
                                  <span>LL: <b>{e.ll_jaccard.toFixed(2)}</b></span>
                                  <span>cos: <b>{e.semantic_cosine.toFixed(2)}</b></span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </DetailSection>
                      )}

                      {/* Citations */}
                      {detail.citationEdges && detail.citationEdges.length > 0 && (
                        <DetailSection icon={<Quote className="h-3 w-3 text-red-500" />} title={t('graphPanel.detail.cites', { count: detail.citationEdges.length })}>
                          <div className="space-y-2">
                            {detail.citationEdges.map((e, i) => (
                              <div key={i} className="rounded-md border border-red-200/50 p-2 bg-red-50/30">
                                <p className="text-xs font-medium">{e.otherLabel}</p>
                                {e.rawText && <p className="text-[10px] italic text-muted-foreground mt-1 line-clamp-2">"{e.rawText.slice(0, 120)}"</p>}
                              </div>
                            ))}
                          </div>
                        </DetailSection>
                      )}

                      {/* Cited by */}
                      {detail.citedByEdges && detail.citedByEdges.length > 0 && (
                        <DetailSection icon={<Quote className="h-3 w-3 text-orange-500" />} title={t('graphPanel.detail.citedBy', { count: detail.citedByEdges.length })}>
                          <div className="space-y-1">
                            {detail.citedByEdges.map((e, i) => (
                              <div key={i} className="text-xs">
                                <span className="font-medium">{e.otherLabel}</span>
                                {e.rawText && <p className="text-[10px] italic text-muted-foreground line-clamp-2">"{e.rawText.slice(0, 100)}"</p>}
                              </div>
                            ))}
                          </div>
                        </DetailSection>
                      )}

                      {/* Shared concepts */}
                      {detail.sharedEdges && detail.sharedEdges.length > 0 && (
                        <DetailSection icon={<Layers className="h-3 w-3 text-amber-500" />} title={t('graphPanel.detail.sharedEdges', { count: detail.sharedEdges.length })}>
                          <div className="flex flex-wrap gap-1.5">
                            {detail.sharedEdges.map((e, i) => (
                              <div key={i} className="rounded-md bg-amber-50/50 border border-amber-200/50 px-2 py-1 text-[10px]">
                                <b className="text-amber-700">{e.count}</b> shared · {e.otherLabel}
                              </div>
                            ))}
                          </div>
                        </DetailSection>
                      )}
                    </>
                  )}

                  {detail.type === 'concept' && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-medium text-indigo-700">{detail.level}</span>
                        <span className="text-xs text-muted-foreground">freq: <b>{detail.docFreq}</b></span>
                      </div>
                      <p className="text-sm font-medium">{detail.label}</p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
