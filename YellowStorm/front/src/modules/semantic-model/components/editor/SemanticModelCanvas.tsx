import { memo, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { Background, BaseEdge, Controls, EdgeLabelRenderer, Handle, MarkerType, Position, ReactFlow, getBezierPath, type Connection, type Edge, type EdgeProps, type Node, type NodeProps, type ReactFlowInstance } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { BookOpen, Briefcase, Check, FileStack, FileText, KeyRound, Keyboard, Library, Plus, Sheet, Tag, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { showSuccess, showWarning } from '@/lib/notifications';
import { useModuleTranslation } from '@/modules/localization';
import { useSemanticModelEditorStore } from '../../store';
import { KNOWLEDGE_DRAG_TYPE, parseKnowledgeResource, type KnowledgeDropState, type KnowledgeLinkingController, type KnowledgeResource } from '../../hooks/use-knowledge-linking';
import type { AttributeDefinition, ConceptSourceMapping, MappingHealthItem, SemanticNodeType, SemanticRecordRelation, SemanticRelationType } from '../../types';
import { compatibleRecordRelations, nextLinkedConceptPosition, uniqueBusinessKey, type CompatibleRecordRelation } from '../../utils/model-utils';
import { designerFlow, isDesignerSourceId, type DesignerFeed, type DesignerSource } from '../../utils/designer-flow';

/** What a concept card says about its data: how many sources feed it, which are usable, and how it recognises a record. */
export interface ConceptDataSummary {
  sources: number;
  notReady: number;
  identityFields: string[];
  documentNames: string[];
  records: number;
}

type BusinessNodeData = Record<string, unknown> & {
  nodeId: string;
  label: string;
  description: string;
  category: 'business_object' | 'classification' | 'system_collection' | 'record';
  protected: boolean;
  recordPolicy?: 'none' | 'optional' | 'expected';
  attributes?: AttributeDefinition[];
  summary?: ConceptDataSummary;
  quickActions?: boolean;
  onQuickConcept?: (nodeId: string) => void;
  onOpenKnowledge?: (nodeId:string) => void;
  knowledgeCounts?: {workspaces:number;documents:number};
  dropState?: KnowledgeDropState;
  onKnowledgeDragEnter?: (nodeId:string) => void;
  onKnowledgeDragLeave?: (nodeId:string) => void;
  onKnowledgeDrop?: (nodeId:string,event:DragEvent<HTMLDivElement>) => void;
  draft?: boolean;
  onDraftSubmit?: (label: string) => void;
  onDraftCancel?: () => void;
};

function stopNodeEvent(event: MouseEvent | PointerEvent | FormEvent): void {
  event.stopPropagation();
}


/** One badge answering "can this concept produce data?", from its sources and its record policy. */
function conceptStatus(data: BusinessNodeData, t: (key: string, options?: Record<string, unknown>) => string) {
  const summary = data.summary;
  if (!summary || data.category === 'record' || data.protected) return null;
  // A mapped concept without a unique field silently yields no records, so say so on the card.
  if (summary.sources > 0 && summary.identityFields.length === 0) return { tone: 'warn' as const, label: t('editor.status.noKey') };
  if (summary.notReady > 0) return { tone: 'warn' as const, label: t('editor.status.sourcesNotReady', { count: summary.notReady }) };
  if (summary.sources > 0) return { tone: 'ok' as const, label: t('editor.status.ready') };
  if (data.recordPolicy === 'expected' && summary.records === 0) return { tone: 'warn' as const, label: t('editor.status.noSource') };
  return null;
}

function QuickRecordForm({ nodeId,onClose }: Readonly<{ nodeId:string;onClose:()=>void }>) {
  const { t } = useModuleTranslation('semantic-model');
  const graph = useSemanticModelEditorStore((state) => state.graph);
  const commit = useSemanticModelEditorStore((state) => state.commit);
  const [label,setLabel] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); },[]);
  const add = (event:FormEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!graph || !label.trim()) return;
    const index = graph.records.length;
    const entity = { id:crypto.randomUUID(),nodeTypeId:nodeId,label:label.trim(),values:{},status:'active' as const,position:{x:120+(index%3)*304,y:120+Math.floor(index/3)*164} };
    commit({type:'record.create',entity},(current) => ({...current,records:[...current.records,entity]}));
    showSuccess(t('records.added'));
    onClose();
  };
  return <form className='nodrag nopan nowheel mt-3 flex gap-2 border-t pt-3' onSubmit={add} onClick={stopNodeEvent}>
    <Input ref={inputRef} className='h-9 min-w-0' value={label} onChange={(event)=>setLabel(event.target.value)} placeholder={t('records.quickPlaceholder')} aria-label={t('records.quickName')} onKeyDown={(event)=>{if(event.key==='Escape'){event.preventDefault();onClose();}}} />
    <Button type='submit' size='icon' className='h-9 w-9 shrink-0' disabled={!label.trim()} aria-label={t('records.quickCreate')}><Check className='h-4 w-4' /></Button>
    <Button type='button' size='icon' variant='ghost' className='h-9 w-9 shrink-0' onClick={onClose} aria-label={t('action.cancel')}><X className='h-4 w-4' /></Button>
  </form>;
}

