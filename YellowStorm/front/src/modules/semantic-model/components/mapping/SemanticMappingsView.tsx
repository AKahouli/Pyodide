import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, RefreshCw, Wrench } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { showError, showSuccess } from '@/lib/notifications';
import { useModuleTranslation } from '@/modules/localization';
import { semanticModelApi } from '../../api';
import { useMappingHealth, useRelationResolutionRules, useSourceMappings, useSourceResolutionPolicies } from '../../query/hooks';
import { semanticModelQueryKeys } from '../../query/queryKeys';
import { useSemanticModelEditorStore } from '../../store';
import type { ConceptSourceMapping, MappingHealthItem, SemanticNodeType, SourceResolutionPolicy } from '../../types';
import { useSemanticModelChannel } from '../../data-plane/use-semantic-model-channel';
import { useSemanticModelSources } from '../../data-plane/use-semantic-model-sources';
import type { SemanticSourceSummaryRow } from '../../data-plane/semantic-api.types';

export function SemanticMappingsView({ modelId, canEdit, onRepairMapping }: Readonly<{ modelId: string; canEdit: boolean; onRepairMapping?: (mapping: ConceptSourceMapping) => void }>) {
  const { t } = useModuleTranslation('semantic-model');
  const graph = useSemanticModelEditorStore((state) => state.graph);
  const mappings = useSourceMappings(modelId);
  const rules = useRelationResolutionRules(modelId);
  const policies = useSourceResolutionPolicies(modelId);
  const health = useMappingHealth(modelId);
  const sources = useSemanticModelSources(modelId);
  useSemanticModelChannel(modelId);
  const client = useQueryClient();
  useEffect(() => {
    if (!health.dataUpdatedAt) return;
    void Promise.all([
      client.invalidateQueries({ queryKey: semanticModelQueryKeys.readiness(modelId) }),
      client.invalidateQueries({ queryKey: ['semantic-models', 'review-items', modelId] }),
    ]);
  }, [client, health.dataUpdatedAt, modelId]);
  const loading = mappings.isLoading || rules.isLoading || policies.isLoading || health.isLoading;
  const error = mappings.error || rules.error || policies.error || health.error;
  if (loading) return <div className='flex h-full items-center justify-center'><Loader2 className='h-5 w-5 animate-spin text-muted-foreground' /></div>;
  if (error) return <div className='flex h-full items-center justify-center p-6 text-sm text-destructive'><AlertTriangle className='mr-2 h-5 w-5' />{t('mappingsView.error')}</div>;
  const mappedConcepts = (graph?.nodes ?? []).filter((concept) => (mappings.data ?? []).some((mapping) => mapping.conceptId === concept.id));
  return <div className='h-full overflow-y-auto bg-muted/20 p-4 sm:p-6'><div className='mx-auto max-w-5xl space-y-6'>
    <div><h2 className='text-xl font-semibold'>{t('mappingsView.title')}</h2><p className='text-sm text-muted-foreground'>{t('mappingsView.description')}</p></div>
    <SourceStatus rows={sources.data ?? []} loading={sources.isLoading} error={sources.isError} retry={() => void sources.refetch()} />
    <MappingHealth modelId={modelId} items={health.data?.items ?? []} canEdit={canEdit} mappings={mappings.data ?? []} onRepairMapping={onRepairMapping} />
    {mappedConcepts.map((concept) => <ConceptMappings key={concept.id} modelId={modelId} concept={concept} mappings={(mappings.data ?? []).filter((mapping) => mapping.conceptId === concept.id)} policy={(policies.data ?? []).find((policy) => policy.conceptId === concept.id)} canEdit={canEdit} />)}
    {!mappedConcepts.length && <div className='rounded-2xl border border-dashed bg-background p-10 text-center text-sm text-muted-foreground'>{t('mappingsView.empty')}</div>}
    <section className='rounded-2xl border bg-background p-5'><h3 className='font-semibold'>{t('mappingsView.relationships')}</h3><div className='mt-3 space-y-2'>{(graph?.relations ?? []).map((relation) => {
      const rule = rules.data?.find((candidate) => candidate.relationId === relation.id);
      const source = graph?.nodes.find((node) => node.id === relation.sourceNodeTypeId);
      const target = graph?.nodes.find((node) => node.id === relation.targetNodeTypeId);
       return <div key={relation.id} className='flex flex-wrap items-center gap-2 rounded-xl border p-3 text-sm'><span className='font-medium'>{source?.label}</span><ArrowRight className='h-4 w-4 text-muted-foreground' /><span className='font-medium'>{target?.label}</span><span className='ml-auto text-xs text-muted-foreground'>{rule ? `${rule.sourceAttribute} = ${rule.targetAttribute} · ${t(`cardinality.${relation.cardinality}`)} · ${t(`relationMatching.strategyOption.${rule.strategy}`)}` : t('mappingsView.notConfigured')}</span></div>;
    })}</div></section>
  </div></div>;
}

