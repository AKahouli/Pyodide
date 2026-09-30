import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConceptSourceMapping, MappingHealthItem, SemanticGraph } from '../../types';
import type { KnowledgeLinkingController } from '../../hooks/use-knowledge-linking';
import { useSemanticModelEditorStore } from '../../store';
import { showSuccess, showWarning } from '@/lib/notifications';
import { SemanticModelCanvas } from './SemanticModelCanvas';

const flow = vi.hoisted(() => ({ props:{} as Record<string,unknown> }));

vi.mock('@xyflow/react', () => ({
  Background:() => null,
  Controls:() => null,
  Handle:() => null,
  NodeToolbar:({isVisible,children}:{isVisible?:boolean;children:ReactNode}) => isVisible ? <>{children}</> : null,
  MarkerType:{ArrowClosed:'arrowclosed'},
  Position:{Left:'left',Right:'right',Top:'top'},
  ReactFlow:(props:Record<string,unknown>) => {
    flow.props=props;
    const nodes = props.nodes as Array<{id:string;type:string;data:Record<string,unknown>;selected?:boolean}>;
    const types = props.nodeTypes as Record<string,(nodeProps:Record<string,unknown>)=>React.ReactNode>;
    return <div data-testid='flow'>{nodes.map((node)=>{const Component=types[node.type];return <Component key={node.id} data={node.data} selected={Boolean(node.selected)} isConnectable={Boolean(props.nodesConnectable)} />;})}</div>;
  },
}));

vi.mock('@/lib/notifications', () => ({showSuccess:vi.fn(),showWarning:vi.fn()}));
vi.mock('@/components/ui/dropdown-menu',()=>({
  DropdownMenu:({children}:{children:ReactNode})=><>{children}</>,
  DropdownMenuTrigger:({children}:{children:ReactNode})=><>{children}</>,
  DropdownMenuContent:({children}:{children:ReactNode})=><div role='menu'>{children}</div>,
  DropdownMenuItem:({children,onSelect}:{children:ReactNode;onSelect?:()=>void})=><button role='menuitem' onClick={onSelect}>{children}</button>,
}));

const graph: SemanticGraph = {
  modelId:'model',versionId:'version',revision:0,relations:[],records:[],recordRelations:[],
  nodes:[{id:'documents',key:'documents',label:'Documents',description:'',category:'system_collection',recordPolicy:'none',systemKey:'workspace_documents',aliases:[],attributes:[],position:{x:120,y:120}}],
};

const knowledge = {
  bindings:[],workspaceLinks:[],countsByNode:{},draggedResource:null,isBusy:false,
  setDraggedResource:vi.fn(),hasBinding:vi.fn(()=>false),link:vi.fn(),remove:vi.fn(),
} as unknown as KnowledgeLinkingController;

const healthy = (...ids: string[]): MappingHealthItem[] => ids.map((id) => ({ id, conceptId:'contract', conceptLabel:'Contract', documentName:'', state:'healthy', missingFields:[], availableFields:[] } as unknown as MappingHealthItem));
const renderCanvas = (sourceMappings?: ConceptSourceMapping[], mappingHealth?: MappingHealthItem[]) => render(<SemanticModelCanvas canEdit knowledge={knowledge} sourceMappings={sourceMappings} mappingHealth={mappingHealth} onOpenKnowledge={vi.fn()} onConnectRequest={vi.fn()} />);

function mapping(overrides: Partial<ConceptSourceMapping>): ConceptSourceMapping {
  return {
    id:'mapping',conceptId:'contract',workspaceId:'workspace',documentId:'document',documentName:'master-agreement-0041.pdf',
    sheetName:'',assetKind:'document',fieldMappings:[],status:'ready',createdBy:'user',createdAt:'',updatedAt:'',
    identityFields:['contract_number'],...overrides,
  };
}

const contractGraph: SemanticGraph = {
  ...graph,
  nodes:[{
    id:'contract',key:'contract',label:'Contract',description:'An agreement.',category:'business_object',
    recordPolicy:'expected',systemKey:null,aliases:[],position:{x:0,y:0},
    attributes:[
      {key:'contract_number',label:'contract number',type:'text',required:false},
      {key:'customer_id',label:'customer id',type:'text',required:false},
      {key:'effective_date',label:'effective date',type:'date',required:false},
      {key:'title',label:'title',type:'text',required:false},
      {key:'status',label:'status',type:'text',required:false},
    ],
  }],
};

