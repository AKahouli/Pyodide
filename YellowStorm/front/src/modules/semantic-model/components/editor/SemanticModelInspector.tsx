import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { AlertTriangle, GitMerge, KeyRound, Loader2, LockKeyhole, Plus, Table2, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useModuleTranslation } from '@/modules/localization';
import { useSemanticModelEditorStore } from '../../store';
import type { KnowledgeLinkingController } from '../../hooks/use-knowledge-linking';
import { type SourceMappingTarget, sourceMappingTargetFromResource, sourceMappingTargetFromWorkspace } from '../mapping/SourceMappingDrawer';
import type { AttributeDefinition, SemanticNodeType, SemanticRecord, SemanticRelationType } from '../../types';
import { businessKey, guessAttributeType } from '../../utils/model-utils';
import { conceptDeletion, relationDeletion } from '../../utils/graph-deletes';
import { cardinalityOf, relationSentence, relationSides, type Multiplicity } from '../../utils/relation-sentence';
import { KnowledgePanel } from '../knowledge/KnowledgePanel';
import { semanticModelApi } from '../../api';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { semanticModelQueryKeys } from '../../query/queryKeys';
import { useDerivedSources, useIdentityRules, useSourceMappings } from '../../query/hooks';
import type { DerivedSourceTarget } from '../mapping/DerivedSourceDrawer';
import { parseApiError } from '@/lib/api-error';
import { showError } from '@/lib/notifications';
import { cn } from '@/lib/utils';
import { RelationMatchingPanel } from '../mapping/RelationMatchingPanel';

export function SemanticModelInspector({ modelId = '', canEdit,knowledge,knowledgeOpen,knowledgeTargetId,onKnowledgeClose,onMapData,onDeriveData,onBrowseRecords,recordCounts,workspace = false }: Readonly<{ modelId?:string;canEdit:boolean;knowledge:KnowledgeLinkingController;knowledgeOpen:boolean;knowledgeTargetId:string|null;onKnowledgeClose:()=>void;onMapData?:(target:SourceMappingTarget)=>void;onDeriveData?:(target:DerivedSourceTarget)=>void;onBrowseRecords?:(conceptId:string)=>void;recordCounts?:Record<string,number>;workspace?:boolean }>) {
  const { t } = useModuleTranslation('semantic-model');
  const graph = useSemanticModelEditorStore((state) => state.graph);
  const selectedId = useSemanticModelEditorStore((state) => state.selectedId);
  const select = useSemanticModelEditorStore((state) => state.select);
  const node = graph?.nodes.find((item) => item.id === selectedId);
  const relation = graph?.relations.find((item) => item.id === selectedId);
  const record = graph?.records.find((item) => item.id === selectedId);
  useFocusSection();
  const knowledgePanel = <KnowledgePanel canEdit={canEdit} knowledge={knowledge} targetNodeId={knowledgeTargetId} onClose={onKnowledgeClose} onMapData={(resource)=>onMapData?.(sourceMappingTargetFromResource(resource, knowledgeTargetId ?? undefined))} onMapWorkspace={onMapData?(scope)=>onMapData(sourceMappingTargetFromWorkspace(scope, knowledgeTargetId ?? undefined)):undefined}/>;
  if (knowledgeOpen) return workspace
    ? <aside className='absolute inset-y-0 right-0 z-30 w-[min(26rem,100%)] border-l bg-background shadow-xl'>{knowledgePanel}</aside>
    : <ResizableSidePanel className='z-30 bg-background/95 shadow-2xl backdrop-blur xl:shadow-none'>{knowledgePanel}</ResizableSidePanel>;
  if (!selectedId||(!node&&!relation&&!record)) return workspace ? <div className='flex flex-1 items-center justify-center bg-muted/20 p-6'><div className='max-w-sm text-center'><h2 className='text-lg font-semibold'>{t('inspector.emptyTitle')}</h2><p className='mt-2 text-sm text-muted-foreground'>{t('workspaceUi.chooseObject')}</p></div></div> : null;
  const content = <>
    <div className={workspace ? 'mx-auto max-w-2xl' : undefined}>
    <div className='mb-6 flex items-center justify-between'><h2 className={workspace ? 'text-xl font-semibold' : 'font-semibold'}>{node?.label ?? relation?.label ?? record?.label}</h2>{!workspace && <Button size='icon' variant='ghost' onClick={() => select(null)} aria-label={t('action.close')}><X className='h-4 w-4' /></Button>}</div>
    {node && !node.systemKey && onBrowseRecords && <RecordsSummary count={recordCounts?.[node.id]} label={node.label} onBrowse={() => onBrowseRecords(node.id)} />}
    {node && <NodeForm modelId={modelId} node={node} locked={Boolean(node.systemKey)} canEdit={canEdit} onMapData={onMapData} onDeriveData={onDeriveData} />}
    {relation && <RelationForm modelId={modelId} relation={relation} canEdit={canEdit} />}
    {record && <RecordForm record={record} canEdit={canEdit} />}
    </div>
  </>;
  return workspace
    ? <aside className='min-w-0 flex-1 overflow-y-auto bg-background px-5 pt-6 pb-28 sm:px-8'>{content}</aside>
    : <ResizableSidePanel className='z-20 bg-background shadow-xl xl:shadow-none' bodyClassName='p-5 pb-28'>{content}</ResizableSidePanel>;
}

