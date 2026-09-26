import { useCallback, useEffect, useRef, useState } from 'react';
import * as d3Force from 'd3-force';
import * as d3Selection from 'd3-selection';
import * as d3Zoom from 'd3-zoom';
import * as d3Drag from 'd3-drag';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileText, Loader2, Plus, RefreshCw, Trash2, X, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { parseApiError } from '@/lib/api-error';
import { useModuleTranslation } from '@/modules/localization';
import { semanticModelApi } from '../../api';
import { useSemanticModel } from '../../query/hooks';
import { semanticModelQueryKeys } from '../../query/queryKeys';
import type { AgeGraphEdge, AgeGraphNode, AgeGraphOperation, SemanticCorpusDocument, SemanticCorpusManifest, SemanticGraph, SemanticRelationType } from '../../types';

const NODE_R = 42;
const PALETTE = [
  '#059669', '#4f46e5', '#d97706', '#2563eb',
  '#dc2626', '#7c3aed', '#db2777', '#0891b2',
];

function labelColor(label: string, allLabels: string[]): string {
  const idx = allLabels.indexOf(label);
  return PALETTE[idx >= 0 ? idx % PALETTE.length : 0];
}

type SimNode = d3Force.SimulationNodeDatum & {
  id: string;
  displayLabel: string;
  type: string;
  raw: AgeGraphNode;
};

type SimLink = d3Force.SimulationLinkDatum<SimNode> & {
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
  canEdit?: boolean;
  dataRevisionId?: string;
  onDataRevision?: (revisionId: string) => void;
}

// Wrap long text into 2 lines to fit inside the circle
function wrapLines(text: string, maxLen = 14): [string, string | null] {
  const qualified = text.split(' · ');
  if (qualified.length === 2 && qualified.every((part) => part.length <= maxLen)) return [qualified[0], qualified[1]];
  if (text.length <= maxLen) return [text, null];
  const mid = Math.max(text.lastIndexOf(' ', maxLen), text.lastIndexOf('-', maxLen - 1));
  if (mid > 0) return [text.slice(0, mid + (text[mid] === '-' ? 1 : 0)), text.slice(mid + 1).slice(0, maxLen)];
  return [text.slice(0, maxLen - 1) + '…', null];
}

