import { memo, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { Background, BaseEdge, Controls, EdgeLabelRenderer, Handle, MarkerType, Position, ReactFlow, getBezierPath, type Connection, type Edge, type EdgeProps, type Node, type NodeProps, type ReactFlowInstance } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { BookOpen, Briefcase, Check, FileStack, KeyRound, Library, Plus, Table2, Tag, Warehouse, X } from 'lucide-react';
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

const MAX_CARD_FIELDS = 4;

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
  const fields=attributes.slice(0,MAX_CARD_FIELDS);
  const hiddenFieldCount=attributes.length-fields.length;
  const status=conceptStatus(data,t as (key: string, options?: Record<string, unknown>) => string);
  return <div className={cn('relative w-60 rounded-2xl border bg-card shadow-sm transition-colors',selected?'border-primary ring-4 ring-primary/10':'border-border/80 hover:border-primary/40',data.protected&&'border-sky-400/60 bg-sky-50/70 dark:bg-sky-950/20',data.dropState==='valid'&&'border-primary ring-4 ring-primary/20',data.dropState==='already-linked'&&'border-emerald-500 ring-4 ring-emerald-500/15',data.dropState==='busy'&&'border-amber-500 ring-4 ring-amber-500/15')}
    onDragEnter={(event)=>{if(!data.onKnowledgeDragEnter)return;event.preventDefault();event.stopPropagation();data.onKnowledgeDragEnter(data.nodeId);}}
    onDragOver={(event)=>{if(!data.onKnowledgeDrop)return;event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect=data.dropState==='valid'?'copy':'none';}}
    onDragLeave={(event)=>{if(event.currentTarget.contains(event.relatedTarget as globalThis.Node|null))return;data.onKnowledgeDragLeave?.(data.nodeId);}}
    onDrop={(event)=>data.onKnowledgeDrop?.(data.nodeId,event)}>
    <span className='sr-only' aria-live='polite'>{dropLabel}</span>
    {dropLabel&&<div className={cn('pointer-events-none absolute inset-x-3 -top-3 z-20 rounded-full px-3 py-1 text-center text-[10px] font-semibold shadow',data.dropState==='valid'&&'bg-primary text-primary-foreground',data.dropState==='already-linked'&&'bg-emerald-600 text-white',data.dropState==='busy'&&'bg-amber-500 text-amber-950')}>{dropLabel}</div>}
    {/* Handles stay mounted even when connecting is off: React Flow anchors edges to them, so hiding them hides the relationships. */}
    <Handle type='target' position={Position.Left} isConnectable={isConnectable} className={cn('!border-2 !border-background !bg-primary',isConnectable?'!h-4 !w-4':'!h-1 !w-1 !border-0 !opacity-0')} aria-label={t('relation.connectTo')} title={t('relation.connectTo')} />
    <div className='flex items-start gap-3 p-4 pb-3'><div className={cn('rounded-xl p-2',data.protected?'bg-sky-500/10 text-sky-600':'bg-primary/10 text-primary')}><Icon className='h-5 w-5' /></div><div className='min-w-0 flex-1'><div className='flex items-center gap-2'><p className='truncate font-semibold'>{data.label}</p>{data.protected&&<Badge variant='outline' className='text-[10px]'>{t('editor.system')}</Badge>}</div><p className='mt-1 line-clamp-2 text-xs text-muted-foreground'>{data.description||t('editor.noDescription')}</p></div>{status&&<span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold',status.tone==='ok'&&'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',status.tone==='warn'&&'bg-amber-500/10 text-amber-700 dark:text-amber-400')}>{status.label}</span>}</div>
    {fields.length>0&&<dl className='space-y-1 px-4 pb-3'>{fields.map((field)=><div key={field.key} className='flex items-center gap-2'>
      {data.summary?.identityFields.includes(field.key)
        ? <KeyRound className='h-3 w-3 shrink-0 text-amber-600 dark:text-amber-400' aria-label={t('editor.matchingKey')} />
        : <span className='h-3 w-3 shrink-0' />}
      <dt className='min-w-0 flex-1 truncate text-xs text-muted-foreground'>{field.label||field.key}</dt>
      <dd className='shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground'>{t(`attribute.type.${field.type}`)}</dd>
    </div>)}{hiddenFieldCount>0&&<p className='pl-5 text-[11px] text-muted-foreground'>{t('editor.moreFields',{count:hiddenFieldCount})}</p>}</dl>}
    {Boolean(data.summary&&(data.summary.sources>0||data.summary.records>0))&&<div className='flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-4 py-2 text-[11px] text-muted-foreground'>
      {(data.summary?.sources??0)>0&&<span className='flex min-w-0 items-center gap-1.5' title={data.summary?.documentNames.join(', ')}><FileStack className='h-3.5 w-3.5 shrink-0' /><span className='truncate'>{t('editor.sourceCount',{count:data.summary?.sources??0})}</span></span>}
      {(data.summary?.records??0)>0&&<span className='flex items-center gap-1.5'><Table2 className='h-3.5 w-3.5 shrink-0' />{t('editor.recordCount',{count:data.summary?.records??0})}</span>}
    </div>}
    {((data.knowledgeCounts?.workspaces??0)>0||(data.knowledgeCounts?.documents??0)>0)&&<div className='nodrag nopan nowheel flex flex-wrap gap-1 border-t px-3 py-2' onClick={stopNodeEvent}>{(data.knowledgeCounts?.workspaces??0)>0&&<Button size='sm' variant='ghost' className='h-11 gap-1 px-2 text-[10px]' onClick={(event)=>runClickAction(event,()=>data.onOpenKnowledge?.(data.nodeId))} aria-label={t((data.knowledgeCounts?.workspaces??0)===1?'knowledge.workspaceCount_one':'knowledge.workspaceCount_other',{count:data.knowledgeCounts?.workspaces??0})}><Warehouse className='h-3.5 w-3.5'/>{data.knowledgeCounts?.workspaces}</Button>}{(data.knowledgeCounts?.documents??0)>0&&<Button size='sm' variant='ghost' className='h-11 gap-1 px-2 text-[10px]' onClick={(event)=>runClickAction(event,()=>data.onOpenKnowledge?.(data.nodeId))} aria-label={t((data.knowledgeCounts?.documents??0)===1?'knowledge.documentCount_one':'knowledge.documentCount_other',{count:data.knowledgeCounts?.documents??0})}><BookOpen className='h-3.5 w-3.5'/>{data.knowledgeCounts?.documents}</Button>}</div>}
    {data.quickActions&&<div className='nodrag nopan nowheel flex items-center justify-end border-t px-3 py-2' onClick={stopNodeEvent}>
      <DropdownMenu><DropdownMenuTrigger asChild><Button size='sm' variant='ghost' className='h-11 px-3'><Plus className='mr-1.5 h-4 w-4'/>{t('action.add')}</Button></DropdownMenuTrigger><DropdownMenuContent align='end'>
        {!data.protected&&<DropdownMenuItem className='min-h-11' onSelect={()=>{if(data.recordPolicy==='none'){showWarning(t('records.disabled'));return;}setRecordInputOpen(true);}}>{t('records.quickAdd')}</DropdownMenuItem>}
        {!data.protected&&<DropdownMenuItem className='min-h-11' onSelect={()=>data.onQuickConcept?.(data.nodeId)}>{t('concept.quickAdd')}</DropdownMenuItem>}
        <DropdownMenuItem className='min-h-11' onSelect={()=>data.onOpenKnowledge?.(data.nodeId)}><Library className='h-4 w-4'/>{t('knowledge.addSource')}</DropdownMenuItem>
      </DropdownMenuContent></DropdownMenu>
      {recordInputOpen&&<div className='absolute left-3 right-3 top-full z-20 rounded-xl border bg-card p-3 shadow-xl'><QuickRecordForm nodeId={data.nodeId} onClose={()=>setRecordInputOpen(false)} /></div>}
    </div>}
    <Handle type='source' position={Position.Right} isConnectable={isConnectable} className={cn('!border-2 !border-background !bg-primary',isConnectable?'!h-4 !w-4':'!h-1 !w-1 !border-0 !opacity-0')} aria-label={t('relation.connectFrom')} title={t('relation.connectFrom')} />
  </div>;
});