const BusinessNode = memo(function BusinessNode({ data,selected,isConnectable }: NodeProps<Node<BusinessNodeData>>) {
  const { t } = useModuleTranslation('semantic-model');
  const [recordInputOpen,setRecordInputOpen] = useState(false);
  const [draftLabel,setDraftLabel] = useState('');
  const draftInputRef = useRef<HTMLInputElement>(null);
  const touchHandledAt = useRef(0);
  const runTouchAction = (event:PointerEvent,action:()=>void) => {
    if (event.pointerType!=='touch') return;
    event.preventDefault();
    event.stopPropagation();
    touchHandledAt.current=Date.now();
    action();
  };
  const runClickAction = (event:MouseEvent,action:()=>void) => {
    event.stopPropagation();
    if (Date.now()-touchHandledAt.current<500) return;
    action();
  };
  useEffect(() => {
    if (!data.draft) return;
    const timer = window.setTimeout(() => draftInputRef.current?.focus(),0);
    return () => window.clearTimeout(timer);
  },[data.draft]);
  const Icon = data.category === 'system_collection' ? FileStack : data.category === 'classification' ? Tag : data.category === 'record' ? BookOpen : Briefcase;
  if (data.draft) return <div className='w-60 rounded-2xl border-2 border-dashed border-primary bg-card p-3 shadow-lg'>
    <div className='nodrag nopan nowheel flex gap-2' onClick={stopNodeEvent}>
      <Input ref={draftInputRef} value={draftLabel} onChange={(event)=>setDraftLabel(event.target.value)} placeholder={t('concept.quickPlaceholder')} aria-label={t('concept.quickName')} onKeyDown={(event:KeyboardEvent<HTMLInputElement>)=>{event.stopPropagation();if(event.key==='Enter'){event.preventDefault();data.onDraftSubmit?.(draftLabel);}if(event.key==='Escape'){event.preventDefault();data.onDraftCancel?.();}}} />
      <Button size='icon' className='shrink-0' onPointerUp={(event)=>runTouchAction(event,()=>data.onDraftSubmit?.(draftLabel))} onClick={(event)=>runClickAction(event,()=>data.onDraftSubmit?.(draftLabel))} disabled={!draftLabel.trim()} aria-label={t('concept.quickCreate')}><Check className='h-4 w-4' /></Button>
      <Button size='icon' variant='ghost' className='shrink-0' onPointerUp={(event)=>runTouchAction(event,()=>data.onDraftCancel?.())} onClick={(event)=>runClickAction(event,()=>data.onDraftCancel?.())} aria-label={t('action.cancel')}><X className='h-4 w-4' /></Button>
    </div>
    <p className='mt-2 text-[11px] text-muted-foreground'>{t('concept.quickHelp')}</p>
  </div>;
  const dropLabel=data.dropState?t(`knowledge.dropState.${data.dropState}`):null;
  const attributes=data.attributes??[];
  const status=conceptStatus(data,t as (key: string, options?: Record<string, unknown>) => string);
  const records=data.summary?.records??0;
  const subtitle=[t(attributes.length===1?'designer.fieldCount_one':'designer.fieldCount_other',{count:attributes.length}),records>0?t('editor.recordCount',{count:records}):null].filter(Boolean).join(' · ');
  const hasKey=(data.summary?.identityFields.length??0)>0;
  return <div className='relative flex w-48 flex-col items-center'
    onDragEnter={(event)=>{if(!data.onKnowledgeDragEnter)return;event.preventDefault();event.stopPropagation();data.onKnowledgeDragEnter(data.nodeId);}}
    onDragOver={(event)=>{if(!data.onKnowledgeDrop)return;event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect=data.dropState==='valid'?'copy':'none';}}
    onDragLeave={(event)=>{if(event.currentTarget.contains(event.relatedTarget as globalThis.Node|null))return;data.onKnowledgeDragLeave?.(data.nodeId);}}
    onDrop={(event)=>data.onKnowledgeDrop?.(data.nodeId,event)}>
    <span className='sr-only' aria-live='polite'>{dropLabel}</span>
    {dropLabel&&<div className={cn('pointer-events-none absolute -top-8 z-20 whitespace-nowrap rounded-full px-3 py-1 text-center text-[10px] font-semibold shadow',data.dropState==='valid'&&'bg-primary text-primary-foreground',data.dropState==='already-linked'&&'bg-emerald-600 text-white',data.dropState==='busy'&&'bg-amber-500 text-amber-950')}>{dropLabel}</div>}
    {/* The + on the left brings data in; the one on the right adds what comes next. */}
    {data.quickActions&&!data.protected&&<button type='button' className='nodrag nopan absolute left-0 top-[36px] z-10 flex h-7 w-7 items-center justify-center rounded-full border-2 border-teal-500/60 bg-background text-teal-600 opacity-70 transition hover:scale-110 hover:opacity-100 dark:text-teal-400' onClick={(event)=>runClickAction(event,()=>data.onOpenKnowledge?.(data.nodeId))} aria-label={t('designer.plus.source',{name:data.label})} title={t('designer.plus.source',{name:data.label})}><Plus className='h-4 w-4' /></button>}
    <div className={cn('relative flex h-24 w-24 items-center justify-center rounded-full transition-shadow',data.protected?'bg-sky-500 text-white':'bg-primary text-primary-foreground',selected?'ring-8 ring-primary/30':'ring-8 ring-primary/10 hover:ring-primary/20',data.dropState==='valid'&&'ring-primary/40',data.dropState==='already-linked'&&'ring-emerald-500/40',data.dropState==='busy'&&'ring-amber-500/40')}>
      <Handle type='target' position={Position.Left} isConnectable={isConnectable} className={cn('!border-2 !border-background !bg-primary',isConnectable?'!h-3.5 !w-3.5':'!h-1 !w-1 !border-0 !opacity-0')} aria-label={t('relation.connectTo')} title={t('relation.connectTo')} />
      <Icon className='h-10 w-10' />
      {hasKey&&<span className='absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-background bg-amber-400 text-amber-950' role='img' aria-label={t('editor.matchingKey')} title={t('editor.matchingKey')}><KeyRound className='h-3.5 w-3.5' /></span>}
      <Handle type='source' position={Position.Right} isConnectable={isConnectable} className={cn('!border-2 !border-background !bg-primary',isConnectable?'!h-3.5 !w-3.5':'!h-1 !w-1 !border-0 !opacity-0')} aria-label={t('relation.connectFrom')} title={t('relation.connectFrom')} />
    </div>
    {data.quickActions&&<div className='nodrag nopan nowheel absolute right-0 top-[36px] z-10' onClick={stopNodeEvent}>
      <DropdownMenu><DropdownMenuTrigger asChild><button type='button' className='flex h-7 w-7 items-center justify-center rounded-full border-2 border-primary/60 bg-background text-primary opacity-70 transition hover:scale-110 hover:opacity-100' aria-label={t('designer.plus.next',{name:data.label})} title={t('designer.plus.next',{name:data.label})}><Plus className='h-4 w-4' /></button></DropdownMenuTrigger><DropdownMenuContent align='start'>
        {!data.protected&&<DropdownMenuItem className='min-h-11' onSelect={()=>data.onQuickConcept?.(data.nodeId)}><Briefcase className='h-4 w-4'/>{t('concept.quickAdd')}</DropdownMenuItem>}
        <DropdownMenuItem className='min-h-11' onSelect={()=>data.onOpenKnowledge?.(data.nodeId)}><Library className='h-4 w-4'/>{t('designer.plus.mapSource')}</DropdownMenuItem>
        {!data.protected&&<DropdownMenuItem className='min-h-11' onSelect={()=>{if(data.recordPolicy==='none'){showWarning(t('records.disabled'));return;}setRecordInputOpen(true);}}><Keyboard className='h-4 w-4'/>{t('records.quickAdd')}</DropdownMenuItem>}
      </DropdownMenuContent></DropdownMenu>
    </div>}
    <div className='mt-3 w-full text-center'>
      <p className='truncate font-semibold' title={data.label}>{data.label}{data.protected&&<Badge variant='outline' className='ml-1.5 align-middle text-[10px]'>{t('editor.system')}</Badge>}</p>
      <p className='truncate text-[11px] text-muted-foreground' title={data.description}>{data.category==='record'?data.description:subtitle}</p>
      {status&&<span className={cn('mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold',status.tone==='ok'&&'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',status.tone==='warn'&&'bg-amber-500/10 text-amber-700 dark:text-amber-400')}>{status.label}</span>}
    </div>
    {recordInputOpen&&<div className='absolute left-0 right-0 top-full z-20 mt-2 rounded-xl border bg-card p-3 shadow-xl'><QuickRecordForm nodeId={data.nodeId} onClose={()=>setRecordInputOpen(false)} /></div>}
  </div>;
});