export function SemanticModelGraphViewer({ open, onClose, modelId, canEdit = false, dataRevisionId, onDataRevision }: Props) {
  const { t } = useModuleTranslation('semantic-model');
  const model = useSemanticModel(open ? modelId : undefined);
  const runtimeOwned = model.data?.executionOwner === 'runtime';
  const graphCanEdit = canEdit && !runtimeOwned;
  const queryClient = useQueryClient();
  const markIndexPending = useCallback(() => {
    queryClient.setQueryData(semanticModelQueryKeys.model(modelId), (current: typeof model.data) => current ? { ...current,indexStatus: 'pending' as const,indexError: null } : current);
    void queryClient.invalidateQueries({ queryKey: semanticModelQueryKeys.all });
  },[model.data,modelId,queryClient]);
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const simRef = useRef<d3Force.Simulation<SimNode, SimLink> | null>(null);

  const [loading, setLoading] = useState(false);
  const [ageNodes, setAgeNodes] = useState<AgeGraphNode[]>([]);
  const [ageEdges, setAgeEdges] = useState<AgeGraphEdge[]>([]);
  const [modelGraph, setModelGraph] = useState<SemanticGraph | null>(null);
  const [corpus, setCorpus] = useState<SemanticCorpusManifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<AgeGraphNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<AgeGraphEdge | null>(null);
  const [editorMode, setEditorMode] = useState<'node' | null>(null);
  const [pendingRelationChoice, setPendingRelationChoice] = useState<{ sourceId: string; targetId: string; relations: SemanticRelationType[] } | null>(null);
  const [pendingRelationTypeId, setPendingRelationTypeId] = useState('');
  const [nodeTypeId, setNodeTypeId] = useState('');
  const [nodeLabel, setNodeLabel] = useState('');
  const [nodeValues, setNodeValues] = useState<Record<string, string>>({});
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [mutationLoading, setMutationLoading] = useState(false);
  const selectedNodeType = modelGraph?.nodes.find((node) => node.id === nodeTypeId);
  const relevantDocuments = Array.from(new Map<string, SemanticCorpusDocument>((corpus?.bindings ?? [])
    .filter((binding) => binding.target.kind === 'node_type' && binding.target.id === nodeTypeId)
    .flatMap((binding) => binding.documents)
    .map((document): [string, SemanticCorpusDocument] => [document.sourceDocumentId, document])).values());

  useEffect(() => {
    if (!selectedNodeType) return;
    setNodeValues((current) => Object.fromEntries(selectedNodeType.attributes.map((attribute) => [attribute.key, current[attribute.key] ?? ''])));
  }, [selectedNodeType?.id]);

  /** Graph vertices are labelled with the concept key; people read the concept's name. */
  const conceptLabel = (key: string) => modelGraph?.nodes.find((node) => node.key === key)?.label ?? key.replaceAll('_', ' ');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSelectedNode(null);
    setSelectedEdge(null);
    try {
      const [{ nodes, edges, dataRevisionId: loadedRevisionId }, structure, preparedCorpus] = await Promise.all([
        semanticModelApi.getAgeGraph(modelId, dataRevisionId),
        semanticModelApi.graph(modelId),
        semanticModelApi.corpus(modelId),
      ]);
      setAgeNodes(nodes);
      if (loadedRevisionId) onDataRevision?.(loadedRevisionId);
      setAgeEdges(edges);
      setModelGraph(structure);
      setCorpus(preparedCorpus);
      setSelectedDocumentIds([]);
      setNodeTypeId((current) => current || structure.nodes.find((node) => !node.systemKey && node.recordPolicy !== 'none')?.id || '');
    } catch (err: unknown) {
      setError(parseApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, [dataRevisionId, modelId, onDataRevision]);

  useEffect(() => {
    if (open && modelId) void load();
  }, [open, modelId, load]);

  // ── D3 force graph ──────────────────────────────────────────────────────────
  useEffect(() => {
    simRef.current?.stop();
    if (!svgRef.current || !containerRef.current) return;

    const svgEl = svgRef.current;
    const d3svg = d3Selection.select(svgEl);
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
    const zoom = d3Zoom
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.05, 3])
      .on('zoom', (ev) => g.attr('transform', ev.transform.toString()));
    d3svg.call(zoom);

    // Deselect on background click
    d3svg.on('click', () => {
      setSelectedNode(null);
      setSelectedEdge(null);
    });

    // Data
    const allTypes = [...new Set(ageNodes.map((n) => n.label))];

    const labelCounts = new Map<string, number>();
    for (const node of ageNodes) {
      const key = `${node.label}:${String(node.properties.record_label ?? node.id)}`;
      labelCounts.set(key, (labelCounts.get(key) ?? 0) + 1);
    }
    const simNodes: SimNode[] = ageNodes.map((n) => ({
      id: n.id,
      displayLabel: (() => {
        const label = String(n.properties.record_label ?? n.id);
        // Same-named records are told apart by their first business attribute (e.g. a date), whatever the concept.
        const attributes = modelGraph?.nodes.find((node) => node.key === n.label)?.attributes ?? [];
        const qualifier = attributes.map((attribute) => n.properties[attribute.key]).find((value) => value != null && value !== '' && value !== '__missing__' && String(value) !== label);
        return (labelCounts.get(`${n.label}:${label}`) ?? 0) > 1 && qualifier ? `${label} · ${qualifier}` : label;
      })(),
      type: n.label,
      raw: n,
      x: width / 2 + (Math.random() - 0.5) * 300,
      y: height / 2 + (Math.random() - 0.5) * 300,
    }));

    const nodeById = new Map(simNodes.map((n) => [n.id, n]));

    const simLinks: SimLink[] = ageEdges
      .filter((e) => nodeById.has(e.sourceId) && nodeById.has(e.targetId))
      .map((e) => ({ id: e.id, edgeLabel: modelGraph?.relations.find((relation) => relation.id === e.label || relation.key === e.label)?.label ?? e.label.replaceAll('_', ' '), source: e.sourceId, target: e.targetId }));

    // Simulation — stays alive for continuous animation
    const sim = d3Force
      .forceSimulation<SimNode>(simNodes)
      .force(
        'link',
        d3Force.forceLink<SimNode, SimLink>(simLinks).id((d) => d.id).distance(170).strength(0.35),
      )
      .force('charge', d3Force.forceManyBody<SimNode>().strength(-500))
      .force('center', d3Force.forceCenter(width / 2, height / 2))
      .force('collision', d3Force.forceCollide<SimNode>(NODE_R + 12))
      .alphaDecay(0.018); // slow decay → longer warm animation

    // Links
    const link = g
      .append('g')
      .selectAll<SVGLineElement, SimLink>('line')
      .data(simLinks)
      .join('line')
      .attr('stroke', 'rgba(255,255,255,0.18)')
      .attr('stroke-width', 1.5)
      .attr('marker-end', 'url(#ag-arrow)')
      .style('cursor', 'pointer')
      .on('click', (ev, d) => {
        ev.stopPropagation();
        setSelectedNode(null);
        setSelectedEdge(ageEdges.find((edge) => edge.id === d.id) ?? null);
      });

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

    // A dedicated connector handle keeps relationship creation separate from
    // normal node movement. Users can link nodes directly with the mouse.
    const linkPreview = g
      .append('line')
      .attr('stroke', 'rgba(96,165,250,0.85)')
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '6 4')
      .attr('pointer-events', 'none')
      .style('display', 'none');
    const drag = d3Drag
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

    const linkDrag = d3Drag
      .drag<SVGCircleElement, SimNode>()
      .on('start', (ev, d) => {
        ev.sourceEvent.stopPropagation();
        linkPreview.style('display', null).attr('x1', d.x ?? 0).attr('y1', d.y ?? 0).attr('x2', d.x ?? 0).attr('y2', d.y ?? 0);
      })
      .on('drag', (ev) => {
        linkPreview.attr('x2', ev.x).attr('y2', ev.y);
      })
      .on('end', (ev, d) => {
        linkPreview.style('display', 'none');
        const target = simNodes.find((candidate) => candidate.id !== d.raw.id && Math.hypot((candidate.x ?? 0) - ev.x, (candidate.y ?? 0) - ev.y) <= NODE_R + 16);
        if (!target) return;
        const sourceTypeId = String(d.raw.properties.node_type_id ?? '');
        const targetTypeId = String(target.raw.properties.node_type_id ?? '');
        const relations = (modelGraph?.relations ?? []).filter((relation) => relation.sourceNodeTypeId === sourceTypeId && relation.targetNodeTypeId === targetTypeId);
        if (relations.length === 0) {
          setError(t('graphViewer.noCompatibleRelation'));
        } else {
          setPendingRelationTypeId(relations[0].id);
          setPendingRelationChoice({ sourceId: d.raw.id, targetId: target.raw.id, relations });
        }
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
      const g = d3Selection.select(this);
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
        .text(line2.length > 14 ? line2.slice(0, 13) + '…' : line2);
      }

      // Type sublabel
      g.append('text')
        .attr('text-anchor', 'middle')
        .attr('dy', line2 ? yOff + 26 : 16)
        .attr('fill', 'rgba(255,255,255,0.5)')
        .attr('font-size', 8)
        .attr('font-family', 'system-ui, sans-serif')
        .attr('pointer-events', 'none')
        .text(conceptLabel(d.type));
    });

    if (graphCanEdit) {
      node
        .append('circle')
        .attr('cx', NODE_R - 2)
        .attr('r', 7)
        .attr('fill', '#60a5fa')
        .attr('stroke', '#0f0f1a')
        .attr('stroke-width', 2)
        .style('cursor', 'crosshair')
        .on('click', (ev) => ev.stopPropagation())
        .call(linkDrag);
    }

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
    return () => { sim.stop(); };
  }, [ageNodes, ageEdges, graphCanEdit, modelGraph, t]);

  const apply = useCallback(async (operation: AgeGraphOperation) => {
    setMutationLoading(true);
    setError(null);
    try {
      await semanticModelApi.applyAgeGraphOperations(modelId, [operation]);
      markIndexPending();
      setEditorMode(null);
      await load();
    } catch (err: unknown) {
      setError(parseApiError(err).message);
    } finally {
      setMutationLoading(false);
    }
  }, [load, markIndexPending, modelId]);

  useEffect(() => {
    if (!pendingRelationChoice || pendingRelationChoice.relations.length !== 1) return;
    const relation = pendingRelationChoice.relations[0];
    setPendingRelationChoice(null);
    void apply({ type: 'edge.create', relationTypeId: relation.id, sourceId: pendingRelationChoice.sourceId, targetId: pendingRelationChoice.targetId });
  }, [apply, pendingRelationChoice]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const selectedMeta = selectedNode?.properties._meta as NodeMeta | undefined;
  const allTypes = [...new Set(ageNodes.map((n) => n.label))];

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: '#0f0f1a' }}>
      {/* Header */}
      <div className="flex items-center justify-between shrink-0 px-6 py-3 border-b border-white/10">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-white">{t('graphViewer.title')}</h2>
          <span className={`h-2.5 w-2.5 rounded-full ${model.data?.indexStatus === 'indexed' ? 'bg-emerald-500' : model.data?.indexStatus === 'failed' ? 'bg-red-500' : `bg-amber-500 ${model.data?.indexStatus === 'pending' || model.data?.indexStatus === 'in_progress' ? 'animate-pulse' : ''}`}`} title={model.data?.indexStatus ?? 'not_indexed'} />
           {graphCanEdit && <span className="text-[10px] text-white/45">{t('graphViewer.mouseRelationHint')}</span>}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {allTypes.map((lbl) => (
            <div key={lbl} className="flex items-center gap-1.5">
              <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: labelColor(lbl, allTypes) }} />
              <span className="text-xs text-white/60">{conceptLabel(lbl)}</span>
            </div>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="text-white/60 hover:text-white hover:bg-white/10 gap-1.5"
             onClick={() => void load()}
            disabled={loading || mutationLoading}
            aria-label={t('graphViewer.refresh')}
            title={t('graphViewer.refresh')}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading || mutationLoading ? 'animate-spin' : ''}`} />
          </Button>
           {graphCanEdit && (
            <>
              <Button variant="outline" size="sm" className="text-white border-white/20 hover:bg-white/10 gap-1.5" onClick={() => setEditorMode('node')} disabled={mutationLoading}>
                <Plus className="h-3.5 w-3.5" />{t('graphViewer.addNode')}
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="text-white/60 hover:text-white hover:bg-white/10"
            onClick={onClose}
            aria-label={t('graphViewer.close')}
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
                 onClick={() => void load()}
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
           {graphCanEdit && editorMode === 'node' && (
            <form
              className="absolute left-4 top-4 z-10 w-80 space-y-3 rounded-xl border border-white/15 bg-[#171725]/95 p-4 shadow-xl"
              onSubmit={(event) => {
                event.preventDefault();
                if (editorMode === 'node' && nodeTypeId && nodeLabel.trim()) {
                  const values = Object.fromEntries((selectedNodeType?.attributes ?? []).map((attribute) => {
                    const raw = nodeValues[attribute.key] ?? '';
                    if (raw === '') return [attribute.key, null];
                    if (attribute.type === 'number') return [attribute.key, Number(raw)];
                    if (attribute.type === 'boolean') return [attribute.key, raw === 'true'];
                    return [attribute.key, raw];
                  }));
                  const selectedDocuments = relevantDocuments.filter((document) => selectedDocumentIds.includes(document.sourceDocumentId));
                  if (selectedDocuments.length) {
                    values._source_document_ids = selectedDocuments.map((document) => document.sourceDocumentId);
                    values._source_document_id = selectedDocuments[0].sourceDocumentId;
                    values._source_file_name = selectedDocuments[0].originalName;
                  }
                  void apply({ type: 'node.create', nodeTypeId, label: nodeLabel.trim(), values });
                }
              }}
            >
              <div className="flex items-center justify-between"><p className="text-sm font-semibold text-white">{t('graphViewer.addNode')}</p><button type="button" className="text-white/50 hover:text-white" onClick={() => setEditorMode(null)}><X className="h-4 w-4" /></button></div>
              <>
                  <div className="space-y-1"><Label className="text-white/70">{t('graphViewer.nodeType')}</Label><select value={nodeTypeId} onChange={(event) => { setNodeTypeId(event.target.value); setNodeValues({}); }} className="h-10 w-full rounded-md border border-white/15 bg-white/5 px-3 text-sm text-white">{modelGraph?.nodes.filter((node) => !node.systemKey && node.recordPolicy !== 'none').map((node) => <option key={node.id} value={node.id} className="bg-[#171725]">{node.label}</option>)}</select></div>
                  <div className="space-y-1"><Label className="text-white/70">{t('graphViewer.nodeLabel')}</Label><Input value={nodeLabel} onChange={(event) => setNodeLabel(event.target.value)} placeholder={t('graphViewer.nodeLabelPlaceholder')} className="border-white/15 bg-white/5 text-white" /></div>
                  <div className="max-h-56 space-y-2 overflow-y-auto pr-1">{selectedNodeType?.attributes.map((attribute) => <div key={attribute.key} className="space-y-1"><Label className="text-white/70">{attribute.label}{attribute.required ? ` (${t('graphViewer.required')})` : ''}</Label>{attribute.type === 'boolean' ? <select value={nodeValues[attribute.key] ?? ''} onChange={(event) => setNodeValues((current) => ({ ...current, [attribute.key]: event.target.value }))} className="h-10 w-full rounded-md border border-white/15 bg-white/5 px-3 text-sm text-white"><option value="" className="bg-[#171725]">{t('graphViewer.emptyValue')}</option><option value="true" className="bg-[#171725]">{t('graphViewer.yes')}</option><option value="false" className="bg-[#171725]">{t('graphViewer.no')}</option></select> : <Input type={attribute.type === 'number' ? 'number' : attribute.type === 'date' ? 'date' : 'text'} value={nodeValues[attribute.key] ?? ''} onChange={(event) => setNodeValues((current) => ({ ...current, [attribute.key]: event.target.value }))} className="border-white/15 bg-white/5 text-white" />}</div>)}</div>
                  <div className="space-y-2"><Label className="text-white/70">{t('graphViewer.sourceDocuments')}</Label>{relevantDocuments.length ? <div className="max-h-40 space-y-1 overflow-y-auto pr-1">{relevantDocuments.map((document) => <label key={document.sourceDocumentId} className="flex items-center gap-2 text-xs text-white/75"><input type="checkbox" checked={selectedDocumentIds.includes(document.sourceDocumentId)} onChange={(event) => setSelectedDocumentIds((current) => event.target.checked ? [...current, document.sourceDocumentId] : current.filter((id) => id !== document.sourceDocumentId))} />{document.originalName}</label>)}</div> : <p className="text-xs text-white/45">{t('graphViewer.noRelevantDocuments')}</p>}</div>
              </>
              <div className="flex justify-end gap-2"><Button type="button" variant="ghost" className="text-white/70 hover:bg-white/10 hover:text-white" onClick={() => setEditorMode(null)}>{t('graphViewer.cancel')}</Button><Button type="submit" disabled={mutationLoading}>{t('graphViewer.save')}</Button></div>
            </form>
          )}
           {graphCanEdit && pendingRelationChoice && pendingRelationChoice.relations.length > 1 && (
            <div className="absolute left-4 top-4 z-10 w-80 space-y-3 rounded-xl border border-white/15 bg-[#171725]/95 p-4 shadow-xl">
              <div className="flex items-center justify-between"><p className="text-sm font-semibold text-white">{t('graphViewer.chooseRelation')}</p><button type="button" className="text-white/50 hover:text-white" onClick={() => setPendingRelationChoice(null)}><X className="h-4 w-4" /></button></div>
              <select value={pendingRelationTypeId} onChange={(event) => setPendingRelationTypeId(event.target.value)} className="h-10 w-full rounded-md border border-white/15 bg-white/5 px-3 text-sm text-white">
                {pendingRelationChoice.relations.map((relation) => <option key={relation.id} value={relation.id} className="bg-[#171725]">{relation.label}</option>)}
              </select>
              <div className="flex justify-end gap-2"><Button type="button" variant="ghost" className="text-white/70 hover:bg-white/10 hover:text-white" onClick={() => setPendingRelationChoice(null)}>{t('graphViewer.cancel')}</Button><Button type="button" disabled={mutationLoading || !pendingRelationTypeId} onClick={() => { const relation = pendingRelationChoice.relations.find((item) => item.id === pendingRelationTypeId); if (relation) setPendingRelationChoice({ ...pendingRelationChoice, relations: [relation] }); }}>{t('graphViewer.save')}</Button></div>
            </div>
          )}
           {graphCanEdit && (selectedNode || selectedEdge) && (
            <div className="absolute bottom-4 left-4 z-10 flex items-center gap-2 rounded-xl border border-white/15 bg-[#171725]/95 p-2 shadow-xl">
              <span className="max-w-48 truncate px-2 text-xs text-white/70">{selectedNode ? String(selectedNode.properties.record_label ?? selectedNode.id) : selectedEdge?.label}</span>
              <Button size="sm" variant="destructive" disabled={mutationLoading} onClick={() => void apply(selectedNode ? { type: 'node.delete', nodeId: selectedNode.id } : { type: 'edge.delete', edgeId: selectedEdge!.id })}>
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />{selectedNode ? t('graphViewer.deleteNode') : t('graphViewer.deleteEdge')}
              </Button>
            </div>
          )}
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
