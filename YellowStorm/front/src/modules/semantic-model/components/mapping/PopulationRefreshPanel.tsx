import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { showError, showSuccess } from '@/lib/notifications';
import { parseApiError } from '@/lib/api-error';
import { useModuleTranslation } from '@/modules/localization';
import { semanticModelApi } from '../../api';
import type { ConceptSourceMapping, PopulationRefreshResponse } from '../../types';

const STRUCTURED_KINDS = new Set(['excel_sheet', 'csv']);
const TERMINAL_STATES = new Set(['completed', 'completed_with_gaps', 'failed', 'cancelled', 'superseded']);

export function PopulationRefreshPanel({ modelId, mappings, canEdit, onAccepted }: Readonly<{ modelId: string; mappings: ConceptSourceMapping[]; canEdit: boolean; onAccepted?: (jobId: string) => void }>) {
  const { t } = useModuleTranslation('semantic-model');
  const client = useQueryClient();
  const structured = mappings.filter((mapping) => mapping.status === 'ready' && STRUCTURED_KINDS.has(mapping.assetKind));
  const [scopeKind, setScopeKind] = useState<'model' | 'mapping'>('model');
  const [mappingId, setMappingId] = useState<string>('');
  const [lastJob, setLastJob] = useState<PopulationRefreshResponse | null>(null);
  const job = useQuery({
    queryKey: ['semantic-models', 'population-job', modelId, lastJob?.jobId],
    queryFn: () => semanticModelApi.getPopulationJob(modelId, lastJob!.jobId),
    enabled: Boolean(lastJob?.jobId),
    refetchInterval: (query) => TERMINAL_STATES.has(query.state.data?.state ?? '') ? false : 2000,
    retry: false,
  });
  const run = useMutation({
    mutationFn: (purpose: 'build' | 'refresh') => semanticModelApi.requestPopulationRefresh(modelId, {
      purpose,
      scope: scopeKind === 'mapping' ? { kind: 'mapping', mappingId } : { kind: 'model' },
    }),
    onSuccess: (response) => {
      setLastJob(response);
      onAccepted?.(response.jobId);
      showSuccess(response.reused ? t('populationRefresh.reused', { jobId: response.jobId }) : t('populationRefresh.accepted', { jobId: response.jobId }));
      void client.invalidateQueries({ queryKey: ['semantic-models', 'data-preview', modelId] });
    },
    onError: (error) => showError(t('populationRefresh.failed'), { description: error instanceof Error ? error.message : undefined }),
  });
  const jobActive = Boolean(lastJob) && !job.isError && !TERMINAL_STATES.has(job.data?.state ?? '');
  useEffect(() => {
    if (job.data && TERMINAL_STATES.has(job.data.state)) {
      void client.invalidateQueries({ queryKey: ['semantic-models', 'data-preview', modelId] });
    }
  }, [client, job.data, modelId]);
  const mappingReady = scopeKind === 'model' || Boolean(mappingId);
  return <section className='rounded-2xl border bg-background p-5'>
    <div className='flex flex-col justify-between gap-3 sm:flex-row sm:items-center'>
      <div><h3 className='font-semibold'>{t('populationRefresh.title')}</h3><p className='text-xs text-muted-foreground'>{t('populationRefresh.description')}</p></div>
      <div className='flex items-center gap-2'>
        <Button variant='outline' disabled={!canEdit || run.isPending || jobActive || !mappingReady} onClick={() => run.mutate('build')}>{run.isPending || jobActive ? <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' /> : <Play className='mr-1.5 h-3.5 w-3.5' />}{t('populationRefresh.prepare')}</Button>
        <Button disabled={!canEdit || run.isPending || jobActive || !mappingReady} onClick={() => run.mutate('refresh')}>{run.isPending || jobActive ? <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' /> : null}{t('populationRefresh.refreshAction')}</Button>
      </div>
    </div>
    <div className='mt-4 flex flex-col gap-2 sm:flex-row sm:items-center'>
      <span className='text-xs text-muted-foreground'>{t('populationRefresh.scope')}</span>
      <Select value={scopeKind} disabled={!canEdit} onValueChange={(value) => setScopeKind(value as 'model' | 'mapping')}>
        <SelectTrigger className='w-44' aria-label={t('populationRefresh.scope')}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value='model'>{t('populationRefresh.wholeModel')}</SelectItem>
          <SelectItem value='mapping'>{t('populationRefresh.singleMapping')}</SelectItem>
        </SelectContent>
      </Select>
      {scopeKind === 'mapping' && (structured.length
        ? <Select value={mappingId} disabled={!canEdit} onValueChange={setMappingId}><SelectTrigger className='w-64' aria-label={t('populationRefresh.chooseMapping')}><SelectValue placeholder={t('populationRefresh.chooseMapping')} /></SelectTrigger><SelectContent>{structured.map((mapping) => <SelectItem key={mapping.id} value={mapping.id}>{mapping.documentName ?? mapping.documentId}{mapping.sheetName ? ` / ${mapping.sheetName}` : ''}</SelectItem>)}</SelectContent></Select>
        : <p className='text-xs text-muted-foreground'>{t('populationRefresh.noStructuredMappings')}</p>)}
    </div>
    {lastJob && <div className='mt-3 flex items-center gap-2 text-xs text-muted-foreground'><p>{job.data
      ? t('populationRefresh.status', { jobId: lastJob.jobId, state: job.data.state })
      : job.isError ? parseApiError(job.error).message
        : t(lastJob.reused ? 'populationRefresh.reused' : 'populationRefresh.accepted', { jobId: lastJob.jobId })}{job.data?.errorCode ? ` ${job.data.errorCode}` : ''}{lastJob.skipped.length > 0 ? ` ${t('populationRefresh.skipped', { count: lastJob.skipped.length })}` : ''}</p>{job.isError && <Button variant='link' size='sm' className='h-auto p-0 text-xs' onClick={() => void job.refetch()}>{t('action.retry')}</Button>}</div>}
  </section>;
}
