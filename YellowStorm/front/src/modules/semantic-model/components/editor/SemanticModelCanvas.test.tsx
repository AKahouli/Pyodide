import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SemanticGraph } from '../../types';
import type { KnowledgeLinkingController } from '../../hooks/use-knowledge-linking';
import { useSemanticModelEditorStore } from '../../store';
import { SemanticModelCanvas } from './SemanticModelCanvas';

const flow = vi.hoisted(() => ({ props:{} as Record<string,unknown> }));

vi.mock('@xyflow/react', () => ({
  Background:() => null,
  Controls:() => null,
  Handle:() => null,
  Position:{Left:'left',Right:'right'},
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

const renderCanvas = () => render(<SemanticModelCanvas canEdit knowledge={knowledge} onOpenKnowledge={vi.fn()} onConnectRequest={vi.fn()} />);

describe('SemanticModelCanvas', () => {
  beforeEach(() => {useSemanticModelEditorStore.getState().hydrate(graph);vi.clearAllMocks();knowledge.draggedResource=null;knowledge.isBusy=false;knowledge.countsByNode={};});

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
    fireEvent.click(screen.getByRole('button',{name:'action.add'}));
    fireEvent.click(screen.getByRole('menuitem',{name:'records.quickAdd'}));
    const input = screen.getByRole('textbox',{name:'records.quickName'});
    fireEvent.change(input,{target:{value:'Acme'}});
    fireEvent.click(screen.getByRole('button',{name:'records.quickCreate'}));
    expect(useSemanticModelEditorStore.getState().pending[0][0]).toMatchObject({type:'record.create',entity:{nodeTypeId:'customer',label:'Acme'}});
  });

  it('creates a linked optional-record concept as one operation group', async () => {
    useSemanticModelEditorStore.getState().hydrate({...graph,nodes:[{...graph.nodes[0],id:'customer',label:'Customer',systemKey:null,recordPolicy:'optional'}]});
    renderCanvas();
    fireEvent.click(screen.getByRole('button',{name:'action.add'}));
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

  it('links a dragged workspace directly from a concept card', () => {
    useSemanticModelEditorStore.getState().hydrate({...graph,nodes:[{...graph.nodes[0],id:'customer',label:'Customer',systemKey:null}]});
    const resource={kind:'workspace' as const,workspaceId:'workspace',name:'Credit Risk'};
    knowledge.draggedResource=resource;
    renderCanvas();
    const nodes=flow.props.nodes as Array<{id:string;data:{onKnowledgeDrop:(id:string,event:unknown)=>void}}>;
    const event={preventDefault:vi.fn(),stopPropagation:vi.fn(),dataTransfer:{getData:vi.fn()}};
    act(()=>nodes[0].data.onKnowledgeDrop('customer',event));
    expect(knowledge.link).toHaveBeenCalledWith('customer',resource);
  });
});
