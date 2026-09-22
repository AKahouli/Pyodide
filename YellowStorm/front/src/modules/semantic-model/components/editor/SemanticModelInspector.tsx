import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, LockKeyhole, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useModuleTranslation } from '@/modules/localization';
import { useSemanticModelEditorStore } from '../../store';
import type { KnowledgeLinkingController } from '../../hooks/use-knowledge-linking';
import { type SourceMappingTarget, sourceMappingTargetFromResource } from '../mapping/SourceMappingDrawer';
import type { AttributeDefinition, SemanticCorpusDocument, SemanticNodeType, SemanticRecord, SemanticRelationType } from '../../types';
import { businessKey } from '../../utils/model-utils';
import { KnowledgePanel } from '../knowledge/KnowledgePanel';
import { semanticModelApi } from '../../api';
import { useQueryClient } from '@tanstack/react-query';
import { semanticModelQueryKeys } from '../../query/queryKeys';
import { useSourceMappings } from '../../query/hooks';
import { parseApiError } from '@/lib/api-error';
import { showError, showSuccess } from '@/lib/notifications';
import { RelationMatchingPanel } from '../mapping/RelationMatchingPanel';

export function SemanticModelInspector({ modelId = '', canEdit,knowledge,knowledgeOpen,knowledgeTargetId,onKnowledgeClose,onMapData }: Readonly<{ modelId?:string;canEdit:boolean;knowledge:KnowledgeLinkingController;knowledgeOpen:boolean;knowledgeTargetId:string|null;onKnowledgeClose:()=>void;onMapData?:(target:SourceMappingTarget)=>void }>) {
  const { t } = useModuleTranslation('semantic-model');
  const graph = useSemanticModelEditorStore((state) => state.graph);
  const selectedId = useSemanticModelEditorStore((state) => state.selectedId);
  const select = useSemanticModelEditorStore((state) => state.select);
  const node = graph?.nodes.find((item) => item.id === selectedId);
  const relation = graph?.relations.find((item) => item.id === selectedId);
  const record = graph?.records.find((item) => item.id === selectedId);
  if (knowledgeOpen||!selectedId||(!node&&!relation&&!record)) return <aside className={knowledgeOpen?'absolute inset-y-0 right-0 z-30 w-[min(22rem,calc(100%-1rem))] border-l bg-background/95 shadow-2xl backdrop-blur xl:static xl:w-80 xl:shadow-none':'hidden w-80 shrink-0 border-l bg-background/92 xl:block'}><KnowledgePanel canEdit={canEdit} knowledge={knowledge} targetNodeId={knowledgeTargetId} onClose={knowledgeOpen?onKnowledgeClose:undefined} onMapData={(resource)=>onMapData?.(sourceMappingTargetFromResource(resource, knowledgeTargetId ?? undefined))}/></aside>;
  return <aside className='absolute inset-y-0 right-0 z-20 w-[min(22rem,calc(100%-1rem))] overflow-y-auto border-l bg-background/95 p-5 shadow-2xl backdrop-blur xl:static xl:w-80 xl:shadow-none'>
    <div className='mb-5 flex items-center justify-between'><div><p className='text-xs font-medium uppercase tracking-wider text-muted-foreground'>{t('inspector.title')}</p><h2 className='font-semibold'>{node?.label ?? relation?.label ?? record?.label}</h2></div><Button size='icon' variant='ghost' onClick={() => select(null)} aria-label={t('action.close')}><X className='h-4 w-4' /></Button></div>
    {node && <NodeForm modelId={modelId} node={node} locked={Boolean(node.systemKey)} canEdit={canEdit} onMapData={onMapData} />}
    {relation && <RelationForm modelId={modelId} relation={relation} canEdit={canEdit} />}
    {record && <RecordForm record={record} canEdit={canEdit} />}
  </aside>;
}

