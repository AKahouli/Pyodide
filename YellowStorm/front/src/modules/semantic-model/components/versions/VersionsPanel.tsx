import { useEffect, useState } from 'react';
import { GitCompare, History, Loader2, RotateCcw, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/modules/semantic-model/components/common/Select';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { showError, showSuccess, showWarning } from '@/lib/notifications';
import { useModuleTranslation } from '@/modules/localization';
import { semanticModelApi } from '../../api';
import { useSemanticVersions, useVersionComparison } from '../../query/hooks';
import type { VersionChange, VersionComparison } from '../../types';

export function VersionsPanel({ modelId, canEdit, canPublish, onPublished, onClose }: Readonly<{ modelId: string; canEdit: boolean; canPublish: boolean; onPublished: () => void; onClose?: () => void }>) {
  const { t,language } = useModuleTranslation('semantic-model');
  const versions = useSemanticVersions(modelId);
  const list = versions.data ?? [];
  const draft = list.find((version) => version.status === 'draft');
  const latestPublished = list.find((version) => version.status === 'published');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [left, setLeft] = useState<string>();
  const [right, setRight] = useState<string>();
  useEffect(() => { setLeft((current) => current ?? latestPublished?.id); setRight((current) => current ?? draft?.id); }, [draft?.id, latestPublished?.id]);
  const publishChanges = useVersionComparison(modelId, latestPublished?.id, draft?.id);
  const comparison = useVersionComparison(modelId, left, right);
  const versionName = (id?: string) => {
    const version = list.find((candidate) => candidate.id === id);
    return version ? `${t('versions.number',{number:version.versionNumber})} · ${t(`status.${version.status}`)}` : '';
  };
  const publish = async () => {
    setConfirmOpen(false);
    try { const result = await semanticModelApi.publish(modelId); await versions.refetch(); onPublished(); if (result.data?.published === false) showWarning(t('versions.publishedWithoutData'), { description: t(result.data.reason === 'draft_data_outdated' ? 'versions.dataOutdated' : result.data.reason === 'no_draft_data' ? 'versions.noData' : 'versions.dataUnavailable') }); else showSuccess(t('versions.published')); }
    catch (error) { showError(t('versions.publishError'),{description:error instanceof Error ? error.message : undefined}); }
  };
  return <aside className='relative z-20 w-[min(24rem,100%)] shrink-0 overflow-y-auto border-l bg-background p-4 pb-28 shadow-xl' aria-label={t('versions.title')}>
    <div className='mb-5 flex items-start gap-3'><div className='rounded-xl bg-primary/10 p-2 text-primary'><History className='h-5 w-5' /></div><div className='min-w-0 flex-1'><h2 className='font-semibold'>{t('versions.title')}</h2><p className='text-xs text-muted-foreground'>{t('versions.description')}</p></div>
      {onClose && <Button size='icon' variant='ghost' className='h-8 w-8 shrink-0' onClick={onClose} aria-label={t('action.close')}><X className='h-4 w-4' /></Button>}</div>
    {canEdit && draft && latestPublished && <section className='mb-4 rounded-xl border bg-muted/30 p-3' aria-label={t('versionChanges.ifYouPublish')}>
      <h3 className='text-sm font-semibold'>{t('versionChanges.ifYouPublish')}</h3>
      <ChangeList comparison={publishChanges.data} loading={publishChanges.isLoading} failed={publishChanges.isError} />
    </section>}
    {canEdit&&<Button className='mb-5 w-full' onClick={() => setConfirmOpen(true)} disabled={!canPublish}><Send className='mr-2 h-4 w-4' />{t('versions.publish')}</Button>}
    {list.length > 1 && <section className='mb-5 rounded-xl border p-3' aria-label={t('versionChanges.compareTitle')}>
      <h3 className='flex items-center gap-2 text-sm font-semibold'><GitCompare className='h-4 w-4' />{t('versionChanges.compareTitle')}</h3>
      <div className='mt-2 grid gap-2 text-xs'>
        <label className='grid gap-1'>{t('versionChanges.from')}<Select value={left ?? undefined} onValueChange={setLeft}><SelectTrigger className='px-2'><SelectValue /></SelectTrigger><SelectContent>{list.map((version) => <SelectItem key={version.id} value={version.id}>{versionName(version.id)}</SelectItem>)}</SelectContent></Select></label>
        <label className='grid gap-1'>{t('versionChanges.to')}<Select value={right ?? undefined} onValueChange={setRight}><SelectTrigger className='px-2'><SelectValue /></SelectTrigger><SelectContent>{list.map((version) => <SelectItem key={version.id} value={version.id}>{versionName(version.id)}</SelectItem>)}</SelectContent></Select></label>
      </div>
      {left && right && left === right ? <p className='mt-2 text-xs text-muted-foreground'>{t('versionChanges.sameVersion')}</p> : <ChangeList comparison={comparison.data} loading={comparison.isLoading} failed={comparison.isError} />}
    </section>}
    {versions.isLoading ? <Loader2 className='mx-auto h-5 w-5 animate-spin' /> : <div className='space-y-3'>{list.map((version) => <div key={version.id} className='rounded-xl border p-3'><div className='flex items-center justify-between'><p className='text-sm font-semibold'>{t('versions.number',{number:version.versionNumber})}</p><Badge variant={version.status === 'published' ? 'default':'secondary'}>{t(`status.${version.status}`)}</Badge></div><p className='mt-2 text-xs text-muted-foreground'>{new Intl.DateTimeFormat(language,{dateStyle:'medium',timeStyle:'short'}).format(new Date(version.createdAt))}</p>{draft && version.id !== draft.id && <Button className='mt-3 w-full' size='sm' variant='ghost' onClick={() => { setLeft(version.id); setRight(draft.id); }}><GitCompare className='mr-2 h-3.5 w-3.5' />{t('versionChanges.compareWithDraft')}</Button>}{canEdit&&version.status === 'published' && <Button className='mt-2 w-full' size='sm' variant='outline' onClick={() => void semanticModelApi.restore(modelId,version.id).then(async () => { await versions.refetch(); onPublished(); showSuccess(t('versions.restored')); })}><RotateCcw className='mr-2 h-3.5 w-3.5' />{t('versions.restore')}</Button>}</div>)}</div>}
    <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('versionChanges.confirmTitle')}</DialogTitle>
          <DialogDescription>{latestPublished ? t('versionChanges.confirmDescription') : t('versionChanges.confirmFirst')}</DialogDescription>
        </DialogHeader>
        {latestPublished && <div className='max-h-72 overflow-y-auto'><ChangeList comparison={publishChanges.data} loading={publishChanges.isLoading} failed={publishChanges.isError} /></div>}
        <DialogFooter>
          <Button variant='outline' onClick={() => setConfirmOpen(false)}>{t('action.cancel')}</Button>
          <Button onClick={() => void publish()}><Send className='mr-2 h-4 w-4' />{t('versionChanges.confirmPublish')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </aside>;
}

/** The differences between two versions as sentences a business reader understands. */
export function ChangeList({ comparison, loading, failed }: Readonly<{ comparison?: VersionComparison; loading?: boolean; failed?: boolean }>) {
  const { t } = useModuleTranslation('semantic-model');
  if (loading) return <p className='mt-2 flex items-center gap-2 text-xs text-muted-foreground'><Loader2 className='h-3.5 w-3.5 animate-spin' />{t('versionChanges.loading')}</p>;
  if (failed || !comparison) return failed ? <p className='mt-2 text-xs text-muted-foreground'>{t('versionChanges.unavailable')}</p> : null;
  const { changes, records } = comparison;
  const recordLine = records.change == null ? null
    : records.change === 0 ? t('versionChanges.recordsSame', { count: records.after ?? 0 })
      : t(records.change > 0 ? 'versionChanges.recordsMore' : 'versionChanges.recordsFewer', { count: Math.abs(records.change), before: records.before ?? 0, after: records.after ?? 0 });
  if (!changes.length && !recordLine) return <p className='mt-2 text-xs text-muted-foreground'>{t('versionChanges.none')}</p>;
  return <ul className='mt-2 space-y-1.5 text-xs'>
    {changes.map((change, index) => <li key={`${change.kind}-${index}`} className='flex gap-2'><span aria-hidden className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${tone(change)}`} /><span className='break-words'>{describeChange(change, t as Translate)}</span></li>)}
    {recordLine && <li className='flex gap-2 font-medium'><span aria-hidden className='mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary' /><span>{recordLine}</span></li>}
  </ul>;
}

function tone(change: VersionChange) {
  if (change.kind.endsWith('_added')) return 'bg-emerald-500';
  if (change.kind.endsWith('_removed')) return 'bg-destructive';
  return 'bg-amber-500';
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

function describeChange(change: VersionChange, t: Translate): string {
  switch (change.kind) {
    case 'field_type_changed': return t('versionChanges.field_type_changed', { ...change, from: t(`attribute.type.${change.from}`), to: t(`attribute.type.${change.to}`) });
    case 'field_required_changed': return t(change.required ? 'versionChanges.field_now_required' : 'versionChanges.field_now_optional', change);
    case 'relation_cardinality_changed': return t('versionChanges.relation_cardinality_changed', { ...change, from: t(`cardinality.${change.from}`), to: t(`cardinality.${change.to}`) });
    default: return t(`versionChanges.${change.kind}`, change);
  }
}
