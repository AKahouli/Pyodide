import { memo, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { Background, BaseEdge, Controls, EdgeLabelRenderer, Handle, MarkerType, NodeToolbar, Position, ReactFlow, getBezierPath, type Connection, type Edge, type EdgeProps, type Node, type NodeChange, type NodeProps, type ReactFlowInstance } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { BookOpen, Briefcase, Check, FileStack, FileText, FolderOpen, KeyRound, Library, Mail, PanelRight, Pencil, Plus, Sheet, Table2, Tag, Trash2, X } from 'lucide-react';
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
import type { AttributeDefinition, ConceptSourceMapping, DerivedSource, MappingHealthItem, ModelCheckIssue, SemanticNodeType, SemanticRecordRelation, SemanticRelationType } from '../../types';
import { businessKey, compatibleRecordRelations, nextLinkedConceptPosition, uniqueBusinessKey, type CompatibleRecordRelation } from '../../utils/model-utils';
import { conceptDeletion, relationDeletion, manualTableDeletion } from '../../utils/graph-deletes';
import { announceUndoable, isTextEntry } from '../../utils/undo-notice';
import { copyConcept, copySource, pasteConcept, readCanvasClipboard, writeCanvasClipboard } from '../../utils/canvas-clipboard';
import { ConceptToolbar, InlineRename, SourceToolbar, ToolButton, ToolbarShell } from './CanvasToolbars';
import { tableLabel } from '../../utils/data-sources';
import { indexModelCheck } from '../../utils/model-check';
import { CheckBadge } from './CheckBadge';
import { closesDerivationCycle, designerFlow, isDesignerSourceId, type DesignerFeed, type DesignerSource } from '../../utils/designer-flow';

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
  onDelete?: (nodeId: string) => void;
  /** Unique fields chosen on the concept (the rule), toggled from the fields popover. */
  keyFields?: string[];
  onToggleKey?: (conceptId: string, field: string) => void;
  onRename?: (nodeId: string, label: string) => void;
  onDetails?: (nodeId: string) => void;
  onBrowseRecords?: (nodeId: string) => void;
  /** Open the grid where this concept's rows are typed or pasted by hand. */
  onOpenManualTable?: (nodeId: string) => void;
  /** A run is refreshing this concept's records right now. */
  refreshing?: boolean;
  /** What the model check found on this concept, its fields included. */
  checkIssues?: ModelCheckIssue[];
  onCheckIssue?: (issue: ModelCheckIssue) => void;
};

const DATA_TARGET_HANDLE = 'data-target';
const DATA_SOURCE_HANDLE = 'data-source';
const RELATION_TARGET_HANDLE = 'relationship-target';
const RELATION_SOURCE_HANDLE = 'relationship-source';

function stopNodeEvent(event: MouseEvent | PointerEvent | FormEvent): void {
  event.stopPropagation();
}


/** One badge answering "can this concept produce data?", from its sources and its record policy. */
function conceptStatus(data: BusinessNodeData, t: (key: string, options?: Record<string, unknown>) => string) {
  const summary = data.summary;
  if (!summary || data.category === 'record' || data.protected) return null;
  // A mapped concept without a unique field is reported by the model check (no_identity), not by a chip.
  if (summary.notReady > 0) return { tone: 'warn' as const, label: t('editor.status.sourcesNotReady', { count: summary.notReady }) };
  if (summary.sources > 0) return { tone: 'ok' as const, label: t('editor.status.ready') };
  if (data.recordPolicy === 'expected' && summary.records === 0) return { tone: 'warn' as const, label: t('editor.status.noSource') };
  return null;
}

