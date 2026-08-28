import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { Background, Controls, Handle, Position, ReactFlow, type Connection, type Edge, type Node, type NodeProps, type ReactFlowInstance } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { BookOpen, Briefcase, Check, FileStack, Library, Plus, Tag, Warehouse, X } from 'lucide-react';
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
import { KNOWLEDGE_DRAG_TYPE, parseKnowledgeResource, type KnowledgeDropState, type KnowledgeLinkingController } from '../../hooks/use-knowledge-linking';
import type { SemanticNodeType, SemanticRecordRelation, SemanticRelationType } from '../../types';
import { compatibleRecordRelations, nextLinkedConceptPosition, uniqueBusinessKey, type CompatibleRecordRelation } from '../../utils/model-utils';

type BusinessNodeData = Record<string, unknown> & {
  nodeId: string;
  label: string;
  description: string;
  category: 'business_object' | 'classification' | 'system_collection' | 'record';
  protected: boolean;
  recordPolicy?: 'none' | 'optional' | 'expected';
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

function BusinessNode({ data,selected,isConnectable }: NodeProps<Node<BusinessNodeData>>) {
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
  return <div className={cn('relative w-60 rounded-2xl border bg-card shadow-sm transition-colors',selected?'border-primary ring-4 ring-primary/10':'border-border/80 hover:border-primary/40',data.protected&&'border-sky-400/60 bg-sky-50/70 dark:bg-sky-950/20',data.dropState==='valid'&&'border-primary ring-4 ring-primary/20',data.dropState==='already-linked'&&'border-emerald-500 ring-4 ring-emerald-500/15',data.dropState==='busy'&&'border-amber-500 ring-4 ring-amber-500/15')}
    onDragEnter={(event)=>{if(!data.onKnowledgeDragEnter)return;event.preventDefault();event.stopPropagation();data.onKnowledgeDragEnter(data.nodeId);}}
    onDragOver={(event)=>{if(!data.onKnowledgeDrop)return;event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect=data.dropState==='valid'?'copy':'none';}}
    onDragLeave={(event)=>{if(event.currentTarget.contains(event.relatedTarget as globalThis.Node|null))return;data.onKnowledgeDragLeave?.(data.nodeId);}}
    onDrop={(event)=>data.onKnowledgeDrop?.(data.nodeId,event)}>
    <span className='sr-only' aria-live='polite'>{dropLabel}</span>
    {dropLabel&&<div className={cn('pointer-events-none absolute inset-x-3 -top-3 z-20 rounded-full px-3 py-1 text-center text-[10px] font-semibold shadow',data.dropState==='valid'&&'bg-primary text-primary-foreground',data.dropState==='already-linked'&&'bg-emerald-600 text-white',data.dropState==='busy'&&'bg-amber-500 text-amber-950')}>{dropLabel}</div>}
    {isConnectable&&<Handle type='target' position={Position.Left} className='!h-4 !w-4 !border-2 !border-background !bg-primary' aria-label={t('relation.connectTo')} title={t('relation.connectTo')} />}
    <div className='flex items-start gap-3 p-4'><div className={cn('rounded-xl p-2',data.protected?'bg-sky-500/10 text-sky-600':'bg-primary/10 text-primary')}><Icon className='h-5 w-5' /></div><div className='min-w-0 flex-1'><div className='flex items-center gap-2'><p className='truncate font-semibold'>{data.label}</p>{data.protected&&<Badge variant='outline' className='text-[10px]'>{t('editor.system')}</Badge>}</div><p className='mt-1 line-clamp-2 text-xs text-muted-foreground'>{data.description||t('editor.noDescription')}</p>{data.recordPolicy&&data.recordPolicy!=='none'&&<p className='mt-2 text-[11px] font-medium text-primary'>{t(`recordPolicy.${data.recordPolicy}`)}</p>}</div></div>
    {((data.knowledgeCounts?.workspaces??0)>0||(data.knowledgeCounts?.documents??0)>0)&&<div className='nodrag nopan nowheel flex flex-wrap gap-1 border-t px-3 py-2' onClick={stopNodeEvent}>{(data.knowledgeCounts?.workspaces??0)>0&&<Button size='sm' variant='ghost' className='h-11 gap-1 px-2 text-[10px]' onClick={(event)=>runClickAction(event,()=>data.onOpenKnowledge?.(data.nodeId))} aria-label={t((data.knowledgeCounts?.workspaces??0)===1?'knowledge.workspaceCount_one':'knowledge.workspaceCount_other',{count:data.knowledgeCounts?.workspaces??0})}><Warehouse className='h-3.5 w-3.5'/>{data.knowledgeCounts?.workspaces}</Button>}{(data.knowledgeCounts?.documents??0)>0&&<Button size='sm' variant='ghost' className='h-11 gap-1 px-2 text-[10px]' onClick={(event)=>runClickAction(event,()=>data.onOpenKnowledge?.(data.nodeId))} aria-label={t((data.knowledgeCounts?.documents??0)===1?'knowledge.documentCount_one':'knowledge.documentCount_other',{count:data.knowledgeCounts?.documents??0})}><BookOpen className='h-3.5 w-3.5'/>{data.knowledgeCounts?.documents}</Button>}</div>}
    {data.quickActions&&<div className='nodrag nopan nowheel flex items-center justify-end border-t px-3 py-2' onClick={stopNodeEvent}>
      <DropdownMenu><DropdownMenuTrigger asChild><Button size='sm' variant='ghost' className='h-11 px-3'><Plus className='mr-1.5 h-4 w-4'/>{t('action.add')}</Button></DropdownMenuTrigger><DropdownMenuContent align='end'>
        {!data.protected&&<DropdownMenuItem className='min-h-11' onSelect={()=>{if(data.recordPolicy==='none'){showWarning(t('records.disabled'));return;}setRecordInputOpen(true);}}>{t('records.quickAdd')}</DropdownMenuItem>}
        {!data.protected&&<DropdownMenuItem className='min-h-11' onSelect={()=>data.onQuickConcept?.(data.nodeId)}>{t('concept.quickAdd')}</DropdownMenuItem>}
        <DropdownMenuItem className='min-h-11' onSelect={()=>data.onOpenKnowledge?.(data.nodeId)}><Library className='h-4 w-4'/>{t('knowledge.addSource')}</DropdownMenuItem>
      </DropdownMenuContent></DropdownMenu>
      {recordInputOpen&&<div className='absolute left-3 right-3 top-full z-20 rounded-xl border bg-card p-3 shadow-xl'><QuickRecordForm nodeId={data.nodeId} onClose={()=>setRecordInputOpen(false)} /></div>}
    </div>}
    {isConnectable&&<Handle type='source' position={Position.Right} className='!h-4 !w-4 !border-2 !border-background !bg-primary' aria-label={t('relation.connectFrom')} title={t('relation.connectFrom')} />}
  </div>;
}

const nodeTypes = { business:BusinessNode };

export function SemanticModelCanvas({ canEdit,onConnectRequest,knowledge,onOpenKnowledge }: Readonly<{ canEdit:boolean;onConnectRequest:(connection:{sourceId:string;targetId:string})=>void;knowledge:KnowledgeLinkingController;onOpenKnowledge:(nodeId:string)=>void }>) {
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
    if (!resource||knowledge.hasBinding(nodeId,resource)||knowledge.isBusy) return;
    void knowledge.link(nodeId,resource);
  };

  const nodes = useMemo<Node<BusinessNodeData>[]>(()=>{
    if (!graph) return [];
    if (mode==='records') return graph.records.map((record)=>({id:record.id,type:'business',position:record.position,data:{nodeId:record.id,label:record.label,description:String(record.values.description??''),category:'record',protected:false},selected:selectedId===record.id}));
    const modelNodes = graph.nodes.map((node)=>({id:node.id,type:'business',position:node.position,draggable:canEdit&&!node.systemKey,data:{nodeId:node.id,label:node.label,description:node.description,category:node.category,protected:Boolean(node.systemKey),recordPolicy:node.recordPolicy,quickActions:canEdit,onQuickConcept:beginQuickConcept,onOpenKnowledge,knowledgeCounts:knowledge.countsByNode[node.id]??{workspaces:0,documents:0},dropState:dropStateFor(node.id),onKnowledgeDragEnter:canEdit&&knowledge.draggedResource?setDropNodeId:undefined,onKnowledgeDragLeave:canEdit?((nodeId:string)=>setDropNodeId((current)=>current===nodeId?null:current)):undefined,onKnowledgeDrop:canEdit?dropKnowledge:undefined},selected:selectedId===node.id}));
    if (!quickConcept) return modelNodes;
    return [...modelNodes,{id:quickConcept.id,type:'business',position:quickConcept.position,draggable:false,selectable:false,focusable:false,data:{nodeId:quickConcept.id,label:'',description:'',category:'business_object',protected:false,draft:true,onDraftSubmit:submitQuickConcept,onDraftCancel:()=>setQuickConcept(null)}}];
  },[canEdit,dropNodeId,graph,knowledge.bindings,knowledge.countsByNode,knowledge.draggedResource,knowledge.isBusy,mode,onOpenKnowledge,quickConcept,selectedId]);
  const edges = useMemo<Edge[]>(()=>{
    if (!graph) return [];
    if (mode==='records') return graph.recordRelations.map((relation)=>({id:relation.id,source:relation.sourceRecordId,target:relation.targetRecordId,label:graph.relations.find((type)=>type.id===relation.relationTypeId)?.label}));
    const modelEdges = graph.relations.map((relation)=>({id:relation.id,source:relation.sourceNodeTypeId,target:relation.targetNodeTypeId,label:relation.label,animated:false,style:{strokeWidth:1.5}}));
    return quickConcept?[...modelEdges,{id:`quick-${quickConcept.id}`,source:quickConcept.sourceId,target:quickConcept.id,label:t('relation.defaultWording'),animated:true,style:{strokeDasharray:'5 5'}}]:modelEdges;
  },[graph,mode,quickConcept,t]);

  return <>
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{padding:0.25,minZoom:isMobile?1:0.25,maxZoom:1}} minZoom={isMobile?1:0.25} maxZoom={1.6} proOptions={{hideAttribution:true}} nodesConnectable={canEdit} nodesDraggable={canEdit} onInit={(instance)=>{flowRef.current=instance;}}
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
