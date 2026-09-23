import { useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, ReactFlowProvider, Background, MiniMap, useOnViewportChange, useReactFlow } from '@xyflow/react';
import type { Edge, Node } from '@xyflow/react';
import { Expand, Shrink, Search, X } from 'lucide-react';
import '@xyflow/react/dist/style.css';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { Controls } from '@/components/ai-elements/controls';
import { useWorkyBoard, useWorkyBoardLoading, useWorkyBoardError } from '../store';
import { useStreamAgents } from '../agents/useStreamAgents';
import { layoutCompactCanvasNodes } from '@/modules/playbook/utils/compact-canvas-layout';
import { buildWorkyGraph, traceWorkyDependencies } from '../worky-graph';
import { WorkyGraphNode } from './WorkyGraphNode';
import { WorkyDependencyEdge } from './WorkyDependencyEdge';
import { WorkyGraphInspector } from './WorkyGraphInspector';
import type { WorkyTask } from '../types';

interface WorkyGraphBoardProps {
  onTaskClick?: (task: WorkyTask) => void;
}

const NODE_TYPES = { workyStep: WorkyGraphNode };
const EDGE_TYPES = { workyDependency: WorkyDependencyEdge };

export function WorkyGraphBoard({ onTaskClick }: WorkyGraphBoardProps): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const board = useWorkyBoard();
  const loading = useWorkyBoardLoading();
  const error = useWorkyBoardError();
  const tasks = useMemo(() => (board ? (Object.values(board) as WorkyTask[][]).flat() : []), [board]);
  const { agents } = useStreamAgents();
  const nameByKey = useMemo(() => new Map(agents.map((agent) => [agent.key, agent.name])), [agents]);
  const graph = useMemo(() => {
    const taskById = new Map(tasks.map((task) => [task.id, task]));
    const raw = buildWorkyGraph(tasks);
    const laidOut = layoutCompactCanvasNodes(raw.nodes, raw.edges, { width: 260, height: 104 });
    const nodes = laidOut.nodes.map((node) => {
      const task = taskById.get(node.id);
      if (!task) return node;
      return {
        ...node,
        data: {
          ...node.data,
          lane: task.lane,
          createdAt: task.createdAt ?? null,
          updatedAt: task.updatedAt ?? null,
          startedAt: task.startedAt,
          completedAt: task.completedAt,
          assigneeName: task.assigneeName || (task.assigneeKey ? nameByKey.get(task.assigneeKey) ?? task.assigneeKey : null),
        },
      };
    });
    return { nodes, edges: laidOut.edges, taskById };
  }, [tasks, nameByKey]);

  if (loading && !board) return <div className='flex h-full items-center justify-center text-sm text-muted-foreground'>{t('kanban.loading')}</div>;
  if (error) return <div className='flex h-full items-center justify-center text-sm text-destructive'>{t('kanban.error')}</div>;
  return <ReactFlowProvider><GraphWorkspace {...graph} onTaskClick={onTaskClick} /></ReactFlowProvider>;
}

