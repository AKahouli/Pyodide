import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { ChevronDown, ChevronRight, FileText, Folder, GripVertical, Loader2, Search, Share2, Table2, Trash2, Warehouse, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { useModuleTranslation } from '@/modules/localization';
import { getDocument, getDocuments, getFolderContents, getSharedWorkspaces, getWorkspaces } from '@/modules/workspace/api';
import type { Workspace, WorkspaceDocument } from '@/modules/workspace/types';
import { KNOWLEDGE_DRAG_TYPE, type KnowledgeLinkingController, type KnowledgeResource } from '../../hooks/use-knowledge-linking';
import { useSemanticModelEditorStore } from '../../store';

export const STRUCTURED_DOCUMENT_MIME_PREFIXES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
];

export function isStructuredDocument(mimeType:string): boolean {
  return typeof mimeType==='string'&&STRUCTURED_DOCUMENT_MIME_PREFIXES.some((prefix)=>mimeType.startsWith(prefix));
}

const MAPPABLE_DOCUMENT_MIME_TYPES = new Set(['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document']);

export function isMappableDocument(mimeType:string): boolean {
  return isStructuredDocument(mimeType)||MAPPABLE_DOCUMENT_MIME_TYPES.has(mimeType);
}

export function KnowledgePanel({ canEdit,knowledge,targetNodeId,onClose,onMapData }: Readonly<{ canEdit:boolean;knowledge:KnowledgeLinkingController;targetNodeId:string|null;onClose?:()=>void;onMapData?:(resource:Extract<KnowledgeResource,{kind:'document'}>)=>void }>) {
  const { t } = useModuleTranslation('semantic-model');
  const graph = useSemanticModelEditorStore((state)=>state.graph);
  const [available,setAvailable] = useState<Workspace[]>([]);
  const [sharedAvailable,setSharedAvailable] = useState<Workspace[]>([]);
  const [documents,setDocuments] = useState<Record<string,{items:WorkspaceDocument[];page:number;totalPages:number}>>({});
  const [boundDocumentNames,setBoundDocumentNames] = useState<Record<string,string>>({});
  const [expanded,setExpanded] = useState<Set<string>>(new Set());
  const [expandedFolders,setExpandedFolders] = useState<Set<string>>(new Set());
  const [loadingDocuments,setLoadingDocuments] = useState<Set<string>>(new Set());
  const [search,setSearch] = useState('');
  const [workspacePage,setWorkspacePage] = useState(1);
  const [workspaceTotalPages,setWorkspaceTotalPages] = useState(1);
  const [loadingWorkspaces,setLoadingWorkspaces] = useState(false);
  const [loadFailed,setLoadFailed] = useState(false);

  useEffect(()=>{
    let active=true;
    setLoadingWorkspaces(true);
    const timer=window.setTimeout(()=>void Promise.all([
      getWorkspaces({limit:50,page:workspacePage,search:search.trim()||undefined}),
      workspacePage===1?getSharedWorkspaces({limit:100,search:search.trim()||undefined}).catch((err)=>{console.warn('[KnowledgePanel] getSharedWorkspaces failed:',err);return {workspaces:[],pagination:{totalPages:1,total:0,page:1,limit:100}};}):{workspaces:[],pagination:{totalPages:1,total:0,page:1,limit:100}},
    ]).then(([ownResult,sharedResult])=>{
      if(!active)return;
      const ownIds=new Set(ownResult.workspaces.map((w)=>w.id));
      setAvailable((current)=>workspacePage===1?ownResult.workspaces:[...current,...ownResult.workspaces.filter((w)=>!current.some((item)=>item.id===w.id))]);
      setSharedAvailable(sharedResult.workspaces.filter((w)=>!ownIds.has(w.id)) as unknown as Workspace[]);
      setWorkspaceTotalPages(ownResult.pagination.totalPages);
      setLoadFailed(false);
    }).catch(()=>{if(active){if(workspacePage===1){setAvailable([]);setSharedAvailable([]);}setLoadFailed(true);}}).finally(()=>{if(active)setLoadingWorkspaces(false);}),workspacePage===1?250:0);
    return ()=>{active=false;window.clearTimeout(timer);};
  },[search,workspacePage]);

  const workspaceNames = useMemo(()=>Object.fromEntries([...available,...sharedAvailable].map((workspace)=>[workspace.id,workspace.name])),[available,sharedAvailable]);
  const targetNode = graph?.nodes.find((node)=>node.id===targetNodeId)??null;
  const targetBindings = knowledge.bindings.filter((binding)=>binding.enabled&&binding.targetKind==='node_type'&&binding.targetId===targetNodeId);


  useEffect(()=>{
    const workspaceIds=[...new Set(targetBindings.filter((binding)=>binding.resourceKind==='document').map((binding)=>binding.workspaceId))];
    let active=true;
    void Promise.allSettled(targetBindings.filter((binding)=>binding.resourceKind==='document'&&binding.documentId).map(async(binding)=>({key:`${binding.workspaceId}:${binding.documentId}`,name:(await getDocument(binding.workspaceId,binding.documentId!)).originalName}))).then((results)=>{
      if (!active) return;
      setBoundDocumentNames((current)=>({...current,...Object.fromEntries(results.flatMap((result)=>result.status==='fulfilled'?[[result.value.key,result.value.name]]:[]))}));
    });
    return ()=>{active=false;};
  },[knowledge.bindings,targetNodeId]);

  const toggleWorkspace = async(workspaceId:string)=>{
    const next=new Set(expanded);
    if (next.has(workspaceId)){next.delete(workspaceId);setExpanded(next);return;}
    next.add(workspaceId);
    setExpanded(next);
    const key=documentPageKey(workspaceId);
    if (documents[key]||loadingDocuments.has(key)) return;
    await loadDocumentPage(workspaceId,1);
  };

  const loadDocumentPage = async(workspaceId:string,page:number,folderId?:string)=>{
    const key=documentPageKey(workspaceId,folderId);
    setLoadingDocuments((current)=>new Set(current).add(key));
    try {
      const result=folderId?await getFolderContents(workspaceId,folderId,{limit:50,page}):await getDocuments(workspaceId,{limit:50,page});
      const items=result.documents;
      setDocuments((current)=>({...current,[key]:{items:page===1?items:[...(current[key]?.items??[]),...items.filter((document)=>!current[key]?.items.some((item)=>item.id===document.id))],page,totalPages:result.pagination.totalPages}}));
    } catch {
      if (page===1)setDocuments((current)=>({...current,[key]:{items:[],page:1,totalPages:1}}));
    } finally {
      setLoadingDocuments((current)=>{const updated=new Set(current);updated.delete(key);return updated;});
    }
  };

  const toggleFolder = async(workspaceId:string,folderId:string)=>{
    const key=documentPageKey(workspaceId,folderId);
    const next=new Set(expandedFolders);
    if (next.has(key)){next.delete(key);setExpandedFolders(next);return;}
    next.add(key);
    setExpandedFolders(next);
    if (!documents[key]&&!loadingDocuments.has(key)) await loadDocumentPage(workspaceId,1,folderId);
  };

  const beginDrag = (event:DragEvent,resource:KnowledgeResource)=>{
    event.dataTransfer.effectAllowed='copy';
    event.dataTransfer.setData(KNOWLEDGE_DRAG_TYPE,JSON.stringify(resource));
    event.dataTransfer.setData('text/plain',resource.name);
    knowledge.setDraggedResource(resource);
  };

  const closeFromHeaderEdge = (clientX:number,clientY:number,currentTarget:HTMLDivElement) => {
    const bounds=currentTarget.getBoundingClientRect();
    if (onClose&&clientX>=bounds.right-80&&clientY<=bounds.top+80) onClose();
  };

  const renderDocumentPage = (workspaceId:string,folderId?:string,depth=0) => {
    const key=documentPageKey(workspaceId,folderId);
    const page=documents[key];
    if (loadingDocuments.has(key)&&!page?.items.length) return <div className='flex items-center justify-center p-3'><Loader2 className='h-4 w-4 animate-spin text-primary'/></div>;
    if (!page?.items.length) return <p className='p-3 text-center text-xs text-muted-foreground'>{t('knowledge.noDocuments')}</p>;
    return <div className='space-y-1'>{page.items.map((document)=>{
      if (document.isFolder) {
        const childKey=documentPageKey(workspaceId,document.id);
        const open=expandedFolders.has(childKey);
        const name=document.folderName??document.originalName;
        return <div key={document.id}><button type='button' className='flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-xs hover:bg-background' style={{paddingLeft:`${8+depth*12}px`}} onClick={()=>void toggleFolder(workspaceId,document.id)} aria-label={open?t('knowledge.collapseWorkspace',{name}):t('knowledge.expandWorkspace',{name})}>{open?<ChevronDown className='h-4 w-4 shrink-0'/>:<ChevronRight className='h-4 w-4 shrink-0'/>}<Folder className='h-4 w-4 shrink-0 text-primary'/><span className='truncate'>{name}</span></button>{open&&<div className='border-l border-border/60'>{renderDocumentPage(workspaceId,document.id,depth+1)}</div>}</div>;
      }
       const resource:KnowledgeResource={kind:'document',workspaceId,documentId:document.id,name:document.originalName,structured:isStructuredDocument(document.mimeType),mappable:isMappableDocument(document.mimeType),mimeType:document.mimeType,path:document.path};
      return <div key={document.id} role='group' aria-label={t('knowledge.dragDocument',{name:document.originalName})} draggable={canEdit} onDragStart={(event)=>beginDrag(event,resource)} onDragEnd={()=>knowledge.setDraggedResource(null)} className='flex min-h-11 items-center gap-2 rounded-lg px-2 hover:bg-background' style={{paddingLeft:`${8+depth*12}px`}}><FileText className='h-4 w-4 shrink-0 text-muted-foreground'/><span className='min-w-0 flex-1 truncate text-xs'>{document.originalName}</span>{canEdit&&<><GripVertical className='h-3.5 w-3.5 text-muted-foreground'/><LinkMenu resource={resource} targetNodeId={targetNodeId} knowledge={knowledge} onMapData={onMapData}/></>}</div>;
    })}{page.page<page.totalPages&&<Button variant='ghost' className='h-11 w-full text-xs' disabled={loadingDocuments.has(key)} onClick={()=>void loadDocumentPage(workspaceId,page.page+1,folderId)}>{loadingDocuments.has(key)?<Loader2 className='mr-2 h-4 w-4 animate-spin'/>:null}{t('action.loadMore')}</Button>}</div>;
  };

  return <div className='flex h-full min-h-0 flex-col'>
    <div className='shrink-0 border-b p-5' onPointerUp={(event)=>{if(event.pointerType==='touch'){event.preventDefault();event.stopPropagation();if(event.target===event.currentTarget)onClose?.();else closeFromHeaderEdge(event.clientX,event.clientY,event.currentTarget);}}} onClick={(event)=>{if(event.target===event.currentTarget)onClose?.();else closeFromHeaderEdge(event.clientX,event.clientY,event.currentTarget);}}>
      <div className='flex items-start justify-between gap-3'><div><h2 className='font-semibold'>{t('knowledge.title')}</h2><p className='mt-1 text-xs text-muted-foreground'>{targetNode?t('knowledge.dropFor',{name:targetNode.label}):t('knowledge.trayDescription')}</p></div>{onClose&&<Button size='icon' variant='ghost' className='h-11 w-11 shrink-0' onPointerUp={(event)=>{if(event.pointerType==='touch'){event.preventDefault();event.stopPropagation();onClose();}}} onClick={(event)=>{event.stopPropagation();onClose();}} aria-label={t('action.close')}><X className='h-4 w-4' /></Button>}</div>
      <div className='relative mt-4'><Search className='pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground' /><Input className='pl-9' value={search} onChange={(event)=>{setSearch(event.target.value);setWorkspacePage(1);}} placeholder={t('knowledge.search')} aria-label={t('knowledge.search')} /></div>
      {targetNode&&<div className='mt-3 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-xs'><span className='font-medium'>{t('knowledge.target')}</span> {targetNode.label}</div>}
    </div>
    <div className='min-h-0 flex-1 overflow-y-auto p-4'>
      {targetNode&&<section className='mb-5 space-y-2'><p className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>{t('knowledge.linkedSources',{count:targetBindings.length})}</p>{targetBindings.length?targetBindings.map((binding)=><div key={binding.id} className='flex items-center gap-2 rounded-xl border bg-card p-2.5'><div className='rounded-lg bg-muted p-1.5'>{binding.resourceKind==='document'?<FileText className='h-4 w-4'/>:<Warehouse className='h-4 w-4'/>}</div><div className='min-w-0 flex-1'><p className='truncate text-xs font-medium'>{binding.resourceKind==='workspace'?(workspaceNames[binding.workspaceId]??t('knowledge.workspace')):(boundDocumentNames[`${binding.workspaceId}:${binding.documentId}`]??t('knowledge.document'))}</p><p className='truncate text-[10px] text-muted-foreground'>{workspaceNames[binding.workspaceId]??t('knowledge.workspace')}</p></div>{canEdit&&!binding.protected&&<Button size='icon' variant='ghost' className='h-11 w-11 shrink-0' disabled={knowledge.isBusy} onClick={()=>void knowledge.remove(binding.id)} aria-label={t('knowledge.remove')}><Trash2 className='h-4 w-4'/></Button>}</div>):<p className='rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground'>{t('knowledge.noSources')}</p>}</section>}
      <div className='mb-2 flex items-center justify-between'><p className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>{t('knowledge.available')}</p>{canEdit&&<span className='text-[10px] text-muted-foreground'>{t('knowledge.dragHint')}</span>}</div>
      {loadFailed?<p className='rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground'>{t('knowledge.loadError')}</p>:
        <div className='space-y-2'>
          {available.length?available.map((workspace)=>{
            const resource:KnowledgeResource={kind:'workspace',workspaceId:workspace.id,name:workspace.name};
            const open=expanded.has(workspace.id);
            return <div key={workspace.id} className='overflow-hidden rounded-xl border bg-card'>
              <div role='group' aria-label={t('knowledge.dragWorkspace',{name:workspace.name})} draggable={canEdit} onDragStart={(event)=>beginDrag(event,resource)} onDragEnd={()=>knowledge.setDraggedResource(null)} className='flex items-center gap-1 p-2'>
                <Button size='icon' variant='ghost' className='h-11 w-11 shrink-0' onClick={()=>void toggleWorkspace(workspace.id)} aria-label={open?t('knowledge.collapseWorkspace',{name:workspace.name}):t('knowledge.expandWorkspace',{name:workspace.name})}>{open?<ChevronDown className='h-4 w-4'/>:<ChevronRight className='h-4 w-4'/>}</Button>
                <Warehouse className='h-4 w-4 shrink-0 text-primary'/><div className='min-w-0 flex-1 px-1'><p className='truncate text-sm font-medium'>{workspace.name}</p><p className='text-[10px] text-muted-foreground'>{t((workspace.documentCount??0)===1?'knowledge.documentCount_one':'knowledge.documentCount_other',{count:workspace.documentCount??0})}</p></div>{canEdit&&<><GripVertical className='h-4 w-4 text-muted-foreground'/><LinkMenu resource={resource} targetNodeId={targetNodeId} knowledge={knowledge}/></>}
              </div>
              {open&&<div className='border-t bg-muted/20 p-2'>{renderDocumentPage(workspace.id)}</div>}
            </div>;
          }):loadingWorkspaces?null:<p className='rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground'>{t('knowledge.noMatchingSources')}</p>}
          {workspacePage<workspaceTotalPages&&<Button variant='outline' className='h-11 w-full' disabled={loadingWorkspaces} onClick={()=>setWorkspacePage((page)=>page+1)}>{loadingWorkspaces?<Loader2 className='mr-2 h-4 w-4 animate-spin'/>:null}{t('action.loadMore')}</Button>}
          {loadingWorkspaces&&!available.length&&<div className='flex justify-center p-6'><Loader2 className='h-5 w-5 animate-spin text-primary'/></div>}

          {sharedAvailable.length>0&&<>
            <div className='mt-5 mb-3 flex items-center gap-2'>
              <div className='h-px flex-1 bg-border'/>
              <div className='flex items-center gap-1.5 rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1'>
                <Share2 className='h-3 w-3 text-blue-400'/>
                <span className='text-[11px] font-semibold text-blue-400'>{t('knowledge.sharedWithMe')}</span>
                <span className='flex h-4 w-4 items-center justify-center rounded-full bg-blue-500/20 text-[10px] font-bold text-blue-400'>{sharedAvailable.length}</span>
              </div>
              <div className='h-px flex-1 bg-border'/>
            </div>
            {sharedAvailable.map((workspace)=>{
              const resource:KnowledgeResource={kind:'workspace',workspaceId:workspace.id,name:workspace.name};
              const open=expanded.has(workspace.id);
              return <div key={workspace.id} className='overflow-hidden rounded-xl border border-blue-500/30 bg-blue-950/30'>
                <div role='group' aria-label={t('knowledge.dragWorkspace',{name:workspace.name})} draggable={canEdit} onDragStart={(event)=>beginDrag(event,resource)} onDragEnd={()=>knowledge.setDraggedResource(null)} className='flex items-center gap-1 p-2'>
                  <Button size='icon' variant='ghost' className='h-11 w-11 shrink-0' onClick={()=>void toggleWorkspace(workspace.id)} aria-label={open?t('knowledge.collapseWorkspace',{name:workspace.name}):t('knowledge.expandWorkspace',{name:workspace.name})}>{open?<ChevronDown className='h-4 w-4'/>:<ChevronRight className='h-4 w-4'/>}</Button>
                  <Warehouse className='h-4 w-4 shrink-0 text-blue-400'/><div className='min-w-0 flex-1 px-1'><div className='flex items-center gap-1.5'><p className='truncate text-sm font-medium'>{workspace.name}</p><span className='shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-blue-400 ring-1 ring-blue-500/30'>{t('knowledge.sharedBadge')}</span></div><p className='text-[10px] text-muted-foreground'>{t((workspace.documentCount??0)===1?'knowledge.documentCount_one':'knowledge.documentCount_other',{count:workspace.documentCount??0})}</p></div>{canEdit&&<><GripVertical className='h-4 w-4 text-muted-foreground'/><LinkMenu resource={resource} targetNodeId={targetNodeId} knowledge={knowledge}/></>}
                </div>
                {open&&<div className='border-t border-blue-500/20 bg-blue-950/20 p-2'>{renderDocumentPage(workspace.id)}</div>}
              </div>;
            })}
          </>}
        </div>
      }
    </div>
  </div>;
}

