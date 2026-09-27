import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ExternalLink, Loader2, RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { parseApiError } from '@/lib/api-error';
import { useFileViewerStore } from '@/modules/file-viewer/store';
import { useModuleTranslation } from '@/modules/localization';
import { useSemanticDataPreview } from '../../query/hooks';
import type { SemanticDataGaps, SourcePreviewIssue } from '../../types';

export function SemanticDataPreview({ modelId, dataRevisionId, onDataRevision, onOpenItem }: Readonly<{ modelId: string; dataRevisionId?: string; onDataRevision?: (revisionId: string) => void; onOpenItem?: (id: string) => void }>) {
  const { t } = useModuleTranslation('semantic-model');
  const [limit, setLimit] = useState(25);
  const [conceptId, setConceptId] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [showUnresolved, setShowUnresolved] = useState(true);
  const preview = useSemanticDataPreview(modelId, limit, true, dataRevisionId);
  useEffect(() => {
    if (preview.data?.dataRevisionId) onDataRevision?.(preview.data.dataRevisionId);
  }, [onDataRevision, preview.data?.dataRevisionId]);
  const concepts = useMemo(() => (preview.data?.concepts ?? [])
    .filter((concept) => conceptId === 'all' || concept.id === conceptId)
    .map((concept) => ({
      ...concept,
      entities: concept.entities.filter((entity) => !search.trim()
        || entity.label.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
        || Object.values(entity.values).some((value) => String(value ?? '').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))),
    })), [conceptId, preview.data?.concepts, search]);
  // The second line under a record's name: its first non-key business value, so records sharing a label stay distinguishable.
  const recordDetail = (entity: { label: string; values: Record<string, unknown> }) => {
    const value = businessValues(entity.values).find(([, candidate]) => candidate != null && String(candidate) !== '' && String(candidate) !== entity.label)?.[1];
    return value == null ? '' : String(value);
  };
  const labels = new Map((preview.data?.concepts ?? []).flatMap((concept) => concept.entities.map((entity) => [entity.id, `${concept.label}: ${entity.label}${recordDetail(entity) ? ` · ${recordDetail(entity)}` : ''}`] as const)));
  const visibleEntities = concepts.flatMap((concept) => concept.entities);
  const selectedEntity = visibleEntities.find((entity) => entity.id === selectedEntityId) ?? visibleEntities[0];
  const selectedConcept = concepts.find((concept) => concept.id === selectedEntity?.conceptId);
  const relatedRelations = (preview.data?.relations ?? []).filter((relation) => (relation.status === 'resolved' || showUnresolved) && (relation.sourceEntityId === selectedEntity?.id || relation.targetEntityIds.includes(selectedEntity?.id ?? '')));

  if (preview.isLoading) return <div className='flex h-full items-center justify-center gap-2 text-sm text-muted-foreground'><Loader2 className='h-5 w-5 animate-spin' />{t('dataPreview.loading')}</div>;
  if (preview.isError) return <div className='flex h-full items-center justify-center p-6'><div className='max-w-md rounded-2xl border bg-background p-6 text-center'><AlertTriangle className='mx-auto h-6 w-6 text-destructive' /><h2 className='mt-3 font-semibold'>{t('dataPreview.error')}</h2><p className='mt-1 text-sm text-muted-foreground'>{parseApiError(preview.error).message}</p><Button className='mt-4' onClick={() => void preview.refetch()}>{t('action.retry')}</Button></div></div>;

  return <div className='h-full overflow-y-auto bg-muted/20 p-4 sm:p-6'>
    <div className='mx-auto max-w-6xl space-y-5'>
      <div className='flex flex-col justify-between gap-3 sm:flex-row sm:items-start'>
        <div><h2 className='text-xl font-semibold'>{t('dataPreview.title')}</h2><p className='text-sm text-muted-foreground'>{t('dataPreview.description')}</p></div>
        <Button variant='outline' onClick={() => void preview.refetch()} disabled={preview.isFetching}><RefreshCw className={`mr-2 h-4 w-4 ${preview.isFetching ? 'animate-spin' : ''}`} />{t('dataPreview.refresh')}</Button>
      </div>
      {preview.data && <div className='grid grid-cols-2 gap-2 md:grid-cols-5'>
        <Summary value={preview.data.summary.entities} label={t('dataPreview.entities')} />
        <Summary value={preview.data.summary.resolvedRelations} label={t('dataPreview.resolved')} good />
        <Summary value={preview.data.summary.unresolvedRelations} label={t('dataPreview.unresolved')} />
        <Summary value={preview.data.summary.ambiguousRelations} label={t('dataPreview.ambiguous')} warn />
        <Summary value={preview.data.summary.conflicts} label={t('dataPreview.conflicts')} warn />
      </div>}
      <div className='grid gap-3 rounded-2xl border bg-background p-4 md:grid-cols-[1fr_14rem_8rem_auto] md:items-end'>
        <div className='space-y-1.5'><Label htmlFor='semantic-data-search'>{t('dataPreview.search')}</Label><div className='relative'><Search className='absolute left-3 top-2.5 h-4 w-4 text-muted-foreground' /><Input id='semantic-data-search' className='pl-9' value={search} onChange={(event) => setSearch(event.target.value)} /></div></div>
        <div className='space-y-1.5'><Label>{t('dataPreview.concept')}</Label><Select value={conceptId} onValueChange={setConceptId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value='all'>{t('dataPreview.allConcepts')}</SelectItem>{preview.data?.concepts.map((concept) => <SelectItem key={concept.id} value={concept.id}>{concept.label}</SelectItem>)}</SelectContent></Select></div>
        <div className='space-y-1.5'><Label>{t('dataPreview.sample')}</Label><Select value={String(limit)} onValueChange={(value) => setLimit(Number(value))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{[10, 25, 50].map((value) => <SelectItem key={value} value={String(value)}>{value}</SelectItem>)}</SelectContent></Select></div>
        <label className='flex min-h-10 items-center gap-2 text-xs'><input type='checkbox' checked={showUnresolved} onChange={(event) => setShowUnresolved(event.target.checked)} />{t('dataPreview.showUnresolved')}</label>
      </div>
      {preview.data && preview.data.sourceIssues.length > 0 && <section className='rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4'>
        <div className='flex items-start gap-2'>
          <AlertTriangle className='mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400' />
          <div className='min-w-0 flex-1 space-y-2'>
            <h3 className='text-sm font-semibold text-amber-700 dark:text-amber-400'>{t('dataPreview.sourceIssuesTitle', { count: preview.data.sourceIssues.length })}</h3>
            <ul className='space-y-2'>{groupSourceIssues(preview.data.sourceIssues).map((group) => <li key={group.key} className='text-sm'>
              <p className='break-words'>{group.issues.length === 1
                ? group.issues[0].message
                : t('dataPreview.sourceIssueGroup', { count: group.issues.length, reason: group.reason })}</p>
              {group.issues.length > 1 && <p className='mt-1 break-words text-xs text-muted-foreground'>{group.issues.map((issue) => issue.documentName).filter(Boolean).join(', ')}</p>}
              {group.detail && <details className='mt-1'>
                <summary className='cursor-pointer text-xs text-muted-foreground'>{t('dataPreview.sourceIssueDetail')}</summary>
                <p className='mt-1 break-words font-mono text-[11px] text-muted-foreground'>{group.detail}</p>
              </details>}
            </li>)}</ul>
          </div>
        </div>
      </section>}
      {preview.data?.gaps && <GapsPanel gaps={preview.data.gaps} onOpenItem={onOpenItem} />}
      {selectedEntity ? <div className='grid gap-4 min-[900px]:grid-cols-[15rem_minmax(0,1fr)]'>
        <select className='h-11 w-full rounded-lg border bg-background px-3 text-sm min-[900px]:hidden' value={selectedEntity.id} onChange={(event) => setSelectedEntityId(event.target.value)} aria-label={t('dataPreview.chooseRecord')}>{concepts.filter((concept) => concept.entities.length > 0).map((concept) => <optgroup key={concept.id} label={concept.label}>{concept.entities.map((entity) => <option key={entity.id} value={entity.id}>{concept.label}: {entity.label || t('mapping.unnamedEntity')}{recordDetail(entity) ? ` · ${recordDetail(entity)}` : ''}</option>)}</optgroup>)}</select>
        <nav className='hidden space-y-4 rounded-2xl border bg-background p-3 min-[900px]:block' aria-label={t('dataPreview.entities')}>{concepts.filter((concept) => concept.entities.length > 0).map((concept) => <section key={concept.id}><h3 className='px-2 py-1 text-xs font-semibold text-muted-foreground'>{concept.label} · {concept.entities.length}</h3><div className='space-y-1'>{concept.entities.map((entity) => <button key={entity.id} type='button' onClick={() => setSelectedEntityId(entity.id)} aria-current={selectedEntity.id === entity.id ? 'true' : undefined} className={`w-full rounded-lg px-3 py-2 text-left text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${selectedEntity.id === entity.id ? 'bg-primary/10 font-medium' : 'hover:bg-muted'}`}><span className='block truncate'>{entity.label || t('mapping.unnamedEntity')}</span>{recordDetail(entity) && <span className='block text-xs text-muted-foreground'>{recordDetail(entity)}</span>}</button>)}</div></section>)}</nav>
        <article className='min-w-0 rounded-2xl border bg-background p-5'>
          <p className='text-xs text-muted-foreground'>{selectedConcept?.label}</p>
          <div className='mt-1 flex items-start justify-between gap-3'><h3 className='text-xl font-semibold'>{selectedEntity.label || t('mapping.unnamedEntity')}</h3>{selectedEntity.conflicts.length > 0 && <span className='rounded-full bg-amber-500/10 px-2 py-1 text-[10px] font-medium text-amber-700'>{t('dataPreview.conflictBadge', { count: selectedEntity.conflicts.length })}</span>}</div>
          {recordDetail(selectedEntity) && <p className='mt-1 text-sm text-muted-foreground'>{recordDetail(selectedEntity)}</p>}
          <h4 className='mt-6 font-semibold'>{t('dataPreview.valuesAndSources')}</h4>
          <div className='mt-2 divide-y'>{businessValues(selectedEntity.values).map(([attribute, value]) => {
            const provenance = selectedEntity.provenance[attribute];
            const canOpen = Boolean(provenance?.source.workspaceId && provenance.source.documentId);
            const typedByHand = provenance?.source.kind === 'manual';
            return <div key={attribute} className='grid grid-cols-[minmax(6rem,0.7fr)_1fr] gap-3 py-2 text-sm'><span className='text-muted-foreground'>{readableLabel(attribute)}</span><div className='min-w-0'><p className='break-words'>{String(value ?? '')}</p>{typedByHand && <p className='mt-1 text-[11px] text-muted-foreground'>{t('dataPreview.typedByHand')}</p>}{provenance && !typedByHand && <button type='button' disabled={!canOpen} className='mt-1 flex max-w-full items-center gap-1 truncate text-left text-[11px] text-primary disabled:cursor-default disabled:text-muted-foreground' onClick={() => canOpen && void useFileViewerStore.getState().openFile(provenance.source.workspaceId!, provenance.source.documentId!, provenance.source.documentPath ?? '', provenance.source.documentName, provenance.source.mimeType ?? '', { page: Number.parseInt(provenance.field?.page ?? '1', 10) || 1, highlightText: provenance.field?.quote })}><ExternalLink className='h-3 w-3 shrink-0' />{provenance.source.documentName}{provenance.source.sheetName ? ` / ${provenance.source.sheetName}` : ''}{provenance.rowNumber ? ` · ${t('dataPreview.row', { row: provenance.rowNumber })}` : ''}{provenance.field?.reference ? ` · ${t('dataPreview.column', { column: provenance.field.reference })}` : ''}{provenance.field?.page ? ` · ${t('dataPreview.page', { page: provenance.field.page })}` : ''}</button>}</div></div>;
          })}</div>
          {selectedEntity.conflicts.length > 0 && <div className='mt-5 space-y-2 border-t pt-4'><h4 className='font-semibold text-amber-700 dark:text-amber-400'>{t('dataPreview.conflictDetails')}</h4>{selectedEntity.conflicts.map((conflict, index) => <div key={`${conflict.attribute}-${conflict.conflictingMappingId}-${index}`} className='rounded-lg bg-amber-500/10 p-3 text-xs'><p className='font-medium'>{conflict.attribute}</p><p className='mt-1 break-words'>{String(conflict.preferred ?? '')} <span className='text-muted-foreground'>· {selectedEntity.sources?.find((source) => source.mappingId === conflict.preferredMappingId)?.source.documentName ?? conflict.preferredMappingId}</span></p><p className='mt-1 break-words'>{String(conflict.conflicting ?? '')} <span className='text-muted-foreground'>· {selectedEntity.sources?.find((source) => source.mappingId === conflict.conflictingMappingId)?.source.documentName ?? conflict.conflictingMappingId}</span></p></div>)}</div>}
          <section className='mt-6 border-t pt-5'><h4 className='font-semibold'>{t('dataPreview.relationships')}</h4><div className='mt-3 space-y-2'>{relatedRelations.map((relation, index) => <div key={`${relation.relationId}-${relation.sourceEntityId}-${index}`} className={`rounded-lg p-3 text-xs ${relation.status === 'resolved' ? 'bg-emerald-500/10' : 'bg-amber-500/10'}`}><p><span className='font-medium'>{labels.get(relation.sourceEntityId) ?? relation.sourceEntityId}</span><span className='mx-1 text-muted-foreground'>→ {readableLabel(relation.relationLabel).toLocaleLowerCase()} →</span><span className='font-medium'>{relation.targetEntityIds.map((id) => labels.get(id) ?? id).join(', ') || t(`relationMatching.status.${relation.status}`)}</span></p><details className='mt-2'><summary className='cursor-pointer text-muted-foreground'>{t('dataPreview.matchingEvidence')}</summary><p className='mt-1 text-muted-foreground'>{readableLabel(relation.sourceAttribute)} = {String(relation.sourceValue ?? '')}{relation.targetValues.length ? ` · ${readableLabel(relation.targetAttribute)} = ${relation.targetValues.map(String).join(', ')}` : ''}</p></details></div>)}{relatedRelations.length === 0 && <p className='text-sm text-muted-foreground'>{t('dataPreview.noRelationships')}</p>}</div></section>
        </article>
      </div> : <div className='rounded-2xl border border-dashed bg-background p-10 text-center text-sm text-muted-foreground'>{t('dataPreview.empty')}</div>}
    </div>
  </div>;
}

/** Values a person entered or a source produced; `_`-prefixed keys are bookkeeping the pipeline keeps for itself. */
function businessValues(values: Record<string, unknown>) {
  return Object.entries(values).filter(([key]) => !key.startsWith('_'));
}

function readableLabel(value: string) {
  const words = value.replaceAll(/[_-]+/g, ' ').trim();
  return words ? words[0].toLocaleUpperCase() + words.slice(1) : value;
}

/** Sources that fail for the same cause read as one line, so a configuration problem is not mistaken for eight file problems. */
function groupSourceIssues(issues: SourcePreviewIssue[]) {
  const groups = new Map<string, { key: string; reason?: string; detail?: string; issues: SourcePreviewIssue[] }>();
  for (const issue of issues) {
    const key = `${issue.code}|${issue.reason ?? issue.message}`;
    const group = groups.get(key) ?? { key, reason: issue.reason, detail: issue.detail, issues: [] };
    group.issues.push(issue);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** The prepared records' gaps, in plain words, each with a way to fix it. */
function GapsPanel({ gaps, onOpenItem }: Readonly<{ gaps: SemanticDataGaps; onOpenItem?: (id: string) => void }>) {
  const { t } = useModuleTranslation('semantic-model');
  const rows = [
    ...gaps.missingValues.map((gap) => ({
      key: `value-${gap.conceptId}-${gap.attribute}`, targetId: gap.conceptId,
      text: t('dataPreview.gapMissingValue', { missing: gap.missing, total: gap.total, concept: gap.conceptLabel, field: gap.attributeLabel }),
      action: t('dataPreview.gapFixConcept', { concept: gap.conceptLabel }),
    })),
    ...gaps.unresolvedLinks.map((gap) => ({
      key: `link-${gap.relationId}-${gap.kind}`, targetId: gap.relationId,
      text: t('dataPreview.gapUnresolvedLink', { count: gap.count, relationship: gap.relationLabel }),
      action: t('dataPreview.gapFixRelationship'),
    })),
    ...gaps.other.map((gap) => ({
      key: `other-${gap.conceptId ?? 'model'}-${gap.kind}`, targetId: gap.conceptId,
      text: gap.conceptLabel ? t('dataPreview.gapOther', { count: gap.count, concept: gap.conceptLabel }) : t('dataPreview.gapOtherModel', { count: gap.count }),
      action: gap.conceptLabel ? t('dataPreview.gapFixConcept', { concept: gap.conceptLabel }) : null,
    })),
  ];
  return <section className={`rounded-2xl border p-4 ${rows.length ? 'border-amber-500/30 bg-amber-500/5' : 'bg-background'}`} aria-label={t('dataPreview.gapsTitle')}>
    <h3 className='text-sm font-semibold'>{t('dataPreview.gapsTitle')}</h3>
    {rows.length === 0 ? <p className='mt-1 text-sm text-muted-foreground'>{t('dataPreview.gapsNone')}</p>
      : <ul className='mt-2 space-y-2'>{rows.map((row) => <li key={row.key} className='flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:justify-between'>
        <span className='break-words'>{row.text}</span>
        {row.action && row.targetId && onOpenItem && <Button variant='link' size='sm' className='h-auto p-0' onClick={() => onOpenItem(row.targetId!)}>{row.action}</Button>}
      </li>)}</ul>}
  </section>;
}

function Summary({ value, label, good = false, warn = false }: Readonly<{ value: number; label: string; good?: boolean; warn?: boolean }>) {
  return <div className={`rounded-xl border p-3 ${good ? 'border-emerald-500/30 bg-emerald-500/5' : warn && value ? 'border-amber-500/30 bg-amber-500/5' : 'bg-background'}`}><p className='text-xl font-semibold'>{value}</p><p className='text-xs text-muted-foreground'>{label}</p></div>;
}