const TONE_CLASS = {
  ok:'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  warn:'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  idle:'bg-muted text-muted-foreground',
} as const;

type SourceNodeData = Record<string, unknown> & { source: DesignerSource; onAddFeed?: (source: DesignerSource) => void };

/** A data source on the canvas; clicking it opens its mapping, and its + feeds another concept. */
const SourceNode = memo(function SourceNode({ data,selected }: NodeProps<Node<SourceNodeData>>) {
  const { t } = useModuleTranslation('semantic-model');
  const { source } = data;
  const Icon = source.kind==='typed' ? Keyboard : source.kind==='spreadsheet' ? Sheet : FileText;
  const title = source.kind==='typed' ? t('designer.typedRecords') : source.label;
  const detail = source.kind==='typed' ? t('editor.recordCount',{count:Number(source.detail)}) : source.detail || t(`designer.kind.${source.kind}`);
  return <div className='relative flex w-44 flex-col items-center'>
    <div className={cn('relative flex h-20 w-20 items-center justify-center rounded-full bg-teal-600 text-white transition-shadow',selected?'ring-8 ring-teal-500/40':'ring-8 ring-teal-500/15 hover:ring-teal-500/30')}>
      <Icon className='h-9 w-9' />
      {source.tone!=='idle'&&<span className={cn('absolute -right-0.5 -top-0.5 h-4 w-4 rounded-full border-2 border-background',source.tone==='ok'?'bg-emerald-500':'bg-amber-500')} role='img' aria-label={t(`designer.tone.${source.tone}`)} />}
      <Handle type='source' position={Position.Right} isConnectable={false} className='!h-2 !w-2 !border-0 !bg-teal-500' />
    </div>
    {data.onAddFeed&&source.kind!=='typed'&&<button type='button' className='nodrag nopan absolute right-2 top-[26px] z-10 flex h-7 w-7 items-center justify-center rounded-full border-2 border-teal-500/60 bg-background text-teal-600 opacity-70 transition hover:scale-110 hover:opacity-100 dark:text-teal-400' onClick={(event)=>{event.stopPropagation();data.onAddFeed?.(source);}} aria-label={t('designer.plus.feed',{name:title})} title={t('designer.plus.feed',{name:title})}><Plus className='h-4 w-4' /></button>}
    <div className='mt-3 w-full text-center'><p className='truncate text-sm font-semibold' title={title}>{title}</p><p className='truncate text-[11px] text-muted-foreground'>{detail}</p></div>
  </div>;
});