/** Brings the part of the details a review item points at into view, and marks it for a moment. */
function useFocusSection() {
  const focusRequest = useSemanticModelEditorStore((state) => state.focusRequest);
  useEffect(() => {
    const section = focusRequest?.section;
    if (!section) return;
    let timer: number | undefined;
    // The panel renders the selection first; the section exists on the next frame.
    const frame = window.requestAnimationFrame(() => {
      const element = document.querySelector<HTMLElement>(`[data-focus-section="${section}"]`);
      if (!element) return;
      element.scrollIntoView({ block: 'start', behavior: 'smooth' });
      element.classList.add('rounded-xl', 'ring-2', 'ring-primary', 'ring-offset-4', 'ring-offset-background');
      timer = window.setTimeout(() => element.classList.remove('rounded-xl', 'ring-2', 'ring-primary', 'ring-offset-4', 'ring-offset-background'), 2500);
    });
    return () => { window.cancelAnimationFrame(frame); window.clearTimeout(timer); };
  }, [focusRequest]);
}

/** How many records the concept holds in the data in use, and the way to look through them. */
function RecordsSummary({ count, label, onBrowse }: Readonly<{ count?: number; label: string; onBrowse: () => void }>) {
  const { t } = useModuleTranslation('semantic-model');
  return <div className='mb-6 flex items-center gap-3 rounded-xl border bg-muted/30 p-3'>
    <div className='min-w-0 flex-1'>
      <p className='text-sm font-semibold'>{count === undefined ? t('records.table.noDataShort') : t('records.table.count', { count })}</p>
      <p className='text-xs text-muted-foreground'>{t('records.table.summaryHint', { name: label })}</p>
    </div>
    <Button size='sm' variant='outline' onClick={onBrowse}><Table2 className='mr-1.5 h-4 w-4' />{t('records.table.browse')}</Button>
  </div>;
}

const PANEL_WIDTH_KEY = 'semantic-model.side-panel-width';
const PANEL_MIN = 320;
const PANEL_DEFAULT = 416;
const panelMax = () => Math.max(PANEL_MIN, Math.round(window.innerWidth * 0.7));
const clampPanel = (width: number) => Math.min(panelMax(), Math.max(PANEL_MIN, Math.round(width)));
function storedPanelWidth(): number {
  try { const saved = Number(window.localStorage.getItem(PANEL_WIDTH_KEY)); return saved ? clampPanel(saved) : PANEL_DEFAULT; } catch { return PANEL_DEFAULT; }
}
function savePanelWidth(width: number) {
  try { window.localStorage.setItem(PANEL_WIDTH_KEY, String(width)); } catch { /* the width is a convenience; it is fine not to keep it */ }
}

