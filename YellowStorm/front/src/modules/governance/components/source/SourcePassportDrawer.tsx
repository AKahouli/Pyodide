import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useModuleTranslation } from '@/modules/localization';
import { governanceApi } from '../../api';
import { useGovernanceSourceEvents, useGovernanceSourceVersions } from '../../query/hooks';
import { governanceQueryKeys } from '../../query/queryKeys';
import type { GovernanceSource, GovernanceSourceVersion } from '../../types';

const validityModes: Array<{ mode: GovernanceSourceVersion['validity']['mode']; key: 'sourcePassport.validityMode.unknown' | 'sourcePassport.validityMode.fixed_date' | 'sourcePassport.validityMode.relative_duration' | 'sourcePassport.validityMode.until_replaced' | 'sourcePassport.validityMode.until_funds_exhausted' | 'sourcePassport.validityMode.open_ended' }> = [
  { mode: 'unknown', key: 'sourcePassport.validityMode.unknown' }, { mode: 'fixed_date', key: 'sourcePassport.validityMode.fixed_date' }, { mode: 'relative_duration', key: 'sourcePassport.validityMode.relative_duration' }, { mode: 'until_replaced', key: 'sourcePassport.validityMode.until_replaced' }, { mode: 'until_funds_exhausted', key: 'sourcePassport.validityMode.until_funds_exhausted' }, { mode: 'open_ended', key: 'sourcePassport.validityMode.open_ended' },
];

export function SourcePassportDrawer({ open, onOpenChange, programId, source }: Readonly<{ open: boolean; onOpenChange: (open: boolean) => void; programId: string | null; source: GovernanceSource | null }>): JSX.Element {
  const { t } = useModuleTranslation('governance');
  const queryClient = useQueryClient();
  const { data: versions = [] } = useGovernanceSourceVersions(programId, source?.id ?? null);
  const { data: events = [] } = useGovernanceSourceEvents(programId, source?.id ?? null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const current = versions.find((version) => version.id === selectedVersionId) ?? versions[0];
  const invalidate = () => {
    if (!programId || !source) return;
    void queryClient.invalidateQueries({ queryKey: governanceQueryKeys.sourceVersions(programId, source.id) });
    void queryClient.invalidateQueries({ queryKey: governanceQueryKeys.sourceEvents(programId, source.id) });
  };
  const transition = useMutation({ mutationFn: ({ versionId, action }: { versionId: string; action: 'submit-review' | 'return-to-editing' | 'approve' | 'reject' | 'publish' }) => governanceApi.transitionSourceVersion(programId ?? '', source?.id ?? '', versionId, action), onSuccess: invalidate });
  const updateValidity = useMutation({ mutationFn: ({ version, mode }: { version: GovernanceSourceVersion; mode: GovernanceSourceVersion['validity']['mode'] }) => governanceApi.updateSourceValidity(programId ?? '', source?.id ?? '', version.id, { ...version.validity, mode }), onSuccess: invalidate });
  const summary = [
    { label: 'sourcePassport.version' as const, value: `v${current?.versionNumber ?? ''}` }, { label: 'sourcePassport.technical' as const, value: current?.technicalStatus ?? '' }, { label: 'sourcePassport.lifecycle' as const, value: current?.lifecycleStatus ?? '' }, { label: 'sourcePassport.validity' as const, value: current?.validity.mode ?? '' },
  ];

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className='max-h-[85vh] max-w-2xl overflow-y-auto'><DialogHeader><DialogTitle>{source?.title ?? t('sourcePassport.title')}</DialogTitle><DialogDescription>{t('sourcePassport.description')}</DialogDescription></DialogHeader>{current ? <div className='grid gap-4'><div className='grid gap-2 rounded-xl border p-3 sm:grid-cols-4'>{summary.map(({ label, value }) => <div key={label}><p className='text-xs text-muted-foreground'>{t(label)}</p><p className='text-sm font-medium'>{value}</p></div>)}</div><div className='grid gap-2'><h3 className='text-sm font-semibold'>{t('sourcePassport.versions')}</h3><div className='flex flex-wrap gap-2'>{versions.map((version) => <Button key={version.id} type='button' size='sm' variant={version.id === current.id ? 'default' : 'outline'} onClick={() => setSelectedVersionId(version.id)}>{t('sourcePassport.version')} {version.versionNumber}</Button>)}</div></div><div className='flex flex-wrap gap-2'>{current.lifecycleStatus === 'captured' && <Button size='sm' onClick={() => transition.mutate({ versionId: current.id, action: 'submit-review' })}>{t('sourcePassport.submit')}</Button>}{current.lifecycleStatus === 'to_review' && <><Button size='sm' onClick={() => transition.mutate({ versionId: current.id, action: 'approve' })}>{t('sourcePassport.approve')}</Button><Button size='sm' variant='outline' onClick={() => transition.mutate({ versionId: current.id, action: 'reject' })}>{t('sourcePassport.reject')}</Button><Button size='sm' variant='outline' onClick={() => transition.mutate({ versionId: current.id, action: 'return-to-editing' })}>{t('sourcePassport.return')}</Button></>}{current.lifecycleStatus === 'approved' && <Button size='sm' disabled={current.technicalStatus !== 'ready'} onClick={() => transition.mutate({ versionId: current.id, action: 'publish' })}>{t('sourcePassport.publish')}</Button>}</div><div className='grid gap-2'><h3 className='text-sm font-semibold'>{t('sourcePassport.validity')}</h3><Select value={current.validity.mode} disabled={updateValidity.isPending} onValueChange={(mode: GovernanceSourceVersion['validity']['mode']) => updateValidity.mutate({ version: current, mode })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{validityModes.map(({ mode, key }) => <SelectItem key={mode} value={mode}>{t(key)}</SelectItem>)}</SelectContent></Select></div><div><h3 className='text-sm font-semibold'>{t('sourcePassport.history')}</h3>{events.map((event) => <div key={event.id} className='mt-2 rounded-lg border p-2 text-sm'>{event.eventType}</div>)}</div></div> : <p className='text-sm text-muted-foreground'>{t('sourcePassport.empty')}</p>}</DialogContent></Dialog>;
}