function NodeForm({ modelId, node: item,locked,canEdit,onMapData }: Readonly<{ modelId:string; node: SemanticNodeType; locked: boolean; canEdit: boolean; onMapData?:(target:SourceMappingTarget)=>void }>) {
  const { t } = useModuleTranslation('semantic-model');
  const graph = useSemanticModelEditorStore((state) => state.graph);
  const commit = useSemanticModelEditorStore((state) => state.commit);
  const commitBatch = useSemanticModelEditorStore((state) => state.commitBatch);
  const select = useSemanticModelEditorStore((state) => state.select);
  const update = (changes: Partial<Omit<SemanticNodeType,'id'|'systemKey'>>) => commit({ type:'node_type.update',id:item.id,changes }, (current) => ({ ...current,nodes:current.nodes.map((candidate) => candidate.id === item.id ? {...candidate,...changes} : candidate) }));
  const [sourceLoading, setSourceLoading] = useState(false);
  const [applyToAllSources, setApplyToAllSources] = useState(false);
  useEffect(() => { setApplyToAllSources(false); }, [item.id]);
  const existingSourceKeys = new Set(graph?.records
    .filter((record) => record.nodeTypeId === item.id)
    .flatMap((record) => {
      const ids = Array.isArray(record.values._source_document_ids) ? record.values._source_document_ids : [record.values._source_document_id];
      const workspaceIds = Array.isArray(record.values._source_workspace_ids) ? record.values._source_workspace_ids : [record.values._source_workspace_id];
      return ids.flatMap((id, index) => typeof id === 'string' && id.length > 0 && typeof workspaceIds[index] === 'string' ? [`${workspaceIds[index]}:${id}`] : []);
    }));
  const legacySourceIds = new Set(graph?.records
    .filter((record) => record.nodeTypeId === item.id && !record.values._source_workspace_id && !Array.isArray(record.values._source_workspace_ids))
    .flatMap((record) => Array.isArray(record.values._source_document_ids) ? record.values._source_document_ids : [record.values._source_document_id])
    .filter((id): id is string => typeof id === 'string' && id.length > 0));
  const toggleApplyToAllSources = async (checked: boolean) => {
    setApplyToAllSources(checked);
    if (!checked || sourceLoading || !modelId || !graph) return;
    setSourceLoading(true);
    try {
      const corpus = await semanticModelApi.corpus(modelId);
      const documents = Array.from(new Map<string, SemanticCorpusDocument>(corpus.bindings
        .filter((binding) => binding.target.kind === 'node_type' && binding.target.id === item.id)
        .flatMap((binding) => binding.documents)
        .map((document) => [`${document.workspaceId}:${document.sourceDocumentId}`, document] as const)).values());
      const records = documents.filter((document) => !existingSourceKeys.has(`${document.workspaceId}:${document.sourceDocumentId}`) && !legacySourceIds.has(document.sourceDocumentId)).map((document, index): SemanticRecord => ({
        id: crypto.randomUUID(), nodeTypeId: item.id, label: document.originalName,
        values: { _source_document_id: document.sourceDocumentId, _source_document_ids: [document.sourceDocumentId], _source_file_name: document.originalName, _source_workspace_id: document.workspaceId, _source_workspace_ids: [document.workspaceId], _source_materialized: true },
        status: 'active', position: { x: 120 + ((graph.records.length + index) % 3) * 304, y: 120 + Math.floor((graph.records.length + index) / 3) * 164 },
      }));
      if (records.length) {
        commitBatch(records.map((entity) => ({ type:'record.create' as const, entity })), (current) => ({ ...current, records: [...current.records, ...records] }));
        showSuccess(t('records.added'));
      } else {
        const ageResult = await semanticModelApi.rebuildAgeGraph(modelId);
        if (ageResult.graphViewerWarning) throw new Error(ageResult.graphViewerWarning);
      }
    } catch (error) {
      setApplyToAllSources(false);
      showError(t('sourceMaterialization.title'), { description: parseApiError(error).message });
    } finally {
      setSourceLoading(false);
    }
  };
  const deleteNode = () => {
    if (!graph) return;
    const relationIds = new Set(graph.relations.filter((candidate)=>candidate.sourceNodeTypeId===item.id||candidate.targetNodeTypeId===item.id).map((candidate)=>candidate.id));
    const recordIds = new Set(graph.records.filter((candidate)=>candidate.nodeTypeId===item.id).map((candidate)=>candidate.id));
    const recordRelationIds = new Set(graph.recordRelations.filter((candidate)=>relationIds.has(candidate.relationTypeId)||recordIds.has(candidate.sourceRecordId)||recordIds.has(candidate.targetRecordId)).map((candidate)=>candidate.id));
    const operations = [
      ...[...recordRelationIds].map((id)=>({type:'record_relation.delete' as const,id})),
      ...[...recordIds].map((id)=>({type:'record.delete' as const,id})),
      ...[...relationIds].map((id)=>({type:'relation_type.delete' as const,id})),
      {type:'node_type.delete' as const,id:item.id},
    ];
    commitBatch(operations,(current)=>({...current,nodes:current.nodes.filter((candidate)=>candidate.id!==item.id),relations:current.relations.filter((candidate)=>!relationIds.has(candidate.id)),records:current.records.filter((candidate)=>!recordIds.has(candidate.id)),recordRelations:current.recordRelations.filter((candidate)=>!recordRelationIds.has(candidate.id))}));
    select(null);
  };
  if (!canEdit) return <div className='space-y-4'><ReadOnlyField label={t('field.label')} value={item.label} /><ReadOnlyField label={t('field.description')} value={item.description||t('editor.noDescription')} /><ReadOnlyField label={t('field.category')} value={t(`category.${item.category}`)} /><ReadOnlyField label={t('field.recordPolicy')} value={t(`recordPolicy.${item.recordPolicy}`)} />{item.attributes.length>0&&<ReadOnlyField label={t('attributes.title')} value={item.attributes.map((attribute)=>attribute.label).join(', ')} />}</div>;
  return <div className='space-y-5'>{locked && <div className='flex gap-2 rounded-xl bg-sky-500/10 p-3 text-xs text-sky-700 dark:text-sky-300'><LockKeyhole className='h-4 w-4 shrink-0' />{t('inspector.protected')}</div>}
    {!locked&&canEdit && <div className='rounded-xl border-2 border-primary/40 bg-primary/5 p-3'><label className='flex cursor-pointer items-start gap-3 text-sm'><input type='checkbox' className='mt-0.5 h-4 w-4' checked={applyToAllSources} disabled={sourceLoading||!modelId} onChange={(event) => void toggleApplyToAllSources(event.target.checked)} />{sourceLoading&&<Loader2 className='h-4 w-4 animate-spin' />}<span><span className='font-semibold text-primary'>{t('sourceMaterialization.title')}</span><span className='mt-1 block text-xs text-muted-foreground'>{t('sourceMaterialization.help')}</span></span></label></div>}
    <Field label={t('field.label')}><Input value={item.label} disabled={locked||!canEdit} onChange={(event) => update({ label:event.target.value,key:businessKey(event.target.value) })} /></Field>
    <Field label={t('field.description')}><Textarea value={item.description} disabled={locked||!canEdit} onChange={(event) => update({ description:event.target.value })} /></Field>
    <Field label={t('field.category')}><Select value={item.category} disabled={locked||!canEdit} onValueChange={(category: SemanticNodeType['category']) => update({ category })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value='business_object'>{t('category.business_object')}</SelectItem><SelectItem value='classification'>{t('category.classification')}</SelectItem></SelectContent></Select></Field>
    <Field label={t('field.recordPolicy')}><Select value={item.recordPolicy} disabled={locked||!canEdit} onValueChange={(recordPolicy: SemanticNodeType['recordPolicy']) => update({ recordPolicy })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{(['none','optional','expected'] as const).map((policy) => <SelectItem key={policy} value={policy}>{t(`recordPolicy.${policy}`)}</SelectItem>)}</SelectContent></Select></Field>
    {!locked&&canEdit && <AttributeEditor attributes={item.attributes} onChange={(attributes) => update({ attributes })} />}
    {!locked&&canEdit && <SourceMappingsSection modelId={modelId} conceptId={item.id} onMapData={onMapData} />}
    {!locked&&canEdit && <><Separator /><Button variant='destructive' className='w-full' onClick={deleteNode}><Trash2 className='mr-2 h-4 w-4' />{t('inspector.deleteConcept')}</Button></>}
  </div>;
}

function SourceMappingsSection({ modelId,conceptId,onMapData }: Readonly<{ modelId:string;conceptId:string;onMapData?:(target:SourceMappingTarget)=>void }>) {
  const { t } = useModuleTranslation('semantic-model');
  const client = useQueryClient();
  const mappingsQuery = useSourceMappings(modelId || undefined);
  const mappings = (mappingsQuery.data ?? []).filter((mapping) => mapping.conceptId === conceptId);
  const remove = async (mappingId: string) => {
    try {
      await semanticModelApi.deleteSourceMapping(modelId, mappingId);
      await Promise.all([
        client.invalidateQueries({ queryKey: semanticModelQueryKeys.sourceMappings(modelId) }),
        client.invalidateQueries({ queryKey: semanticModelQueryKeys.model(modelId) }),
      ]);
    } catch (error) {
      showError(t('mapping.deleteError'), { description: parseApiError(error).message });
    }
  };
  return <div className='space-y-2'>
    <Label>{t('mapping.sourcesTitle', { count: mappings.length })}</Label>
    <p className='text-xs text-muted-foreground'>{t('mapping.sourcesHelp')}</p>
    {mappingsQuery.isLoading ? <Loader2 className='h-4 w-4 animate-spin' />
      : mappingsQuery.isError ? (
        <div className='flex items-start gap-1.5 rounded-lg bg-destructive/10 p-2 text-xs text-destructive'>
          <AlertTriangle className='mt-0.5 h-3.5 w-3.5 shrink-0' />
          <span className='min-w-0 flex-1'>{parseApiError(mappingsQuery.error).message}</span>
          <Button size='sm' variant='ghost' className='h-6 shrink-0 px-2 text-[11px]' onClick={() => void mappingsQuery.refetch()}>{t('action.retry')}</Button>
        </div>
      ) : mappings.length ? (
      <div className='space-y-2'>
        {mappings.map((mapping) => (
          <div key={mapping.id} className='rounded-xl border p-2.5'>
            <p className='truncate text-xs font-medium'>{mapping.documentName ?? mapping.documentId}</p>
            <p className='truncate text-[10px] text-muted-foreground'>{mapping.sheetName}{mapping.identityFields.length ? ` · ${t('mapping.identityShort', { fields: mapping.identityFields.join(', ') })}` : ''}</p>
            <div className='mt-1.5 flex gap-1'>
              <Button size='sm' variant='ghost' className='h-7 px-2 text-[11px]' onClick={() => onMapData?.({ workspaceId: mapping.workspaceId, documentId: mapping.documentId, documentName: mapping.documentName ?? mapping.documentId, assetKind: mapping.assetKind, mimeType: mapping.mimeType, path: mapping.documentPath, mapping })}>{t('mapping.edit')}</Button>
              <Button size='sm' variant='ghost' className='h-7 px-2 text-[11px] text-destructive' disabled={!modelId} onClick={() => void remove(mapping.id)}>{t('mapping.remove')}</Button>
            </div>
          </div>
        ))}
      </div>
    ) : <p className='rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground'>{t('mapping.noSources')}</p>}
  </div>;
}

function RelationForm({ modelId,relation: item,canEdit }: Readonly<{ modelId: string; relation: SemanticRelationType; canEdit: boolean }>) {
  const { t } = useModuleTranslation('semantic-model');
  const graph = useSemanticModelEditorStore((state) => state.graph);
  const commit = useSemanticModelEditorStore((state) => state.commit);
  const commitBatch = useSemanticModelEditorStore((state) => state.commitBatch);
  const select = useSemanticModelEditorStore((state) => state.select);
  const update = (changes: Partial<Omit<SemanticRelationType,'id'>>) => commit({ type:'relation_type.update',id:item.id,changes }, (current) => ({ ...current,relations:current.relations.map((candidate) => candidate.id === item.id ? {...candidate,...changes} : candidate) }));
  const deleteRelation = () => {
    if (!graph) return;
    const recordRelationIds = graph.recordRelations.filter((candidate)=>candidate.relationTypeId===item.id).map((candidate)=>candidate.id);
    const operations = [...recordRelationIds.map((id)=>({type:'record_relation.delete' as const,id})),{type:'relation_type.delete' as const,id:item.id}];
    commitBatch(operations,(current)=>({...current,relations:current.relations.filter((candidate)=>candidate.id!==item.id),recordRelations:current.recordRelations.filter((candidate)=>!recordRelationIds.includes(candidate.id))}));
    select(null);
  };
  if (!canEdit) return <div className='space-y-4'><ReadOnlyField label={t('field.label')} value={item.label} />{item.inverseLabel&&<ReadOnlyField label={t('field.inverseLabel')} value={item.inverseLabel} />}{item.description&&<ReadOnlyField label={t('field.description')} value={item.description} />}<ReadOnlyField label={t('field.cardinality')} value={t(`cardinality.${item.cardinality}`)} /></div>;
  return <Tabs defaultValue='overview' className='space-y-4'>
    <TabsList className='grid w-full grid-cols-2'><TabsTrigger value='overview'>{t('relationMatching.overview')}</TabsTrigger><TabsTrigger value='matching'>{t('relationMatching.matching')}</TabsTrigger></TabsList>
    <TabsContent value='overview' className='space-y-5'><Field label={t('field.label')}><Input value={item.label} disabled={!canEdit} onChange={(event) => update({label:event.target.value,key:businessKey(event.target.value)})} /></Field><Field label={t('field.inverseLabel')}><Input value={item.inverseLabel} disabled={!canEdit} onChange={(event) => update({inverseLabel:event.target.value})} /></Field><Field label={t('field.description')}><Textarea value={item.description} disabled={!canEdit} onChange={(event) => update({description:event.target.value})} /></Field><Field label={t('field.cardinality')}><Select value={item.cardinality} disabled={!canEdit} onValueChange={(cardinality: SemanticRelationType['cardinality']) => update({cardinality})}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{(['one_to_one','one_to_many','many_to_one','many_to_many'] as const).map((value) => <SelectItem key={value} value={value}>{t(`cardinality.${value}`)}</SelectItem>)}</SelectContent></Select></Field><div className='flex items-center justify-between'><Label>{t('field.traversable')}</Label><Switch checked={item.traversable} disabled={!canEdit} onCheckedChange={(traversable) => update({traversable})} /></div>{canEdit&&<><Separator /><Button variant='destructive' className='w-full' onClick={deleteRelation}><Trash2 className='mr-2 h-4 w-4' />{t('inspector.deleteRelationship')}</Button></>}</TabsContent>
    <TabsContent value='matching'><RelationMatchingPanel modelId={modelId} relation={item} /></TabsContent>
  </Tabs>;
}

function RecordForm({ record: item,canEdit }: Readonly<{ record: SemanticRecord; canEdit: boolean }>) {
  const { t } = useModuleTranslation('semantic-model');
  const graph = useSemanticModelEditorStore((state) => state.graph);
  const commit = useSemanticModelEditorStore((state) => state.commit);
  const select = useSemanticModelEditorStore((state) => state.select);
  const type = graph?.nodes.find((candidate) => candidate.id === item.nodeTypeId);
  const update = (changes: Partial<Omit<SemanticRecord,'id'|'nodeTypeId'>>) => commit({type:'record.update',id:item.id,changes},(current) => ({...current,records:current.records.map((candidate) => candidate.id === item.id ? {...candidate,...changes} : candidate)}));
  if (!canEdit) return <div className='space-y-4'><ReadOnlyField label={t('records.type')} value={type?.label??''} /><ReadOnlyField label={t('field.label')} value={item.label} />{type?.attributes.map((attribute)=><ReadOnlyField key={attribute.key} label={attribute.label} value={String(item.values[attribute.key]??'')} />)}</div>;
  return <div className='space-y-5'><p className='rounded-xl bg-muted p-3 text-xs text-muted-foreground'>{t('records.instanceOf',{ name:type?.label ?? '' })}</p><Field label={t('field.label')}><Input value={item.label} disabled={!canEdit} onChange={(event) => update({label:event.target.value})} /></Field>{type?.attributes.map((attribute) => <Field key={attribute.key} label={attribute.label}><Input value={String(item.values[attribute.key] ?? '')} disabled={!canEdit} onChange={(event) => update({values:{...item.values,[attribute.key]:event.target.value}})} /></Field>)}{canEdit&&<><Separator /><Button variant='destructive' className='w-full' onClick={() => { commit({type:'record.delete',id:item.id},(current) => ({...current,records:current.records.filter((candidate) => candidate.id !== item.id),recordRelations:current.recordRelations.filter((candidate) => candidate.sourceRecordId !== item.id && candidate.targetRecordId !== item.id)})); select(null); }}><Trash2 className='mr-2 h-4 w-4' />{t('records.delete')}</Button></>}</div>;
}

function Field({ label,children }: Readonly<{ label: string; children: React.ReactNode }>) { return <div className='space-y-2'><Label>{label}</Label>{children}</div>; }

function ReadOnlyField({ label,value }: Readonly<{ label: string; value: string }>) { return <div><p className='text-xs font-medium text-muted-foreground'>{label}</p><p className='mt-1 text-sm'>{value}</p></div>; }

function AttributeEditor({ attributes,onChange }: Readonly<{ attributes: AttributeDefinition[]; onChange: (attributes: AttributeDefinition[]) => void }>) {
  const { t } = useModuleTranslation('semantic-model');
  const [label,setLabel] = useState('');
  const add = () => { if (!label.trim()) return; onChange([...attributes,{key:businessKey(label),label:label.trim(),type:'text',required:false}]); setLabel(''); };
  return <div className='space-y-3'><div><Label>{t('attributes.title')}</Label><p className='text-xs text-muted-foreground'>{t('attributes.help')}</p></div>{attributes.map((attribute,index) => <div key={`${attribute.key}-${index}`} className='flex items-center gap-2 rounded-lg border p-2'><Input className='h-8' value={attribute.label} onChange={(event) => onChange(attributes.map((item,itemIndex) => itemIndex === index ? {...item,label:event.target.value,key:businessKey(event.target.value)} : item))} /><Button size='icon' variant='ghost' onClick={() => onChange(attributes.filter((_,itemIndex) => itemIndex !== index))} aria-label={t('attributes.remove')}><Trash2 className='h-4 w-4' /></Button></div>)}<div className='flex gap-2'><Input value={label} onChange={(event) => setLabel(event.target.value)} placeholder={t('attributes.placeholder')} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); add(); } }} /><Button size='icon' variant='outline' onClick={add} aria-label={t('attributes.add')}><Plus className='h-4 w-4' /></Button></div></div>;
}
