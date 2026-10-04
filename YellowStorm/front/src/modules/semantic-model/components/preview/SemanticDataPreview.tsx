import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ExternalLink, Loader2, RefreshCw, Search, Database, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/modules/semantic-model/components/common/Select';
import { parseApiError } from '@/lib/api-error';
import { useFileViewerStore } from '@/modules/file-viewer/store';
import { useModuleTranslation } from '@/modules/localization';
import { useSemanticDataPreview, useSemanticGraph } from '../../query/hooks';
import { AddLinkForm, CorrectionNote, CorrectionNotice, CorrectionsList, FixValueButton, HideRecordButton, useCorrectionActions } from './RecordCorrections';
import type { SemanticDataGaps, SourcePreviewIssue } from '../../types';
import { valueReadingParts } from '../../utils/value-reading';
import { MissingValueGuide, RejectedRowsGuide, UnmatchedLinksGuide, type GapGuideActions } from './DataGapGuides';

/**
 * What a review item points at in the data: a concept's records missing one field, the rows of a concept
 * that never became records, or the records whose link of one relationship found nothing.
 */
export interface DataPreviewFocus { conceptId?: string; attribute?: string; rows?: boolean; relationId?: string; at: number }

export function SemanticDataPreview({ modelId, dataRevisionId, onDataRevision, onOpenReview, onRebuildStarted, canEdit = true, focus, onOpenMapping, onOpenIdentity, onOpenMatching }: Readonly<{ modelId: string; dataRevisionId?: string; onDataRevision?: (revisionId: string | undefined) => void; onOpenReview?: () => void; onRebuildStarted?: (jobId: string) => void; canEdit?: boolean; focus?: DataPreviewFocus | null } & GapGuideActions>) {
  const { t } = useModuleTranslation('semantic-model');
  const [limit, setLimit] = useState(25);
  const [conceptId, setConceptId] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [showUnresolved, setShowUnresolved] = useState(true);
  const [missingField, setMissingField] = useState<string | null>(null);
  const [rowsConceptId, setRowsConceptId] = useState<string | null>(null);
  const [linkRelationId, setLinkRelationId] = useState<string | null>(null);
  const preview = useSemanticDataPreview(modelId, limit, true, dataRevisionId);
  const structure = useSemanticGraph(modelId);
  const focusedRelation = structure.data?.relations.find((relation) => relation.id === linkRelationId);
  const nodes = structure.data?.nodes ?? [];
  const readingOf = (field: Parameters<typeof valueReadingParts>[0]) => valueReadingParts(field, t, (id) => nodes.find((node) => node.id === id)?.label,
    (id, key) => nodes.find((node) => node.id === id)?.attributes.find((attribute) => attribute.key === key)?.label || key);
  // Opening a review item shows only what it is about, with the most records sampled.
  useEffect(() => {
    if (!focus) return;
    setMissingField(focus.attribute ?? null);
    setRowsConceptId(focus.rows && focus.conceptId ? focus.conceptId : null);
    setLinkRelationId(focus.relationId ?? null);
    if (focus.conceptId) setConceptId(focus.conceptId);
    setSearch('');
    setSelectedEntityId(null);
    setLimit(50);
  }, [focus]);
  // A relationship's records are browsed from its first side, once the structure says which that is.
  useEffect(() => {
    if (focusedRelation) setConceptId(focusedRelation.sourceNodeTypeId);
  }, [focusedRelation]);
  const clearGuide = () => { setMissingField(null); setRowsConceptId(null); setLinkRelationId(null); };
  // The records whose link found nothing: the ones the data kept as examples, else those of the sample with no such link.
  const linkSampleIds = new Set((preview.data?.gaps?.linkSamples ?? []).filter((sample) => sample.relationId === linkRelationId).map((sample) => sample.sourceEntityId));
  const unmatchedInSample = linkRelationId ? (preview.data?.concepts ?? []).flatMap((concept) => concept.entities)
    .filter((entity) => entity.conceptId === focusedRelation?.sourceNodeTypeId
      && !(preview.data?.relations ?? []).some((relation) => relation.relationId === linkRelationId && relation.status === 'resolved' && relation.sourceEntityId === entity.id))
    .map((entity) => entity.id) : [];
  const linkIds = linkSampleIds.size ? linkSampleIds : new Set(unmatchedInSample);
  const fixes = useCorrectionActions(modelId, onRebuildStarted);
  useEffect(() => {
    if (preview.data?.dataRevisionId) onDataRevision?.(preview.data.dataRevisionId);
  }, [onDataRevision, preview.data?.dataRevisionId]);
  const concepts = useMemo(() => (preview.data?.concepts ?? [])
    .filter((concept) => conceptId === 'all' || concept.id === conceptId)
    .map((concept) => ({
      ...concept,
      entities: concept.entities.filter((entity) => (!missingField || isEmpty(entity.values[missingField])) && (!linkRelationId || linkIds.has(entity.id))).filter((entity) => !search.trim()
        || entity.label.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
        || Object.values(entity.values).some((value) => String(value ?? '').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    })), [conceptId, missingField, linkRelationId, linkIds.size, preview.data?.concepts, search]);
  // The second line under a record's name: its first non-key business value, so records sharing a label stay distinguishable.
  const recordDetail = (entity: { label: string; values: Record<string, unknown> }) => {
    const value = businessValues(entity.values).find(([, candidate]) => candidate != null && String(candidate) !== '' && String(candidate) !== entity.label)?.[1];
    return value == null ? '' : String(value);
  };
  const labels = new Map((preview.data?.concepts ?? []).flatMap((concept) => concept.entities.map((entity) => [entity.id, `${concept.label}: ${entity.label}${recordDetail(entity) ? ` · ${recordDetail(entity)}` : ''}`] as const)));
  const visibleEntities = concepts.flatMap((concept) => concept.entities);
  const selectedEntity = visibleEntities.find((entity) => entity.id === selectedEntityId) ?? visibleEntities[0];
  const selectedConcept = concepts.find((concept) => concept.id === selectedEntity?.conceptId);
  const allEntities = (preview.data?.concepts ?? []).flatMap((concept) => concept.entities);
  const entityName = (id: unknown) => labels.get(String(id)) ?? t('corrections.aRecord');
  const relationName = (id: unknown) => {
    const relation = structure.data?.relations.find((candidate) => candidate.id === id);
    return relation ? readableLabel(relation.label || relation.key).toLocaleLowerCase() : t('corrections.aLink');
  };
  const linkOptions = selectedEntity ? (structure.data?.relations ?? []).flatMap((relation) => [
    ...(relation.sourceNodeTypeId === selectedEntity.conceptId ? [{ relationId: relation.id, direction: 'out' as const, label: readableLabel(relation.label || relation.key),
      targets: allEntities.filter((entity) => entity.conceptId === relation.targetNodeTypeId && entity.id !== selectedEntity.id).map((entity) => ({ id: entity.id, label: labels.get(entity.id) ?? entity.label })) }] : []),
    ...(relation.targetNodeTypeId === selectedEntity.conceptId && relation.sourceNodeTypeId !== relation.targetNodeTypeId ? [{ relationId: relation.id, direction: 'in' as const, label: readableLabel(relation.inverseLabel || relation.label || relation.key),
      targets: allEntities.filter((entity) => entity.conceptId === relation.sourceNodeTypeId).map((entity) => ({ id: entity.id, label: labels.get(entity.id) ?? entity.label })) }] : []),
  ]) : [];
  const relatedRelations = (preview.data?.relations ?? []).filter((relation) => (relation.status === 'resolved' || showUnresolved) && (relation.sourceEntityId === selectedEntity?.id || relation.targetEntityIds.includes(selectedEntity?.id ?? '')));

  if (preview.isLoading) return <div className='flex h-full items-center justify-center gap-2 text-sm text-muted-foreground'><Loader2 className='h-5 w-5 animate-spin' />{t('dataPreview.loading')}</div>;
  // No build has produced records yet: this is a starting point, not an error.
  if (preview.isError && parseApiError(preview.error).message === 'active_binding_not_found') return <div className='flex h-full items-center justify-center p-6'><div className='max-w-md rounded-2xl border bg-background p-6 text-center'><Database className='mx-auto h-6 w-6 text-muted-foreground' /><h2 className='mt-3 font-semibold'>{t('dataPreview.noRecordsYet')}</h2><p className='mt-1 text-sm text-muted-foreground'>{t('dataPreview.noRecordsYetHint')}</p></div></div>;
  // A pinned revision may have been replaced by a newer build; retrying reads the current one.
  if (preview.isError) return <div className='flex h-full items-center justify-center p-6'><div className='max-w-md rounded-2xl border bg-background p-6 text-center'><AlertTriangle className='mx-auto h-6 w-6 text-destructive' /><h2 className='mt-3 font-semibold'>{t('dataPreview.error')}</h2><p className='mt-1 text-sm text-muted-foreground'>{t('dataPreview.errorHint')}</p><Button className='mt-4' onClick={() => { if (dataRevisionId) onDataRevision?.(undefined); else void preview.refetch(); }}>{t('action.retry')}</Button></div></div>;

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
      {preview.data?.gaps && <GapsSummary gaps={preview.data.gaps} onOpenReview={onOpenReview} />}
      {missingField && <div className='flex flex-wrap items-center gap-2 rounded-2xl border border-primary/40 bg-primary/5 px-4 py-3 text-sm'>
        <span className='min-w-0 flex-1'>{t('dataPreview.missingFilter', { count: visibleEntities.length, concept: concepts[0]?.label ?? '', field: readableLabel(missingField) })}</span>
        <Button variant='ghost' size='sm' className='h-8' onClick={clearGuide}><X className='mr-1 h-3.5 w-3.5' />{t('dataPreview.showAllRecords')}</Button>
      </div>}
      {rowsConceptId && <RejectedRowsGuide conceptId={rowsConceptId} conceptLabel={preview.data?.concepts.find((concept) => concept.id === rowsConceptId)?.label ?? structure.data?.nodes.find((node) => node.id === rowsConceptId)?.label ?? ''}
        gaps={preview.data?.gaps} onOpenMapping={onOpenMapping} onOpenIdentity={onOpenIdentity} />}
      {linkRelationId && <UnmatchedLinksGuide relationId={linkRelationId} relationLabel={readableLabel(focusedRelation?.label || focusedRelation?.key || '')}
        targetLabel={structure.data?.nodes.find((node) => node.id === focusedRelation?.targetNodeTypeId)?.label ?? ''}
        gaps={preview.data?.gaps} entityLabel={(id) => allEntities.find((entity) => entity.id === id)?.label || undefined}
        unmatchedInSample={unmatchedInSample} onPick={setSelectedEntityId} onOpenMatching={onOpenMatching} />}
      {(rowsConceptId || linkRelationId) && <div className='flex justify-end'><Button variant='ghost' size='sm' className='h-8' onClick={clearGuide}><X className='mr-1 h-3.5 w-3.5' />{t('dataPreview.showAllRecords')}</Button></div>}
      <CorrectionNotice actions={fixes} />
      {canEdit && <CorrectionsList actions={fixes} recordLabel={entityName} fieldLabel={readableLabel} relationLabel={relationName} />}
      {selectedEntity ? <div className='grid gap-4 min-[900px]:grid-cols-[15rem_minmax(0,1fr)]'>
        <Select value={selectedEntity.id} onValueChange={setSelectedEntityId}><SelectTrigger className='h-11 rounded-lg px-3 min-[900px]:hidden' aria-label={t('dataPreview.chooseRecord')}><SelectValue /></SelectTrigger><SelectContent>{concepts.filter((concept) => concept.entities.length > 0).map((concept) => <SelectGroup key={concept.id}><SelectLabel>{concept.label}</SelectLabel>{concept.entities.map((entity) => <SelectItem key={entity.id} value={entity.id}>{concept.label}: {entity.label || t('mapping.unnamedEntity')}{recordDetail(entity) ? ` · ${recordDetail(entity)}` : ''}</SelectItem>)}</SelectGroup>)}</SelectContent></Select>
        <nav className='hidden space-y-4 rounded-2xl border bg-background p-3 min-[900px]:block' aria-label={t('dataPreview.entities')}>{concepts.filter((concept) => concept.entities.length > 0).map((concept) => <section key={concept.id}><h3 className='px-2 py-1 text-xs font-semibold text-muted-foreground'>{concept.label} · {concept.entities.length}</h3><div className='space-y-1'>{concept.entities.map((entity) => <button key={entity.id} type='button' onClick={() => setSelectedEntityId(entity.id)} aria-current={selectedEntity.id === entity.id ? 'true' : undefined} className={`w-full rounded-lg px-3 py-2 text-left text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${selectedEntity.id === entity.id ? 'bg-primary/10 font-medium' : 'hover:bg-muted'}`}><span className='block truncate'>{entity.label || t('mapping.unnamedEntity')}</span>{recordDetail(entity) && <span className='block text-xs text-muted-foreground'>{recordDetail(entity)}</span>}</button>)}</div></section>)}</nav>
        <article className='min-w-0 rounded-2xl border bg-background p-5'>
          <p className='text-xs text-muted-foreground'>{selectedConcept?.label}</p>
          <div className='mt-1 flex items-start justify-between gap-3'><h3 className='text-xl font-semibold'>{selectedEntity.label || t('mapping.unnamedEntity')}</h3>{selectedEntity.conflicts.length > 0 && <span className='rounded-full bg-amber-500/10 px-2 py-1 text-[10px] font-medium text-amber-700'>{t('dataPreview.conflictBadge', { count: selectedEntity.conflicts.length })}</span>}</div>
          {recordDetail(selectedEntity) && <p className='mt-1 text-sm text-muted-foreground'>{recordDetail(selectedEntity)}</p>}
          {canEdit && <div className='mt-3'><HideRecordButton busy={fixes.busy} onHide={() => fixes.save({ action: 'remove_entity', targetIdentity: { entityId: selectedEntity.id } })} /></div>}
          <h4 className='mt-6 font-semibold'>{t('dataPreview.valuesAndSources')}</h4>
          <div className='mt-2 divide-y'>{withField(businessValues(selectedEntity.values), missingField).map(([attribute, value]) => {
            const provenance = selectedEntity.provenance[attribute];
            const canOpen = Boolean(provenance?.source.workspaceId && provenance.source.documentId);
            const typedByHand = provenance?.source.kind === 'manual';
            const toFix = attribute === missingField && isEmpty(value);
            return <div key={attribute} className={`grid grid-cols-[minmax(6rem,0.7fr)_1fr] gap-3 py-2 text-sm ${toFix ? 'rounded-lg bg-primary/5 px-2 ring-1 ring-primary' : ''}`}><span className='text-muted-foreground'>{readableLabel(attribute)}</span><div className='min-w-0'><div className='flex flex-wrap items-baseline justify-between gap-2'><p className={`break-words ${toFix ? 'italic text-muted-foreground' : ''}`}>{toFix ? t('dataPreview.noValue') : String(value ?? '')}</p>{canEdit && <FixValueButton label={readableLabel(attribute)} value={value} busy={fixes.busy} onSave={(next) => fixes.save({ action: 'edit_entity', targetIdentity: { entityId: selectedEntity.id }, payload: { attribute, value: next } })} />}</div>{toFix && <MissingValueGuide entity={selectedEntity} field={attribute} onOpenMapping={onOpenMapping} />}{provenance?.correction && <CorrectionNote correction={provenance.correction} busy={fixes.busy} onUndo={canEdit ? () => fixes.revert(provenance.correction!.sequence) : undefined} />}{typedByHand && !provenance?.correction && <p className='mt-1 text-[11px] text-muted-foreground'>{t('dataPreview.typedByHand')}</p>}{provenance && !typedByHand && <button type='button' disabled={!canOpen} className='mt-1 flex max-w-full items-center gap-1 truncate text-left text-[11px] text-primary disabled:cursor-default disabled:text-muted-foreground' onClick={() => canOpen && void useFileViewerStore.getState().openFile(provenance.source.workspaceId!, provenance.source.documentId!, provenance.source.documentPath ?? '', provenance.source.documentName, provenance.source.mimeType ?? '', { page: Number.parseInt(provenance.field?.page ?? '1', 10) || 1, highlightText: provenance.field?.quote })}><ExternalLink className='h-3 w-3 shrink-0' />{provenance.source.documentName}{provenance.source.sheetName ? ` / ${provenance.source.sheetName}` : ''}{provenance.rowNumber ? ` · ${t('dataPreview.row', { row: provenance.rowNumber })}` : ''}{provenance.field?.reference ? ` · ${t('dataPreview.column', { column: provenance.field.reference })}` : ''}{provenance.field?.page ? ` · ${t('dataPreview.page', { page: provenance.field.page })}` : ''}</button>}{provenance && !typedByHand && readingOf(provenance.field).length > 0 && <p className='mt-0.5 break-words text-[11px] text-muted-foreground'>{readingOf(provenance.field).join(' · ')}</p>}</div></div>;
          })}</div>
          {selectedEntity.conflicts.length > 0 && <div className='mt-5 space-y-2 border-t pt-4'><h4 className='font-semibold text-amber-700 dark:text-amber-400'>{t('dataPreview.conflictDetails')}</h4>{selectedEntity.conflicts.map((conflict, index) => <div key={`${conflict.attribute}-${conflict.conflictingMappingId}-${index}`} className='rounded-lg bg-amber-500/10 p-3 text-xs'><p className='font-medium'>{conflict.attribute}</p><p className='mt-1 break-words'>{String(conflict.preferred ?? '')} <span className='text-muted-foreground'>· {selectedEntity.sources?.find((source) => source.mappingId === conflict.preferredMappingId)?.source.documentName ?? conflict.preferredMappingId}</span></p><p className='mt-1 break-words'>{String(conflict.conflicting ?? '')} <span className='text-muted-foreground'>· {selectedEntity.sources?.find((source) => source.mappingId === conflict.conflictingMappingId)?.source.documentName ?? conflict.conflictingMappingId}</span></p></div>)}</div>}
          <section className='mt-6 border-t pt-5'><h4 className='font-semibold'>{t('dataPreview.relationships')}</h4><div className='mt-3 space-y-2'>{relatedRelations.map((relation, index) => <div key={`${relation.relationId}-${relation.sourceEntityId}-${index}`} className={`rounded-lg p-3 text-xs ${relation.status === 'resolved' ? 'bg-emerald-500/10' : 'bg-amber-500/10'}`}><p><span className='font-medium'>{labels.get(relation.sourceEntityId) ?? relation.sourceEntityId}</span><span className='mx-1 text-muted-foreground'>→ {readableLabel(relation.relationLabel).toLocaleLowerCase()} →</span><span className='font-medium'>{relation.targetEntityIds.map((id) => labels.get(id) ?? id).join(', ') || t(`relationMatching.status.${relation.status}`)}</span></p>{canEdit && relation.status === 'resolved' && relation.targetEntityIds.length === 1 && <button type='button' disabled={fixes.busy} className='mt-1 inline-flex items-center gap-1 text-[11px] text-primary disabled:opacity-50' onClick={() => fixes.save({ action: 'remove_relationship', targetIdentity: { relationId: relation.relationId, sourceEntityId: relation.sourceEntityId, targetEntityId: relation.targetEntityIds[0] } })}>{t('corrections.hideLink')}</button>}<details className='mt-2'><summary className='cursor-pointer text-muted-foreground'>{t('dataPreview.matchingEvidence')}</summary><p className='mt-1 text-muted-foreground'>{readableLabel(relation.sourceAttribute)} = {String(relation.sourceValue ?? '')}{relation.targetValues.length ? ` · ${readableLabel(relation.targetAttribute)} = ${relation.targetValues.map(String).join(', ')}` : ''}</p></details></div>)}{relatedRelations.length === 0 && <p className='text-sm text-muted-foreground'>{t('dataPreview.noRelationships')}</p>}</div>{canEdit && <div className='mt-3'><AddLinkForm options={linkOptions} busy={fixes.busy} onAdd={(relationId, otherId, direction) => fixes.save({ action: 'add_relationship', targetIdentity: direction === 'out' ? { relationId, sourceEntityId: selectedEntity.id, targetEntityId: otherId } : { relationId, sourceEntityId: otherId, targetEntityId: selectedEntity.id } })} /></div>}</section>
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

/** How many problems the prepared records have; they are reviewed, and fixed, from the Trust center. */
function GapsSummary({ gaps, onOpenReview }: Readonly<{ gaps: SemanticDataGaps; onOpenReview?: () => void }>) {
  const { t } = useModuleTranslation('semantic-model');
  // A field not found in a document is the empty value it leaves, already counted there; the review list does the same.
  const count = gaps.missingValues.length + gaps.unresolvedLinks.length
    + gaps.other.filter((gap) => !FIELD_NOT_FOUND.has(gap.kind) || Boolean(gap.conceptId && gap.fields?.length
      && !gap.fields.every((field) => gaps.missingValues.some((value) => value.conceptId === gap.conceptId && value.attribute === field)))).length;
  if (!count) return <section className='rounded-2xl border bg-background p-4' aria-label={t('dataPreview.gapsTitle')}><p className='text-sm text-muted-foreground'>{t('dataPreview.gapsNone')}</p></section>;
  return <section className='flex flex-wrap items-center gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 px-4 py-3' aria-label={t('dataPreview.gapsTitle')}>
    <AlertTriangle className='h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400' />
    <p className='min-w-0 flex-1 text-sm'>{t('dataPreview.gapsCount', { count })}</p>
    {onOpenReview && <Button variant='outline' size='sm' className='h-8' onClick={onOpenReview}>{t('dataPreview.reviewGaps')}</Button>}
  </section>;
}

const FIELD_NOT_FOUND = new Set(['unresolved_document_field', 'ai_extraction_unresolved']);

/** A value counts as missing when the source gave nothing for it. */
function isEmpty(value: unknown) {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

/** The field being fixed always shows, even when the record has no entry for it at all. */
function withField(values: Array<[string, unknown]>, field: string | null): Array<[string, unknown]> {
  return !field || values.some(([key]) => key === field) ? values : [...values, [field, null]];
}

function Summary({ value, label, good = false, warn = false }: Readonly<{ value: number; label: string; good?: boolean; warn?: boolean }>) {
  return <div className={`rounded-xl border p-3 ${good ? 'border-emerald-500/30 bg-emerald-500/5' : warn && value ? 'border-amber-500/30 bg-amber-500/5' : 'bg-background'}`}><p className='text-xl font-semibold'>{value}</p><p className='text-xs text-muted-foreground'>{label}</p></div>;
}