const nodeTypes = { business:BusinessNode, source:SourceNode };

const CARDINALITY_SHORT: Record<string,string> = { one_to_one:'1 → 1', one_to_many:'1 → n', many_to_one:'n → 1', many_to_many:'n → n' };

// The theme exposes raw oklch colours, so these are used as-is — wrapping them in hsl() makes the
// declaration invalid and the line falls back to React Flow's nearly invisible default grey.
const EDGE_COLOR = 'color-mix(in oklab, var(--foreground) 55%, transparent)';
const EDGE_COLOR_SELECTED = 'var(--primary)';

/** A relationship reads as a sentence on the canvas: its wording, plus how many records each side can hold. */
const RelationEdge = memo(function RelationEdge({ id,sourceX,sourceY,targetX,targetY,sourcePosition,targetPosition,selected,data,markerEnd }: EdgeProps) {
  const [path,labelX,labelY] = getBezierPath({ sourceX,sourceY,sourcePosition,targetX,targetY,targetPosition });
  const label = String(data?.label??'');
  const cardinality = CARDINALITY_SHORT[String(data?.cardinality??'')] ?? '';
  return <>
    <BaseEdge id={id} path={path} markerEnd={markerEnd} style={{strokeWidth:selected?9:7,strokeDasharray:'0 14',strokeLinecap:'round',stroke:selected?EDGE_COLOR_SELECTED:EDGE_COLOR}} />
    <EdgeLabelRenderer>
      <div style={{transform:`translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`}} className='pointer-events-none absolute flex flex-col items-center gap-0.5'>
        {label&&<span className={cn('max-w-40 truncate rounded-full border bg-background px-2 py-0.5 text-[11px] font-medium shadow-sm',selected?'border-primary text-primary':'border-border text-foreground')}>{label}</span>}
        {cardinality&&<span className='text-[10px] font-medium text-muted-foreground'>{cardinality}</span>}
      </div>
    </EdgeLabelRenderer>
  </>;
});

