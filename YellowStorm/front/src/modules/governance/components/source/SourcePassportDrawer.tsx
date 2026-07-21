import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useModuleTranslation } from '@/modules/localization';
import { governanceApi } from '../../api';
import { useGovernanceSourceEvents, useGovernanceSourceVersions } from '../../query/hooks';
import { governanceQueryKeys } from '../../query/queryKeys';
import type { GovernanceSource, GovernanceSourceVersion } from '../../types';
import { TemporalCandidatesPanel } from './TemporalCandidatesPanel';

const validityModes: GovernanceSourceVersion['validity']['mode'][] = ['unknown', 'fixed_date', 'relative_duration', 'until_replaced', 'until_funds_exhausted', 'open_ended'];

export function SourcePassportDrawer({ open, onOpenChange, programId, source }: Readonly<{ open: boolean; onOpenChange: (open: boolean) => void; programId: string | null; source: GovernanceSource | null }>): JSX.Element {
  const { t } = useModuleTranslation('governance');
  const queryClient = useQueryClient();
  const { data: versions = [] } = useGovernanceSourceVersions(programId, source?.id ?? null);
  const { data: events = [] } = useGovernanceSourceEvents(programId, source?.id ?? null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [editingValidity, setEditingValidity] = useState(false);
  const current = versions.find((version) => version.id === selectedVersionId) ?? versions[0];
  useEffect(() => { setEditingValidity(false); }, [open, source?.id, current?.id]);
  const invalidate = () => {
    if (!programId || !source) return;
    void queryClient.invalidateQueries({ queryKey: governanceQueryKeys.sourceVersions(programId, source.id) });
    void queryClient.invalidateQueries({ queryKey: governanceQueryKeys.sourceEvents(programId, source.id) });
  };
  const transition = useMutation({ mutationFn: ({ versionId, action }: { versionId: string; action: 'submit-review' | 'return-to-editing' | 'approve' | 'reject' | 'publish' }) => governanceApi.transitionSourceVersion(programId ?? '', source?.id ?? '', versionId, action), onSuccess: invalidate });
  const updateValidity = useMutation({ mutationFn: ({ versionId, patch }: { versionId: string; patch: Partial<GovernanceSourceVersion['validity']> }) => governanceApi.updateSourceValidity(programId ?? '', source?.id ?? '', versionId, patch), onSuccess: invalidate });
  const saveValidity = (patch: Partial<GovernanceSourceVersion['validity']>) => { if (current) updateValidity.mutate({ versionId: current.id, patch }); };
  const dateValue = (value?: string | null) => value?.slice(0, 10) ?? '';
  const displayDate = (value?: string | null) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value)) : t('sourcePassport.notSet');

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className='max-h-[85vh] max-w-3xl overflow-y-auto'>
    <DialogHeader><DialogTitle>{source?.title ?? t('sourcePassport.title')}</DialogTitle><DialogDescription>{t('sourcePassport.descriptionCompact')}</DialogDescription></DialogHeader>
    {current ? <div key={current.id} className='grid gap-4'>
      <div className='flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/20 p-3'>
        <div className='flex flex-wrap gap-2 text-xs'><StatusPill label={`v${current.versionNumber}`} /><StatusPill label={current.technicalStatus} /><StatusPill label={current.lifecycleStatus} /><StatusPill label={t(`sourcePassport.validityMode.${current.validity.mode}`)} /></div>
        <LifecycleActions current={current} pending={transition.isPending} onAction={(action) => transition.mutate({ versionId: current.id, action })} />
      </div>
      <Tabs defaultValue='overview' className='grid gap-4'>
        <TabsList className='grid w-full grid-cols-3'><TabsTrigger value='overview'>{t('sourcePassport.tabs.overview')}</TabsTrigger><TabsTrigger value='evidence'>{t('sourcePassport.tabs.evidence')}</TabsTrigger><TabsTrigger value='history'>{t('sourcePassport.tabs.history')}</TabsTrigger></TabsList>
        <TabsContent value='overview' className='mt-0 grid gap-3'>
          <section className='rounded-xl border p-4' aria-labelledby='source-validity-title'>
            <div className='flex items-center justify-between gap-3'><div><h3 id='source-validity-title' className='font-semibold'>{t('sourcePassport.validity')}</h3><p className='text-sm text-muted-foreground'>{t(`sourcePassport.validityMode.${current.validity.mode}`)}</p></div><Button type='button' size='sm' variant='outline' onClick={() => setEditingValidity((value) => !value)}><Pencil className='mr-1 h-3.5 w-3.5' />{editingValidity ? t('sourcePassport.doneEditing') : t('sourcePassport.editValidity')}</Button></div>
            {!editingValidity ? <div className='mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4'><SummaryValue label={t('sourcePassport.effectiveFrom')} value={displayDate(current.validity.effectiveFrom)} /><SummaryValue label={t('sourcePassport.effectiveUntil')} value={displayDate(current.validity.effectiveUntil)} /><SummaryValue label={t('sourcePassport.nextReview')} value={displayDate(current.validity.nextReviewAt)} /><SummaryValue label={t('sourcePassport.confidence')} value={`${Math.round(current.validity.confidence * 100)}%`} /></div> : <div className='mt-4 grid gap-3'>
              <Select value={current.validity.mode} disabled={updateValidity.isPending} onValueChange={(mode: GovernanceSourceVersion['validity']['mode']) => saveValidity({ mode })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{validityModes.map((mode) => <SelectItem key={mode} value={mode}>{t(`sourcePassport.validityMode.${mode}`)}</SelectItem>)}</SelectContent></Select>
              <div className='grid gap-3 sm:grid-cols-2'>{([['effective-from', 'sourcePassport.effectiveFrom', 'effectiveFrom'], ['effective-until', 'sourcePassport.effectiveUntil', 'effectiveUntil'], ['last-reviewed', 'sourcePassport.lastReviewed', 'lastReviewedAt'], ['next-review', 'sourcePassport.nextReview', 'nextReviewAt']] as const).map(([id, label, field]) => <div key={id} className='grid gap-1'><Label htmlFor={id}>{t(label)}</Label><Input id={id} type='date' defaultValue={dateValue(current.validity[field])} onBlur={(event) => saveValidity({ [field]: event.target.value || null })} /></div>)}<div className='grid gap-1'><Label htmlFor='review-frequency'>{t('sourcePassport.reviewFrequency')}</Label><Input id='review-frequency' type='number' min='1' defaultValue={current.validity.reviewFrequencyDays ?? undefined} onBlur={(event) => saveValidity({ reviewFrequencyDays: event.target.value ? Number(event.target.value) : null })} /></div><div className='grid gap-1'><Label htmlFor='confidence'>{t('sourcePassport.confidence')}</Label><Input id='confidence' type='number' min='0' max='1' step='0.01' defaultValue={current.validity.confidence} onBlur={(event) => saveValidity({ confidence: Number(event.target.value) })} /></div></div>
              <label className='flex items-center gap-2 text-sm'><Input type='checkbox' className='h-4 w-4' checked={current.validity.manuallyOverridden === true} onChange={(event) => saveValidity({ manuallyOverridden: event.target.checked })} />{t('sourcePassport.manualOverride')}</label>
              {current.validity.manuallyOverridden && <label className='flex items-center gap-2 text-sm'><Input type='checkbox' className='h-4 w-4' checked={current.validity.inclusiveEnd === true} onChange={(event) => saveValidity({ inclusiveEnd: event.target.checked })} />{t('sourcePassport.inclusiveEnd')}</label>}
            </div>}
            <p className='mt-4 text-xs text-muted-foreground'>{t('sourcePassport.businessStatus')}: {current.validity.businessStatus} · {t('sourcePassport.evidenceCount')}: {current.validity.evidence?.length ?? 0}</p>
          </section>
        </TabsContent>
        <TabsContent value='evidence' className='mt-0'>{programId && source && <TemporalCandidatesPanel programId={programId} sourceId={source.id} version={current} onChanged={invalidate} />}</TabsContent>
        <TabsContent value='history' className='mt-0 grid gap-4'>
          <section className='grid gap-2'><h3 className='text-sm font-semibold'>{t('sourcePassport.versions')}</h3><div className='flex flex-wrap gap-2'>{versions.map((version) => <Button key={version.id} type='button' size='sm' variant={version.id === current.id ? 'default' : 'outline'} onClick={() => setSelectedVersionId(version.id)}>{t('sourcePassport.version')} {version.versionNumber}</Button>)}</div></section>
          <section className='grid gap-1 text-sm'><h3 className='font-semibold'>{t('sourcePassport.audit')}</h3>{current.submittedForReviewAt && <p>{t('sourcePassport.submittedAt')}: {new Date(current.submittedForReviewAt).toLocaleString()}</p>}{current.reviewedAt && <p>{t('sourcePassport.reviewedAt')}: {new Date(current.reviewedAt).toLocaleString()}</p>}{current.publishedAt && <p>{t('sourcePassport.publishedAt')}: {new Date(current.publishedAt).toLocaleString()}</p>}</section>
          <section><h3 className='text-sm font-semibold'>{t('sourcePassport.history')}</h3>{events.map((event) => <div key={event.id} className='mt-2 rounded-lg border p-2 text-sm'>{event.eventType}</div>)}</section>
        </TabsContent>
      </Tabs>
    </div> : <p className='text-sm text-muted-foreground'>{t('sourcePassport.empty')}</p>}
  </DialogContent></Dialog>;
}

