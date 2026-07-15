import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router-dom';
import { Background, Controls, ReactFlow, addEdge, applyEdgeChanges, applyNodeChanges, type Connection, type Edge, type Node, type OnEdgesChange, type OnNodesChange, type ReactFlowInstance } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './DecisionFlowEditorPage.css';
import Dagre from '@dagrejs/dagre';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Circle, LayoutDashboard, Loader2, Maximize, PanelLeft, PanelRight, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { showError, showSuccess } from '@/lib/notifications';
import { useModuleTranslation } from '@/modules/localization';
import { cloneWorkspaceArtifact, getWorkspaceArtifact, retryWorkspaceArtifact, updateWorkspaceArtifact } from '../../artifact-api';
import { useCanWriteWorkspace, useWorkspaceStore } from '../../store';
import type { DecisionFlowNodeType, DecisionFlowPayload, WorkspaceArtifact } from '../../types';

type DecisionFlowNodeData = {
  label: string;
  type: DecisionFlowNodeType;
  description: string;
  sourceRefs?: Array<{ page: number; passage: string }>;
  needsConfirmation?: boolean;
  uncertaintyReason?: string;
};

type FlowNode = Node<DecisionFlowNodeData>;

const nodeColor: Record<DecisionFlowNodeType, string> = { start: '#22c55e', information: '#3b82f6', decision: '#f59e0b', result: '#8b5cf6', end: '#ef4444' };
const nodeTypes: DecisionFlowNodeType[] = ['start', 'information', 'decision', 'result', 'end'];
const generationSteps = ['queued', 'generating', 'ready'] as const;

function nodeStyle(type: DecisionFlowNodeType, needsConfirmation = false) {
  return {
    backgroundColor: 'var(--card)',
    borderColor: nodeColor[type],
    borderWidth: needsConfirmation ? 2 : 1,
    color: 'var(--card-foreground)',
  };
}

function layoutNodes(nodes: FlowNode[], edges: Edge[]): FlowNode[] {
  const graph = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: 'TB', nodesep: 70, ranksep: 110 });
  nodes.forEach((node) => graph.setNode(node.id, { width: 180, height: 70 }));
  edges.forEach((edge) => graph.setEdge(edge.source, edge.target));
  Dagre.layout(graph);
  return nodes.map((node) => {
    const position = graph.node(node.id);
    return { ...node, position: { x: position.x - 90, y: position.y - 35 } };
  });
}

function errorCode(error: unknown): string | undefined { return error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined; }
function errorMessage(error: unknown): string | undefined { return error && typeof error === 'object' && 'message' in error ? String(error.message) : undefined; }