function GraphWorkspace({ nodes: baseNodes, edges: baseEdges, taskById, onTaskClick }: {
  nodes: Node[];
  edges: Edge[];
  taskById: Map<string, WorkyTask>;
  onTaskClick?: (task: WorkyTask) => void;
}): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const flow = useReactFlow();
  const [expanded, setExpanded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focus, setFocus] = useState<'all' | 'upstream' | 'downstream'>('all');
  const [query, setQuery] = useState('');
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [hideCompleted, setHideCompleted] = useState(false);
  const [owner, setOwner] = useState('');
  const [compact, setCompact] = useState(false);
  const [planChanged, setPlanChanged] = useState(false);
  const previousTopology = useRef<string | null>(null);
  const savedViewport = useRef<ReturnType<typeof flow.getViewport> | null>(null);
  const savedCenter = useRef<{ x: number; y: number } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const interacted = useRef(false);
  const hasExpanded = useRef(false);
  const preserveOnExpand = useRef(false);
  useOnViewportChange({ onChange: ({ zoom }) => setCompact((previous) => previous === (zoom < 0.65) ? previous : zoom < 0.65) });

  const topology = useMemo(() => `${baseNodes.map((node) => node.id).join('|')}::${baseEdges.map((edge) => `${edge.source}>${edge.target}`).join('|')}`, [baseNodes, baseEdges]);
  useEffect(() => {
    if (previousTopology.current && previousTopology.current !== topology) setPlanChanged(true);
    previousTopology.current = topology;
  }, [topology]);

  useEffect(() => {
    if (!expanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (selectedId) setSelectedId(null);
      else {
        setExpanded(false);
        if (savedViewport.current) {
          const viewport = savedViewport.current;
          requestAnimationFrame(() => { void flow.setViewport(viewport); });
        }
      }
    };
    window.addEventListener('keydown', onEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onEscape);
    };
  }, [expanded, selectedId, flow]);

  useEffect(() => {
    if (!expanded) return;
    const timer = window.setTimeout(() => {
      if (preserveOnExpand.current && savedCenter.current && savedViewport.current) {
        void flow.setCenter(savedCenter.current.x, savedCenter.current.y, { zoom: savedViewport.current.zoom, duration: 250 });
      } else {
        void flow.fitView({ duration: 250, padding: 0.1, maxZoom: 1 });
      }
    }, 100);
    return () => window.clearTimeout(timer);
  }, [expanded]);

  const selected = selectedId ? taskById.get(selectedId) ?? null : null;
  const traced = selectedId && focus !== 'all' ? traceWorkyDependencies(baseEdges, selectedId, focus) : null;
  const owners = [...new Set(baseNodes.map((node) => String(node.data.assigneeName || '')).filter(Boolean))].sort();
  const matching = query.trim() ? baseNodes.filter((node) => {
    const task = taskById.get(node.id);
    return (!hideCompleted || node.data.status !== 'completed') && `${task?.title} ${node.data.assigneeName}`.toLowerCase().includes(query.toLowerCase());
  }) : [];
  const visibleIds = new Set(baseNodes.filter((node) => !hideCompleted || node.data.status !== 'completed').map((node) => node.id));
  const nodes = baseNodes.filter((node) => visibleIds.has(node.id)).map((node) => ({
    ...node,
    data: {
      ...node.data,
      compact,
      isSelected: node.id === selectedId,
      hiddenPrerequisites: hideCompleted ? [...traceWorkyDependencies(baseEdges, node.id, 'upstream')].filter((id) => id !== node.id && taskById.get(id)?.lane === 'done').length : 0,
      dimmed: Boolean(
        (traced && !traced.has(node.id)) ||
        (owner && node.data.assigneeName !== owner) ||
        (attentionOnly && !['failed', 'blocked'].includes(String(node.data.status))),
      ),
    },
  }));
  const edges = baseEdges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target)).map((edge) => ({
    ...edge,
    style: { ...edge.style, stroke: traced && traced.has(edge.source) && traced.has(edge.target) ? 'var(--primary)' : 'var(--muted-foreground)', strokeWidth: traced && traced.has(edge.source) && traced.has(edge.target) ? 2.5 : 1.5, opacity: traced && (!traced.has(edge.source) || !traced.has(edge.target)) ? 0.15 : 0.65 },
  }));

  const focusNodes = (ids: string[]) => {
    interacted.current = true;
    if (ids.length) void flow.fitView({ nodes: ids.map((id) => ({ id })), duration: 250, padding: 0.3, maxZoom: 1.2 });
  };
  const select = (id: string) => {
    if (hideCompleted && baseNodes.find((node) => node.id === id)?.data.status === 'completed') setHideCompleted(false);
    setSelectedId(id);
    requestAnimationFrame(() => focusNodes([id]));
  };
  const toggleExpanded = () => {
    if (expanded) {
      setExpanded(false);
      if (savedViewport.current) {
        const viewport = savedViewport.current;
        requestAnimationFrame(() => { void flow.setViewport(viewport); });
      }
    } else {
      preserveOnExpand.current = hasExpanded.current && interacted.current;
      hasExpanded.current = true;
      savedViewport.current = flow.getViewport();
      const bounds = canvasRef.current?.getBoundingClientRect();
      savedCenter.current = bounds ? flow.screenToFlowPosition({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }) : null;
      setExpanded(true);
    }
  };
  const openTask = (task: WorkyTask) => {
    if (expanded) toggleExpanded();
    onTaskClick?.(task);
  };

  return (
    <div data-testid='worky-graph-board' className={cn('relative flex h-full min-h-0 flex-1 flex-col bg-background', expanded && 'fixed inset-0 z-[100] h-dvh w-screen')}>
      <header className='flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-2'>
        <strong className='mr-auto text-sm'>{t('graph.title')}</strong>
        <label className='relative min-w-40 flex-1 sm:max-w-64'>
          <Search className='pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' aria-hidden />
          <input className='h-9 w-full rounded-md border border-border bg-background pl-8 pr-8 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary' value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('graph.search')} aria-label={t('graph.search')} />
          {query && <button type='button' className='absolute right-2 top-1/2 -translate-y-1/2' onClick={() => setQuery('')} aria-label={t('graph.clearSearch')}><X className='size-4' /></button>}
          {query && <div className='absolute left-0 right-0 top-10 z-20 max-h-48 overflow-y-auto rounded-md border border-border bg-popover shadow-md'>
            {matching.length ? matching.slice(0, 12).map((node) => <button type='button' key={node.id} className='block w-full truncate px-3 py-2 text-left text-xs hover:bg-muted focus-visible:bg-muted' onClick={() => { select(node.id); setQuery(''); }}>{String(node.data.title)}</button>) : <p className='px-3 py-2 text-xs text-muted-foreground'>{t('graph.noResults')}</p>}
          </div>}
        </label>
        <button type='button' className='rounded-md border border-border px-2 py-1.5 text-xs hover:bg-muted' onClick={() => setAttentionOnly(!attentionOnly)} aria-pressed={attentionOnly}>{t('graph.attention')}</button>
        <button type='button' className='rounded-md border border-border px-2 py-1.5 text-xs hover:bg-muted' onClick={() => { if (!hideCompleted && selected?.lane === 'done') setSelectedId(null); setHideCompleted(!hideCompleted); }} aria-pressed={hideCompleted}>{t('graph.hideCompleted')}</button>
        {expanded && <select className='h-8 max-w-40 rounded-md border border-border bg-background px-2 text-xs' value={owner} onChange={(event) => setOwner(event.target.value)} aria-label={t('graph.owner')}><option value=''>{t('graph.allOwners')}</option>{owners.map((name) => <option key={name}>{name}</option>)}</select>}
        <button type='button' className='inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1.5 text-xs text-primary-foreground' onClick={toggleExpanded} aria-label={expanded ? t('graph.exitFullscreen') : t('graph.fullscreen')}>
          {expanded ? <Shrink className='size-4' /> : <Expand className='size-4' />}{expanded ? t('graph.exitFullscreen') : t('graph.fullscreen')}
        </button>
      </header>
      <div className='flex min-h-0 flex-1'>
        <div ref={canvasRef} className='relative min-w-0 flex-1' onPointerDown={() => { interacted.current = true; }} onWheel={() => { interacted.current = true; }}>
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={NODE_TYPES} edgeTypes={EDGE_TYPES} fitView minZoom={0.1} nodesDraggable={false} nodesConnectable={false} elementsSelectable panOnScroll proOptions={{ hideAttribution: true }} onNodeClick={(_, node) => select(node.id)}>
            <Background bgColor='var(--sidebar)' />
            <Controls position='bottom-left' />
            {expanded && <MiniMap pannable zoomable nodeColor='var(--muted-foreground)' maskColor='rgba(0,0,0,0.35)' style={{ width: 160, height: 104, backgroundColor: 'var(--card)' }} className='!border !border-border' />}
          </ReactFlow>
          {expanded && <div className='absolute bottom-3 left-16 flex gap-1 rounded-md border border-border bg-card p-1 text-xs shadow-sm'>
            <button type='button' className='rounded px-2 py-1 hover:bg-muted' onClick={() => { focusNodes(nodes.map((node) => node.id)); setPlanChanged(false); }}>{planChanged ? t('graph.planChanged') : t('graph.fitAll')}</button>
            <button type='button' disabled={!selectedId} className='rounded px-2 py-1 hover:bg-muted disabled:opacity-40' onClick={() => focusNodes(traced ? [...traced] : selectedId ? [selectedId] : [])}>{t('graph.fitSelection')}</button>
          </div>}
        </div>
        {selected && <WorkyGraphInspector task={selected} edges={baseEdges} taskById={taskById} hideCompleted={hideCompleted} onRevealCompleted={() => setHideCompleted(false)} focus={focus} onFocusChange={setFocus} onSelect={select} onClose={() => { setSelectedId(null); setFocus('all'); }} onOpenTask={() => openTask(selected)} />}
      </div>
    </div>
  );
}