function documentPageKey(workspaceId:string,folderId?:string):string {
  return `${workspaceId}:${folderId??'root'}`;
}

function LinkMenu({resource,targetNodeId,knowledge,onMapData}:Readonly<{resource:KnowledgeResource;targetNodeId:string|null;knowledge:KnowledgeLinkingController;onMapData?:(resource:Extract<KnowledgeResource,{kind:'document'}>)=>void}>) {
  const { t } = useModuleTranslation('semantic-model');
  const nodes=useSemanticModelEditorStore((state)=>state.graph?.nodes??[]);
  if (targetNodeId&&resource.kind==='document'&&resource.mappable&&onMapData) return <DropdownMenu><DropdownMenuTrigger asChild><Button size='sm' variant='ghost' className='h-11 min-w-11 shrink-0 px-2 text-xs' disabled={knowledge.isBusy}>{t('action.add')}</Button></DropdownMenuTrigger><DropdownMenuContent align='end' onCloseAutoFocus={(event)=>event.preventDefault()}><DropdownMenuItem disabled={knowledge.hasBinding(targetNodeId,resource)} onSelect={()=>void knowledge.link(targetNodeId,resource)}>{knowledge.hasBinding(targetNodeId,resource)?t('knowledge.linked'):t('knowledge.link')}</DropdownMenuItem><DropdownMenuItem onSelect={()=>onMapData(resource)}><Table2 className='h-4 w-4'/>{t('mapping.mapData')}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>;
  if (targetNodeId) return <Button size='sm' variant='ghost' className='h-11 min-w-11 shrink-0 px-2 text-xs' disabled={knowledge.isBusy||knowledge.hasBinding(targetNodeId,resource)} onClick={()=>void knowledge.link(targetNodeId,resource)}>{knowledge.hasBinding(targetNodeId,resource)?t('knowledge.linked'):t('knowledge.link')}</Button>;
  return <DropdownMenu><DropdownMenuTrigger asChild><Button size='sm' variant='ghost' className='h-11 min-w-11 shrink-0 px-2 text-xs' disabled={knowledge.isBusy}>{t('knowledge.link')}</Button></DropdownMenuTrigger><DropdownMenuContent align='end' onCloseAutoFocus={(event)=>event.preventDefault()}><div className='px-2 py-1.5 text-xs font-medium text-muted-foreground'>{t('knowledge.linkToConcept')}</div>{nodes.map((node)=><DropdownMenuItem key={node.id} className='min-h-11' disabled={knowledge.hasBinding(node.id,resource)} onSelect={()=>void knowledge.link(node.id,resource)}>{node.label}{knowledge.hasBinding(node.id,resource)&&<span className='ml-auto text-[10px] text-muted-foreground'>{t('knowledge.linked')}</span>}</DropdownMenuItem>)}{resource.kind==='document'&&resource.mappable&&onMapData&&<><DropdownMenuSeparator/><DropdownMenuItem className='min-h-11' onSelect={()=>onMapData(resource)}><Table2 className='h-4 w-4'/>{t('mapping.mapData')}</DropdownMenuItem></>}</DropdownMenuContent></DropdownMenu>;
}