export function DecisionFlowEditorPage() {
  const { id: workspaceId, artifactId } = useParams();
  const navigate = useNavigate();
  const { t } = useModuleTranslation('workspace');
  const selectPageWorkspace = useWorkspaceStore((state) => state.selectPageWorkspace);
  const canWrite = useCanWriteWorkspace();
  const [artifact, setArtifact] = useState<WorkspaceArtifact | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<FlowNode, Edge> | null>(null);
  const [viewportRevision, setViewportRevision] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const loadRequestRef = useRef(0);
  const blocker = useBlocker(dirty && !saving);

  const fitCanvas = useCallback(() => {
    flowInstance?.fitView({ padding: 0.22, duration: 250, maxZoom: 1 });
  }, [flowInstance]);

  const load = useCallback(async (silent = false) => {
    if (!workspaceId || !artifactId) return;
    const requestId = ++loadRequestRef.current;
    try {
      const item = await getWorkspaceArtifact(workspaceId, artifactId);
      if (requestId !== loadRequestRef.current) return;
      if (item.schemaVersion !== 1) throw new Error(t('editor.unsupportedSchema'));
      setArtifact(item);
      setLoadError(null);
      if (item.status !== 'ready') {
        setNodes([]);
        setEdges([]);
        setDirty(false);
        return;
      }
      const loadedEdges = (item.payload?.edges ?? []).map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, label: edge.label }));
      const hasMissingPositions = (item.payload?.nodes ?? []).some((node) => !node.position);
      const loadedNodes: FlowNode[] = (item.payload?.nodes ?? []).map((node) => ({
        id: node.id,
        position: node.position ?? { x: 0, y: 0 },
        data: { label: node.label, type: node.type, description: node.description ?? '', sourceRefs: node.sourceRefs, needsConfirmation: node.needsConfirmation, uncertaintyReason: node.uncertaintyReason },
        style: nodeStyle(node.type, node.needsConfirmation),
      }));
      setNodes(hasMissingPositions ? layoutNodes(loadedNodes, loadedEdges) : loadedNodes);
      setEdges(loadedEdges);
      setDirty(false);
      setViewportRevision((current) => current + 1);
    } catch (error) {
      if (requestId !== loadRequestRef.current || silent) return;
      setLoadError(errorMessage(error) ?? t('editor.loadFailed'));
    }
  }, [artifactId, t, workspaceId]);

  useEffect(() => { if (workspaceId) void selectPageWorkspace(workspaceId); }, [selectPageWorkspace, workspaceId]);
  useEffect(() => {
    setArtifact(null);
    setLoadError(null);
    setNodes([]);
    setEdges([]);
    void load();
    return () => { loadRequestRef.current += 1; };
  }, [load]);
  useEffect(() => {
    if (artifact?.status !== 'queued' && artifact?.status !== 'generating') return;
    const interval = window.setInterval(() => { void load(true); }, 2_000);
    return () => window.clearInterval(interval);
  }, [artifact?.status, load]);
  useEffect(() => {
    if (!flowInstance || !nodes.length || viewportRevision === 0) return;
    const frame = window.requestAnimationFrame(fitCanvas);
    return () => window.cancelAnimationFrame(frame);
  }, [fitCanvas, flowInstance, nodes.length, viewportRevision]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const onNodesChange: OnNodesChange<FlowNode> = useCallback((changes) => { if (!canWrite) return; setNodes((current) => applyNodeChanges(changes, current)); if (changes.some((change) => change.type !== 'select')) setDirty(true); }, [canWrite]);
  const onEdgesChange: OnEdgesChange<Edge> = useCallback((changes) => { if (!canWrite) return; setEdges((current) => applyEdgeChanges(changes, current)); if (changes.some((change) => change.type !== 'select')) setDirty(true); }, [canWrite]);
  const onConnect = useCallback((connection: Connection) => { if (!canWrite) return; setEdges((current) => addEdge({ ...connection, id: crypto.randomUUID() }, current)); setDirty(true); }, [canWrite]);
  const selectedNode = useMemo(() => nodes.find((node) => node.id === selectedNodeId) ?? null, [nodes, selectedNodeId]);
  const selectedEdge = useMemo(() => edges.find((edge) => edge.id === selectedEdgeId) ?? null, [edges, selectedEdgeId]);

  const addNode = (type: DecisionFlowNodeType) => {
    if (!canWrite) return;
    const id = crypto.randomUUID();
    setNodes((current) => [...current, { id, position: { x: 100 + current.length * 20, y: 100 + current.length * 20 }, data: { label: t(`editor.nodeType.${type}`), type, description: '' }, style: nodeStyle(type) }]);
    setSelectedNodeId(id);
    setSelectedEdgeId(null);
    setInspectorOpen(true);
    setDirty(true);
  };
  const updateSelectedNode = (key: 'label' | 'type' | 'description', value: string) => {
    if (!selectedNode || !canWrite) return;
    setNodes((current) => current.map((node) => node.id === selectedNode.id ? { ...node, data: { ...node.data, [key]: value }, style: key === 'type' ? nodeStyle(value as DecisionFlowNodeType, node.data.needsConfirmation) : node.style } : node));
    setDirty(true);
  };
  const updateSelectedEdge = (value: string) => { if (!selectedEdge || !canWrite) return; setEdges((current) => current.map((edge) => edge.id === selectedEdge.id ? { ...edge, label: value } : edge)); setDirty(true); };
  const autoLayout = () => { if (!canWrite) return; setNodes((current) => layoutNodes(current, edges)); setViewportRevision((current) => current + 1); setDirty(true); };
  const buildPayload = (): DecisionFlowPayload => ({ title: artifact?.name ?? '', description: artifact?.description, nodes: nodes.map((node) => ({ id: node.id, type: node.data.type, label: node.data.label, description: node.data.description || undefined, position: node.position, sourceRefs: node.data.sourceRefs, needsConfirmation: node.data.needsConfirmation, uncertaintyReason: node.data.uncertaintyReason })), edges: edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, label: typeof edge.label === 'string' && edge.label ? edge.label : undefined })), warnings: artifact?.payload?.warnings });

  const save = async () => {
    if (!workspaceId || !artifact || !canWrite) return;
    setSaving(true);
    try {
      const updated = await updateWorkspaceArtifact(workspaceId, artifact.id, { expectedRevision: artifact.revision, name: artifact.name, payload: buildPayload() });
      setArtifact(updated); setDirty(false); showSuccess(t('editor.saved'));
    } catch (error) {
      if (errorCode(error) === 'ERR_1966') setConflictOpen(true);
      else showError(t('editor.saveFailed'), { description: errorMessage(error) });
    } finally { setSaving(false); }
  };

  const retryGeneration = async () => {
    if (!workspaceId || !artifact || artifact.status !== 'failed' || !canWrite) return;
    setRetrying(true);
    try {
      setArtifact(await retryWorkspaceArtifact(workspaceId, artifact.id));
      setLoadError(null);
    } catch (error) {
      showError(t('editor.retryFailed'), { description: errorMessage(error) });
    } finally {
      setRetrying(false);
    }
  };

  const keepAsClone = async () => {
    if (!workspaceId || !artifact) return;
    setSaving(true);
    try {
      const clone = await cloneWorkspaceArtifact(workspaceId, artifact.id);
      await updateWorkspaceArtifact(workspaceId, clone.id, { expectedRevision: clone.revision, name: t('editor.copyName', { name: artifact.name }), payload: buildPayload() });
      setConflictOpen(false); setDirty(false); navigate(`/workspace/${workspaceId}/artifacts/${clone.id}`);
    } catch (error) { showError(t('editor.cloneFailed'), { description: errorMessage(error) }); }
    finally { setSaving(false); }
  };

  if (!artifact) return <div className='flex h-[100dvh] w-full flex-col'>
    <header className='flex shrink-0 items-center gap-2 border-b p-3'>
      <Button variant='outline' asChild><Link to={`/workspace/${workspaceId}`}>{t('editor.back')}</Link></Button>
    </header>
    <main className='flex min-h-0 flex-1 items-center justify-center p-6'>
      <div className='flex max-w-md flex-col items-center gap-4 text-center'>
        {loadError ? <AlertTriangle className='h-10 w-10 text-destructive' /> : <Loader2 className='h-10 w-10 animate-spin text-primary' />}
        <div className='space-y-1'>
          <h1 className='text-lg font-semibold'>{loadError ? t('editor.loadFailed') : t('editor.loading')}</h1>
          {loadError && <p className='text-sm text-muted-foreground'>{loadError}</p>}
        </div>
        {loadError && <Button onClick={() => void load()}><RotateCcw className='mr-2 h-4 w-4' />{t('editor.retryLoad')}</Button>}
      </div>
    </main>
  </div>;

  if (artifact.status !== 'ready') {
    const failed = artifact.status === 'failed';
    const activeStep = artifact.status === 'queued' ? 0 : 1;
    const generationMessage = artifact.status === 'queued' ? t('editor.generationStatus.queued') : t('editor.generationStatus.generating');
    return <div className='flex h-[100dvh] w-full min-w-0 flex-col self-stretch overflow-hidden'>
      <header className='flex shrink-0 flex-wrap items-center gap-2 border-b p-3'>
        <Button variant='outline' asChild><Link to={`/workspace/${workspaceId}`}>{t('editor.back')}</Link></Button>
        <span className='min-w-48 max-w-md truncate text-sm font-medium'>{artifact.name}</span>
        <span className='hidden text-xs text-muted-foreground lg:inline'>{t('editor.source', { name: artifact.primarySource.documentName })}</span>
      </header>
      <main className='flex min-h-0 flex-1 items-center justify-center bg-muted/20 p-6'>
        <div className='w-full max-w-xl space-y-8 rounded-xl border bg-background p-8 text-center shadow-sm'>
          <div className='flex flex-col items-center gap-4'>
            {failed ? <AlertTriangle className='h-12 w-12 text-destructive' /> : <Loader2 className='h-12 w-12 animate-spin text-primary' />}
            <div className='space-y-2'>
              <h1 className='text-xl font-semibold'>{failed ? t('editor.generationFailed') : t('editor.generationTitle')}</h1>
              <p className='text-sm text-muted-foreground'>
                {failed ? (artifact.generation.error || t('editor.generationFailedDescription')) : generationMessage}
              </p>
            </div>
          </div>
          {!failed && <ol className='grid grid-cols-3 gap-3' aria-label={t('editor.generationProgress')}>
            {generationSteps.map((step, index) => {
              const completed = index < activeStep;
              const active = index === activeStep;
              return <li key={step} className={`flex flex-col items-center gap-2 rounded-lg border p-3 text-xs ${active ? 'border-primary bg-primary/5 text-foreground' : 'text-muted-foreground'}`}>
                {completed ? <CheckCircle2 className='h-5 w-5 text-primary' /> : active ? <Loader2 className='h-5 w-5 animate-spin text-primary' /> : <Circle className='h-5 w-5' />}
                <span>{t(`editor.generationStep.${step}`)}</span>
              </li>;
            })}
          </ol>}
          {failed && canWrite && <Button onClick={() => void retryGeneration()} disabled={retrying}>
            {retrying ? <Loader2 className='mr-2 h-4 w-4 animate-spin' /> : <RotateCcw className='mr-2 h-4 w-4' />}
            {retrying ? t('editor.retrying') : t('editor.retryGeneration')}
          </Button>}
          {failed && !canWrite && <span className='inline-flex rounded bg-muted px-2 py-1 text-xs text-muted-foreground'>{t('editor.readOnly')}</span>}
        </div>
      </main>
    </div>;
  }
  return <div className='flex h-[100dvh] w-full min-w-0 flex-col self-stretch overflow-hidden'>
    <header className='flex shrink-0 flex-wrap items-center gap-2 border-b p-3'>
      <Button variant='outline' asChild><Link to={`/workspace/${workspaceId}`}>{t('editor.back')}</Link></Button>
      <Input value={artifact.name} onChange={(event) => { if (canWrite) { setArtifact({ ...artifact, name: event.target.value }); setDirty(true); } }} disabled={!canWrite} className='min-w-48 max-w-md' />
      <span className='hidden text-xs text-muted-foreground lg:inline'>{t('editor.source', { name: artifact.primarySource.documentName })}</span>
      {!canWrite && <span className='rounded bg-muted px-2 py-1 text-xs'>{t('editor.readOnly')}</span>}
      {dirty && <span className='text-xs text-amber-600'>{t('editor.unsaved')}</span>}
      <Button className='ml-auto' onClick={() => void save()} disabled={saving || !dirty || !canWrite}>{saving ? t('editor.saving') : t('editor.save')}</Button>
    </header>
    <main className='relative min-h-0 flex-1'>
      <section className='decision-flow-canvas h-full min-w-0'>
        <ReactFlow nodes={nodes} edges={edges} onInit={setFlowInstance} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} nodesDraggable={canWrite} nodesConnectable={canWrite} elementsSelectable onNodeClick={(_, node) => { setSelectedNodeId(node.id); setSelectedEdgeId(null); setInspectorOpen(true); }} onEdgeClick={(_, edge) => { setSelectedEdgeId(edge.id); setSelectedNodeId(null); setInspectorOpen(true); }} onPaneClick={() => { setSelectedNodeId(null); setSelectedEdgeId(null); }}>
          <Background />
          <Controls />
        </ReactFlow>
      </section>
      <div className='absolute left-3 top-3 z-10 flex gap-2 rounded-md border bg-background/95 p-1 shadow-sm'>
        <Button size='icon' variant='ghost' title={t('editor.togglePalette')} onClick={() => setPaletteOpen((current) => !current)}><PanelLeft className='h-4 w-4' /></Button>
        <Button size='icon' variant='ghost' title={t('editor.autoLayout')} onClick={autoLayout} disabled={!canWrite}><LayoutDashboard className='h-4 w-4' /></Button>
        <Button size='icon' variant='ghost' title={t('editor.fitCanvas')} onClick={fitCanvas}><Maximize className='h-4 w-4' /></Button>
      </div>
      {paletteOpen && <aside className='absolute bottom-3 left-3 top-14 z-10 w-52 overflow-y-auto rounded-md border bg-background/95 p-3 shadow-lg'><div className='mb-2 flex items-center justify-between'><p className='text-sm font-medium'>{t('editor.addNode')}</p><Button size='icon' variant='ghost' title={t('editor.closePalette')} onClick={() => setPaletteOpen(false)}><ChevronLeft className='h-4 w-4' /></Button></div><div className='space-y-2'>{nodeTypes.map((type) => <Button key={type} variant='outline' className='w-full justify-start' disabled={!canWrite} onClick={() => addNode(type)}>{t(`editor.nodeType.${type}`)}</Button>)}</div></aside>}
      {inspectorOpen && <aside className='absolute bottom-3 right-3 top-3 z-10 w-[min(22rem,calc(100%-1.5rem))] overflow-y-auto rounded-md border bg-background/95 p-3 shadow-lg'><div className='mb-3 flex items-center justify-between'><p className='text-sm font-medium'>{selectedNode ? t('editor.properties') : selectedEdge ? t('editor.edgeProperties') : t('editor.inspector')}</p><Button size='icon' variant='ghost' title={t('editor.closeInspector')} onClick={() => setInspectorOpen(false)}><ChevronRight className='h-4 w-4' /></Button></div>{selectedNode ? <div className='space-y-3'><Input value={selectedNode.data.label} disabled={!canWrite} onChange={(event) => updateSelectedNode('label', event.target.value)} /><select className='w-full rounded border bg-background p-2 text-sm' disabled={!canWrite} value={selectedNode.data.type} onChange={(event) => updateSelectedNode('type', event.target.value)}>{nodeTypes.map((type) => <option key={type} value={type}>{t(`editor.nodeType.${type}`)}</option>)}</select><Textarea placeholder={t('editor.description')} disabled={!canWrite} value={selectedNode.data.description} onChange={(event) => updateSelectedNode('description', event.target.value)} />{selectedNode.data.needsConfirmation && <p className='rounded bg-amber-100 p-2 text-xs text-amber-900'>{t('editor.needsConfirmation', { reason: selectedNode.data.uncertaintyReason || t('editor.unspecified') })}</p>}{selectedNode.data.sourceRefs?.length ? <div className='space-y-2'><p className='text-sm font-medium'>{t('editor.sources')}</p>{selectedNode.data.sourceRefs.map((reference, index) => <p key={`${reference.page}-${index}`} className='rounded bg-muted p-2 text-xs'><span className='font-medium'>{t('editor.sourcePage', { page: reference.page })}</span>{' — '}{reference.passage}</p>)}</div> : null}{canWrite && <Button variant='destructive' onClick={() => { setNodes((current) => current.filter((node) => node.id !== selectedNode.id)); setEdges((current) => current.filter((edge) => edge.source !== selectedNode.id && edge.target !== selectedNode.id)); setSelectedNodeId(null); setDirty(true); }}>{t('editor.deleteNode')}</Button>}</div> : selectedEdge ? <div className='space-y-3'><Input value={typeof selectedEdge.label === 'string' ? selectedEdge.label : ''} disabled={!canWrite} onChange={(event) => updateSelectedEdge(event.target.value)} />{canWrite && <Button variant='destructive' onClick={() => { setEdges((current) => current.filter((edge) => edge.id !== selectedEdge.id)); setSelectedEdgeId(null); setDirty(true); }}>{t('editor.deleteEdge')}</Button>}</div> : <p className='text-sm text-muted-foreground'>{t('editor.selectElement')}</p>}</aside>}
      {!inspectorOpen && <Button className='absolute right-3 top-3 z-10' size='sm' variant='outline' onClick={() => setInspectorOpen(true)}><PanelRight className='mr-2 h-4 w-4' />{t('editor.inspector')}</Button>}
    </main>
    <Dialog open={conflictOpen} onOpenChange={setConflictOpen}><DialogContent><DialogHeader><DialogTitle>{t('editor.conflictTitle')}</DialogTitle><DialogDescription>{t('editor.conflictDescription')}</DialogDescription></DialogHeader><DialogFooter><Button variant='outline' onClick={() => { setConflictOpen(false); void load(); }}>{t('editor.reloadLatest')}</Button><Button onClick={() => void keepAsClone()} disabled={saving}>{t('editor.keepAsClone')}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={blocker.state === 'blocked'}><DialogContent><DialogHeader><DialogTitle>{t('editor.leaveTitle')}</DialogTitle><DialogDescription>{t('editor.leaveDescription')}</DialogDescription></DialogHeader><DialogFooter><Button variant='outline' onClick={() => blocker.state === 'blocked' && blocker.reset()}>{t('editor.stay')}</Button><Button variant='destructive' onClick={() => blocker.state === 'blocked' && blocker.proceed()}>{t('editor.discard')}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
