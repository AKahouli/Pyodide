import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeLinkingController } from '../../hooks/use-knowledge-linking';
import type { SemanticGraph } from '../../types';
import { useSemanticModelEditorStore } from '../../store';
import { SemanticModelInspector } from './SemanticModelInspector';

vi.mock('../knowledge/KnowledgePanel',()=>({KnowledgePanel:()=> <div>knowledge-tray</div>}));
const hookState = vi.hoisted(() => ({ mappings: [] as Array<Record<string, unknown>>, rules: [] as Array<{ conceptId: string; fields: string[] }> }));
const saveIdentityRule = vi.hoisted(() => vi.fn(async () => ({ revision: 1, conceptId: 'customer', fields: [] })));
vi.mock('../mapping/RelationMatchingPanel',()=>({RelationMatchingPanel:()=> <div>relation-matching</div>}));
vi.mock('../../query/hooks',()=>({useSourceMappings:()=>({data:hookState.mappings,isLoading:false}),useIdentityRules:()=>({data:hookState.rules,isLoading:false}),useDerivedSources:()=>({data:[],isLoading:false})}));
vi.mock('../../api',()=>({semanticModelApi:{saveIdentityRule}}));

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
  beforeEach(() => { hookState.mappings=[];hookState.rules=[];saveIdentityRule.mockClear();useSemanticModelEditorStore.getState().hydrate(graph);useSemanticModelEditorStore.getState().select('customer'); });

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

  it('updates whether a business field is required', () => {
    useSemanticModelEditorStore.getState().hydrate({ ...graph, nodes: [{ ...graph.nodes[0], attributes: [{ key: 'country', label: 'Country', type: 'text', required: false }] }] });
    useSemanticModelEditorStore.getState().select('customer');
    renderInspector(true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'attributes.required' }));
    expect(useSemanticModelEditorStore.getState().graph?.nodes[0].attributes[0].required).toBe(true);
  });

  it('opens a field row to describe the field for the AI', () => {
    useSemanticModelEditorStore.getState().hydrate({ ...graph, nodes: [{ ...graph.nodes[0], attributes: [{ key: 'country', label: 'Country', type: 'text', required: false }] }] });
    useSemanticModelEditorStore.getState().select('customer');
    renderInspector(true);
    expect(screen.queryByRole('textbox', { name: 'attributes.descriptionFor' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'attributes.moreFor' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'attributes.descriptionFor' }), { target: { value: 'Country of the billing address' } });
    expect(useSemanticModelEditorStore.getState().graph?.nodes[0].attributes[0].description).toBe('Country of the billing address');
  });

  it('asks what makes each concept unique and saves the chosen fields', async () => {
    useSemanticModelEditorStore.getState().hydrate({ ...graph, nodes: [{ ...graph.nodes[0], attributes: [{ key: 'number', label: 'Number', type: 'text', required: false }, { key: 'country', label: 'Country', type: 'text', required: false }] }] });
    useSemanticModelEditorStore.getState().select('customer');
    hookState.rules=[{ conceptId: 'customer', fields: ['country'] }];
    renderInspector(true);
    expect(screen.getByText('identity.title')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Country' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Number' }));
    await waitFor(() => expect(saveIdentityRule).toHaveBeenCalledWith('model', 'customer', ['country', 'number']));
  });

  it('warns when a mapped concept has nothing that makes it unique', () => {
    useSemanticModelEditorStore.getState().hydrate({ ...graph, nodes: [{ ...graph.nodes[0], attributes: [{ key: 'number', label: 'Number', type: 'text', required: false }] }] });
    useSemanticModelEditorStore.getState().select('customer');
    hookState.mappings=[{ id: 'm', conceptId: 'customer', identityFields: [] }];
    renderInspector(true);
    expect(screen.getByRole('alert')).toHaveTextContent('identity.missing');
  });

  it('edits a relationship as two sentences that set its cardinality', () => {
    useSemanticModelEditorStore.getState().hydrate({
      ...graph,
      nodes:[graph.nodes[0],{...graph.nodes[0],id:'contract',key:'contract',label:'Contract'}],
      relations:[{id:'belongs',key:'belongs_to',label:'belongs to',inverseLabel:'has',description:'',sourceNodeTypeId:'contract',targetNodeTypeId:'customer',cardinality:'many_to_one',traversable:true,filterable:true,attributes:[]}],
    });
    useSemanticModelEditorStore.getState().select('belongs');
    renderInspector(true);
    expect(screen.getByDisplayValue('belongs to')).toBeInTheDocument();
    expect(screen.getByDisplayValue('has')).toBeInTheDocument();
    expect(screen.getByText('relation-matching')).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue('has'), { target: { value: 'owns' } });
    expect(useSemanticModelEditorStore.getState().graph?.relations[0].inverseLabel).toBe('owns');
  });

  it('adds and removes business synonyms on a concept', () => {
    renderInspector(true);
    const input = screen.getByRole('textbox', { name: 'aliases.placeholder' });
    fireEvent.change(input, { target: { value: 'Client' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(useSemanticModelEditorStore.getState().graph?.nodes[0].aliases).toEqual(['Client']);
    fireEvent.click(screen.getByRole('button', { name: 'aliases.remove' }));
    expect(useSemanticModelEditorStore.getState().graph?.nodes[0].aliases).toEqual([]);
  });

  it('keeps the knowledge tray out of the empty details state', () => {
    useSemanticModelEditorStore.getState().select(null);
    renderInspector(true);
    expect(screen.queryByText('knowledge-tray')).not.toBeInTheDocument();
  });
});