const nodeTypes = { business:BusinessNode };

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
    <BaseEdge id={id} path={path} markerEnd={markerEnd} style={{strokeWidth:selected?3:2,stroke:selected?EDGE_COLOR_SELECTED:EDGE_COLOR}} />
    <EdgeLabelRenderer>
      <div style={{transform:`translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`}} className='pointer-events-none absolute flex flex-col items-center gap-0.5'>
        {label&&<span className={cn('max-w-40 truncate rounded-full border bg-background px-2 py-0.5 text-[11px] font-medium shadow-sm',selected?'border-primary text-primary':'border-border text-foreground')}>{label}</span>}
        {cardinality&&<span className='text-[10px] font-medium text-muted-foreground'>{cardinality}</span>}
      </div>
    </EdgeLabelRenderer>
  </>;
});

const edgeTypes = { relation:RelationEdge };

export function SemanticModelCanvas({ sourceMappings,mappingHealth,canEdit,onConnectRequest,knowledge,onOpenKnowledge,onMapStructuredDrop }: Readonly<{ sourceMappings?:ConceptSourceMapping[];mappingHealth?:MappingHealthItem[];canEdit:boolean;onConnectRequest:(connection:{sourceId:string;targetId:string})=>void;knowledge:KnowledgeLinkingController;onOpenKnowledge:(nodeId:string)=>void;onMapStructuredDrop?:(resource:Extract<KnowledgeResource,{kind:'document'}>,nodeId:string)=>void }>) {
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
  const graphId = graph?.versionId;
  useEffect(() => {
    if (!graphId) return;
    const timer = window.setTimeout(() => void flowRef.current?.fitView({padding:0.25,maxZoom:1,duration:300}),100);
    return () => window.clearTimeout(timer);
  },[graphId]);
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

  // Stage 1 — stable node data, no selection state.
  // selectedId is intentionally excluded so clicking a node doesn't rebuild every node object.
  const baseNodes = useMemo<Node<BusinessNodeData>[]>(()=>{
    if (!graph) return [];
    if (mode==='records') return graph.records.map((record)=>({id:record.id,type:'business',position:record.position,data:{nodeId:record.id,label:record.label,description:String(record.values.description??''),category:'record',protected:false}}));
    const modelNodes = graph.nodes.map((node)=>({id:node.id,type:'business',position:node.position,draggable:canEdit&&!node.systemKey,data:{nodeId:node.id,label:node.label,description:node.description,category:node.category,protected:Boolean(node.systemKey),recordPolicy:node.recordPolicy,attributes:node.attributes,summary:summaries[node.id],quickActions:canEdit,onQuickConcept:beginQuickConcept,onOpenKnowledge,knowledgeCounts:knowledge.countsByNode[node.id]??{workspaces:0,documents:0},dropState:dropStateFor(node.id),onKnowledgeDragEnter:canEdit&&knowledge.draggedResource?setDropNodeId:undefined,onKnowledgeDragLeave:canEdit?((nodeId:string)=>setDropNodeId((current)=>current===nodeId?null:current)):undefined,onKnowledgeDrop:canEdit?dropKnowledge:undefined}}));
    if (!quickConcept) return modelNodes;
    return [...modelNodes,{id:quickConcept.id,type:'business',position:quickConcept.position,draggable:false,selectable:false,focusable:false,data:{nodeId:quickConcept.id,label:'',description:'',category:'business_object',protected:false,draft:true,onDraftSubmit:submitQuickConcept,onDraftCancel:()=>setQuickConcept(null)}}];
  },[canEdit,dropNodeId,graph,knowledge.bindings,knowledge.countsByNode,knowledge.draggedResource,knowledge.isBusy,mode,onOpenKnowledge,quickConcept,summaries]);
  // Stage 2 — apply selection cheaply; reuses same object refs for unaffected nodes so memo on BusinessNode holds.
  const nodes = useMemo<Node<BusinessNodeData>[]>(()=>
    baseNodes.map((node)=>node.selected===(node.id===selectedId)?node:{...node,selected:node.id===selectedId})
  ,[baseNodes,selectedId]);
  const edges = useMemo<Edge[]>(()=>{
    if (!graph) return [];
    const marker = {type:MarkerType.ArrowClosed,width:18,height:18,color:EDGE_COLOR};
    if (mode==='records') return graph.recordRelations.map((relation)=>({id:relation.id,source:relation.sourceRecordId,target:relation.targetRecordId,type:'relation',markerEnd:marker,data:{label:graph.relations.find((type)=>type.id===relation.relationTypeId)?.label??''}}));
    const modelEdges = graph.relations.map((relation)=>({id:relation.id,source:relation.sourceNodeTypeId,target:relation.targetNodeTypeId,type:'relation',animated:false,markerEnd:marker,data:{label:relation.label,cardinality:relation.cardinality}}));
    return quickConcept?[...modelEdges,{id:`quick-${quickConcept.id}`,source:quickConcept.sourceId,target:quickConcept.id,label:t('relation.defaultWording'),animated:true,style:{strokeDasharray:'5 5',stroke:EDGE_COLOR_SELECTED,strokeWidth:2}}]:modelEdges;
  },[graph,mode,quickConcept,t]);

  return <>
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} fitView fitViewOptions={{padding:0.15,minZoom:isMobile?1:0.25,maxZoom:1}} minZoom={isMobile?1:0.25} maxZoom={1.6} proOptions={{hideAttribution:true}} nodesConnectable={canEdit} nodesDraggable={canEdit} elevateNodesOnSelect={false} onInit={(instance)=>{flowRef.current=instance;}}
      onConnect={(connection:Connection)=>{
        if (!connection.source||!connection.target||!graph) return;
        if (mode!=='records'){onConnectRequest({sourceId:connection.source,targetId:connection.target});return;}
        const options = compatibleRecordRelations(graph,connection.source,connection.target).filter((option)=>!graph.recordRelations.some((existing)=>existing.relationTypeId===option.relation.id&&existing.sourceRecordId===option.sourceRecordId&&existing.targetRecordId===option.targetRecordId));
        if (!options.length){showWarning(t('records.noCompatibleRelationship'));return;}
        if (options.length===1){addRecordRelation(options[0]);return;}
        setRecordOptions(options);
      }}
      onNodeClick={(event,node)=>{if((event.target as Element).closest('.nodrag')||node.id===quickConcept?.id)return;select(node.id);}} onEdgeClick={(_,edge)=>select(edge.id)} onPaneClick={()=>select(null)}
      onNodeDragStop={(_,node)=>{if(!graph||node.id===quickConcept?.id)return;const isRecord=mode==='records';if(!isRecord&&graph.nodes.some((item)=>item.id===node.id&&item.systemKey))return;commit({type:'layout.update',positions:[{id:node.id,position:node.position}]},(current)=>isRecord?{...current,records:current.records.map((item)=>item.id===node.id?{...item,position:node.position}:item)}:{...current,nodes:current.nodes.map((item)=>item.id===node.id?{...item,position:node.position}:item)});}}
    ><Background gap={24} size={1} color='hsl(var(--muted-foreground) / 0.18)' /><Controls showInteractive={false} /></ReactFlow>
    <Dialog open={recordOptions.length>0} onOpenChange={(open)=>{if(!open)setRecordOptions([]);}}><DialogContent><DialogHeader><DialogTitle>{t('records.chooseRelationship')}</DialogTitle><DialogDescription>{t('records.chooseRelationshipHelp')}</DialogDescription></DialogHeader><div className='grid gap-2'>{recordOptions.map((option)=><Button key={option.relation.id} variant='outline' className='h-auto justify-start py-3 text-left' onClick={()=>addRecordRelation(option)}>{option.relation.label}</Button>)}</div></DialogContent></Dialog>
  </>;
}
