import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Network, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { showError, showSuccess } from '@/lib/notifications';
import { parseApiError } from '@/lib/api-error';
import { useModuleTranslation } from '@/modules/localization';
import { semanticModelApi } from '../../api';
import type { ConceptSourceMapping, PopulationRefreshResponse } from '../../types';

const TERMINAL_STATES = new Set(['completed', 'completed_with_gaps', 'failed', 'cancelled', 'superseded']);
/** Runtime job states a person can read; anything else is shown as waiting. */
const KNOWN_STATES = ['queued', 'waiting_dependencies', 'running', 'cancel_requested', 'completed', 'completed_with_gaps', 'failed', 'cancelled', 'superseded'] as const;
/** Runtime error codes with a plain-language explanation; unknown codes fall back to a generic message. */
const KNOWN_ERRORS = [
  'workspace_forbidden', 'asset_not_found', 'asset_changed', 'asset_unavailable', 'unreadable_source', 'dataset_too_large',
  'parser_timeout', 'unmapped_identity', 'invalid_document_mapping', 'unknown_concept', 'unknown_relation',
  'attempts_exhausted', 'stale_lease', 'workspace_required',
] as const;

function known<T extends string>(values: readonly T[], value: string | null | undefined): T | undefined {
  return values.find((candidate) => candidate === value);
}

/**
 * Starts a whole-model record build. Only whole-model builds are published to the data view by the runtime,
 * so partial "update" or single-source runs are not offered: they would finish without any visible effect.
 */
export function PopulationRefreshPanel({ modelId, mappings, canEdit, onAccepted, onOpenGraph }: Readonly<{ modelId: string; mappings: ConceptSourceMapping[]; canEdit: boolean; onAccepted?: (jobId: string) => void; onOpenGraph?: () => void }>) {
  const { t } = useModuleTranslation('semantic-model');
  const client = useQueryClient();
  const [lastJob, setLastJob] = useState<PopulationRefreshResponse | null>(null);
  const job = useQuery({
    queryKey: ['semantic-models', 'population-job', modelId, lastJob?.jobId],
    queryFn: () => semanticModelApi.getPopulationJob(modelId, lastJob!.jobId),
    enabled: Boolean(lastJob?.jobId),
    refetchInterval: (query) => TERMINAL_STATES.has(query.state.data?.state ?? '') ? false : 2000,
    retry: false,
  });
  const run = useMutation({
    mutationFn: () => semanticModelApi.requestPopulationRefresh(modelId, { purpose: 'build', scope: { kind: 'model' } }),
    onSuccess: (response) => {
      setLastJob(response);
      onAccepted?.(response.jobId);
      showSuccess(t(response.reused ? 'populationRefresh.reused' : 'populationRefresh.accepted'));
      void client.invalidateQueries({ queryKey: ['semantic-models', 'data-preview', modelId] });
    },
    onError: (error) => showError(t('populationRefresh.failed'), { description: parseApiError(error).message }),
  });
  const jobActive = Boolean(lastJob) && !job.isError && !TERMINAL_STATES.has(job.data?.state ?? '');
  useEffect(() => {
    if (job.data && TERMINAL_STATES.has(job.data.state)) {
      void client.invalidateQueries({ queryKey: ['semantic-models', 'data-preview', modelId] });
    }
  }, [client, job.data, modelId]);
  const state = job.data?.state;
  const errorCode = job.data?.errorCode;
  return <section className='rounded-2xl border bg-background p-5'>
    <div className='flex flex-col justify-between gap-3 sm:flex-row sm:items-center'>
      <div><h3 className='font-semibold'>{t('populationRefresh.title')}</h3><p className='text-xs text-muted-foreground'>{t('populationRefresh.description')}</p></div>
      <div className='flex flex-wrap items-center gap-2'>
        <Button disabled={!canEdit || run.isPending || jobActive || !mappings.length} onClick={() => run.mutate()}>{run.isPending || jobActive ? <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' /> : <Play className='mr-1.5 h-3.5 w-3.5' />}{t('populationRefresh.prepare')}</Button>
        {onOpenGraph && <Button variant='outline' onClick={onOpenGraph}><Network className='mr-1.5 h-4 w-4' />{t('dataWorkflow.dataGraph')}</Button>}
      </div>
    </div>
    {!mappings.length && <p className='mt-3 text-xs text-amber-700 dark:text-amber-400'>{t('dataWorkflow.noReadySources')}</p>}
    {lastJob && <div className='mt-3 flex items-center gap-2 text-xs text-muted-foreground'><p>{job.isError
      ? parseApiError(job.error).message
      : t(`populationRefresh.state.${known(KNOWN_STATES, state) ?? 'queued'}`)}
      {errorCode ? ` ${t(`populationRefresh.errorCode.${known(KNOWN_ERRORS, errorCode) ?? 'unknown'}`)}` : ''}
      {lastJob.skipped.length > 0 ? ` ${t('populationRefresh.skipped', { count: lastJob.skipped.length })}` : ''}</p>{job.isError && <Button variant='link' size='sm' className='h-auto p-0 text-xs' onClick={() => void job.refetch()}>{t('action.retry')}</Button>}</div>}
  </section>;
}