describe('SemanticModelCanvas', () => {
  beforeEach(() => {useSemanticModelEditorStore.getState().hydrate(graph);vi.clearAllMocks();knowledge.draggedResource=null;knowledge.isBusy=false;knowledge.countsByNode={};});

  it('shows a concept as a round step: its name, field count, matching key and status', () => {
    useSemanticModelEditorStore.getState().hydrate(contractGraph);
    renderCanvas([mapping({}), mapping({ id:'mapping-2', documentId:'document-2', documentName:'master-agreement-0099.pdf' })], healthy('mapping', 'mapping-2'));

    expect(screen.getByText('Contract')).toBeInTheDocument();
    expect(screen.getByText('designer.fieldCount_other')).toBeInTheDocument();
    expect(screen.getByLabelText('editor.matchingKey')).toBeInTheDocument();
    expect(screen.getByText('editor.status.ready')).toBeInTheDocument();
    // Both documents appear as their own source steps.
    expect(screen.getByText('master-agreement-0041.pdf')).toBeInTheDocument();
    expect(screen.getByText('master-agreement-0099.pdf')).toBeInTheDocument();
  });

  it('shows the key badge for a unique field chosen on the concept, before any source is mapped', () => {
    useSemanticModelEditorStore.getState().hydrate(contractGraph);
    render(<SemanticModelCanvas canEdit knowledge={knowledge} identityRules={[{ conceptId: contractGraph.nodes[0].id, fields: ['contract_number'] }]} onOpenKnowledge={vi.fn()} onConnectRequest={vi.fn()} />);
    expect(screen.getByLabelText('editor.matchingKey')).toBeInTheDocument();
  });

  it('shows how many records the last Run produced for each concept', () => {
    useSemanticModelEditorStore.getState().hydrate(contractGraph);
    render(<SemanticModelCanvas canEdit knowledge={knowledge} recordCounts={{ [contractGraph.nodes[0].id]: 42 }} onOpenKnowledge={vi.fn()} onConnectRequest={vi.fn()} />);
    expect(screen.getByText(/editor.recordCount/)).toBeInTheDocument();
  });

  it('brings data into a concept from the + on its left', () => {
    useSemanticModelEditorStore.getState().hydrate(contractGraph);
    const onOpenKnowledge = vi.fn();
    render(<SemanticModelCanvas canEdit knowledge={knowledge} onOpenKnowledge={onOpenKnowledge} onConnectRequest={vi.fn()} />);
    fireEvent.click(screen.getByRole('button',{name:'designer.plus.source'}));
    expect(onOpenKnowledge).toHaveBeenCalledWith('contract');
  });

  it('feeds another concept from the + on a source', () => {
    useSemanticModelEditorStore.getState().hydrate(contractGraph);
    const onAddFeed = vi.fn();
    render(<SemanticModelCanvas canEdit knowledge={knowledge} sourceMappings={[mapping({})]} onOpenKnowledge={vi.fn()} onConnectRequest={vi.fn()} onAddFeed={onAddFeed} />);
    fireEvent.click(screen.getByRole('button',{name:'designer.plus.feed'}));
    expect(onAddFeed).toHaveBeenCalledWith(expect.objectContaining({ label:'master-agreement-0041.pdf' }));
  });

  it('flags a concept that expects data but has no source', () => {
    useSemanticModelEditorStore.getState().hydrate(contractGraph);
    renderCanvas([]);
    expect(screen.getByText('editor.status.noSource')).toBeInTheDocument();
  });

  it('does not call a saved but unchecked source ready', () => {
    useSemanticModelEditorStore.getState().hydrate(contractGraph);
    renderCanvas([mapping({})]);
    expect(screen.getByText('editor.status.sourcesNotReady')).toBeInTheDocument();
    expect(screen.queryByText('editor.status.ready')).not.toBeInTheDocument();
  });

  it('flags sources that are not ready yet', () => {
    useSemanticModelEditorStore.getState().hydrate(contractGraph);
    renderCanvas([mapping({ status:'needs_review' })]);
    expect(screen.getByText('editor.status.sourcesNotReady')).toBeInTheDocument();
  });

  it('draws relationships as arrows a reader can follow', () => {
    useSemanticModelEditorStore.getState().hydrate({
      ...contractGraph,
      nodes:[...contractGraph.nodes,{...contractGraph.nodes[0],id:'customer',key:'customer',label:'Customer',attributes:[]}],
      relations:[{id:'signs',key:'signs',label:'signs',inverseLabel:'',description:'',sourceNodeTypeId:'customer',targetNodeTypeId:'contract',cardinality:'one_to_many',traversable:true,filterable:true,attributes:[]}],
    });
    renderCanvas([]);
    const edges = flow.props.edges as Array<{type:string;markerEnd:{type:string};data:Record<string,unknown>}>;
    expect(edges).toHaveLength(1);
    expect(edges[0].type).toBe('relation');
    expect(edges[0].markerEnd.type).toBe('arrowclosed');
    expect(edges[0].data).toMatchObject({label:'signs',cardinality:'one_to_many'});
  });

  it('prevents protected concepts from producing layout operations', () => {
    renderCanvas();
    const nodes = flow.props.nodes as Array<{ id:string; draggable:boolean; position:{x:number;y:number} }>;
    expect(nodes[0].draggable).toBe(false);
    const onNodeDragStop = flow.props.onNodeDragStop as (_event:unknown,node:typeof nodes[number]) => void;
    onNodeDragStop({}, {...nodes[0],position:{x:400,y:400}});
    expect(useSemanticModelEditorStore.getState().pending).toEqual([]);
  });

  it('creates a record inline for its concept', () => {
    useSemanticModelEditorStore.getState().hydrate({...graph,nodes:[{...graph.nodes[0],id:'customer',label:'Customer',systemKey:null,recordPolicy:'optional'}]});
    renderCanvas();
    fireEvent.click(screen.getByRole('button',{name:'designer.plus.next'}));
    fireEvent.click(screen.getByRole('menuitem',{name:'records.quickAdd'}));
    const input = screen.getByRole('textbox',{name:'records.quickName'});
    fireEvent.change(input,{target:{value:'Acme'}});
    fireEvent.click(screen.getByRole('button',{name:'records.quickCreate'}));
    expect(useSemanticModelEditorStore.getState().pending[0][0]).toMatchObject({type:'record.create',entity:{nodeTypeId:'customer',label:'Acme'}});
  });

  it('creates a linked optional-record concept as one operation group', async () => {
    useSemanticModelEditorStore.getState().hydrate({...graph,nodes:[{...graph.nodes[0],id:'customer',label:'Customer',systemKey:null,recordPolicy:'optional'}]});
    renderCanvas();
    fireEvent.click(screen.getByRole('button',{name:'designer.plus.next'}));
    fireEvent.click(screen.getByRole('menuitem',{name:'concept.quickAdd'}));
    const input = screen.getByRole('textbox',{name:'concept.quickName'});
    await waitFor(()=>expect(input).toHaveFocus());
    fireEvent.change(input,{target:{value:'Contract'}});
    fireEvent.keyDown(input,{key:'Enter'});
    const group = useSemanticModelEditorStore.getState().pending[0];
    expect(group.map((operation)=>operation.type)).toEqual(['node_type.create','relation_type.create']);
    expect(group[0]).toMatchObject({entity:{label:'Contract',recordPolicy:'optional'}});
    expect(group[1]).toMatchObject({entity:{sourceNodeTypeId:'customer',label:'relation.defaultWording'}});
  });

  it('reuses and normalizes a concept relationship when records are connected', () => {
    useSemanticModelEditorStore.getState().hydrate({
      ...graph,
      nodes:[
        {...graph.nodes[0],id:'customer',systemKey:null,recordPolicy:'optional'},
        {...graph.nodes[0],id:'contract',systemKey:null,recordPolicy:'optional'},
      ],
      relations:[{id:'places',key:'places',label:'places',inverseLabel:'',description:'',sourceNodeTypeId:'customer',targetNodeTypeId:'contract',cardinality:'many_to_many',traversable:true,filterable:true,attributes:[]}],
      records:[
        {id:'customer-1',nodeTypeId:'customer',label:'Acme',values:{},status:'active',position:{x:0,y:0}},
        {id:'contract-1',nodeTypeId:'contract',label:'Agreement',values:{},status:'active',position:{x:300,y:0}},
      ],
    });
    useSemanticModelEditorStore.getState().setMode('records');
    renderCanvas();
    const onConnect = flow.props.onConnect as (connection:{source:string;target:string})=>void;
    act(()=>onConnect({source:'contract-1',target:'customer-1'}));
    expect(useSemanticModelEditorStore.getState().pending[0][0]).toMatchObject({
      type:'record_relation.create',
      entity:{relationTypeId:'places',sourceRecordId:'customer-1',targetRecordId:'contract-1'},
    });
  });

  it('draws each source as a box feeding its concept: a click selects it, a double-click opens its mapping', () => {
    useSemanticModelEditorStore.getState().hydrate(contractGraph);
    const onOpenSource = vi.fn();
    const source = mapping({ id:'m1' });
    render(<SemanticModelCanvas canEdit knowledge={knowledge} sourceMappings={[source]} mappingHealth={healthy('m1')} onOpenKnowledge={vi.fn()} onConnectRequest={vi.fn()} onOpenSource={onOpenSource} />);
    expect(screen.getByText('master-agreement-0041.pdf')).toBeInTheDocument();
    const edges = flow.props.edges as Array<{id:string;type:string;source:string;target:string}>;
    const feed = edges.find((edge)=>edge.type==='feed')!;
    expect(feed.target).toBe('contract');
    const nodes = flow.props.nodes as Array<{id:string}>;
    const onNodeClick = flow.props.onNodeClick as (event:unknown,node:{id:string})=>void;
    act(()=>onNodeClick({target:document.body},{id:feed.source}));
    expect(onOpenSource).not.toHaveBeenCalled();
    expect(useSemanticModelEditorStore.getState().selectedId).toBe(feed.source);
    expect(screen.getByRole('toolbar')).toBeInTheDocument();
    const onNodeDoubleClick = flow.props.onNodeDoubleClick as (event:unknown,node:{id:string})=>void;
    act(()=>onNodeDoubleClick({target:document.body},{id:feed.source}));
    expect(onOpenSource).toHaveBeenCalledWith(expect.objectContaining({ kind:'documents' }));
    expect(nodes.some((node)=>node.id===feed.source)).toBe(true);
    const onEdgeClick = flow.props.onEdgeClick as (event:unknown,edge:{id:string})=>void;
    act(()=>onEdgeClick({}, {id:feed.id}));
    expect(onOpenSource).toHaveBeenLastCalledWith(expect.objectContaining({ kind:'documents' }), source);
    expect(useSemanticModelEditorStore.getState().selectedId).toBeNull();
  });

  it('deletes a concept from its hover button, with its relationships, as one undoable change', () => {
    useSemanticModelEditorStore.getState().hydrate({
      ...contractGraph,
      nodes:[...contractGraph.nodes,{...contractGraph.nodes[0],id:'customer',key:'customer',label:'Customer',attributes:[]}],
      relations:[{id:'signs',key:'signs',label:'signs',inverseLabel:'',description:'',sourceNodeTypeId:'customer',targetNodeTypeId:'contract',cardinality:'one_to_many',traversable:true,filterable:true,attributes:[]}],
    });
    renderCanvas([]);
    fireEvent.click(screen.getAllByRole('button',{name:'designer.delete.concept'})[0]);
    const state = useSemanticModelEditorStore.getState();
    expect(state.pending[0].map((operation)=>operation.type)).toEqual(['relation_type.delete','node_type.delete']);
    expect(state.graph?.nodes.map((node)=>node.id)).toEqual(['customer']);
    act(()=>{void state.undo();});
    expect(useSemanticModelEditorStore.getState().graph?.relations).toHaveLength(1);
  });

  it('deletes a relationship from its line', () => {
    useSemanticModelEditorStore.getState().hydrate({
      ...contractGraph,
      relations:[{id:'renews',key:'renews',label:'renews',inverseLabel:'',description:'',sourceNodeTypeId:'contract',targetNodeTypeId:'contract',cardinality:'one_to_many',traversable:true,filterable:true,attributes:[]}],
    });
    renderCanvas([]);
    const edges = flow.props.edges as Array<{id:string;data:{onDelete:(id:string)=>void}}>;
    act(()=>edges[0].data.onDelete('renews'));
    expect(useSemanticModelEditorStore.getState().graph?.relations).toEqual([]);
  });

  it('removes the selected concept with the Delete key, but not while typing', () => {
    useSemanticModelEditorStore.getState().hydrate(contractGraph);
    renderCanvas([]);
    act(()=>useSemanticModelEditorStore.getState().select('contract'));
    const input = document.createElement('input');
    document.body.appendChild(input);
    fireEvent.keyDown(input,{key:'Backspace'});
    expect(useSemanticModelEditorStore.getState().graph?.nodes).toHaveLength(1);
    fireEvent.keyDown(window,{key:'Delete'});
    expect(useSemanticModelEditorStore.getState().graph?.nodes).toEqual([]);
    expect(showSuccess).toHaveBeenCalledWith('designer.delete.conceptDone', expect.anything());
    input.remove();
  });

  it('hands a source removal to the page, which removes it at once with Undo', () => {
    useSemanticModelEditorStore.getState().hydrate(contractGraph);
    const onRemoveSource = vi.fn();
    render(<SemanticModelCanvas canEdit knowledge={knowledge} sourceMappings={[mapping({})]} onOpenKnowledge={vi.fn()} onConnectRequest={vi.fn()} onRemoveSource={onRemoveSource} />);
    fireEvent.click(screen.getByRole('button',{name:'designer.delete.source'}));
    expect(onRemoveSource).toHaveBeenCalledWith(expect.objectContaining({ label:'master-agreement-0041.pdf' }));
    expect(useSemanticModelEditorStore.getState().pending).toEqual([]);
  });

  it('moves a node live while dragging and saves its place only on drop', () => {
    useSemanticModelEditorStore.getState().hydrate(contractGraph);
    renderCanvas([]);
    const onNodesChange = flow.props.onNodesChange as (changes:unknown[])=>void;
    act(()=>onNodesChange([{type:'position',id:'contract',position:{x:50,y:60},dragging:true}]));
    const moved = (flow.props.nodes as Array<{id:string;position:{x:number;y:number}}>).find((node)=>node.id==='contract');
    expect(moved?.position).toEqual({x:50,y:60});
    expect(useSemanticModelEditorStore.getState().pending).toEqual([]);
    const onNodeDragStop = flow.props.onNodeDragStop as (event:unknown,node:unknown)=>void;
    act(()=>onNodeDragStop({}, {id:'contract',position:{x:50,y:60}}));
    expect(useSemanticModelEditorStore.getState().pending[0][0]).toMatchObject({type:'layout.update',positions:[{id:'contract',position:{x:50,y:60}}]});
  });

  it('turns a workspace dropped on a concept away instead of linking it, since it would bring no data', () => {
    useSemanticModelEditorStore.getState().hydrate({...graph,nodes:[{...graph.nodes[0],id:'customer',label:'Customer',systemKey:null}]});
    const resource={kind:'workspace' as const,workspaceId:'workspace',name:'Credit Risk'};
    knowledge.draggedResource=resource;
    renderCanvas();
    const nodes=flow.props.nodes as Array<{id:string;data:{onKnowledgeDrop:(id:string,event:unknown)=>void}}>;
    const event={preventDefault:vi.fn(),stopPropagation:vi.fn(),dataTransfer:{getData:vi.fn()}};
    act(()=>nodes[0].data.onKnowledgeDrop('customer',event));
    expect(knowledge.link).not.toHaveBeenCalled();
    expect(showWarning).toHaveBeenCalledWith('knowledge.notReadableDrop');
  });

  it('opens a concept details on one click, and shows its actions', () => {
    useSemanticModelEditorStore.getState().hydrate(contractGraph);
    renderCanvas();
    const onNodeClick = flow.props.onNodeClick as (event:unknown,node:{id:string})=>void;
    act(()=>onNodeClick({target:document.body},{id:'contract'}));
    expect(useSemanticModelEditorStore.getState()).toMatchObject({ selectedId:'contract', detailsOpen:true });
    expect(screen.getByRole('toolbar',{name:'canvasTools.conceptToolbar'})).toBeInTheDocument();
  });

  it('renames a concept in place from its toolbar', () => {
    useSemanticModelEditorStore.getState().hydrate(contractGraph);
    renderCanvas();
    act(()=>useSemanticModelEditorStore.getState().select('contract'));
    fireEvent.click(screen.getByRole('button',{name:'canvasTools.rename'}));
    const box = screen.getByRole('textbox',{name:'canvasTools.rename'});
    fireEvent.change(box,{target:{value:'Agreement'}});
    fireEvent.submit(box.closest('form')!);
    const node = useSemanticModelEditorStore.getState().graph!.nodes.find((item)=>item.id==='contract')!;
    expect(node).toMatchObject({ label:'Agreement', key:'agreement' });
  });

  it('adds a field and marks a unique field from the canvas', async () => {
    useSemanticModelEditorStore.getState().hydrate(contractGraph);
    const onToggleKey = vi.fn();
    render(<SemanticModelCanvas canEdit knowledge={knowledge} onOpenKnowledge={vi.fn()} onConnectRequest={vi.fn()} onToggleKey={onToggleKey} />);
    act(()=>useSemanticModelEditorStore.getState().select('contract'));
    fireEvent.click(screen.getByRole('button',{name:'canvasTools.fields'}));
    const input = await screen.findByRole('textbox',{name:'attributes.add'});
    fireEvent.change(input,{target:{value:'signed on'}});
    fireEvent.submit(input.closest('form')!);
    const node = useSemanticModelEditorStore.getState().graph!.nodes.find((item)=>item.id==='contract')!;
    expect(node.attributes.map((attribute)=>attribute.key)).toContain('signed_on');
    fireEvent.click(screen.getAllByRole('button',{name:'canvasTools.setKey'})[0]);
    expect(onToggleKey).toHaveBeenCalled();
  });

  it('changes how many records each side of a relationship holds from its line', () => {
    useSemanticModelEditorStore.getState().hydrate({ ...contractGraph, nodes:[...contractGraph.nodes,{ ...contractGraph.nodes[0], id:'customer', key:'customer', label:'Customer', position:{x:0,y:0} }],
      relations:[{ id:'holds', key:'holds', label:'holds', inverseLabel:'', description:'', sourceNodeTypeId:'customer', targetNodeTypeId:'contract', cardinality:'many_to_many', traversable:true, filterable:true, attributes:[] }] });
    renderCanvas();
    const edge = (flow.props.edges as Array<{id:string;data:Record<string,unknown>}>).find((item)=>item.id==='holds')!;
    act(()=>(edge.data.onCardinality as (id:string,value:string)=>void)('holds','one_to_many'));
    expect(useSemanticModelEditorStore.getState().graph!.relations[0].cardinality).toBe('one_to_many');
  });

  it('lets a source box be dragged and reports where it was dropped', () => {
    useSemanticModelEditorStore.getState().hydrate(contractGraph);
    const onMoveSource = vi.fn();
    render(<SemanticModelCanvas canEdit knowledge={knowledge} sourceMappings={[mapping({ id:'m1' })]} onOpenKnowledge={vi.fn()} onConnectRequest={vi.fn()} onMoveSource={onMoveSource} sourcePositions={{}} />);
    const source = (flow.props.nodes as Array<{id:string;draggable?:boolean}>).find((node)=>node.id.startsWith('source:'))!;
    expect(source.draggable).toBe(true);
    act(()=>(flow.props.onNodeDragStop as (event:unknown,node:{id:string;position:{x:number;y:number}})=>void)({}, { id:source.id, position:{x:5,y:6} }));
    expect(onMoveSource).toHaveBeenCalledWith(source.id,{x:5,y:6});
  });

  it('removes the typed records of a concept from their box, as an edit Undo brings back', () => {
    const record = (id:string) => ({ id, nodeTypeId:'contract', label:id, values:{}, status:'active' as const, position:{x:0,y:0} });
    useSemanticModelEditorStore.getState().hydrate({ ...contractGraph, records:[record('r1'),record('r2')] });
    renderCanvas();
    const typed = (flow.props.nodes as Array<{id:string;data:{source:unknown;onRemove?:(source:unknown)=>void}}>).find((node)=>node.id==='typed:contract')!;
    act(()=>typed.data.onRemove!(typed.data.source));
    expect(useSemanticModelEditorStore.getState().graph!.records).toEqual([]);
    expect(showSuccess).toHaveBeenCalledWith('designer.delete.typedDone_other', expect.objectContaining({ action: expect.objectContaining({ label: 'action.undo' }) }));
    act(()=>{void useSemanticModelEditorStore.getState().undo();});
    expect(useSemanticModelEditorStore.getState().graph!.records).toHaveLength(2);
  });
});
