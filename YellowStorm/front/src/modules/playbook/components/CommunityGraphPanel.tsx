import { useEffect, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3';
import { Loader2, RefreshCw } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
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

const COMM_COLORS = ['#4f46e5', '#0891b2', '#059669', '#d97706', '#dc2626', '#7c3aed', '#db2777', '#0d9488', '#ea580c', '#65a30d', '#be123c'];

interface DetailData {
  type: 'document' | 'concept';
  label: string;
  fullLabel?: string;
  toc?: string;
  hl?: string[];
  ll?: string[];
  community?: string | null;
  level?: string;
  docFreq?: number;
  explicitEdges?: Array<{ weight: number; otherLabel: string; hl_jaccard: number; ll_jaccard: number; semantic_cosine: number }>;
  citationEdges?: Array<{ weight: number; otherLabel: string; rawText?: string; citeType?: string; confidence?: number }>;
  citedByEdges?: Array<{ otherLabel: string; rawText?: string }>;
  sharedEdges?: Array<{ count: number; otherLabel: string }>;
  communityInfo?: { level: number; memberCount: number; dominantHl: string[]; dominantLl: string[] };
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
      loadGraph();
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

  const buildGraph = useCallback(() => {
    if (!data || !svgRef.current || !containerRef.current) return;

    if (simulationRef.current) {
      simulationRef.current.stop();
    }

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const g = svg.append('g');
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 8])
      .on('zoom', (event) => g.attr('transform', event.transform));
    svg.call(zoom);

    const rect = containerRef.current.getBoundingClientRect();
    svg.attr('width', rect.width).attr('height', rect.height);

    const ccMap: Record<string, string> = {};
    data.communities.forEach((c, i) => { ccMap[c.id] = COMM_COLORS[i % COMM_COLORS.length]; });

    const docMap = new Map(data.documents.map((d) => [d.id, d]));
    const nodes: GraphNode[] = [];
    const links: GraphLink[] = [];

    data.documents.forEach((d) => {
      nodes.push({
        id: d.id,
        type: 'document',
        label: (d.file_name || d.description).slice(0, 40) + '...',
        fullLabel: d.file_name || d.description,
        community: d.community_id,
        hl: d.hl_concepts,
        ll: d.ll_concepts,
        toc: d.toc_text,
      });
    });

    data.edges.forEach((e) => {
      links.push({
        source: e.source,
        target: e.target,
        weight: e.weight,
        linkType: 'explicit',
        rel_type: e.relationship_type,
        hl_jaccard: e.hl_jaccard,
        ll_jaccard: e.ll_jaccard,
        semantic_cosine: e.semantic_cosine,
        shared_hl: e.shared_hl,
        shared_ll: e.shared_ll,
        citation_raw_text: e.citation_raw_text,
        citation_type: e.citation_type,
        citation_confidence: e.citation_confidence,
      });
    });

    data.shared_concept_edges.forEach((e) => {
      links.push({
        source: e.source,
        target: e.target,
        weight: e.shared_count,
        linkType: 'shared_concept',
        levels: e.shared_levels,
      });
    });

    if (showConcepts) {
      const top = data.concepts
        .filter((c) => c.level === 'HL')
        .sort((a, b) => b.doc_freq - a.doc_freq)
        .slice(0, 30);
      top.forEach((c) => {
        nodes.push({ id: `c-${c.id}`, type: 'concept', label: c.label, level: c.level, docFreq: c.doc_freq });
      });
      data.concept_document_links.forEach((l) => {
        const cid = `c-${l.concept_id}`;
        if (nodes.find((n) => n.id === cid) && nodes.find((n) => n.id === l.document_id)) {
          links.push({ source: cid, target: l.document_id, weight: 0.3, linkType: 'concept_link', level: l.level });
        }
      });
    }

    const sim = d3.forceSimulation<GraphNode>(nodes)
      .force('link', d3.forceLink<GraphNode, GraphLink>(links)
        .id((d) => d.id)
        .distance((d) => {
          if (d.linkType === 'concept_link') return 80;
          if (d.linkType === 'shared_concept') return 140;
          return 160;
        })
        .strength(0.4))
      .force('charge', d3.forceManyBody<GraphNode>().strength((d) => d.type === 'concept' ? -80 : -400))
      .force('center', d3.forceCenter(rect.width / 2, rect.height / 2))
      .force('collision', d3.forceCollide<GraphNode>().radius((d) => d.type === 'concept' ? 20 : 40));

    simulationRef.current = sim;

    g.append('g').selectAll('line').data(links).join('line')
      .attr('stroke', (d) => {
        if (d.linkType === 'shared_concept') return '#f59e0b';
        if (d.linkType === 'concept_link') return 'rgba(59,130,246,0.25)';
        if (d.rel_type === 'CITES') return '#dc2626';
        return '#6366f1';
      })
      .attr('stroke-width', (d) => {
        if (d.linkType === 'shared_concept') return Math.min(d.weight * 2, 6);
        if (d.linkType === 'concept_link') return 1;
        return Math.max(d.weight * 5, 2);
      })
      .attr('stroke-dasharray', (d) => {
        if (d.linkType === 'shared_concept') return '8,4';
        if (d.linkType === 'concept_link') return '3,3';
        if (d.rel_type === 'CITES') return '4,2';
        return 'none';
      })
      .attr('stroke-opacity', (d) => d.linkType === 'concept_link' ? 0.3 : 0.7);

    const node = g.append('g').selectAll('g').data(nodes).join('g')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .call(d3.drag<SVGGElement, GraphNode, GraphNode>()
        .on('start', (event, d) => { if (!event.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
        .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
        .on('end', (event, d) => { if (!event.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }) as any);

    node.filter((d) => d.type === 'document').append('circle').attr('r', 20)
      .attr('fill', (d) => ccMap[d.community ?? ''] || '#94a3b8')
      .attr('stroke', '#fff').attr('stroke-width', 2).attr('opacity', 0.9);
    node.filter((d) => d.type === 'concept').append('rect').attr('width', 12).attr('height', 12).attr('x', -6).attr('y', -6)
      .attr('rx', 3).attr('fill', '#3b82f6').attr('opacity', 0.7);
    node.filter((d) => d.type === 'document').append('text').text((d) => d.label).attr('dy', 32)
      .attr('text-anchor', 'middle').attr('fill', '#4b5563').attr('font-size', '10px').attr('font-weight', '500').attr('pointer-events', 'none');
    node.filter((d) => d.type === 'concept').append('text').text((d) => d.label).attr('dy', 18)
      .attr('text-anchor', 'middle').attr('fill', '#374151').attr('font-size', '9px').attr('pointer-events', 'none');

    node.on('click', (_event, d) => {
      _event.stopPropagation();
      if (d.type === 'document') {
        const explicitE = data.edges.filter((e) => (e.source === d.id || e.target === d.id) && e.relationship_type !== 'CITES');
        const citeE = data.edges.filter((e) => e.source === d.id && e.relationship_type === 'CITES');
        const citedByE = data.edges.filter((e) => e.target === d.id && e.relationship_type === 'CITES');
        const sharedE = data.shared_concept_edges.filter((e) => e.source === d.id || e.target === d.id);
        const comm = data.communities.find((c) => c.id === d.community);
        setDetail({
          type: 'document',
          label: d.label,
          fullLabel: d.fullLabel,
          toc: d.toc,
          hl: d.hl,
          ll: d.ll,
          community: d.community,
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
      g.selectAll('line')
        .attr('x1', (d: unknown) => { const l = d as GraphLink; return (typeof l.source === 'object' ? l.source.x : 0) ?? 0; })
        .attr('y1', (d: unknown) => { const l = d as GraphLink; return (typeof l.source === 'object' ? l.source.y : 0) ?? 0; })
        .attr('x2', (d: unknown) => { const l = d as GraphLink; return (typeof l.target === 'object' ? l.target.x : 0) ?? 0; })
        .attr('y2', (d: unknown) => { const l = d as GraphLink; return (typeof l.target === 'object' ? l.target.y : 0) ?? 0; });
      node.attr('transform', (d) => `translate(${d.x},${d.y})`);
    });

    svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity.translate(rect.width / 2, rect.height / 2).scale(0.7));
  }, [data, showConcepts]);

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

  const stats = data ? {
    docs: data.documents.length,
    comms: data.communities.length,
    concepts: data.concepts.length,
    explicit: data.edges.length,
    cites: data.edges.filter((e) => e.relationship_type === 'CITES').length,
    shared: data.shared_concept_edges.length,
  } : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-full p-0 flex flex-col">
        <SheetHeader className="px-4 pt-4 pb-2 shrink-0">
          <SheetTitle>{t('graphPanel.title')}</SheetTitle>
          <SheetDescription>{t('graphPanel.description')}</SheetDescription>
        </SheetHeader>

        <div className="flex items-center gap-2 px-4 pb-2 shrink-0">
          <Button variant="outline" size="sm" onClick={loadGraph} disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
            {t('graphPanel.refresh')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowConcepts((p) => !p)} className={showConcepts ? 'bg-primary text-primary-foreground' : ''}>
            {t('graphPanel.toggleConcepts')}
          </Button>
        </div>

        {stats && (
          <div className="flex gap-4 px-4 pb-2 text-xs text-muted-foreground shrink-0">
            <span>{t('graphPanel.stats.docs')}: <b>{stats.docs}</b></span>
            <span>{t('graphPanel.stats.communities')}: <b>{stats.comms}</b></span>
            <span>{t('graphPanel.stats.concepts')}: <b>{stats.concepts}</b></span>
            <span>{t('graphPanel.stats.edges')}: <b>{stats.explicit}</b></span>
            <span>{t('graphPanel.stats.citations')}: <b>{stats.cites}</b></span>
            <span>{t('graphPanel.stats.shared')}: <b>{stats.shared}</b></span>
          </div>
        )}

        {error && (
          <div className="px-4 pb-2 text-sm text-destructive shrink-0">{error}</div>
        )}

        <div className="flex-1 flex relative overflow-hidden">
          <div ref={containerRef} className="flex-1 relative">
            <svg ref={svgRef} className="w-full h-full" />
          </div>

          {detail && (
            <div className="w-[340px] border-l overflow-y-auto p-4 shrink-0">
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-sm font-semibold">{detail.type === 'document' ? t('graphPanel.detail.document') : t('graphPanel.detail.concept')}</h3>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setDetail(null)}>&times;</Button>
              </div>

              {detail.type === 'document' && (
                <>
                  <div className="mb-3">
                    <p className="text-xs text-muted-foreground mb-1">{t('graphPanel.detail.description')}</p>
                    <p className="text-sm">{detail.fullLabel}</p>
                  </div>
                  {detail.toc && (
                    <div className="mb-3">
                      <p className="text-xs text-muted-foreground mb-1">{t('graphPanel.detail.toc')}</p>
                      <p className="text-xs whitespace-pre-wrap">{detail.toc}</p>
                    </div>
                  )}
                  {detail.hl && detail.hl.length > 0 && (
                    <div className="mb-3">
                      <p className="text-xs text-muted-foreground mb-1">{t('graphPanel.detail.hlConcepts', { count: detail.hl.length })}</p>
                      <div className="flex flex-wrap gap-1">
                        {detail.hl.map((c) => (
                          <span key={c} className="inline-block px-2 py-0.5 rounded-full text-[10px] bg-blue-100 text-blue-700 border border-blue-200">{c}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {detail.ll && detail.ll.length > 0 && (
                    <div className="mb-3">
                      <p className="text-xs text-muted-foreground mb-1">{t('graphPanel.detail.llConcepts', { count: detail.ll.length })}</p>
                      <div className="flex flex-wrap gap-1">
                        {detail.ll.map((c) => (
                          <span key={c} className="inline-block px-2 py-0.5 rounded-full text-[10px] bg-green-100 text-green-700 border border-green-200">{c}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {detail.explicitEdges && detail.explicitEdges.length > 0 && (
                    <div className="mb-3">
                      <p className="text-xs text-muted-foreground mb-1">{t('graphPanel.detail.explicitEdges', { count: detail.explicitEdges.length })}</p>
                      {detail.explicitEdges.map((e, i) => (
                        <div key={i} className="text-xs mb-1">
                          <b className="text-indigo-600">w:{e.weight.toFixed(3)}</b> {e.otherLabel}
                          <br />
                          <span className="text-muted-foreground">HL:{e.hl_jaccard.toFixed(3)} LL:{e.ll_jaccard.toFixed(3)} cos:{e.semantic_cosine.toFixed(3)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {detail.sharedEdges && detail.sharedEdges.length > 0 && (
                    <div className="mb-3">
                      <p className="text-xs text-muted-foreground mb-1">{t('graphPanel.detail.sharedEdges', { count: detail.sharedEdges.length })}</p>
                      {detail.sharedEdges.map((e, i) => (
                        <div key={i} className="text-xs mb-1">
                          <b className="text-amber-600">{e.count} shared</b> {e.otherLabel}
                        </div>
                      ))}
                    </div>
                  )}
                  {detail.citationEdges && detail.citationEdges.length > 0 && (
                    <div className="mb-3">
                      <p className="text-xs text-muted-foreground mb-1">{t('graphPanel.detail.cites', { count: detail.citationEdges.length })}</p>
                      {detail.citationEdges.map((e, i) => (
                        <div key={i} className="text-xs mb-1">
                          <b className="text-red-600">cites</b> {e.otherLabel}
                          {e.rawText && <p className="italic text-muted-foreground">"{e.rawText.slice(0, 80)}"</p>}
                        </div>
                      ))}
                    </div>
                  )}
                  {detail.citedByEdges && detail.citedByEdges.length > 0 && (
                    <div className="mb-3">
                      <p className="text-xs text-muted-foreground mb-1">{t('graphPanel.detail.citedBy', { count: detail.citedByEdges.length })}</p>
                      {detail.citedByEdges.map((e, i) => (
                        <div key={i} className="text-xs mb-1">
                          <b className="text-red-600">cited by</b> {e.otherLabel}
                          {e.rawText && <p className="italic text-muted-foreground">"{e.rawText.slice(0, 80)}"</p>}
                        </div>
                      ))}
                    </div>
                  )}
                  {detail.communityInfo && (
                    <div className="mb-3">
                      <p className="text-xs text-muted-foreground mb-1">{t('graphPanel.detail.community')}</p>
                      <p className="text-xs">{t('graphPanel.detail.communityLevel')}: {detail.communityInfo.level} | {t('graphPanel.detail.communityMembers')}: {detail.communityInfo.memberCount}</p>
                      {detail.communityInfo.dominantHl.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {detail.communityInfo.dominantHl.map((c) => (
                            <span key={c} className="inline-block px-2 py-0.5 rounded-full text-[10px] bg-blue-100 text-blue-700">{c}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              {detail.type === 'concept' && (
                <>
                  <p className="text-sm font-medium">{detail.label}</p>
                  <p className="text-xs text-muted-foreground">{detail.level} | freq: {detail.docFreq}</p>
                </>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