const BusinessNode = memo(function BusinessNode({ data,selected,isConnectable }: NodeProps<Node<BusinessNodeData>>) {
  const { t } = useModuleTranslation('semantic-model');
  const [renaming,setRenaming] = useState(false);
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
  return <div className='group relative flex w-48 flex-col items-center'
    onDragEnter={(event)=>{if(!data.onKnowledgeDragEnter)return;event.preventDefault();event.stopPropagation();data.onKnowledgeDragEnter(data.nodeId);}}
    onDragOver={(event)=>{if(!data.onKnowledgeDrop)return;event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect=data.dropState==='valid'?'copy':'none';}}
    onDragLeave={(event)=>{if(event.currentTarget.contains(event.relatedTarget as globalThis.Node|null))return;data.onKnowledgeDragLeave?.(data.nodeId);}}
    onDrop={(event)=>data.onKnowledgeDrop?.(data.nodeId,event)}>
    <span className='sr-only' aria-live='polite'>{dropLabel}</span>
    {/* Selected concept: everything that can be done to it, right above it. */}
    {data.quickActions&&!data.protected&&data.category!=='record'&&<NodeToolbar isVisible={Boolean(selected)} position={Position.Top} offset={14}>
      <ConceptToolbar conceptId={data.nodeId} label={data.label} attributes={attributes} keyFields={data.keyFields??[]} onToggleKey={data.onToggleKey}
        actions={{onRename:()=>setRenaming(true),onBringData:()=>data.onOpenKnowledge?.(data.nodeId),onLinkConcept:()=>data.onQuickConcept?.(data.nodeId),
          onManualTable:data.recordPolicy==='none'||!data.onOpenManualTable?undefined:()=>data.onOpenManualTable?.(data.nodeId),onDetails:()=>data.onDetails?.(data.nodeId),onBrowseRecords:data.onBrowseRecords?()=>data.onBrowseRecords?.(data.nodeId):undefined,onDelete:data.onDelete?()=>data.onDelete?.(data.nodeId):undefined}} />
    </NodeToolbar>}
    {dropLabel&&<div className={cn('pointer-events-none absolute -top-8 z-20 whitespace-nowrap rounded-full px-3 py-1 text-center text-[10px] font-semibold shadow',data.dropState==='valid'&&'bg-primary text-primary-foreground',data.dropState==='already-linked'&&'bg-emerald-600 text-white',data.dropState==='busy'&&'bg-amber-500 text-amber-950')}>{dropLabel}</div>}
    {/* The + on the left brings data in; the one on the right adds what comes next. */}
    {data.quickActions&&!data.protected&&<DropdownMenu><DropdownMenuTrigger asChild><button type='button' className='nodrag nopan absolute left-[14px] top-[36px] z-10 flex h-7 w-7 items-center justify-center rounded-full border-2 border-teal-500/60 bg-background text-teal-600 opacity-70 transition hover:scale-110 hover:opacity-100 dark:text-teal-400' onClick={(event)=>event.stopPropagation()} aria-label={t('designer.plus.source',{name:data.label})} title={t('designer.plus.source',{name:data.label})}><Plus className='h-4 w-4' /></button></DropdownMenuTrigger><DropdownMenuContent align='start' onCloseAutoFocus={(event)=>event.preventDefault()}>
      {data.onOpenManualTable&&<DropdownMenuItem className='min-h-11' onSelect={()=>{if(data.recordPolicy==='none'){showWarning(t('records.disabled'));return;}data.onOpenManualTable?.(data.nodeId);}}><Table2 className='h-4 w-4'/>{t('designer.plus.manual')}</DropdownMenuItem>}
      <DropdownMenuItem className='min-h-11' onSelect={()=>data.onOpenKnowledge?.(data.nodeId)}><Library className='h-4 w-4'/>{t('designer.plus.connect')}</DropdownMenuItem>
    </DropdownMenuContent></DropdownMenu>}
    <div className={cn('relative flex h-24 w-24 items-center justify-center rounded-full transition-shadow',data.protected?'bg-sky-500 text-white':'bg-primary text-primary-foreground',selected?'ring-8 ring-primary/30':'ring-8 ring-primary/10 hover:ring-primary/20',data.dropState==='valid'&&'ring-primary/40',data.dropState==='already-linked'&&'ring-emerald-500/40',data.dropState==='busy'&&'ring-amber-500/40')}>
      {data.category==='record' ? <Handle type='target' position={Position.Left} isConnectable={isConnectable} className={cn('!border-2 !border-background !bg-primary',isConnectable?'!h-3.5 !w-3.5':'!h-1 !w-1 !border-0 !opacity-0')} aria-label={t('relation.connectTo')} title={t('relation.connectTo')} /> : <>
        <Handle id={DATA_TARGET_HANDLE} type='target' position={Position.Left} isConnectable={isConnectable} style={{top:'28%'}} className='!h-3.5 !w-3.5 !rounded-sm !border-2 !border-background !bg-teal-500' aria-label={t('canvasConnections.dataTo')} title={t('canvasConnections.dataTo')} />
        <Handle id={RELATION_TARGET_HANDLE} type='target' position={Position.Left} isConnectable={isConnectable} style={{top:'68%'}} className='!h-3.5 !w-3.5 !rounded-full !border-2 !border-background !bg-foreground/65' aria-label={t('canvasConnections.relationshipTo')} title={t('canvasConnections.relationshipTo')} />
      </>}
      {data.refreshing&&<span className='pointer-events-none absolute -inset-3 animate-spin rounded-full drop-shadow-[0_0_6px_rgba(236,72,153,0.8)] [animation-duration:1.6s] motion-reduce:animate-none' style={REFRESH_RING} role='status' aria-label={t('editor.refreshing',{name:data.label})} title={t('editor.refreshing',{name:data.label})} />}
      <Icon className='h-10 w-10' />
      {data.onDelete&&!selected&&<HoverDelete label={t('designer.delete.concept',{name:data.label})} className='left-1/2 -top-4 -translate-x-1/2' onDelete={()=>data.onDelete?.(data.nodeId)} />}
      {data.checkIssues?.length?<CheckBadge issues={data.checkIssues} onOpen={data.onCheckIssue} className='absolute -right-1 -top-1 z-20' />:null}
      {hasKey&&<span className='absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-background bg-amber-400 text-amber-950' role='img' aria-label={t('editor.matchingKey')} title={t('editor.matchingKey')}><KeyRound className='h-3.5 w-3.5' /></span>}
      {data.category==='record' ? <Handle type='source' position={Position.Right} isConnectable={isConnectable} className={cn('!border-2 !border-background !bg-primary',isConnectable?'!h-3.5 !w-3.5':'!h-1 !w-1 !border-0 !opacity-0')} aria-label={t('relation.connectFrom')} title={t('relation.connectFrom')} /> : <>
        <Handle id={DATA_SOURCE_HANDLE} type='source' position={Position.Right} isConnectable={isConnectable} style={{top:'28%'}} className='!h-3.5 !w-3.5 !rounded-sm !border-2 !border-background !bg-teal-500' aria-label={t('canvasConnections.dataFrom')} title={t('canvasConnections.dataFrom')} />
        <Handle id={RELATION_SOURCE_HANDLE} type='source' position={Position.Right} isConnectable={isConnectable} style={{top:'68%'}} className='!h-3.5 !w-3.5 !rounded-full !border-2 !border-background !bg-foreground/65' aria-label={t('canvasConnections.relationshipFrom')} title={t('canvasConnections.relationshipFrom')} />
      </>}
    </div>
    {data.quickActions&&<div className='nodrag nopan nowheel absolute right-[14px] top-[36px] z-10' onClick={stopNodeEvent}>
      <DropdownMenu><DropdownMenuTrigger asChild><button type='button' className='flex h-7 w-7 items-center justify-center rounded-full border-2 border-primary/60 bg-background text-primary opacity-70 transition hover:scale-110 hover:opacity-100' aria-label={t('designer.plus.next',{name:data.label})} title={t('designer.plus.next',{name:data.label})}><Plus className='h-4 w-4' /></button></DropdownMenuTrigger><DropdownMenuContent align='start' onCloseAutoFocus={(event)=>event.preventDefault()}>
        {!data.protected&&<DropdownMenuItem className='min-h-11' onSelect={()=>data.onQuickConcept?.(data.nodeId)}><Briefcase className='h-4 w-4'/>{t('concept.quickAdd')}</DropdownMenuItem>}
        <DropdownMenuItem className='min-h-11' onSelect={()=>data.onOpenKnowledge?.(data.nodeId)}><Library className='h-4 w-4'/>{t('designer.plus.mapSource')}</DropdownMenuItem>
        {!data.protected&&<DropdownMenuItem className='min-h-11' onSelect={()=>{if(data.recordPolicy==='none'){showWarning(t('records.disabled'));return;}data.onOpenManualTable?.(data.nodeId);}}><Table2 className='h-4 w-4'/>{t('manualTable.title',{concept:data.label})}</DropdownMenuItem>}
      </DropdownMenuContent></DropdownMenu>
    </div>}
    <div className='mt-3 w-full text-center'>
      {renaming&&data.onRename?<div className='flex justify-center'><InlineRename value={data.label} label={t('canvasTools.rename')} onCancel={()=>setRenaming(false)} onSubmit={(label)=>{data.onRename?.(data.nodeId,label);setRenaming(false);}} /></div>
      :<p className='truncate font-semibold' title={data.onRename?t('canvasTools.renameHint'):data.label} onDoubleClick={(event)=>{if(!data.onRename||data.protected)return;event.stopPropagation();setRenaming(true);}}>{data.label}{data.protected&&<Badge variant='outline' className='ms-1.5 align-middle text-[10px]'>{t('editor.system')}</Badge>}</p>}
      <p className='truncate text-[11px] text-muted-foreground' title={data.description}>{data.category==='record'?data.description:subtitle}</p>
      {status&&<span className={cn('mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold',status.tone==='ok'&&'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',status.tone==='warn'&&'bg-amber-500/10 text-amber-700 dark:text-amber-400')}>{status.label}</span>}
    </div>
  </div>;
});

// A bright spinning gradient ring, cut out of a disc so only its edge shows.
const REFRESH_RING = {
  background:'conic-gradient(#ff00c8,#ffb800,#00f0ff,#7c3aed,#ff00c8)',
  mask:'radial-gradient(farthest-side,transparent calc(100% - 5px),#000 calc(100% - 4px))',
  WebkitMask:'radial-gradient(farthest-side,transparent calc(100% - 5px),#000 calc(100% - 4px))',
} as const;

const TONE_CLASS = {
  ok:'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  warn:'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  idle:'bg-muted text-muted-foreground',
} as const;

