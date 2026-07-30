import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';
import { useGovernanceReconciliationRun, useResumeGovernanceReconciliationRun } from '@/modules/governance';

interface Props {
  programId: string | null;
  bindingId: string;
  runId: string;
  importAllowed: boolean;
  importPending: boolean;
  onImport: () => void;
}

export function ReconciliationRunStatus({ programId, bindingId, runId, importAllowed, importPending, onImport }: Readonly<Props>): JSX.Element {
  const { t } = useModuleTranslation('governance');
  const { data: run } = useGovernanceReconciliationRun(programId, bindingId, runId);
  const resume = useResumeGovernanceReconciliationRun(programId);
  if (!run || run.status === 'pending' || run.status === 'running') {
    return <div className='flex items-center gap-2 rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground' role='status'><Loader2 className='h-4 w-4 animate-spin' />{t('workspaceBinding.updateCheck.running')}</div>;
  }
  if (run.status === 'failed') {
    return <div className='grid gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3' role='alert'><div className='flex items-center gap-2 text-sm text-destructive'><AlertTriangle className='h-4 w-4' />{t('workspaceBinding.updateCheck.failed')}</div>{run.errors.map((error, index) => <p key={`${error.documentId ?? 'error'}-${index}`} className='text-xs text-muted-foreground'>{error.message}</p>)}<Button type='button' size='sm' variant='outline' className='w-fit' disabled={resume.isPending} onClick={() => resume.mutate({ bindingId, runId })}>{t('workspaceBinding.updateCheck.retry')}</Button></div>;
  }

  const updates = (run.stats.missingGovernanceDocuments ?? 0) + (run.stats.createdGovernanceDocuments ?? 0) + (run.stats.staleGovernanceDocuments ?? 0) + (run.stats.archivedMissingArtifacts ?? 0);
  if (!run.dryRun) {
    return <div className='flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3' role='status'><CheckCircle2 className='mt-0.5 h-4 w-4 text-emerald-600' /><div><p className='text-sm font-medium'>{t('workspaceBinding.updateCheck.importComplete')}</p><p className='text-xs text-muted-foreground'>{t('workspaceBinding.updateCheck.importCompleteDescription', { count: updates })}</p></div></div>;
  }
  if (updates === 0) {
    return <div className='flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3' role='status'><CheckCircle2 className='mt-0.5 h-4 w-4 text-emerald-600' /><div><p className='text-sm font-medium'>{t('workspaceBinding.updateCheck.upToDate')}</p><p className='text-xs text-muted-foreground'>{t('workspaceBinding.updateCheck.upToDateDescription', { count: run.stats.scannedDocuments ?? 0 })}</p></div></div>;
  }

  return <div className='grid gap-3 rounded-lg border bg-muted/20 p-3' role='status' aria-live='polite'>
    <div><p className='text-sm font-medium'>{t('workspaceBinding.updateCheck.available', { count: updates })}</p><p className='text-xs text-muted-foreground'>{t('workspaceBinding.updateCheck.checkedDocuments', { count: run.stats.scannedDocuments ?? 0 })}</p></div>
    <dl className='grid grid-cols-2 gap-2 text-xs sm:grid-cols-4'>
      <div><dt className='text-muted-foreground'>{t('workspaceBinding.updateCheck.newDocuments')}</dt><dd className='font-semibold'>{run.stats.missingGovernanceDocuments ?? 0}</dd></div>
      <div><dt className='text-muted-foreground'>{t('workspaceBinding.updateCheck.newVersions')}</dt><dd className='font-semibold'>{run.stats.createdGovernanceDocuments ?? 0}</dd></div>
      <div><dt className='text-muted-foreground'>{t('workspaceBinding.updateCheck.statusUpdates')}</dt><dd className='font-semibold'>{run.stats.staleGovernanceDocuments ?? 0}</dd></div>
      <div><dt className='text-muted-foreground'>{t('workspaceBinding.updateCheck.unavailableFiles')}</dt><dd className='font-semibold'>{run.stats.archivedMissingArtifacts ?? 0}</dd></div>
    </dl>
    {run.errors.length > 0 && <p className='text-xs text-destructive'>{t('workspaceBinding.updateCheck.errors', { count: run.errors.length })}</p>}
    {importAllowed ? <Button type='button' size='sm' className='w-fit' disabled={importPending} onClick={onImport}>{t('workspaceBinding.updateCheck.import', { count: updates })}</Button> : <p className='text-xs text-muted-foreground'>{t('workspaceBinding.updateCheck.manualHelp')}</p>}
  </div>;
}