/** The side panel on the right of the canvas. Its left edge drags to make it wider or narrower; the width is remembered. */
export function ResizableSidePanel({ children, className, bodyClassName }: Readonly<{ children: ReactNode; className?: string; bodyClassName?: string }>) {
  const { t } = useModuleTranslation('semantic-model');
  const [width, setWidth] = useState(storedPanelWidth);
  const [resizing, setResizing] = useState(false);
  const widthRef = useRef(width);
  const apply = (next: number) => { widthRef.current = next; setWidth(next); };
  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = widthRef.current;
    setResizing(true);
    const move = (moveEvent: PointerEvent) => apply(clampPanel(startWidth + startX - moveEvent.clientX));
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      setResizing(false);
      savePanelWidth(widthRef.current);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  };
  const resizeWithKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 64 : 16;
    const next = event.key === 'ArrowLeft' ? widthRef.current + step : event.key === 'ArrowRight' ? widthRef.current - step : null;
    if (next === null) return;
    event.preventDefault();
    apply(clampPanel(next));
    savePanelWidth(widthRef.current);
  };
  const reset = () => { apply(clampPanel(PANEL_DEFAULT)); savePanelWidth(widthRef.current); };
  return <aside style={{ width: `min(${width}px, calc(100% - 1rem))` }}
    className={cn('absolute inset-y-0 right-0 flex shrink-0 border-l xl:relative', resizing && 'select-none', className)}>
    <div role='separator' aria-orientation='vertical' aria-label={t('inspector.resize')} title={t('inspector.resizeHint')}
      aria-valuenow={width} aria-valuemin={PANEL_MIN} aria-valuemax={panelMax()} tabIndex={0}
      onPointerDown={startResize} onKeyDown={resizeWithKeys} onDoubleClick={reset}
      className={cn('group absolute inset-y-0 -left-1.5 z-10 flex w-3 cursor-col-resize justify-center focus-visible:outline-none')}>
      <span className={cn('h-full w-0.5 transition-colors group-hover:bg-primary/60 group-focus-visible:bg-primary', resizing && 'bg-primary')} />
    </div>
    <div className={cn('min-h-0 min-w-0 flex-1 overflow-y-auto', bodyClassName)}>{children}</div>
  </aside>;
}