type SourceNodeData = Record<string, unknown> & { source: DesignerSource; onAddFeed?: (source: DesignerSource) => void; onSwitch?: (source: DesignerSource) => void; onRemove?: (source: DesignerSource) => void; onOpen?: (source: DesignerSource) => void };

/** A small trash button that appears while the pointer is over its node or line. */
function HoverDelete({ label,onDelete,className,visible=false }: Readonly<{ label:string;onDelete:()=>void;className?:string;visible?:boolean }>) {
  return <button type='button' className={cn('nodrag nopan pointer-events-auto absolute z-20 flex h-7 w-7 items-center justify-center rounded-full border border-destructive/40 bg-background text-destructive shadow-sm transition hover:scale-110 hover:bg-destructive hover:text-destructive-foreground focus-visible:opacity-100',visible?'opacity-100':'opacity-0 group-hover:opacity-100',className)}
    onClick={(event)=>{event.stopPropagation();onDelete();}} aria-label={label} title={label}><Trash2 className='h-3.5 w-3.5' /></button>;
}

/** A data source on the canvas; clicking it opens its mapping, and its + feeds another concept. */
const SourceNode = memo(function SourceNode({ data,selected }: NodeProps<Node<SourceNodeData>>) {
  const { t } = useModuleTranslation('semantic-model');
  const { source } = data;
  const Icon = source.kind==='typed' ? Table2 : source.kind==='mail' ? Mail : source.kind==='spreadsheet' ? Sheet : source.kind==='workspace' ? FolderOpen : FileText;
  const title = source.kind==='typed' ? t('designer.typedRecords') : source.label;
  const detail = source.kind==='typed' ? t('editor.recordCount',{count:Number(source.detail)})
    : source.kind==='workspace' ? t(Number(source.detail)===1?'records.table.files_one':'records.table.files',{count:Number(source.detail)})
    : source.kind==='mail' ? tableLabel(t,source.detail)
    : source.detail || t(`designer.kind.${source.kind}`);
  return <div className='group relative flex w-44 flex-col items-center'>
    <NodeToolbar isVisible={Boolean(selected)} position={Position.Top} offset={14}>
      <SourceToolbar label={title} typed={source.kind==='typed'} onOpen={data.onOpen?()=>data.onOpen?.(source):undefined} onAddFeed={data.onAddFeed?()=>data.onAddFeed?.(source):undefined}
        onSwitch={data.onSwitch&&source.mappings.length?()=>data.onSwitch?.(source):undefined} onRemove={data.onRemove?()=>data.onRemove?.(source):undefined} />
    </NodeToolbar>
    <div className={cn('relative flex h-20 w-20 items-center justify-center rounded-full bg-teal-600 text-white transition-shadow',selected?'ring-8 ring-teal-500/40':'ring-8 ring-teal-500/15 hover:ring-teal-500/30')}>
      <Icon className='h-9 w-9' />
      {data.onRemove&&!selected&&<HoverDelete label={source.kind==='typed'?t('designer.delete.typed'):t('designer.delete.source',{name:title})} className='-left-1 -top-1' onDelete={()=>data.onRemove?.(source)} />}
      {source.tone!=='idle'&&<span className={cn('absolute -right-0.5 -top-0.5 h-4 w-4 rounded-full border-2 border-background',source.tone==='ok'?'bg-emerald-500':'bg-amber-500')} role='img' aria-label={t(`designer.tone.${source.tone}`)} />}
      <Handle id={DATA_SOURCE_HANDLE} type='source' position={Position.Right} isConnectable={false} className='!h-3.5 !w-3.5 !rounded-sm !border-2 !border-background !bg-teal-500' aria-label={t('canvasConnections.dataFrom')} title={t('canvasConnections.dataFrom')} />
    </div>
    {data.onOpen&&<button type='button' className='nodrag nopan absolute left-2 top-[26px] z-10 flex h-7 w-7 items-center justify-center rounded-full border-2 border-teal-500/60 bg-background text-teal-600 opacity-70 transition hover:scale-110 hover:opacity-100 dark:text-teal-400' onClick={(event)=>{event.stopPropagation();data.onOpen?.(source);}} aria-label={source.kind==='typed'?t('canvasTools.openRecords'):t('designer.editSource',{name:title})} title={source.kind==='typed'?t('canvasTools.openRecords'):t('designer.editSource',{name:title})}><Pencil className='h-3.5 w-3.5' /></button>}
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
const DATA_EDGE_COLOR = 'rgb(13 148 136)';

const CARDINALITIES: SemanticRelationType['cardinality'][] = ['one_to_one','one_to_many','many_to_one','many_to_many'];

function RelationToolbar({ id,label,cardinality,onCardinality,onDetails,onDelete }: Readonly<{ id:string;label:string;cardinality:string;onCardinality:(id:string,value:SemanticRelationType['cardinality'])=>void;onDetails?:(id:string)=>void;onDelete?:(id:string)=>void }>) {
  const { t } = useModuleTranslation('semantic-model');
  return <ToolbarShell label={t('canvasTools.relationToolbar',{name:label})}>
    {CARDINALITIES.map((value)=><button key={value} type='button' aria-pressed={cardinality===value} title={t('canvasTools.cardinality',{value:CARDINALITY_SHORT[value]})} onClick={(event)=>{event.stopPropagation();if(cardinality!==value)onCardinality(id,value);}}
      className={cn('nodrag nopan h-8 rounded-lg px-2 text-[11px] font-semibold',cardinality===value?'bg-primary text-primary-foreground':'hover:bg-muted')}>{CARDINALITY_SHORT[value]}</button>)}
    <span className='mx-0.5 h-5 w-px bg-border' aria-hidden />
    {onDetails&&<ToolButton label={t('canvasTools.matching')} onClick={()=>onDetails(id)}><PanelRight className='h-4 w-4' /></ToolButton>}
    {onDelete&&<ToolButton tone='danger' label={t('designer.delete.relation',{name:label})} onClick={()=>onDelete(id)}><Trash2 className='h-4 w-4' /></ToolButton>}
  </ToolbarShell>;
}

/** A relationship reads as a sentence on the canvas: its wording, plus how many records each side can hold. */
const RelationEdge = memo(function RelationEdge({ id,sourceX,sourceY,targetX,targetY,sourcePosition,targetPosition,selected,data,markerEnd }: EdgeProps) {
  const parallel = Boolean(data?.parallel);
  const [path,labelX,labelY] = getBezierPath({ sourceX,sourceY,sourcePosition,targetX,targetY,targetPosition,curvature:parallel?0.35:0.25 });
  const label = String(data?.label??'');
  const cardinality = CARDINALITY_SHORT[String(data?.cardinality??'')] ?? '';
  return <>
    <BaseEdge id={id} path={path} markerEnd={markerEnd} style={{strokeWidth:selected?3.5:2.25,stroke:selected?EDGE_COLOR_SELECTED:EDGE_COLOR}} />
    <EdgeLabelRenderer>
      <div style={{transform:`translate(-50%, -50%) translate(${labelX}px, ${labelY+(parallel?16:0)}px)`,zIndex:selected?1001:undefined}} className='nodrag nopan group pointer-events-auto absolute flex cursor-pointer flex-col items-center gap-0.5 p-2' onClick={()=>useSemanticModelEditorStore.getState().select(id,{details:true})}>
        {Array.isArray(data?.checkIssues)&&data.checkIssues.length>0&&<CheckBadge issues={data.checkIssues as ModelCheckIssue[]} onOpen={data.onCheckIssue as ((issue:ModelCheckIssue)=>void)|undefined} className='absolute -left-3 -top-2 z-20' />}
        {typeof data?.onDelete==='function'&&!selected&&<HoverDelete label={String(data?.deleteLabel??'')} className='-right-3 -top-2' onDelete={()=>(data.onDelete as (id:string)=>void)(id)} />}
        {label&&<span className={cn('max-w-40 truncate rounded-full border bg-background px-2 py-0.5 text-[11px] font-medium shadow-sm',selected?'border-primary text-primary':'border-border text-foreground')}>{label}</span>}
        {cardinality&&<span className='text-[10px] font-medium text-muted-foreground'>{cardinality}</span>}
        {/* Selected relationship: how many on each side, how records are matched, or remove it. */}
        {selected&&typeof data?.onCardinality==='function'&&<div className='absolute bottom-full left-1/2 mb-1 -translate-x-1/2'><RelationToolbar id={id} label={label} cardinality={String(data?.cardinality??'')}
          onCardinality={data.onCardinality as (id:string,value:SemanticRelationType['cardinality'])=>void} onDetails={data.onDetails as ((id:string)=>void)|undefined} onDelete={data.onDelete as ((id:string)=>void)|undefined} /></div>}
      </div>
    </EdgeLabelRenderer>
  </>;
});

/** Data flowing from a source into a concept; the chip in the middle is the mapping step. */
const FeedEdge = memo(function FeedEdge({ id,sourceX,sourceY,targetX,targetY,sourcePosition,targetPosition,selected,data,markerEnd }: EdgeProps) {
  const { t } = useModuleTranslation('semantic-model');
  const parallel = Boolean(data?.parallel);
  const [path,labelX,labelY] = getBezierPath({ sourceX,sourceY,sourcePosition,targetX,targetY,targetPosition,curvature:parallel?0.15:0.25 });
  const feed = data?.feed as DesignerFeed|undefined;
  if (!feed) return null;
  const label = feed.step==='typed' ? t('designer.step.typed') : feed.step==='extract' ? t('designer.step.extract') : feed.step==='derived' ? t('designer.step.derived') : t('designer.step.map',{mapped:feed.mapped,total:feed.total});
  return <>
    <BaseEdge id={id} path={path} markerEnd={markerEnd} style={{strokeWidth:selected?4:2.75,strokeDasharray:'1 8',strokeLinecap:'round',stroke:selected?EDGE_COLOR_SELECTED:DATA_EDGE_COLOR}} />
    <EdgeLabelRenderer>
      <div style={{transform:`translate(-50%, -50%) translate(${labelX}px, ${labelY-(parallel?16:0)}px)`}} className='nodrag nopan group pointer-events-auto absolute cursor-pointer p-2' onClick={()=>(data?.onOpen as ((feed:DesignerFeed)=>void)|undefined)?.(feed)}>
        {Array.isArray(data?.checkIssues)&&data.checkIssues.length>0&&<CheckBadge issues={data.checkIssues as ModelCheckIssue[]} onOpen={data.onCheckIssue as ((issue:ModelCheckIssue)=>void)|undefined} className='absolute -left-3 -top-2 z-20' />}
        {feed.mapping&&typeof data?.onRemove==='function'&&<HoverDelete visible={selected} label={t('designer.delete.feed')} className='-right-3 -top-2' onDelete={()=>(data.onRemove as (feed:DesignerFeed)=>void)(feed)} />}
        <span className={cn('rounded-full border bg-background px-2 py-0.5 text-[11px] font-medium shadow-sm',TONE_CLASS[feed.tone],selected&&'border-primary')}>{label}</span>
      </div>
    </EdgeLabelRenderer>
  </>;
});

const edgeTypes = { relation:RelationEdge, feed:FeedEdge };

export function SemanticModelCanvas({ sourceMappings,derivedSources,onOpenDerived,identityRules,recordCounts,mappingHealth,canEdit,onConnectRequest,onDataConnectRequest,knowledge,onOpenKnowledge,onMapStructuredDrop,onOpenSource,onPaneDrop,onAddFeed,onSwitchSource,onRemoveSource,onToggleKey,sourcePositions,onMoveSource,onBrowseRecords,onOpenManualTable,onPaneClick,refreshingConcepts,checkIssues,onOpenCheckIssue }: Readonly<{ sourceMappings?:ConceptSourceMapping[];
  /** Unique fields chosen on the concept itself, so its key badge shows before any source is mapped. */
  identityRules?:{conceptId:string;fields:string[]}[];
  /** Concepts made from another concept's records; each draws a line from that concept. */
  derivedSources?:DerivedSource[];onOpenDerived?:(derived:DerivedSource)=>void;
  /** Records per concept from the last Run; manual table rows are counted until a Run has happened. */
  recordCounts?:Record<string,number>;mappingHealth?:MappingHealthItem[];canEdit:boolean;onConnectRequest:(connection:{sourceId:string;targetId:string})=>void;onDataConnectRequest?:(connection:{sourceId:string;targetId:string})=>void;knowledge:KnowledgeLinkingController;onOpenKnowledge:(nodeId:string)=>void;onMapStructuredDrop?:(resource:Extract<KnowledgeResource,{kind:'document'}>,nodeId:string)=>void;
  /** A source box or its line was clicked; the mapping is set when a specific line was chosen. */
  onOpenSource?:(source:DesignerSource,mapping?:ConceptSourceMapping)=>void;
  /** A document from the knowledge panel was dropped on empty canvas, not on a concept. */
  onPaneDrop?:(resource:KnowledgeResource)=>void;
  /** A click on the empty canvas, after the selection is cleared. */
  onPaneClick?:()=>void;
  /** The + on a source: map the same file onto another concept. */
  onAddFeed?:(source:DesignerSource)=>void;
  /** Reads another workspace, document or spreadsheet with the source's mappings, in place. */
  onSwitchSource?:(source:DesignerSource)=>void;
  /** Stop feeding concepts from a source, or from one of its lines when the mapping is given. */
  onRemoveSource?:(source:DesignerSource,mapping?:ConceptSourceMapping)=>void;
  /** Make a field part of what makes a concept's records unique, or stop it being. */
  onToggleKey?:(conceptId:string,field:string)=>void;
  /** Where source and manual table boxes were moved to; the others are laid out automatically. */
  sourcePositions?:Record<string,{x:number;y:number}>;
  onMoveSource?:(id:string,position:{x:number;y:number})=>void;
  /** Open the table of a concept's records under the canvas. */
  onBrowseRecords?:(conceptId:string)=>void;
  /** Open the grid where a concept's rows are typed or pasted by hand. */
  onOpenManualTable?:(conceptId:string)=>void;
  /** Concepts a running job refreshes: 'all' for a whole-model run, none when nothing runs. */
  refreshingConcepts?:'all'|string[];
  /** What the model check found; shown as badges on the concepts, relationships and source links it names. */
  checkIssues?:ModelCheckIssue[];
  /** Opens the editor where a check issue is fixed. */
  onOpenCheckIssue?:(issue:ModelCheckIssue)=>void }>) {
  const { t } = useModuleTranslation('semantic-model');
  const isMobile = useIsMobile();
  const graph = useSemanticModelEditorStore((state)=>state.graph);
  const mode = useSemanticModelEditorStore((state)=>state.mode);
  const selectedId = useSemanticModelEditorStore((state)=>state.selectedId);
  const select = useSemanticModelEditorStore((state)=>state.select);
  const focus = useSemanticModelEditorStore((state)=>state.focus);
  const commit = useSemanticModelEditorStore((state)=>state.commit);
  const commitBatch = useSemanticModelEditorStore((state)=>state.commitBatch);
  const flowRef = useRef<ReactFlowInstance<Node<BusinessNodeData>,Edge>|null>(null);
  const [quickConcept,setQuickConcept] = useState<{id:string;sourceId:string;position:{x:number;y:number}}|null>(null);
  const [recordOptions,setRecordOptions] = useState<CompatibleRecordRelation[]>([]);
  const [edgeView,setEdgeView] = useState<'relationships'|'data'|'both'>('both');
  const [dropNodeId,setDropNodeId] = useState<string|null>(null);
  // Where nodes are while being dragged; committed to the model only when the drag ends.
  const [dragPositions,setDragPositions] = useState<Record<string,{x:number;y:number}>>({});
  // Sizes React Flow measured. Handed back on every node so a rebuilt node is not treated as new:
  // unmeasured nodes are hidden until measured, which made nodes blink and swallow clicks.
  const [measured,setMeasured] = useState<Record<string,{width:number;height:number}>>({});
  const deleteConcept = (nodeId:string) => {
    const current = useSemanticModelEditorStore.getState().graph;
    if (!current) return;
    const label = current.nodes.find((node)=>node.id===nodeId)?.label ?? '';
    const deletion = conceptDeletion(current,nodeId);
    commitBatch(deletion.operations,deletion.update);
    if (useSemanticModelEditorStore.getState().selectedId===nodeId) select(null);
    announceUndoable(t('designer.delete.conceptDone',{name:label}),t('action.undo'));
  };
  // A manual table's rows are part of the model, so removing them is an ordinary edit that Undo brings back.
  const removeManualTable = (source:DesignerSource) => {
    const current = useSemanticModelEditorStore.getState().graph;
    if (!current) return;
    const deletion = manualTableDeletion(current,source.id.slice('typed:'.length));
    if (!deletion.count) return;
    commitBatch(deletion.operations,deletion.update);
    if (useSemanticModelEditorStore.getState().selectedId===source.id) select(null);
    announceUndoable(t(deletion.count===1?'designer.delete.typedDone_one':'designer.delete.typedDone_other',{count:deletion.count}),t('action.undo'));
  };
  const renameConcept = (nodeId:string,label:string) => {
    const changes = {label,key:businessKey(label)};
    commit({type:'node_type.update',id:nodeId,changes},(current)=>({...current,nodes:current.nodes.map((node)=>node.id===nodeId?{...node,...changes}:node)}));
  };
  const setCardinality = (relationId:string,cardinality:SemanticRelationType['cardinality']) =>
    commit({type:'relation_type.update',id:relationId,changes:{cardinality}},(current)=>({...current,relations:current.relations.map((relation)=>relation.id===relationId?{...relation,cardinality}:relation)}));
  const openDetails = (id:string) => select(id,{details:true});
  const checkIndex = useMemo(()=>indexModelCheck(checkIssues),[checkIssues]);
  const keyFieldsByConcept = useMemo(()=>Object.fromEntries((identityRules??[]).map((rule)=>[rule.conceptId,rule.fields])),[identityRules]);
  const deleteRelation = (relationId:string) => {
    const current = useSemanticModelEditorStore.getState().graph;
    if (!current) return;
    const label = current.relations.find((relation)=>relation.id===relationId)?.label ?? '';
    const deletion = relationDeletion(current,relationId);
    commitBatch(deletion.operations,deletion.update);
    if (useSemanticModelEditorStore.getState().selectedId===relationId) select(null);
    announceUndoable(t('designer.delete.relationDone',{name:label}),t('action.undo'));
  };

  useEffect(() => {
    if (!quickConcept) return;
    const timer = window.setTimeout(() => void flowRef.current?.fitView({nodes:[{id:quickConcept.sourceId},{id:quickConcept.id}],padding:0.3,maxZoom:1,duration:200}),0);
    return () => window.clearTimeout(timer);
  },[quickConcept?.id]);
  const focusRequest = useSemanticModelEditorStore((state)=>state.focusRequest);
  const detailsOpen = useSemanticModelEditorStore((state)=>state.detailsOpen);
  const canvasRef = useRef<HTMLDivElement>(null);
  // When the records table opens or is resized, the canvas gets shorter: fit the model into what is left
  // so no box ends up hidden under the table.
  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return;
    let height = element.getBoundingClientRect().height;
    let timer = 0;
    const observer = new ResizeObserver(([entry]) => {
      const next = entry.contentRect.height;
      if (Math.abs(next-height)<40) return;
      height = next;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void flowRef.current?.fitView({padding:0.15,minZoom:0.25,maxZoom:1,duration:250}),150);
    });
    observer.observe(element);
    return () => { observer.disconnect(); window.clearTimeout(timer); };
  },[]);
  // A side panel opened over the canvas must not hide what was just picked: slide the canvas so the
  // selected box sits in the part that stays visible.
  useEffect(() => {
    if (!selectedId||!detailsOpen) return;
    const timer = window.setTimeout(() => {
      const instance = flowRef.current;
      const node = instance?.getNode(selectedId);
      const bounds = canvasRef.current?.getBoundingClientRect();
      if (!instance||!node||!bounds) return;
      const cover = [...document.querySelectorAll('main aside')].map((panel)=>panel.getBoundingClientRect())
        .filter((rect)=>rect.width>0&&rect.left>bounds.left&&rect.left<bounds.right).reduce((left,rect)=>Math.min(left,rect.left),bounds.right);
      const {zoom} = instance.getViewport();
      const topLeft = instance.flowToScreenPosition(node.position);
      const right = topLeft.x+(node.measured?.width??160)*zoom;
      // The quick-action bar above a box is wider than the box, so keep room for it on both sides.
      const margin = 96;
      const shift = right>cover-margin ? cover-margin-right : topLeft.x<bounds.left+margin ? bounds.left+margin-topLeft.x : 0;
      if (Math.abs(shift)<1) return;
      const viewport = instance.getViewport();
      void instance.setViewport({...viewport,x:viewport.x+shift},{duration:300});
    },120);
    return () => window.clearTimeout(timer);
  },[selectedId,detailsOpen]);
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
    // Close the side panel so the new step's name box is not hidden behind it.
    select(null);
    setQuickConcept({id:crypto.randomUUID(),sourceId,position:nextLinkedConceptPosition(source.position,graph.nodes)});
  };
  const submitQuickConcept = (label:string) => {
    if (!graph || !quickConcept || !label.trim()) return;
    const node:SemanticNodeType = {id:quickConcept.id,key:uniqueBusinessKey(label,graph.nodes.map((item)=>item.key)),label:label.trim(),description:'',category:'business_object',recordPolicy:'optional',systemKey:null,aliases:[],attributes:[],position:quickConcept.position};
    const relation:SemanticRelationType = {id:crypto.randomUUID(),key:uniqueBusinessKey(t('relation.defaultWording'),graph.relations.map((item)=>item.key)),label:t('relation.defaultWording'),inverseLabel:'',description:'',sourceNodeTypeId:quickConcept.sourceId,targetNodeTypeId:node.id,cardinality:'many_to_many',traversable:true,filterable:true,attributes:[]};
    commitBatch([{type:'node_type.create',entity:node},{type:'relation_type.create',entity:relation}],(current)=>({...current,nodes:[...current.nodes,node],relations:[...current.relations,relation]}));
    setQuickConcept(null);
    // Carry on where the + left off: the new concept's details open in the side panel.
    focus(node.id);
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
    return 'valid';
  };
  const dropKnowledge = (nodeId:string,event:DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const resource=knowledge.draggedResource??parseKnowledgeResource(event.dataTransfer.getData(KNOWLEDGE_DRAG_TYPE));
    setDropNodeId(null);
    knowledge.setDraggedResource(null);
    if (!resource||knowledge.isBusy) return;
    // Only a file that can be read feeds a concept; anything else would do nothing when data is generated.
    if (resource.kind==='document'&&resource.mappable&&onMapStructuredDrop) onMapStructuredDrop(resource,nodeId);
    else showWarning(t('knowledge.notReadableDrop',{name:resource.name}));
  };

  // What each concept can say about its data, so a card is readable without opening the details panel.
  const summaries = useMemo<Record<string,ConceptDataSummary>>(()=>{
    const byConcept:Record<string,ConceptDataSummary> = {};
    for (const node of graph?.nodes??[]) byConcept[node.id]={sources:0,notReady:0,identityFields:[],documentNames:[],records:0};
    for (const record of graph?.records??[]) if (byConcept[record.nodeTypeId]) byConcept[record.nodeTypeId].records+=1;
    for (const [conceptId,count] of Object.entries(recordCounts??{})) if (byConcept[conceptId]) byConcept[conceptId].records=count;
    for (const rule of identityRules??[]) {
      const summary = byConcept[rule.conceptId];
      if (summary) for (const field of rule.fields) if (!summary.identityFields.includes(field)) summary.identityFields.push(field);
    }
    for (const derived of derivedSources??[]) if (byConcept[derived.conceptId]) byConcept[derived.conceptId].sources+=1;
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
  },[graph?.nodes,graph?.records,identityRules,recordCounts,sourceMappings,derivedSources,mappingHealth]);

  const flow = useMemo(()=>graph&&mode!=='records'?designerFlow(graph,sourceMappings,mappingHealth,sourcePositions,derivedSources):{sources:[],feeds:[]},[graph,mode,sourceMappings,mappingHealth,sourcePositions,derivedSources]);
  // Delete or Backspace removes what is selected on the canvas; Undo brings it back.
  const removeSelectedRef = useRef<()=>boolean>(()=>false);
  removeSelectedRef.current = () => {
    const state = useSemanticModelEditorStore.getState();
    const id = state.selectedId;
    if (!canEdit||!id||!state.graph||mode==='records') return false;
    if (state.graph.nodes.some((node)=>node.id===id&&!node.systemKey)) { deleteConcept(id); return true; }
    if (state.graph.relations.some((relation)=>relation.id===id)) { deleteRelation(id); return true; }
    const source = flow.sources.find((item)=>item.id===id);
    if (source?.kind==='typed') { removeManualTable(source); return true; }
    if (source&&onRemoveSource) { onRemoveSource(source); return true; }
    return false;
  };
  useEffect(() => {
    const keyboard = (event:globalThis.KeyboardEvent) => {
      if ((event.key!=='Delete'&&event.key!=='Backspace')||event.ctrlKey||event.metaKey||event.altKey||isTextEntry(event.target)) return;
      if (event.target instanceof HTMLElement&&event.target.closest('[role="dialog"]')) return;
      if (removeSelectedRef.current()) event.preventDefault();
    };
    window.addEventListener('keydown',keyboard);
    return () => window.removeEventListener('keydown',keyboard);
  },[]);

  // Ctrl/Cmd+C copies the selected concept or source; Ctrl/Cmd+V pastes a concept as a new one, and a source onto the
  // selected concept (or onto empty canvas, where the drawer asks which concept it feeds).
  const clipboardRef = useRef<(key:'c'|'v')=>boolean>(()=>false);
  clipboardRef.current = (key) => {
    const state = useSemanticModelEditorStore.getState();
    if (!state.graph||mode==='records') return false;
    if (key==='c') {
      const id = state.selectedId;
      const concept = state.graph.nodes.find((node)=>node.id===id&&!node.systemKey);
      const source = flow.sources.find((item)=>item.id===id);
      if (!concept&&!source) return false;
      const copied = concept?copyConcept(concept):copySource(source!);
      if (!copied){showWarning(t('designer.clipboard.notCopyable'));return true;}
      writeCanvasClipboard(copied);
      showSuccess(t('designer.clipboard.copied',{name:concept?.label??(copied.kind==='source'?copied.resource.name:'')}));
      return true;
    }
    const copied = readCanvasClipboard();
    if (!canEdit||!copied) return false;
    if (copied.kind==='concept') {
      const node = pasteConcept(copied.concept,state.graph.nodes,t('designer.clipboard.copyName',{name:copied.concept.label}));
      commit({type:'node_type.create',entity:node},(current)=>({...current,nodes:[...current.nodes,node]}));
      focus(node.id);
      showSuccess(t('designer.clipboard.pasted',{name:node.label}));
      return true;
    }
    const target = state.graph.nodes.find((node)=>node.id===state.selectedId);
    if (target&&onMapStructuredDrop) onMapStructuredDrop(copied.resource,target.id);
    else if (onPaneDrop) onPaneDrop(copied.resource);
    else return false;
    return true;
  };
  useEffect(() => {
    const keyboard = (event:globalThis.KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((key!=='c'&&key!=='v')||!(event.ctrlKey||event.metaKey)||event.altKey||event.shiftKey||isTextEntry(event.target)) return;
      if (event.target instanceof HTMLElement&&event.target.closest('[role="dialog"]')) return;
      // Copying text selected on the page stays the browser's.
      if (key==='c'&&window.getSelection()?.toString()) return;
      if (clipboardRef.current(key)) event.preventDefault();
    };
    window.addEventListener('keydown',keyboard);
    return () => window.removeEventListener('keydown',keyboard);
  },[]);

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
    const modelNodes = graph.nodes.map((node)=>({id:node.id,type:'business',position:node.position,draggable:canEdit&&!node.systemKey,data:{nodeId:node.id,label:node.label,description:node.description,category:node.category,protected:Boolean(node.systemKey),recordPolicy:node.recordPolicy,attributes:node.attributes,summary:summaries[node.id],checkIssues:checkIndex.concepts[node.id],onCheckIssue:onOpenCheckIssue,quickActions:canEdit,onQuickConcept:beginQuickConcept,onOpenKnowledge,knowledgeCounts:knowledge.countsByNode[node.id]??{workspaces:0,documents:0},dropState:dropStateFor(node.id),onKnowledgeDragEnter:canEdit&&knowledge.draggedResource?setDropNodeId:undefined,onKnowledgeDragLeave:canEdit?((nodeId:string)=>setDropNodeId((current)=>current===nodeId?null:current)):undefined,onKnowledgeDrop:canEdit?dropKnowledge:undefined,onDelete:canEdit&&!node.systemKey?deleteConcept:undefined,keyFields:keyFieldsByConcept[node.id]??[],onToggleKey:canEdit?onToggleKey:undefined,onRename:canEdit&&!node.systemKey?renameConcept:undefined,onDetails:openDetails,onBrowseRecords:node.systemKey?undefined:onBrowseRecords,onOpenManualTable:node.systemKey||!canEdit?undefined:onOpenManualTable,refreshing:!node.systemKey&&(refreshingConcepts==='all'||Boolean(refreshingConcepts?.includes(node.id)))}}));
    const sourceNodes = flow.sources.map((source)=>({id:source.id,type:'source',position:source.position,draggable:canEdit&&Boolean(onMoveSource),connectable:false,data:{source,onAddFeed:canEdit?onAddFeed:undefined,onSwitch:canEdit?onSwitchSource:undefined,onRemove:!canEdit?undefined:source.kind==='typed'?removeManualTable:onRemoveSource?(item:DesignerSource)=>onRemoveSource(item):undefined,onOpen:onOpenSource?(item:DesignerSource)=>onOpenSource(item):undefined}}));
    const withSources = [...sourceNodes,...modelNodes] as unknown as Node<BusinessNodeData>[];
    if (!quickConcept) return withSources;
    return [...withSources,{id:quickConcept.id,type:'business',position:quickConcept.position,draggable:false,selectable:false,focusable:false,data:{nodeId:quickConcept.id,label:'',description:'',category:'business_object',protected:false,draft:true,onDraftSubmit:submitQuickConcept,onDraftCancel:()=>setQuickConcept(null)}}];
  },[canEdit,dropNodeId,flow,onAddFeed,onSwitchSource,onRemoveSource,onOpenSource,onMoveSource,onToggleKey,onBrowseRecords,onOpenManualTable,keyFieldsByConcept,graph,knowledge.bindings,knowledge.countsByNode,knowledge.draggedResource,knowledge.isBusy,mode,onOpenKnowledge,quickConcept,summaries,checkIndex,onOpenCheckIssue]);
  // Stage 2 — apply selection cheaply; reuses same object refs for unaffected nodes so memo on BusinessNode holds.
  const nodes = useMemo<Node<BusinessNodeData>[]>(()=>
    baseNodes.map((node)=>{
      const dragged = dragPositions[node.id];
      return {...node,selected:node.id===selectedId,measured:measured[node.id],...(dragged?{position:dragged}:{})};
    })
  ,[baseNodes,dragPositions,measured,selectedId]);
  const followDrag = (changes:NodeChange<Node<BusinessNodeData>>[]) => {
    const moves = changes.filter((change)=>change.type==='position'&&change.position&&change.dragging) as Array<{id:string;position:{x:number;y:number}}>;
    if (moves.length) setDragPositions((current)=>({...current,...Object.fromEntries(moves.map((move)=>[move.id,move.position]))}));
    const sizes = changes.filter((change)=>change.type==='dimensions'&&change.dimensions) as Array<{id:string;dimensions:{width:number;height:number}}>;
    if (sizes.length) setMeasured((current)=>{
      const changed = sizes.filter((size)=>current[size.id]?.width!==size.dimensions.width||current[size.id]?.height!==size.dimensions.height);
      return changed.length ? {...current,...Object.fromEntries(changed.map((size)=>[size.id,size.dimensions]))} : current;
    });
  };
  const edges = useMemo<Edge[]>(()=>{
    if (!graph) return [];
    const relationMarker = {type:MarkerType.ArrowClosed,width:12,height:12,color:EDGE_COLOR};
    const dataMarker = {type:MarkerType.ArrowClosed,width:14,height:14,color:DATA_EDGE_COLOR};
    if (mode==='records') return graph.recordRelations.map((relation)=>({id:relation.id,source:relation.sourceRecordId,target:relation.targetRecordId,type:'relation',markerEnd:relationMarker,data:{label:graph.relations.find((type)=>type.id===relation.relationTypeId)?.label??''}}));
    const openFeed = (feed:DesignerFeed)=>{if(feed.derived){onOpenDerived?.(feed.derived);return;}const source=flow.sources.find((item)=>item.id===feed.sourceId);if(source)onOpenSource?.(source,feed.mapping);};
    const removeFeed = canEdit&&onRemoveSource ? (feed:DesignerFeed)=>{const source=flow.sources.find((item)=>item.id===feed.sourceId);if(source)onRemoveSource(source,feed.mapping);} : undefined;
    const pairKey = (left:string,right:string) => [left,right].sort().join('|');
    const relationPairs = new Set(graph.relations.map((relation)=>pairKey(relation.sourceNodeTypeId,relation.targetNodeTypeId)));
    const feedPairs = new Set(flow.feeds.filter((feed)=>feed.derived).map((feed)=>pairKey(feed.sourceId,feed.conceptId)));
    const feedEdges:Edge[] = flow.feeds.map((feed)=>({id:feed.id,source:feed.sourceId,target:feed.conceptId,sourceHandle:DATA_SOURCE_HANDLE,targetHandle:DATA_TARGET_HANDLE,type:'feed',markerEnd:dataMarker,data:{feed,parallel:Boolean(feed.derived&&relationPairs.has(pairKey(feed.sourceId,feed.conceptId))),onRemove:removeFeed,onOpen:openFeed,checkIssues:[...(feed.mapping?checkIndex.mappings[feed.mapping.id]??[]:[]),...(feed.derived?checkIndex.sources[feed.derived.id]??[]:[])],onCheckIssue:onOpenCheckIssue}}));
    const modelEdges:Edge[] = [...feedEdges,...graph.relations.map((relation)=>({id:relation.id,source:relation.sourceNodeTypeId,target:relation.targetNodeTypeId,sourceHandle:RELATION_SOURCE_HANDLE,targetHandle:RELATION_TARGET_HANDLE,type:'relation',animated:false,markerEnd:relationMarker,data:{label:relation.label,cardinality:relation.cardinality,parallel:feedPairs.has(pairKey(relation.sourceNodeTypeId,relation.targetNodeTypeId)),onDelete:canEdit?deleteRelation:undefined,deleteLabel:t('designer.delete.relation',{name:relation.label}),onCardinality:canEdit?setCardinality:undefined,onDetails:openDetails,checkIssues:checkIndex.relations[relation.id],onCheckIssue:onOpenCheckIssue}}))];
    return quickConcept?[...modelEdges,{id:`quick-${quickConcept.id}`,source:quickConcept.sourceId,target:quickConcept.id,label:t('relation.defaultWording'),animated:true,style:{strokeDasharray:'5 5',stroke:EDGE_COLOR_SELECTED,strokeWidth:2}}]:modelEdges;
  },[canEdit,checkIndex,flow,graph,mode,onOpenCheckIssue,onOpenSource,onOpenDerived,onRemoveSource,quickConcept,t]);

  // Selection lives in the editor store (a click on a line's label selects it too), so lines follow it.
  const shownEdges = useMemo(()=>edges.filter((edge)=>mode==='records'||edgeView==='both'||(edgeView==='data'&&edge.type==='feed')||(edgeView==='relationships'&&edge.type!=='feed'))
    .map((edge)=>(edge.id===selectedId)===Boolean(edge.selected)?edge:{...edge,selected:edge.id===selectedId}),[edgeView,edges,mode,selectedId]);
  const connectionChannel = (connection:Connection|Edge):'record'|'relationship'|'data'|null => {
    if (mode==='records') return 'record';
    if (connection.sourceHandle===RELATION_SOURCE_HANDLE&&connection.targetHandle===RELATION_TARGET_HANDLE) return 'relationship';
    if (connection.sourceHandle!==DATA_SOURCE_HANDLE||connection.targetHandle!==DATA_TARGET_HANDLE||!graph) return null;
    const source = graph.nodes.find((node)=>node.id===connection.source);
    const target = graph.nodes.find((node)=>node.id===connection.target);
    if (!source||!target) return null;
    if (derivedSources?.some((derived)=>derived.sourceConceptId===source.id&&derived.conceptId===target.id)) return 'data';
    if (source.id===target.id||source.systemKey||target.systemKey||source.attributes.length===0) return null;
    return closesDerivationCycle(derivedSources??[],source.id,target.id)?null:'data';
  };
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
  return <div ref={canvasRef} className='relative h-full w-full' onDragOver={paneDragOver} onDrop={paneDrop}>
    {mode!=='records'&&<div className='absolute right-3 top-3 z-10 flex flex-col items-end gap-1.5 rounded-xl border bg-background/95 p-2 shadow-sm'>
      <div className='flex rounded-lg bg-muted p-0.5' role='group' aria-label={t('canvasConnections.viewLabel')}>
        {(['relationships','data','both'] as const).map((view)=><button key={view} type='button' aria-pressed={edgeView===view} onClick={()=>setEdgeView(view)} className={cn('rounded-md px-2 py-1 text-[10px] font-medium transition',edgeView===view?'bg-background text-foreground shadow-sm':'text-muted-foreground hover:text-foreground')}>{t(`canvasConnections.${view}`)}</button>)}
      </div>
      <div className='flex items-center gap-3 px-1 text-[10px] text-muted-foreground' aria-label={t('canvasConnections.legend')}>
        <span className='flex items-center gap-1'><span className='h-0 w-5 border-t-2 border-foreground/55' aria-hidden />{t('canvasConnections.relationship')}</span>
        <span className='flex items-center gap-1'><span className='h-0 w-5 border-t-[3px] border-dotted border-teal-600' aria-hidden />{t('canvasConnections.dataFlow')}</span>
      </div>
    </div>}
    <ReactFlow nodes={nodes} edges={shownEdges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} fitView fitViewOptions={{padding:0.15,minZoom:isMobile?1:0.25,maxZoom:1}} minZoom={isMobile?1:0.25} maxZoom={1.6} proOptions={{hideAttribution:true}} deleteKeyCode={null} nodesConnectable={canEdit} nodesDraggable={canEdit} elevateNodesOnSelect={false} zoomOnDoubleClick={false} onInit={(instance)=>{flowRef.current=instance;}}
      isValidConnection={(connection)=>connectionChannel(connection)!==null}
      onConnect={(connection:Connection)=>{
        if (!connection.source||!connection.target||!graph) return;
        const channel = connectionChannel(connection);
        if (channel!=='record'){
          if(channel==='relationship')onConnectRequest({sourceId:connection.source,targetId:connection.target});
          else if(channel==='data')onDataConnectRequest?.({sourceId:connection.source,targetId:connection.target});
          return;
        }
        const options = compatibleRecordRelations(graph,connection.source,connection.target).filter((option)=>!graph.recordRelations.some((existing)=>existing.relationTypeId===option.relation.id&&existing.sourceRecordId===option.sourceRecordId&&existing.targetRecordId===option.targetRecordId));
        if (!options.length){showWarning(t('records.noCompatibleRelationship'));return;}
        if (options.length===1){addRecordRelation(options[0]);return;}
        setRecordOptions(options);
      }}
      nodeDragThreshold={5}
      // A click opens the item's details in the side panel, replacing whatever panel was open.
      onNodeClick={(event,node)=>{if((event.target as Element).closest('.nodrag')||node.id===quickConcept?.id)return;select(node.id,{details:false});}}
      onNodeDoubleClick={(event,node)=>{if((event.target as Element).closest('.nodrag')||node.id===quickConcept?.id)return;if(isDesignerSourceId(node.id)){const source=flow.sources.find((item)=>item.id===node.id);if(source)onOpenSource?.(source);return;}openDetails(node.id);}}
      onEdgeClick={(_,edge)=>{const feed=flow.feeds.find((item)=>item.id===edge.id);if(feed?.derived){select(null);onOpenDerived?.(feed.derived);return;}if(feed){select(null);const source=flow.sources.find((item)=>item.id===feed.sourceId);if(source)onOpenSource?.(source,feed.mapping);return;}select(edge.id,{details:true});}} onPaneClick={()=>{select(null);onPaneClick?.();}}
      onNodesChange={followDrag}
      onNodeDragStop={(_,node)=>{setDragPositions((current)=>{const next={...current};delete next[node.id];return next;});if(isDesignerSourceId(node.id)){onMoveSource?.(node.id,node.position);return;}if(!graph||node.id===quickConcept?.id)return;const isRecord=mode==='records';if(!isRecord&&graph.nodes.some((item)=>item.id===node.id&&item.systemKey))return;commit({type:'layout.update',positions:[{id:node.id,position:node.position}]},(current)=>isRecord?{...current,records:current.records.map((item)=>item.id===node.id?{...item,position:node.position}:item)}:{...current,nodes:current.nodes.map((item)=>item.id===node.id?{...item,position:node.position}:item)});}}
    ><Background gap={24} size={1} color='hsl(var(--muted-foreground) / 0.18)' /><Controls showInteractive={false} /></ReactFlow>
    <Dialog open={recordOptions.length>0} onOpenChange={(open)=>{if(!open)setRecordOptions([]);}}><DialogContent><DialogHeader><DialogTitle>{t('records.chooseRelationship')}</DialogTitle><DialogDescription>{t('records.chooseRelationshipHelp')}</DialogDescription></DialogHeader><div className='grid gap-2'>{recordOptions.map((option)=><Button key={option.relation.id} variant='outline' className='h-auto justify-start py-3 text-start' onClick={()=>addRecordRelation(option)}>{option.relation.label}</Button>)}</div></DialogContent></Dialog>
  </div>;
}
