import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeLinkingController } from '../../hooks/use-knowledge-linking';
import type { SemanticGraph } from '../../types';
import { useSemanticModelEditorStore } from '../../store';
import { SemanticModelInspector } from './SemanticModelInspector';

vi.mock('../knowledge/KnowledgePanel',()=>({KnowledgePanel:()=> <div>knowledge-tray</div>}));
vi.mock('../../query/hooks',()=>({useSourceMappings:()=>({data:[],isLoading:false})}));

const graph: SemanticGraph = {
  modelId:'model',versionId:'version',revision:0,relations:[],records:[],recordRelations:[],
  nodes:[{id:'customer',key:'customer',label:'Customer',description:'Customer account',category:'business_object',recordPolicy:'none',systemKey:null,aliases:[],attributes:[],position:{x:120,y:120}}],
};
const knowledge={bindings:[],workspaceLinks:[],countsByNode:{},draggedResource:null,isBusy:false,setDraggedResource:vi.fn(),hasBinding:vi.fn(),link:vi.fn(),remove:vi.fn()} as unknown as KnowledgeLinkingController;
const renderInspector=(canEdit:boolean)=>render(
  <QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>
    <SemanticModelInspector modelId="model" canEdit={canEdit} knowledge={knowledge} knowledgeOpen={false} knowledgeTargetId={null} onKnowledgeClose={vi.fn()}/>
  </QueryClientProvider>);

describe('SemanticModelInspector', () => {
  beforeEach(() => { useSemanticModelEditorStore.getState().hydrate(graph);useSemanticModelEditorStore.getState().select('customer'); });

  it('renders read-only details without mutation-shaped controls', () => {
    renderInspector(false);
    expect(screen.getByText('Customer account')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByText('inspector.deleteConcept')).not.toBeInTheDocument();
  });

  it('deletes dependent record links, records, and relationships in one group', () => {
    useSemanticModelEditorStore.getState().hydrate({
      ...graph,
      nodes:[graph.nodes[0],{...graph.nodes[0],id:'contract',key:'contract',label:'Contract'}],
      relations:[{id:'places',key:'places',label:'places',inverseLabel:'',description:'',sourceNodeTypeId:'customer',targetNodeTypeId:'contract',cardinality:'many_to_many',traversable:true,filterable:true,attributes:[]}],
      records:[
        {id:'customer-record',nodeTypeId:'customer',label:'Acme',values:{},status:'active',position:{x:0,y:0}},
        {id:'contract-record',nodeTypeId:'contract',label:'Agreement',values:{},status:'active',position:{x:0,y:0}},
      ],
      recordRelations:[{id:'record-link',relationTypeId:'places',sourceRecordId:'customer-record',targetRecordId:'contract-record',values:{}}],
    });
    useSemanticModelEditorStore.getState().select('customer');
    renderInspector(true);
    fireEvent.click(screen.getByRole('button',{name:'inspector.deleteConcept'}));
    expect(useSemanticModelEditorStore.getState().pending[0].map((operation)=>operation.type)).toEqual([
      'record_relation.delete','record.delete','relation_type.delete','node_type.delete',
    ]);
  });

  it('uses the empty inspector as the knowledge tray', () => {
    useSemanticModelEditorStore.getState().select(null);
    renderInspector(true);
    expect(screen.getByText('knowledge-tray')).toBeInTheDocument();
  });
});