/** Data flowing from a source into a concept; the chip in the middle is the mapping step. */
const FeedEdge = memo(function FeedEdge({ id,sourceX,sourceY,targetX,targetY,sourcePosition,targetPosition,selected,data }: EdgeProps) {
  const { t } = useModuleTranslation('semantic-model');
  const [path,labelX,labelY] = getBezierPath({ sourceX,sourceY,sourcePosition,targetX,targetY,targetPosition });
  const feed = data?.feed as DesignerFeed|undefined;
  if (!feed) return null;
  const label = feed.step==='typed' ? t('designer.step.typed') : feed.step==='extract' ? t('designer.step.extract') : t('designer.step.map',{mapped:feed.mapped,total:feed.total});
  return <>
    <BaseEdge id={id} path={path} style={{strokeWidth:selected?9:7,strokeDasharray:'0 14',strokeLinecap:'round',stroke:selected?EDGE_COLOR_SELECTED:'color-mix(in oklab, rgb(20 184 166) 55%, transparent)'}} />
    <EdgeLabelRenderer>
      <div style={{transform:`translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`}} className='pointer-events-none absolute'>
        <span className={cn('rounded-full border bg-background px-2 py-0.5 text-[11px] font-medium shadow-sm',TONE_CLASS[feed.tone],selected&&'border-primary')}>{label}</span>
      </div>
    </EdgeLabelRenderer>
  </>;
});

const edgeTypes = { relation:RelationEdge, feed:FeedEdge };