function StatusPill({ label }: Readonly<{ label: string }>): JSX.Element { return <span className='rounded-full border bg-background px-2.5 py-1 font-medium'>{label.replaceAll('_', ' ')}</span>; }
function SummaryValue({ label, value }: Readonly<{ label: string; value: string }>): JSX.Element { return <div><p className='text-xs text-muted-foreground'>{label}</p><p className='mt-1 text-sm font-medium'>{value}</p></div>; }

function LifecycleActions({ current, pending, onAction }: Readonly<{ current: GovernanceSourceVersion; pending: boolean; onAction: (action: 'submit-review' | 'return-to-editing' | 'approve' | 'reject' | 'publish') => void }>): JSX.Element {
  const { t } = useModuleTranslation('governance');
  return <div className='flex flex-wrap gap-2'>{current.lifecycleStatus === 'captured' && <Button size='sm' disabled={pending} onClick={() => onAction('submit-review')}>{t('sourcePassport.submit')}</Button>}{current.lifecycleStatus === 'to_review' && <><Button size='sm' disabled={pending} onClick={() => onAction('approve')}>{t('sourcePassport.approve')}</Button><Button size='sm' variant='outline' disabled={pending} onClick={() => onAction('reject')}>{t('sourcePassport.reject')}</Button><Button size='sm' variant='outline' disabled={pending} onClick={() => onAction('return-to-editing')}>{t('sourcePassport.return')}</Button></>}{current.lifecycleStatus === 'approved' && <Button size='sm' disabled={pending || current.technicalStatus !== 'ready'} onClick={() => onAction('publish')}>{t('sourcePassport.publish')}</Button>}</div>;
}
