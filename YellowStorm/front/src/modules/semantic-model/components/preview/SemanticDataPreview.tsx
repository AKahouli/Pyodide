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
import type { SourcePreviewIssue } from '../../types';

export function SemanticDataPreview({ modelId, dataRevisionId, onDataRevision }: Readonly<{ modelId: string; dataRevisionId?: string; onDataRevision?: (revisionId: string) => void }>) {
  const { t } = useModuleTranslation('semantic-model');
  const [limit, setLimit] = useState(25);
  const [conceptId, setConceptId] = useState('all');
  const [search, setSearch] = useState('');
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
  const labels = new Map((preview.data?.concepts ?? []).flatMap((concept) => concept.entities.map((entity) => [entity.id, entity.label] as const)));

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
      {concepts.map((concept) => <section key={concept.id} className='space-y-3'>
        <div className='flex items-baseline justify-between'><h3 className='text-lg font-semibold'>{concept.label}</h3><span className='text-xs text-muted-foreground'>{t('dataPreview.entityCount', { count: concept.entities.length })}</span></div>
        <div className='grid gap-3 lg:grid-cols-2'>{concept.entities.map((entity) => <article key={entity.id} className='rounded-2xl border bg-background p-4 shadow-sm'>
          <div className='flex items-start justify-between gap-3'><h4 className='font-semibold'>{entity.label || t('mapping.unnamedEntity')}</h4>{entity.conflicts.length > 0 && <span className='rounded-full bg-amber-500/10 px-2 py-1 text-[10px] font-medium text-amber-700'>{t('dataPreview.conflictBadge', { count: entity.conflicts.length })}</span>}</div>
          <div className='mt-3 divide-y'>{Object.entries(entity.values).map(([attribute, value]) => {
            const provenance = entity.provenance[attribute];
            const canOpen = Boolean(provenance?.source.workspaceId && provenance.source.documentId);
            return <div key={attribute} className='grid grid-cols-[minmax(6rem,0.7fr)_1fr] gap-3 py-2 text-sm'><span className='text-muted-foreground'>{attribute}</span><div className='min-w-0'><p className='break-words'>{String(value ?? '')}</p>{provenance && <button type='button' disabled={!canOpen} className='mt-1 flex max-w-full items-center gap-1 truncate text-left text-[11px] text-primary disabled:cursor-default disabled:text-muted-foreground' onClick={() => canOpen && void useFileViewerStore.getState().openFile(provenance.source.workspaceId!, provenance.source.documentId!, provenance.source.documentPath ?? '', provenance.source.documentName, provenance.source.mimeType ?? '', { page: Number.parseInt(provenance.field?.page ?? '1', 10) || 1, highlightText: provenance.field?.quote })}><ExternalLink className='h-3 w-3 shrink-0' />{provenance.source.documentName}{provenance.source.sheetName ? ` / ${provenance.source.sheetName}` : ''}{provenance.rowNumber ? ` · ${t('dataPreview.row', { row: provenance.rowNumber })}` : ''}{provenance.field?.reference ? ` · ${t('dataPreview.column', { column: provenance.field.reference })}` : ''}</button>}</div></div>;
          })}</div>
          {entity.conflicts.length > 0 && <div className='mt-3 space-y-2 border-t pt-3'><p className='text-xs font-medium text-amber-700 dark:text-amber-400'>{t('dataPreview.conflictDetails')}</p>{entity.conflicts.map((conflict, index) => <div key={`${conflict.attribute}-${conflict.conflictingMappingId}-${index}`} className='rounded-lg bg-amber-500/10 p-2 text-xs'><p className='font-medium'>{conflict.attribute}</p><p className='mt-1 break-words'>{String(conflict.preferred ?? '')} <span className='text-muted-foreground'>· {entity.sources?.find((source) => source.mappingId === conflict.preferredMappingId)?.source.documentName ?? conflict.preferredMappingId}</span></p><p className='mt-1 break-words'>{String(conflict.conflicting ?? '')} <span className='text-muted-foreground'>· {entity.sources?.find((source) => source.mappingId === conflict.conflictingMappingId)?.source.documentName ?? conflict.conflictingMappingId}</span></p></div>)}</div>}
        </article>)}</div>
      </section>)}
      {concepts.every((concept) => concept.entities.length === 0) && <div className='rounded-2xl border border-dashed bg-background p-10 text-center text-sm text-muted-foreground'>{t('dataPreview.empty')}</div>}
      {preview.data && <section className='rounded-2xl border bg-background p-4'><h3 className='font-semibold'>{t('dataPreview.relationships')}</h3><div className='mt-3 space-y-2'>{preview.data.relations.filter((relation) => relation.status === 'resolved' || showUnresolved).map((relation, index) => <div key={`${relation.relationId}-${relation.sourceEntityId}-${index}`} className={`rounded-lg p-3 text-xs ${relation.status === 'resolved' ? 'bg-emerald-500/10' : 'bg-amber-500/10'}`}><div className='flex items-center gap-2'><span className='font-medium'>{labels.get(relation.sourceEntityId) ?? relation.sourceEntityId}</span><span className='text-muted-foreground'>→ {relation.relationLabel} →</span><span className='font-medium'>{relation.targetEntityIds.map((id) => labels.get(id) ?? id).join(', ') || t(`relationMatching.status.${relation.status}`)}</span></div><p className='mt-1 text-muted-foreground'>{relation.sourceAttribute} = {String(relation.sourceValue ?? '')}{relation.targetValues.length ? ` · ${relation.targetAttribute} = ${relation.targetValues.map(String).join(', ')}` : ''}</p></div>)}{preview.data.relations.length === 0 && <p className='text-sm text-muted-foreground'>{t('dataPreview.noRelationships')}</p>}</div></section>}
    </div>
  </div>;
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

function Summary({ value, label, good = false, warn = false }: Readonly<{ value: number; label: string; good?: boolean; warn?: boolean }>) {
  return <div className={`rounded-xl border p-3 ${good ? 'border-emerald-500/30 bg-emerald-500/5' : warn && value ? 'border-amber-500/30 bg-amber-500/5' : 'bg-background'}`}><p className='text-xl font-semibold'>{value}</p><p className='text-xs text-muted-foreground'>{label}</p></div>;
}