function SourceStatus({ rows, loading, error, retry }: Readonly<{ rows: SemanticSourceSummaryRow[]; loading: boolean; error: boolean; retry: () => void }>) {
  const { t } = useModuleTranslation('semantic-model');
  return <section className='rounded-2xl border bg-background p-5'>
    <div className='flex items-center justify-between gap-3'><div><h3 className='font-semibold'>{t('sourceStatus.title')}</h3><p className='text-xs text-muted-foreground'>{t('sourceStatus.description')}</p></div>{error && <Button size='sm' variant='ghost' onClick={retry}><RefreshCw className='mr-1.5 h-3.5 w-3.5' />{t('sourceStatus.retry')}</Button>}</div>
    {loading && <div className='flex justify-center p-5'><Loader2 className='h-5 w-5 animate-spin text-muted-foreground' /></div>}
    {error && <div className='mt-4 flex items-center gap-2 rounded-xl bg-destructive/10 p-3 text-sm text-destructive'><AlertTriangle className='h-4 w-4' />{t('sourceStatus.error')}</div>}
    {!loading && !error && !rows.length && <p className='mt-4 text-sm text-muted-foreground'>{t('sourceStatus.empty')}</p>}
    {!loading && !error && rows.length > 0 && <div className='mt-4 grid gap-2'>{rows.map((row) => {
      const state = row.deleted ? 'deleted' : !row.source_revision ? 'awaiting' : row.indexing_status === 'failed' ? 'failed' : row.indexing_status === 'ready' ? 'ready' : 'syncing';
      return <div key={row.mapping_id} className='flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center'><div className='min-w-0 flex-1'><p className='truncate text-sm font-medium'>{row.original_name ?? row.document_id}{row.sheet_name ? ` / ${row.sheet_name}` : ''}</p><p className='truncate text-xs text-muted-foreground'>{row.mime_type ?? row.asset_kind}</p></div><Badge variant={state === 'ready' ? 'default' : state === 'failed' || state === 'deleted' ? 'destructive' : 'secondary'}>{t(`sourceStatus.state.${state}`)}</Badge>{row.source_revision && <span className='text-xs text-muted-foreground'>{t('sourceStatus.revision', { revision: row.source_revision })}</span>}</div>;
    })}</div>}
  </section>;
}

function MappingHealth({ modelId, items, canEdit, mappings, onRepairMapping }: Readonly<{ modelId: string; items: MappingHealthItem[]; canEdit: boolean; mappings: ConceptSourceMapping[]; onRepairMapping?: (mapping: ConceptSourceMapping) => void }>) {
  const { t } = useModuleTranslation('semantic-model');
  const client = useQueryClient();
  const issues = items.filter((item) => item.state !== 'healthy');
  return <section className='rounded-2xl border bg-background p-5'>
    <div className='flex items-center justify-between gap-3'><div><h3 className='font-semibold'>{t('mappingHealth.title')}</h3><p className='text-xs text-muted-foreground'>{issues.length ? t('mappingHealth.issueCount', { count: issues.length }) : t('mappingHealth.healthy')}</p></div><Button size='sm' variant='ghost' onClick={() => void client.invalidateQueries({ queryKey: semanticModelQueryKeys.mappingHealth(modelId) })}><RefreshCw className='mr-1.5 h-3.5 w-3.5' />{t('mappingHealth.refresh')}</Button></div>
    {!issues.length && <div className='mt-4 flex items-center gap-2 rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300'><CheckCircle2 className='h-4 w-4' />{t('mappingHealth.allReady')}</div>}
    {issues.length > 0 && <div className='mt-4 space-y-2'>{issues.map((item) => {
      const mapping = mappings.find((candidate) => candidate.id === item.id);
      return <div key={item.id} className='flex flex-col gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 sm:flex-row sm:items-center'><AlertTriangle className='h-4 w-4 shrink-0 text-amber-600' /><div className='min-w-0 flex-1'><div className='flex flex-wrap items-center gap-2'><p className='truncate text-sm font-medium'>{item.conceptLabel} · {item.documentName}</p><Badge variant='outline'>{t(`mappingHealth.state.${item.state}`)}</Badge></div><p className='mt-1 text-xs text-muted-foreground'>{t(`mappingHealth.message.${item.state}`)}{item.missingFields.length ? ` ${t('mappingHealth.missing', { fields: item.missingFields.join(', ') })}` : ''}</p></div>{canEdit && mapping && onRepairMapping && item.state !== 'unavailable' && <Button size='sm' variant='outline' onClick={() => onRepairMapping(mapping)}><Wrench className='mr-1.5 h-3.5 w-3.5' />{t('mappingHealth.repair')}</Button>}</div>;
    })}</div>}
  </section>;
}