function NodeForm({ modelId, node: item,locked,canEdit,onMapData,onDeriveData }: Readonly<{ modelId:string; node: SemanticNodeType; locked: boolean; canEdit: boolean; onMapData?:(target:SourceMappingTarget)=>void; onDeriveData?:(target:DerivedSourceTarget)=>void }>) {
  const { t } = useModuleTranslation('semantic-model');
  const graph = useSemanticModelEditorStore((state) => state.graph);
  const commit = useSemanticModelEditorStore((state) => state.commit);
  const commitBatch = useSemanticModelEditorStore((state) => state.commitBatch);
  const select = useSemanticModelEditorStore((state) => state.select);
  const update = (changes: Partial<Omit<SemanticNodeType,'id'|'systemKey'>>) => commit({ type:'node_type.update',id:item.id,changes }, (current) => ({ ...current,nodes:current.nodes.map((candidate) => candidate.id === item.id ? {...candidate,...changes} : candidate) }));
  const deleteNode = () => {
    if (!graph) return;
    const deletion = conceptDeletion(graph, item.id);
    commitBatch(deletion.operations, deletion.update);
    select(null);
  };
  if (!canEdit) return <div className='space-y-4'><ReadOnlyField label={t('field.label')} value={item.label} /><ReadOnlyField label={t('field.description')} value={item.description||t('editor.noDescription')} /><ReadOnlyField label={t('field.category')} value={t(`category.${item.category}`)} /><ReadOnlyField label={t('field.recordPolicy')} value={t(`recordPolicy.${item.recordPolicy}`)} />{item.attributes.length>0&&<ReadOnlyField label={t('attributes.title')} value={item.attributes.map((attribute)=>attribute.label).join(', ')} />}</div>;
  return <div className='space-y-6'>{locked && <div className='flex gap-2 rounded-xl bg-sky-500/10 p-3 text-xs text-sky-700 dark:text-sky-300'><LockKeyhole className='h-4 w-4 shrink-0' />{t('inspector.protected')}</div>}
    <div className='space-y-4'><h3 className='font-semibold'>{t('workspaceUi.meaning')}</h3>
    <Field label={t('field.label')}><Input value={item.label} disabled={locked||!canEdit} onChange={(event) => update({ label:event.target.value,key:businessKey(event.target.value) })} /></Field>
    <Field label={t('field.description')}><Textarea value={item.description} disabled={locked||!canEdit} placeholder={t('concept.descriptionPlaceholder')} onChange={(event) => update({ description:event.target.value })} /></Field>
    {!locked && <div className='space-y-2'><Label>{t('aliases.title')}</Label><p className='text-xs text-muted-foreground'>{t('aliases.help', { name: item.label })}</p><AliasChips values={item.aliases ?? []} onChange={(aliases) => update({ aliases })} placeholder={t('aliases.placeholder')} /></div>}</div>
    {!locked&&canEdit && <section className='space-y-3 border-t pt-5'><AttributeEditor attributes={item.attributes} onChange={(attributes) => update({ attributes })} /></section>}
    {!locked&&modelId && <section data-focus-section='identity' className='space-y-3 border-t pt-5'><IdentitySection modelId={modelId} node={item} canEdit={canEdit} /></section>}
    <section className='space-y-3 border-t pt-5'><h3 className='font-semibold'>{t('workspaceUi.relationships')}</h3>{(graph?.relations.filter((relation) => relation.sourceNodeTypeId === item.id || relation.targetNodeTypeId === item.id) ?? []).map((relation) => { const other = graph?.nodes.find((node) => node.id === (relation.sourceNodeTypeId === item.id ? relation.targetNodeTypeId : relation.sourceNodeTypeId)); const labels = relation.sourceNodeTypeId === item.id ? { source: item.label, target: other?.label ?? '' } : { source: other?.label ?? '', target: item.label }; return <button key={relation.id} type='button' onClick={() => select(relation.id)} className='block w-full rounded-xl bg-muted/50 p-3 text-left text-sm hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary'>{relationSentence(relation, labels, item.id, t as (key: string, options?: Record<string, unknown>) => string)}</button>; })}{!graph?.relations.some((relation) => relation.sourceNodeTypeId === item.id || relation.targetNodeTypeId === item.id) && <p className='text-sm text-muted-foreground'>{t('workspaceUi.noRelationships')}</p>}</section>
    {!locked&&canEdit && <section data-focus-section='sources' className='border-t pt-5'><SourceMappingsSection modelId={modelId} conceptId={item.id} onMapData={onMapData} onDeriveData={onDeriveData} /></section>}
    <details className='border-t pt-5'><summary className='cursor-pointer text-sm font-semibold'>{t('workspaceUi.advanced')}</summary><div className='mt-4 space-y-4'>
    <Field label={t('field.category')}><Select value={item.category} disabled={locked||!canEdit} onValueChange={(category: SemanticNodeType['category']) => update({ category })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value='business_object'>{t('category.business_object')}</SelectItem><SelectItem value='classification'>{t('category.classification')}</SelectItem></SelectContent></Select></Field>
    <Field label={t('field.recordPolicy')}><Select value={item.recordPolicy} disabled={locked||!canEdit} onValueChange={(recordPolicy: SemanticNodeType['recordPolicy']) => update({ recordPolicy })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{(['none','optional','expected'] as const).map((policy) => <SelectItem key={policy} value={policy}>{t(`recordPolicy.${policy}`)}</SelectItem>)}</SelectContent></Select></Field>
    {!locked&&canEdit && <><Separator /><Button variant='destructive' onClick={deleteNode}><Trash2 className='mr-2 h-4 w-4' />{t('inspector.deleteConcept')}</Button></>}
    </div></details>
  </div>;
}

/** "What makes each <concept> unique?": the identity rule, chosen on the concept itself. */
export function IdentitySection({ modelId, node, canEdit }: Readonly<{ modelId: string; node: SemanticNodeType; canEdit: boolean }>) {
  const { t } = useModuleTranslation('semantic-model');
  const client = useQueryClient();
  const rules = useIdentityRules(modelId);
  const mappings = useSourceMappings(modelId);
  const fields = rules.data?.find((rule) => rule.conceptId === node.id)?.fields ?? [];
  const mapped = (mappings.data ?? []).some((mapping) => mapping.conceptId === node.id);
  const save = useMutation({
    mutationFn: (next: string[]) => semanticModelApi.saveIdentityRule(modelId, node.id, next),
    onSuccess: async (result) => {
      useSemanticModelEditorStore.getState().adoptRevision(result.revision);
      await Promise.all([
        client.invalidateQueries({ queryKey: semanticModelQueryKeys.identityRules(modelId) }),
        client.invalidateQueries({ queryKey: semanticModelQueryKeys.sourceMappings(modelId) }),
        client.invalidateQueries({ queryKey: semanticModelQueryKeys.readiness(modelId) }),
        client.invalidateQueries({ queryKey: semanticModelQueryKeys.model(modelId) }),
      ]);
    },
    onError: (error) => showError(t('identity.saveError'), { description: parseApiError(error).message }),
  });
  const toggle = (key: string) => save.mutate(fields.includes(key) ? fields.filter((field) => field !== key) : [...fields, key]);
  return <div className='space-y-2'>
    <h3 className='font-semibold'>{t('identity.title', { name: node.label })}</h3>
    <p className='text-xs text-muted-foreground'>{t('identity.help', { name: node.label })}</p>
    {mapped && !fields.length && !rules.isLoading && <p role='alert' className='flex gap-2 rounded-lg bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400'><AlertTriangle className='h-4 w-4 shrink-0' />{t('identity.missing', { name: node.label })}</p>}
    {node.attributes.length === 0 ? <p className='rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground'>{t('identity.noFields')}</p>
      : <div className='flex flex-wrap gap-2'>{node.attributes.map((attribute) => {
        const active = fields.includes(attribute.key);
        return <button key={attribute.key} type='button' aria-pressed={active} disabled={!canEdit || save.isPending || rules.isLoading}
          onClick={() => toggle(attribute.key)}
          className={`flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-default ${active ? 'border-amber-500/60 bg-amber-500/10 font-medium text-amber-800 dark:text-amber-300' : 'hover:bg-muted'}`}>
          {active && <KeyRound className='h-3 w-3' />}{attribute.label || attribute.key}
        </button>;
      })}{save.isPending && <Loader2 className='h-4 w-4 animate-spin self-center' />}</div>}
  </div>;
}

function SourceMappingsSection({ modelId,conceptId,onMapData,onDeriveData }: Readonly<{ modelId:string;conceptId:string;onMapData?:(target:SourceMappingTarget)=>void;onDeriveData?:(target:DerivedSourceTarget)=>void }>) {
  const { t } = useModuleTranslation('semantic-model');
  const client = useQueryClient();
  const mappingsQuery = useSourceMappings(modelId || undefined);
  const mappings = (mappingsQuery.data ?? []).filter((mapping) => mapping.conceptId === conceptId);
  const graph = useSemanticModelEditorStore((state) => state.graph);
  const derived = (useDerivedSources(modelId || undefined).data ?? []).filter((source) => source.conceptId === conceptId);
  const conceptLabel = (id: string) => graph?.nodes.find((node) => node.id === id)?.label ?? '';
  const fieldLabel = (id: string, key: string) => graph?.nodes.find((node) => node.id === id)?.attributes.find((field) => field.key === key)?.label ?? key;
  const identity = useIdentityRules(modelId || undefined).data?.find((rule) => rule.conceptId === conceptId)?.fields ?? [];
  const remove = async (mappingId: string) => {
    try {
      const result = await semanticModelApi.deleteSourceMapping(modelId, mappingId);
      useSemanticModelEditorStore.getState().adoptRevision(result.revision);
      await Promise.all([
        client.invalidateQueries({ queryKey: semanticModelQueryKeys.sourceMappings(modelId) }),
        client.invalidateQueries({ queryKey: semanticModelQueryKeys.model(modelId) }),
      ]);
    } catch (error) {
      showError(t('mapping.deleteError'), { description: parseApiError(error).message });
    }
  };
  return <div className='space-y-2'>
    <Label>{t('mapping.sourcesTitle', { count: mappings.length + derived.length })}</Label>
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
    ) : !derived.length && <p className='rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground'>{t('mapping.noSources')}</p>}
    {derived.map((source) => <div key={source.id} className='rounded-xl border border-teal-500/40 p-2.5'>
      <p className='flex items-center gap-1.5 truncate text-xs font-medium'><GitMerge className='h-3.5 w-3.5 shrink-0' />{t('derived.fromConcept', { source: conceptLabel(source.sourceConceptId) })}</p>
      <p className='truncate text-[10px] text-muted-foreground'>{t('derived.summary', { fields: identity.map((key) => fieldLabel(conceptId, key)).join(', '), rule: t(`derived.rule.${source.conflictRule}`) })}</p>
      {onDeriveData && <Button size='sm' variant='ghost' className='mt-1.5 h-7 px-2 text-[11px]' onClick={() => onDeriveData({ conceptId, derived: source })}>{t('mapping.edit')}</Button>}
    </div>)}
    {onDeriveData && !derived.length && <Button size='sm' variant='outline' className='h-8 w-full text-xs' onClick={() => onDeriveData({ conceptId })}>
      <GitMerge className='mr-1.5 h-3.5 w-3.5' />{t('derived.add')}
    </Button>}
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
    const deletion = relationDeletion(graph, item.id);
    commitBatch(deletion.operations, deletion.update);
    select(null);
  };
  const source = graph?.nodes.find((candidate) => candidate.id === item.sourceNodeTypeId);
  const target = graph?.nodes.find((candidate) => candidate.id === item.targetNodeTypeId);
  const labels = { source: source?.label ?? '', target: target?.label ?? '' };
  const translate = t as (key: string, options?: Record<string, unknown>) => string;
  if (!canEdit) return <div className='space-y-4'><div className='space-y-1 rounded-xl bg-muted/50 p-3 text-sm'><p>{relationSentence(item, labels, item.sourceNodeTypeId, translate)}</p>{item.sourceNodeTypeId !== item.targetNodeTypeId && <p>{relationSentence(item, labels, item.targetNodeTypeId, translate)}</p>}</div>{item.description&&<ReadOnlyField label={t('field.description')} value={item.description} />}</div>;
  return <div className='space-y-6'>
    <RelationSentenceEditor relation={item} labels={labels} onChange={update} />
    <section data-focus-section='matching' className='space-y-3 border-t pt-5'><div><h3 className='font-semibold'>{t('relationSentence.linkTitle')}</h3><p className='text-xs text-muted-foreground'>{t('relationSentence.linkHelp')}</p></div><RelationMatchingPanel modelId={modelId} relation={item} /></section>
    <details className='border-t pt-5'><summary className='cursor-pointer text-sm font-semibold'>{t('workspaceUi.advanced')}</summary><div className='mt-4 space-y-4'>
      <Field label={t('field.description')}><Textarea value={item.description} onChange={(event) => update({description:event.target.value})} /></Field>
      <div className='flex items-center justify-between'><Label>{t('field.traversable')}</Label><Switch checked={item.traversable} onCheckedChange={(traversable) => update({traversable})} /></div>
      <Separator /><Button variant='destructive' className='w-full' onClick={deleteRelation}><Trash2 className='mr-2 h-4 w-4' />{t('inspector.deleteRelationship')}</Button>
    </div></details>
  </div>;
}

