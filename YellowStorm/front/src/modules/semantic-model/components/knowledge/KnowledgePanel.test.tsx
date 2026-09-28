import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SemanticGraph } from '../../types';
import type { KnowledgeLinkingController } from '../../hooks/use-knowledge-linking';
import { useSemanticModelEditorStore } from '../../store';
import { isMappableDocument, KnowledgePanel } from './KnowledgePanel';

const workspaceApi = vi.hoisted(() => ({getWorkspaces:vi.fn(),getDocuments:vi.fn(),getDocument:vi.fn(),getFolderContents:vi.fn(),getSharedWorkspaces:vi.fn()}));

vi.mock('@/modules/workspace/api', () => workspaceApi);

const graph: SemanticGraph = {
  modelId:'model',versionId:'version',revision:0,relations:[],records:[],recordRelations:[],
  nodes:[{id:'customer',key:'customer',label:'Customer',description:'',category:'business_object',recordPolicy:'none',systemKey:null,aliases:[],attributes:[],position:{x:120,y:120}}],
};
const knowledge={
  bindings:[
    {id:'binding',targetKind:'node_type',targetId:'customer',resourceKind:'document',workspaceId:'workspace',documentId:'document',inclusionMode:'explicit',retrievalMode:'targeted',priority:0,enabled:true,protected:false,availability:'available'},
    {id:'hidden-binding',targetKind:'node_type',targetId:'other-concept',resourceKind:'document',workspaceId:'other-workspace',documentId:'other-document',inclusionMode:'explicit',retrievalMode:'targeted',priority:0,enabled:true,protected:false,availability:'available'},
  ],workspaceLinks:[{workspaceId:'workspace',role:'connected',enabled:true}],countsByNode:{},draggedResource:null,isBusy:false,
  setDraggedResource:vi.fn(),hasBinding:vi.fn((_target,resource)=>resource.kind==='document'),link:vi.fn(),remove:vi.fn(),
} as unknown as KnowledgeLinkingController;