function ConceptMappings({ modelId, concept, mappings, policy, canEdit }: Readonly<{ modelId: string; concept: SemanticNodeType; mappings: ConceptSourceMapping[]; policy?: SourceResolutionPolicy; canEdit: boolean }>) {
  const { t } = useModuleTranslation('semantic-model');
  const client = useQueryClient();
  const primary = [...(policy?.priorities ?? [])].sort((left, right) => left.rank - right.rank)[0]?.mappingId ?? mappings[0]?.id;
  const save = useMutation({
    mutationFn: (mappingId: string) => semanticModelApi.saveSourceResolutionPolicy(modelId, concept.id, [mappingId, ...mappings.filter((mapping) => mapping.id !== mappingId).map((mapping) => mapping.id)].map((id, index) => ({ mappingId: id, rank: index + 1 }))),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: semanticModelQueryKeys.sourcePolicies(modelId) }),
        client.invalidateQueries({ queryKey: semanticModelQueryKeys.model(modelId) }),
        client.invalidateQueries({ queryKey: ['semantic-models', 'data-preview', modelId] }),
      ]);
      showSuccess(t('mappingsView.prioritySaved'));
    },
    onError: (error) => showError(t('mappingsView.priorityError'), { description: error instanceof Error ? error.message : undefined }),
  });
  return <section className='rounded-2xl border bg-background p-5'><div className='flex flex-col justify-between gap-3 sm:flex-row sm:items-center'><div><h3 className='font-semibold'>{concept.label}</h3><p className='text-xs text-muted-foreground'>{t('mappingsView.sourceCount', { count: mappings.length })}</p></div>{mappings.length > 1 && <div className='flex items-center gap-2'><span className='text-xs text-muted-foreground'>{t('mappingsView.primary')}</span>{save.isPending ? <Loader2 className='h-4 w-4 animate-spin' /> : <Select value={primary} disabled={!canEdit} onValueChange={(value) => canEdit && save.mutate(value)}><SelectTrigger className='w-56'><SelectValue /></SelectTrigger><SelectContent>{mappings.map((mapping) => <SelectItem key={mapping.id} value={mapping.id}>{mapping.documentName ?? mapping.documentId}</SelectItem>)}</SelectContent></Select>}</div>}</div>
    <div className='mt-4 space-y-3'>{mappings.map((mapping) => <div key={mapping.id} className={`rounded-xl border p-3 ${mapping.id === primary ? 'border-primary/40 bg-primary/5' : ''}`}><div className='flex items-center justify-between gap-2'><p className='font-medium'>{mapping.documentName ?? mapping.documentId}{mapping.sheetName ? ` / ${mapping.sheetName}` : ''}</p>{mapping.id === primary && mappings.length > 1 && <span className='rounded-full bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary'>{t('mappingsView.primary')}</span>}</div><div className='mt-2 grid gap-1 sm:grid-cols-2'>{mapping.fieldMappings.filter((field) => field.mode !== 'ignore').map((field) => <p key={`${field.targetAttribute}-${field.sourceField}`} className='text-xs text-muted-foreground'><span className='font-medium text-foreground'>{field.targetAttribute}</span> ← {field.sourceField ?? field.mode}</p>)}</div>{mapping.identityFields.length > 0 && <p className='mt-2 text-[11px] text-muted-foreground'>{t('mapping.identityShort', { fields: mapping.identityFields.join(', ') })}</p>}</div>)}</div>
  </section>;
}