/** "Each Contract [belongs to] [one] Customer" and its reverse, editing the label, inverse label and cardinality together. */
function RelationSentenceEditor({ relation, labels, onChange }: Readonly<{ relation: SemanticRelationType; labels: { source: string; target: string }; onChange: (changes: Partial<Omit<SemanticRelationType,'id'>>) => void }>) {
  const { t } = useModuleTranslation('semantic-model');
  const { forward, reverse } = relationSides(relation.cardinality);
  const multiplicity = (value: Multiplicity, onValue: (next: Multiplicity) => void, label: string) => <Select value={value} onValueChange={(next: Multiplicity) => onValue(next)}>
    <SelectTrigger className='h-9 w-28' aria-label={label}><SelectValue /></SelectTrigger>
    <SelectContent><SelectItem value='one'>{t('relationSentence.one')}</SelectItem><SelectItem value='many'>{t('relationSentence.many')}</SelectItem></SelectContent>
  </Select>;
  const row = (subject: string, object: string, verb: React.ReactNode, count: React.ReactNode) => <div className='flex flex-wrap items-center gap-2 text-sm'>
    <span>{t('relationSentence.each')}</span><span className='font-medium'>{subject}</span>{verb}{count}<span className='font-medium'>{object}</span>
  </div>;
  return <section className='space-y-3'>
    <div><h3 className='font-semibold'>{t('relationSentence.title')}</h3><p className='text-xs text-muted-foreground'>{t('relationSentence.help')}</p></div>
    <div className='space-y-3 rounded-xl bg-muted/40 p-3'>
      {row(labels.source, labels.target,
        <Input className='h-9 w-40' value={relation.label} placeholder={t('relationSentence.verbPlaceholder')} aria-label={t('relationSentence.verbFor', { subject: labels.source, object: labels.target })} onChange={(event) => onChange({ label: event.target.value, key: businessKey(event.target.value) })} />,
        multiplicity(forward, (next) => onChange({ cardinality: cardinalityOf(reverse, next) }), t('relationSentence.howManyFor', { subject: labels.source, object: labels.target })))}
      {row(labels.target, labels.source,
        <Input className='h-9 w-40' value={relation.inverseLabel} placeholder={t('relationSentence.inversePlaceholder')} aria-label={t('relationSentence.verbFor', { subject: labels.target, object: labels.source })} onChange={(event) => onChange({ inverseLabel: event.target.value })} />,
        multiplicity(reverse, (next) => onChange({ cardinality: cardinalityOf(next, forward) }), t('relationSentence.howManyFor', { subject: labels.target, object: labels.source })))}
    </div>
  </section>;
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
  const add = () => { if (!label.trim()) return; onChange([...attributes,{key:businessKey(label),label:label.trim(),type:guessAttributeType(label),required:false}]); setLabel(''); };
  const edit = (index: number, changes: Partial<AttributeDefinition>) => onChange(attributes.map((attribute, itemIndex) => itemIndex === index ? { ...attribute, ...changes } : attribute));
  return <div className='space-y-3'><div><h3 className='font-semibold'>{t('attributes.title')}</h3><p className='text-xs text-muted-foreground'>{t('attributes.help')}</p></div><div className='space-y-2'>{attributes.map((attribute,index) => <div key={index} className='grid gap-2 rounded-xl bg-muted/40 p-3 sm:grid-cols-[minmax(0,1fr)_9rem_auto] sm:items-center'><Input value={attribute.label} aria-label={t('attributes.nameFor', { name: attribute.label })} onChange={(event) => edit(index, { label:event.target.value, key:businessKey(event.target.value) })} /><Select value={attribute.type} onValueChange={(type: AttributeDefinition['type']) => edit(index, { type })}><SelectTrigger aria-label={t('attributes.typeFor', { name: attribute.label })}><SelectValue /></SelectTrigger><SelectContent>{(['text','number','boolean','date','enum'] as const).map((type) => <SelectItem key={type} value={type}>{t(`attribute.type.${type}`)}</SelectItem>)}</SelectContent></Select><Button size='icon' variant='ghost' onClick={() => onChange(attributes.filter((_,itemIndex) => itemIndex !== index))} aria-label={t('attributes.remove')}><Trash2 className='h-4 w-4' /></Button><label className='flex items-center gap-2 text-xs text-muted-foreground sm:col-span-3'><input type='checkbox' checked={attribute.required} onChange={(event) => edit(index, { required: event.target.checked })} />{t('attributes.required')}</label><div className='sm:col-span-3'><AliasChips values={attribute.aliases ?? []} onChange={(aliases) => edit(index, { aliases })} placeholder={t('aliases.fieldPlaceholder', { name: attribute.label })} compact /></div>{attribute.type === 'enum' && <Input className='sm:col-span-3' defaultValue={attribute.options?.join(', ') ?? ''} onBlur={(event) => edit(index, { options: event.target.value.split(',').map((option) => option.trim()).filter(Boolean) })} placeholder={t('attributes.optionsPlaceholder')} aria-label={t('attributes.optionsFor', { name: attribute.label })} />}</div>)}</div><div className='flex gap-2'><Input value={label} onChange={(event) => setLabel(event.target.value)} placeholder={t('attributes.placeholder')} aria-label={t('attributes.add')} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); add(); } }} /><Button size='icon' variant='outline' onClick={add} aria-label={t('attributes.add')}><Plus className='h-4 w-4' /></Button></div></div>;
}

/** Business synonyms as removable chips; Enter or comma adds the typed one. */
export function AliasChips({ values, onChange, placeholder, compact = false }: Readonly<{ values: string[]; onChange: (values: string[]) => void; placeholder: string; compact?: boolean }>) {
  const { t } = useModuleTranslation('semantic-model');
  const [draft, setDraft] = useState('');
  const add = () => {
    const value = draft.trim();
    setDraft('');
    if (!value || values.some((existing) => existing.toLocaleLowerCase() === value.toLocaleLowerCase())) return;
    onChange([...values, value]);
  };
  return <div className='flex flex-wrap items-center gap-1.5'>
    {values.map((value) => <span key={value} className='flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs'>{value}<button type='button' className='rounded-full p-0.5 hover:bg-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary' onClick={() => onChange(values.filter((existing) => existing !== value))} aria-label={t('aliases.remove', { name: value })}><X className='h-3 w-3' /></button></span>)}
    <Input className={compact ? 'h-8 min-w-[10rem] flex-1 text-xs' : 'h-9 min-w-[12rem] flex-1'} value={draft} placeholder={placeholder} aria-label={placeholder}
      onChange={(event) => setDraft(event.target.value)} onBlur={add}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); add(); } }} />
  </div>;
}