export function SemanticModelCanvas({ sourceMappings,mappingHealth,canEdit,onConnectRequest,knowledge,onOpenKnowledge,onMapStructuredDrop,onOpenSource,onPaneDrop,onAddFeed }: Readonly<{ sourceMappings?:ConceptSourceMapping[];mappingHealth?:MappingHealthItem[];canEdit:boolean;onConnectRequest:(connection:{sourceId:string;targetId:string})=>void;knowledge:KnowledgeLinkingController;onOpenKnowledge:(nodeId:string)=>void;onMapStructuredDrop?:(resource:Extract<KnowledgeResource,{kind:'document'}>,nodeId:string)=>void;
  /** A source box or its line was clicked; the mapping is set when a specific line was chosen. */
  onOpenSource?:(source:DesignerSource,mapping?:ConceptSourceMapping)=>void;
  /** A document from the knowledge panel was dropped on empty canvas, not on a concept. */
  onPaneDrop?:(resource:KnowledgeResource)=>void;
  /** The + on a source: map the same file onto another concept. */
  onAddFeed?:(source:DesignerSource)=>void }>) {
  const { t } = useModuleTranslation('semantic-model');
  const isMobile = useIsMobile();
  const graph = useSemanticModelEditorStore((state)=>state.graph);
  const mode = useSemanticModelEditorStore((state)=>state.mode);
  const selectedId = useSemanticModelEditorStore((state)=>state.selectedId);
  const select = useSemanticModelEditorStore((state)=>state.select);
  const commit = useSemanticModelEditorStore((state)=>state.commit);
  const commitBatch = useSemanticModelEditorStore((state)=>state.commitBatch);
  const flowRef = useRef<ReactFlowInstance<Node<BusinessNodeData>,Edge>|null>(null);
  const [quickConcept,setQuickConcept] = useState<{id:string;sourceId:string;position:{x:number;y:number}}|null>(null);
  const [recordOptions,setRecordOptions] = useState<CompatibleRecordRelation[]>([]);
  const [dropNodeId,setDropNodeId] = useState<string|null>(null);

  useEffect(() => {
    if (!quickConcept) return;
    const timer = window.setTimeout(() => void flowRef.current?.fitView({nodes:[{id:quickConcept.sourceId},{id:quickConcept.id}],padding:0.3,maxZoom:1,duration:200}),0);
    return () => window.clearTimeout(timer);
  },[quickConcept?.id]);
  const focusRequest = useSemanticModelEditorStore((state)=>state.focusRequest);
  useEffect(() => {
    if (!focusRequest) return;
    const timer = window.setTimeout(() => {
      const instance = flowRef.current;
      if (!instance) return;
      if (instance.getNode(focusRequest.id)) {
        void instance.fitView({nodes:[{id:focusRequest.id}],padding:0.6,maxZoom:1.2,duration:400});
        return;
      }
      const edge = instance.getEdge(focusRequest.id);
      if (edge) void instance.fitView({nodes:[{id:edge.source},{id:edge.target}],padding:0.4,maxZoom:1,duration:400});
    },0);
    return () => window.clearTimeout(timer);
  },[focusRequest]);
  useEffect(() => {
    if (!isMobile) return;
    const timer = window.setTimeout(() => void flowRef.current?.fitView({padding:0.15,minZoom:1,maxZoom:1}),0);
    return () => window.clearTimeout(timer);
  },[isMobile]);

  const beginQuickConcept = (sourceId:string) => {
    if (!graph) return;
    const source = graph.nodes.find((node)=>node.id===sourceId);
    if (!source) return;
    setQuickConcept({id:crypto.randomUUID(),sourceId,position:nextLinkedConceptPosition(source.position,graph.nodes)});
  };
  const submitQuickConcept = (label:string) => {
    if (!graph || !quickConcept || !label.trim()) return;
    const node:SemanticNodeType = {id:quickConcept.id,key:uniqueBusinessKey(label,graph.nodes.map((item)=>item.key)),label:label.trim(),description:'',category:'business_object',recordPolicy:'optional',systemKey:null,aliases:[],attributes:[],position:quickConcept.position};
    const relation:SemanticRelationType = {id:crypto.randomUUID(),key:uniqueBusinessKey(t('relation.defaultWording'),graph.relations.map((item)=>item.key)),label:t('relation.defaultWording'),inverseLabel:'',description:'',sourceNodeTypeId:quickConcept.sourceId,targetNodeTypeId:node.id,cardinality:'many_to_many',traversable:true,filterable:true,attributes:[]};
    commitBatch([{type:'node_type.create',entity:node},{type:'relation_type.create',entity:relation}],(current)=>({...current,nodes:[...current.nodes,node],relations:[...current.relations,relation]}));
    setQuickConcept(null);
  };
  const addRecordRelation = (option:CompatibleRecordRelation) => {
    if (!graph) return;
    const entity:SemanticRecordRelation = {id:crypto.randomUUID(),relationTypeId:option.relation.id,sourceRecordId:option.sourceRecordId,targetRecordId:option.targetRecordId,values:{}};
    commit({type:'record_relation.create',entity},(current)=>({...current,recordRelations:[...current.recordRelations,entity]}));
    setRecordOptions([]);
    showSuccess(t('records.relationshipAdded',{relationship:option.relation.label}));
  };
  const dropStateFor = (nodeId:string):KnowledgeDropState|undefined => {
    if (dropNodeId!==nodeId||!knowledge.draggedResource) return undefined;
    if (knowledge.isBusy) return 'busy';
    return knowledge.hasBinding(nodeId,knowledge.draggedResource)?'already-linked':'valid';
  };
  const dropKnowledge = (nodeId:string,event:DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const resource=knowledge.draggedResource??parseKnowledgeResource(event.dataTransfer.getData(KNOWLEDGE_DRAG_TYPE));
    setDropNodeId(null);
    knowledge.setDraggedResource(null);
    if (!resource||knowledge.isBusy) return;
    if (resource.kind==='document'&&resource.mappable&&onMapStructuredDrop) {
      onMapStructuredDrop(resource,nodeId);
      return;
    }
    if (knowledge.hasBinding(nodeId,resource)) return;
    void knowledge.link(nodeId,resource);
  };

  // What each concept can say about its data, so a card is readable without opening the details panel.
  const summaries = useMemo<Record<string,ConceptDataSummary>>(()=>{
    const byConcept:Record<string,ConceptDataSummary> = {};
    for (const node of graph?.nodes??[]) byConcept[node.id]={sources:0,notReady:0,identityFields:[],documentNames:[],records:0};
    for (const record of graph?.records??[]) if (byConcept[record.nodeTypeId]) byConcept[record.nodeTypeId].records+=1;
    for (const mapping of sourceMappings??[]) {
      const summary = byConcept[mapping.conceptId];
      if (!summary) continue;
      summary.sources+=1;
      // A saved mapping is not proof of data: only a source the runtime has checked and found current counts as ready.
      const health = mappingHealth?.find((item)=>item.id===mapping.id);
      if (mapping.status!=='ready' || health?.state!=='healthy') summary.notReady+=1;
      if (mapping.documentName) summary.documentNames.push(mapping.documentName);
      for (const field of mapping.identityFields) if (!summary.identityFields.includes(field)) summary.identityFields.push(field);
    }
    return byConcept;
  },[graph?.nodes,graph?.records,sourceMappings,mappingHealth]);

  const flow = useMemo(()=>graph&&mode!=='records'?designerFlow(graph,sourceMappings,mappingHealth):{sources:[],feeds:[]},[graph,mode,sourceMappings,mappingHealth]);

  const graphId = graph?.versionId;
  // Sources arrive after the model, so fit again once they do; otherwise the source column starts off-screen.
  const sourceCount = flow.sources.length;
  useEffect(() => {
    if (!graphId) return;
    const timer = window.setTimeout(() => void flowRef.current?.fitView({padding:0.25,maxZoom:1,duration:300}),100);
    return () => window.clearTimeout(timer);
  },[graphId,sourceCount]);

  // Stage 1 — stable node data, no selection state.
  // selectedId is intentionally excluded so clicking a node doesn't rebuild every node object.
  const baseNodes = useMemo<Node<BusinessNodeData>[]>(()=>{
    if (!graph) return [];
    if (mode==='records') return graph.records.map((record)=>({id:record.id,type:'business',position:record.position,data:{nodeId:record.id,label:record.label,description:String(record.values.description??''),category:'record',protected:false}}));
    const modelNodes = graph.nodes.map((node)=>({id:node.id,type:'business',position:node.position,draggable:canEdit&&!node.systemKey,data:{nodeId:node.id,label:node.label,description:node.description,category:node.category,protected:Boolean(node.systemKey),recordPolicy:node.recordPolicy,attributes:node.attributes,summary:summaries[node.id],quickActions:canEdit,onQuickConcept:beginQuickConcept,onOpenKnowledge,knowledgeCounts:knowledge.countsByNode[node.id]??{workspaces:0,documents:0},dropState:dropStateFor(node.id),onKnowledgeDragEnter:canEdit&&knowledge.draggedResource?setDropNodeId:undefined,onKnowledgeDragLeave:canEdit?((nodeId:string)=>setDropNodeId((current)=>current===nodeId?null:current)):undefined,onKnowledgeDrop:canEdit?dropKnowledge:undefined}}));
    const sourceNodes = flow.sources.map((source)=>({id:source.id,type:'source',position:source.position,draggable:false,connectable:false,data:{source,onAddFeed:canEdit?onAddFeed:undefined}}));
    const withSources = [...sourceNodes,...modelNodes] as unknown as Node<BusinessNodeData>[];
    if (!quickConcept) return withSources;
    return [...withSources,{id:quickConcept.id,type:'business',position:quickConcept.position,draggable:false,selectable:false,focusable:false,data:{nodeId:quickConcept.id,label:'',description:'',category:'business_object',protected:false,draft:true,onDraftSubmit:submitQuickConcept,onDraftCancel:()=>setQuickConcept(null)}}];
  },[canEdit,dropNodeId,flow,onAddFeed,graph,knowledge.bindings,knowledge.countsByNode,knowledge.draggedResource,knowledge.isBusy,mode,onOpenKnowledge,quickConcept,summaries]);
  // Stage 2 — apply selection cheaply; reuses same object refs for unaffected nodes so memo on BusinessNode holds.
  const nodes = useMemo<Node<BusinessNodeData>[]>(()=>
    baseNodes.map((node)=>node.selected===(node.id===selectedId)?node:{...node,selected:node.id===selectedId})
  ,[baseNodes,selectedId]);
  const edges = useMemo<Edge[]>(()=>{
    if (!graph) return [];
    const marker = {type:MarkerType.ArrowClosed,width:18,height:18,color:EDGE_COLOR};
    if (mode==='records') return graph.recordRelations.map((relation)=>({id:relation.id,source:relation.sourceRecordId,target:relation.targetRecordId,type:'relation',markerEnd:marker,data:{label:graph.relations.find((type)=>type.id===relation.relationTypeId)?.label??''}}));
    const feedEdges:Edge[] = flow.feeds.map((feed)=>({id:feed.id,source:feed.sourceId,target:feed.conceptId,type:'feed',data:{feed}}));
    const modelEdges:Edge[] = [...feedEdges,...graph.relations.map((relation)=>({id:relation.id,source:relation.sourceNodeTypeId,target:relation.targetNodeTypeId,type:'relation',animated:false,markerEnd:marker,data:{label:relation.label,cardinality:relation.cardinality}}))];
    return quickConcept?[...modelEdges,{id:`quick-${quickConcept.id}`,source:quickConcept.sourceId,target:quickConcept.id,label:t('relation.defaultWording'),animated:true,style:{strokeDasharray:'5 5',stroke:EDGE_COLOR_SELECTED,strokeWidth:2}}]:modelEdges;
  },[flow,graph,mode,quickConcept,t]);

  const paneDragOver = (event:DragEvent<HTMLDivElement>) => {
    if (!canEdit||!onPaneDrop||!event.dataTransfer.types.includes(KNOWLEDGE_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect='copy';
  };
  const paneDrop = (event:DragEvent<HTMLDivElement>) => {
    if (!canEdit||!onPaneDrop) return;
    const resource=knowledge.draggedResource??parseKnowledgeResource(event.dataTransfer.getData(KNOWLEDGE_DRAG_TYPE));
    if (!resource) return;
    event.preventDefault();
    knowledge.setDraggedResource(null);
    onPaneDrop(resource);
  };
  return <div className='h-full w-full' onDragOver={paneDragOver} onDrop={paneDrop}>
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} fitView fitViewOptions={{padding:0.15,minZoom:isMobile?1:0.25,maxZoom:1}} minZoom={isMobile?1:0.25} maxZoom={1.6} proOptions={{hideAttribution:true}} nodesConnectable={canEdit} nodesDraggable={canEdit} elevateNodesOnSelect={false} onInit={(instance)=>{flowRef.current=instance;}}
      onConnect={(connection:Connection)=>{
        if (!connection.source||!connection.target||!graph) return;
        if (mode!=='records'){onConnectRequest({sourceId:connection.source,targetId:connection.target});return;}
        const options = compatibleRecordRelations(graph,connection.source,connection.target).filter((option)=>!graph.recordRelations.some((existing)=>existing.relationTypeId===option.relation.id&&existing.sourceRecordId===option.sourceRecordId&&existing.targetRecordId===option.targetRecordId));
        if (!options.length){showWarning(t('records.noCompatibleRelationship'));return;}
        if (options.length===1){addRecordRelation(options[0]);return;}
        setRecordOptions(options);
      }}
      onNodeClick={(event,node)=>{if((event.target as Element).closest('.nodrag')||node.id===quickConcept?.id)return;if(isDesignerSourceId(node.id)){const source=flow.sources.find((item)=>item.id===node.id);if(source)onOpenSource?.(source);return;}select(node.id);}}
      onEdgeClick={(_,edge)=>{const feed=flow.feeds.find((item)=>item.id===edge.id);if(feed){const source=flow.sources.find((item)=>item.id===feed.sourceId);if(source)onOpenSource?.(source,feed.mapping);return;}select(edge.id);}} onPaneClick={()=>select(null)}
      onNodeDragStop={(_,node)=>{if(!graph||node.id===quickConcept?.id||isDesignerSourceId(node.id))return;const isRecord=mode==='records';if(!isRecord&&graph.nodes.some((item)=>item.id===node.id&&item.systemKey))return;commit({type:'layout.update',positions:[{id:node.id,position:node.position}]},(current)=>isRecord?{...current,records:current.records.map((item)=>item.id===node.id?{...item,position:node.position}:item)}:{...current,nodes:current.nodes.map((item)=>item.id===node.id?{...item,position:node.position}:item)});}}
    ><Background gap={24} size={1} color='hsl(var(--muted-foreground) / 0.18)' /><Controls showInteractive={false} /></ReactFlow>
    <Dialog open={recordOptions.length>0} onOpenChange={(open)=>{if(!open)setRecordOptions([]);}}><DialogContent><DialogHeader><DialogTitle>{t('records.chooseRelationship')}</DialogTitle><DialogDescription>{t('records.chooseRelationshipHelp')}</DialogDescription></DialogHeader><div className='grid gap-2'>{recordOptions.map((option)=><Button key={option.relation.id} variant='outline' className='h-auto justify-start py-3 text-left' onClick={()=>addRecordRelation(option)}>{option.relation.label}</Button>)}</div></DialogContent></Dialog>
  </div>;
}
