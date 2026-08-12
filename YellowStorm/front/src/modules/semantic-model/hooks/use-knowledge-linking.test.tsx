import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeBinding } from '../types';
import { useKnowledgeLinking } from './use-knowledge-linking';

const api = vi.hoisted(()=>({connectWorkspace:vi.fn(),createBinding:vi.fn(),deleteBinding:vi.fn()}));
const notifications = vi.hoisted(()=>({showSuccess:vi.fn(),showError:vi.fn()}));
const query = vi.hoisted(()=>({
  bindings:{data:[] as KnowledgeBinding[],refetch:vi.fn()},
  workspaces:{data:[] as Array<{workspaceId:string;role:'origin'|'connected';enabled:boolean}>,refetch:vi.fn()},
}));

vi.mock('../api',()=>({semanticModelApi:api}));
vi.mock('../query/hooks',()=>({useSemanticBindings:()=>query.bindings,useSemanticWorkspaces:()=>query.workspaces}));
vi.mock('@/lib/notifications',()=>notifications);

describe('useKnowledgeLinking',()=>{
  beforeEach(()=>{
    vi.clearAllMocks();
    query.bindings.data=[];
    query.workspaces.data=[];
    query.bindings.refetch.mockResolvedValue({data:query.bindings.data});
    query.workspaces.refetch.mockResolvedValue({data:query.workspaces.data});
    api.connectWorkspace.mockResolvedValue(undefined);
    api.createBinding.mockResolvedValue({id:'binding'});
  });

  it('connects the workspace before creating an explicit document binding',async()=>{
    const {result}=renderHook(()=>useKnowledgeLinking('model'));
    await act(async()=>{await result.current.link('customer',{kind:'document',workspaceId:'workspace',documentId:'document',name:'Policy.pdf'});});
    expect(api.connectWorkspace).toHaveBeenCalledWith('model','workspace',false);
    expect(api.createBinding).toHaveBeenCalledWith('model',expect.objectContaining({targetKind:'node_type',targetId:'customer',resourceKind:'document',documentId:'document',inclusionMode:'explicit'}));
    expect(api.connectWorkspace.mock.invocationCallOrder[0]).toBeLessThan(api.createBinding.mock.invocationCallOrder[0]);
  });

  it('does not create an exact binding twice',async()=>{
    query.bindings.data=[{id:'binding',targetKind:'node_type',targetId:'customer',resourceKind:'workspace',workspaceId:'workspace',documentId:null,inclusionMode:'dynamic',retrievalMode:'targeted',priority:0,enabled:true,protected:false,availability:'available'}];
    const {result}=renderHook(()=>useKnowledgeLinking('model'));
    let outcome='';
    await act(async()=>{outcome=await result.current.link('customer',{kind:'workspace',workspaceId:'workspace',name:'Credit Risk'});});
    expect(outcome).toBe('already-linked');
    expect(api.createBinding).not.toHaveBeenCalled();
  });

  it('reconciles one revision conflict and retries once',async()=>{
    query.workspaces.data=[{workspaceId:'workspace',role:'connected',enabled:true}];
    query.workspaces.refetch.mockResolvedValue({data:query.workspaces.data});
    api.createBinding.mockRejectedValueOnce({code:'ERR_3703'}).mockResolvedValueOnce({id:'binding'});
    const {result}=renderHook(()=>useKnowledgeLinking('model'));
    await act(async()=>{await result.current.link('customer',{kind:'workspace',workspaceId:'workspace',name:'Credit Risk'});});
    expect(api.createBinding).toHaveBeenCalledTimes(2);
    expect(notifications.showSuccess).toHaveBeenCalled();
  });
});
