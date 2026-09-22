import { useCallback, useMemo, useRef, useState } from 'react';
import { showError, showSuccess } from '@/lib/notifications';
import { useModuleTranslation } from '@/modules/localization';
import { semanticModelApi } from '../api';
import { useSemanticBindings, useSemanticWorkspaces } from '../query/hooks';
import type { KnowledgeBinding } from '../types';

export const KNOWLEDGE_DRAG_TYPE = 'application/x-yellowstorm-knowledge';

export type KnowledgeResource =
  | { kind:'workspace';workspaceId:string;name:string }
  | { kind:'document';workspaceId:string;documentId:string;name:string;structured?:boolean;mappable?:boolean;mimeType?:string;path?:string };

export type KnowledgeDropState = 'valid' | 'already-linked' | 'busy';

export function parseKnowledgeResource(value: string): KnowledgeResource | null {
  try {
    const parsed = JSON.parse(value) as Record<string,unknown>;
    if (parsed.kind==='workspace'&&typeof parsed.workspaceId==='string'&&typeof parsed.name==='string') {
      return {kind:'workspace',workspaceId:parsed.workspaceId,name:parsed.name};
    }
    if (parsed.kind==='document'&&typeof parsed.workspaceId==='string'&&typeof parsed.documentId==='string'&&typeof parsed.name==='string') {
      return {kind:'document',workspaceId:parsed.workspaceId,documentId:parsed.documentId,name:parsed.name,structured:parsed.structured===true,mappable:parsed.mappable===true,mimeType:typeof parsed.mimeType==='string'?parsed.mimeType:undefined,path:typeof parsed.path==='string'?parsed.path:undefined};
    }
  } catch {
    return null;
  }
  return null;
}

export function bindingMatches(binding: KnowledgeBinding,targetId:string,resource:KnowledgeResource): boolean {
  return binding.targetKind==='node_type'
    && binding.targetId===targetId
    && binding.workspaceId===resource.workspaceId
    && binding.resourceKind===resource.kind
    && (binding.documentId??'')===(resource.kind==='document'?resource.documentId:'');
}

function apiCode(error:unknown): string | undefined {
  return error&&typeof error==='object'&&'code' in error?String(error.code):undefined;
}

export function useKnowledgeLinking(modelId:string|undefined) {
  const { t } = useModuleTranslation('semantic-model');
  const bindingsQuery = useSemanticBindings(modelId);
  const workspacesQuery = useSemanticWorkspaces(modelId);
  const [draggedResource,setDraggedResource] = useState<KnowledgeResource|null>(null);
  const [isBusy,setIsBusy] = useState(false);
  const busyRef = useRef(false);
  const bindings = bindingsQuery.data??[];

  const countsByNode = useMemo(()=>{
    const workspaceIds = new Map<string,Set<string>>();
    const documentIds = new Map<string,Set<string>>();
    for (const binding of bindings) {
      if (!binding.enabled||binding.targetKind!=='node_type'||!binding.targetId) continue;
      const collection = binding.resourceKind==='workspace'?workspaceIds:documentIds;
      const values = collection.get(binding.targetId)??new Set<string>();
      values.add(binding.resourceKind==='workspace'?binding.workspaceId:`${binding.workspaceId}:${binding.documentId}`);
      collection.set(binding.targetId,values);
    }
    return Object.fromEntries([...new Set([...workspaceIds.keys(),...documentIds.keys()])].map((nodeId)=>[nodeId,{workspaces:workspaceIds.get(nodeId)?.size??0,documents:documentIds.get(nodeId)?.size??0}]));
  },[bindings]);

  const hasBinding = useCallback((targetId:string,resource:KnowledgeResource,current=bindings)=>current.some((binding)=>bindingMatches(binding,targetId,resource)),[bindings]);

  const remove = useCallback(async(bindingId:string)=>{
    if (!modelId||busyRef.current) return;
    busyRef.current=true;
    setIsBusy(true);
    try {
      await semanticModelApi.deleteBinding(modelId,bindingId);
      await bindingsQuery.refetch();
      showSuccess(t('knowledge.removed'));
    } catch (error) {
      await bindingsQuery.refetch();
      showError(t('knowledge.removeError'),{description:error instanceof Error?error.message:undefined});
    } finally {
      busyRef.current=false;
      setIsBusy(false);
    }
  },[bindingsQuery,modelId,t]);

  const link = useCallback(async(targetId:string,resource:KnowledgeResource):Promise<'linked'|'already-linked'|'busy'>=>{
    if (!modelId||busyRef.current) return 'busy';
    if (hasBinding(targetId,resource)) return 'already-linked';
    busyRef.current=true;
    setIsBusy(true);
    try {
      for (let attempt=0;attempt<2;attempt+=1) {
        const latestBindings=(await bindingsQuery.refetch()).data??[];
        if (hasBinding(targetId,resource,latestBindings)) return 'already-linked';
        const latestLinks=(await workspacesQuery.refetch()).data??[];
        try {
          if (!latestLinks.some((item)=>item.workspaceId===resource.workspaceId&&item.enabled)) {
            await semanticModelApi.connectWorkspace(modelId,resource.workspaceId,false);
            await workspacesQuery.refetch();
          }
          const created=await semanticModelApi.createBinding(modelId,{
            targetKind:'node_type',targetId,resourceKind:resource.kind,workspaceId:resource.workspaceId,
            documentId:resource.kind==='document'?resource.documentId:null,
            inclusionMode:resource.kind==='document'?'explicit':'dynamic',retrievalMode:'targeted',priority:0,
          });
          await bindingsQuery.refetch();
          showSuccess(t('knowledge.bound'),{description:t('knowledge.boundDescription',{name:resource.name}),action:{label:t('action.undo'),onClick:()=>void remove(created.id)}});
          return 'linked';
        } catch (error) {
          if (apiCode(error)==='ERR_3703'&&attempt===0) continue;
          throw error;
        }
      }
      return 'already-linked';
    } catch (error) {
      await Promise.all([bindingsQuery.refetch(),workspacesQuery.refetch()]);
      showError(t('knowledge.bindError'),{description:error instanceof Error?error.message:undefined});
      throw error;
    } finally {
      busyRef.current=false;
      setIsBusy(false);
    }
  },[bindingsQuery,hasBinding,modelId,remove,t,workspacesQuery]);

  return {bindings,workspaceLinks:workspacesQuery.data??[],countsByNode,draggedResource,isBusy,setDraggedResource,hasBinding,link,remove};
}

export type KnowledgeLinkingController = ReturnType<typeof useKnowledgeLinking>;
