import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';
import { useGovernanceReconciliationRun, useResumeGovernanceReconciliationRun } from '@/modules/governance';

export function ReconciliationRunStatus({ programId, bindingId, runId }: Readonly<{ programId: string | null; bindingId: string; runId: string }>): JSX.Element {
  const { t } = useModuleTranslation('governance');
  const { data: run } = useGovernanceReconciliationRun(programId, bindingId, runId);
  const resume = useResumeGovernanceReconciliationRun(programId);
  if (!run) return <p className='text-xs text-muted-foreground'>{t('workspaceBinding.run.loading')}</p>;
  const repairs = (run.stats.missingSources ?? 0) + (run.stats.missingVersions ?? 0) + (run.stats.repairedStatuses ?? 0) + (run.stats.missingArtifacts ?? 0);
  return <div className='mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground' role='status' aria-live='polite'>
    <span>{t(`workspaceBinding.run.status.${run.status}`)}</span>
    <span>{t('workspaceBinding.run.summary', { documents: run.stats.scannedDocuments ?? 0, repairs })}</span>
    {run.errors.length > 0 && <span className='text-destructive'>{t('workspaceBinding.run.errors', { count: run.errors.length })}</span>}
    {run.status === 'failed' && <Button type='button' size='sm' variant='outline' disabled={resume.isPending} onClick={() => resume.mutate({ bindingId, runId })}>{t('workspaceBinding.run.resume')}</Button>}
  </div>;
}