describe('KnowledgePanel', () => {
  beforeEach(() => {
    useSemanticModelEditorStore.getState().hydrate(graph);
    useSemanticModelEditorStore.getState().select('customer');
    workspaceApi.getWorkspaces.mockResolvedValue({workspaces:[{id:'workspace',name:'Credit Risk'}],pagination:{page:1,totalPages:1}});
    workspaceApi.getDocuments.mockImplementation(async (workspaceId:string) => ({documents:workspaceId==='workspace'?[{id:'document',originalName:'Customer Policy.pdf',isFolder:false}]:[],pagination:{page:1,totalPages:1}}));
    workspaceApi.getDocument.mockResolvedValue({id:'document',originalName:'Customer Policy.pdf',isFolder:false});
    workspaceApi.getFolderContents.mockResolvedValue({documents:[],pagination:{page:1,totalPages:1}});
    workspaceApi.getSharedWorkspaces.mockResolvedValue({workspaces:[],pagination:{page:1,totalPages:1}});
    vi.clearAllMocks();
  });

  it('loads persisted document names independently of the source picker', async () => {
    render(<KnowledgePanel canEdit={false} knowledge={knowledge} targetNodeId='customer' />);
    expect(await screen.findByText('Customer Policy.pdf')).toBeInTheDocument();
    expect(workspaceApi.getDocument).toHaveBeenCalledWith('workspace','document');
    expect(screen.queryByText('knowledge.addSource')).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'knowledge.remove'})).not.toBeInTheDocument();
  });

  it('uses a readable file as a source, and offers no link that would bring no data', async () => {
    workspaceApi.getDocuments.mockResolvedValue({documents:[
      {id:'sheet',originalName:'customers.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',isFolder:false},
      {id:'logo',originalName:'logo.png',mimeType:'image/png',isFolder:false},
    ],pagination:{page:1,totalPages:1}});
    const onMapData=vi.fn();
    render(<KnowledgePanel canEdit knowledge={knowledge} targetNodeId='customer' onMapData={onMapData} />);
    await screen.findAllByText('Credit Risk');
    expect(screen.getAllByText('Credit Risk').some((item)=>item.closest('[draggable="true"]'))).toBe(false);
    fireEvent.click(screen.getByRole('button',{name:'knowledge.expandWorkspace'}));
    fireEvent.click(await screen.findByRole('button',{name:'knowledge.useFile'}));
    expect(onMapData).toHaveBeenCalledWith(expect.objectContaining({kind:'document',documentId:'sheet'}));
    expect(screen.getByText('knowledge.notReadable')).toBeInTheDocument();
    expect(screen.getByText('logo.png').closest('[draggable="true"]')).toBeNull();
    expect(screen.queryByRole('button',{name:'knowledge.link'})).not.toBeInTheDocument();
    expect(knowledge.link).not.toHaveBeenCalled();
  });

  it('uses every file of a workspace or of a folder with one mapping', async () => {
    workspaceApi.getDocuments.mockResolvedValue({documents:[{id:'folder',originalName:'Contracts',folderName:'Contracts',isFolder:true}],pagination:{page:1,totalPages:1}});
    const onMapWorkspace=vi.fn();
    render(<KnowledgePanel canEdit knowledge={knowledge} targetNodeId='customer' onMapWorkspace={onMapWorkspace} />);
    fireEvent.click(await screen.findByRole('button',{name:'knowledge.useAllIn'}));
    expect(onMapWorkspace).toHaveBeenLastCalledWith({workspaceId:'workspace',name:'Credit Risk'});
    fireEvent.click(screen.getByRole('button',{name:'knowledge.expandWorkspace'}));
    await screen.findByText('Contracts');
    fireEvent.click(screen.getAllByRole('button',{name:'knowledge.useAllIn'})[1]);
    expect(onMapWorkspace).toHaveBeenLastCalledWith({workspaceId:'workspace',folderId:'folder',name:'Credit Risk / Contracts',workspaceName:'Credit Risk'});
  });

  it('loads later workspace and document pages on demand', async () => {
    workspaceApi.getWorkspaces.mockImplementation(async({page=1}:{page?:number})=>page===1
      ? {workspaces:[{id:'workspace',name:'Credit Risk',documentCount:51}],pagination:{page:1,totalPages:2}}
      : {workspaces:[{id:'late-workspace',name:'Late Workspace',documentCount:0}],pagination:{page:2,totalPages:2}});
    workspaceApi.getDocuments.mockImplementation(async(_workspaceId:string,{page=1}:{page?:number})=>page===1
      ? {documents:[{id:'folder',originalName:'Policies',folderName:'Policies',isFolder:true}],pagination:{page:1,totalPages:2}}
      : {documents:[{id:'late-document',originalName:'Late.pdf',isFolder:false}],pagination:{page:2,totalPages:2}});
    workspaceApi.getFolderContents.mockResolvedValue({documents:[{id:'nested-document',originalName:'Nested.pdf',isFolder:false}],pagination:{page:1,totalPages:1}});
    render(<KnowledgePanel canEdit knowledge={knowledge} targetNodeId={null} />);
    fireEvent.click(await screen.findByRole('button',{name:'action.loadMore'}));
    expect(await screen.findByText('Late Workspace')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button',{name:'knowledge.expandWorkspace'})[0]);
    expect(await screen.findByText('Policies')).toBeInTheDocument();
    const folderButton=screen.getByText('Policies').closest('button');
    expect(folderButton).not.toBeNull();
    folderButton&&fireEvent.click(folderButton);
    expect(await screen.findByText('Nested.pdf')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'action.loadMore'}));
    expect(await screen.findByText('Late.pdf')).toBeInTheDocument();
  });
});

describe('isMappableDocument', () => {
  it.each([
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/csv',
  ])('accepts supported mapping source %s', (mimeType) => {
    expect(isMappableDocument(mimeType)).toBe(true);
  });

  it('rejects unsupported source formats', () => {
    expect(isMappableDocument('image/png')).toBe(false);
  });
});
