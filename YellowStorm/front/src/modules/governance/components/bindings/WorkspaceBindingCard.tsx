import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { dataRoomFeatures } from '@/config/dataRoomFeatures';
import { parseApiError } from '@/lib/api-error';
import { showError } from '@/lib/notifications';
import { useModuleTranslation } from '@/modules/localization';
import { useWorkspaces } from '@/modules/workspace';
import { useCreateGovernanceReconciliationRun, useDeleteGovernanceWorkspaceBinding, useUpdateGovernanceWorkspaceBinding, type GovernanceWorkspaceBinding } from '@/modules/governance';
import { ReconciliationRunStatus } from './ReconciliationRunStatus';

export function WorkspaceBindingCard({ programId, binding }: Readonly<{ programId: string | null; binding: GovernanceWorkspaceBinding }>): JSX.Element {
  const { t } = useModuleTranslation('governance');
  const workspaces = useWorkspaces();
  const updateBinding = useUpdateGovernanceWorkspaceBinding(programId);
  const deleteBinding = useDeleteGovernanceWorkspaceBinding(programId);
  const createRun = useCreateGovernanceReconciliationRun(programId);
  const [runId, setRunId] = useState<string | null>(null);
  const [runStartError, setRunStartError] = useState<string | null>(null);
  const label = workspaces.find((workspace) => workspace.id === binding.workspaceId)?.name ?? binding.workspaceId;
  const startRun = (dryRun: boolean) => createRun.mutate(
    { bindingId: binding.id, dryRun },
    {
      onSuccess: (run) => {
        if (!run?.id) {
          setRunStartError(t('workspaceBinding.run.invalidResponse'));
          return;
        }
        setRunStartError(null);
        setRunId(run.id);
      },
      onError: (error) => {
        const message = parseApiError(error).message;
        setRunStartError(message);
        showError(t('workspaceBinding.run.startError'), { description: message });
      },
    },
  );
  return <div className='flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3'>
    <div className='min-w-0'>
      <p className='truncate font-medium'>{label}</p>
      <p className='text-xs text-muted-foreground'>{t('workspaceBinding.mode', { mode: binding.ingestionMode })} · {binding.enabled ? t('workspaceBinding.enabled') : t('workspaceBinding.disabled')}</p>
      <select aria-label={t('workspaceBinding.ingestionMode')} className='mt-2 h-8 rounded-md border bg-background px-2 text-xs' value={binding.ingestionMode} disabled={updateBinding.isPending} onChange={(event) => updateBinding.mutate({ bindingId: binding.id, payload: { ingestionMode: event.target.value as GovernanceWorkspaceBinding['ingestionMode'] } })}><option value='manual'>{t('workspaceBinding.modeManual')}</option><option value='assisted'>{t('workspaceBinding.modeAssisted')}</option><option value='automatic'>{t('workspaceBinding.modeAutomatic')}</option></select>
      {!dataRoomFeatures.reconciliationEnabled && <p className='mt-2 text-xs text-muted-foreground'>{t('workspaceBinding.reconciliationUnavailable')}</p>}
      {runStartError && <p className='mt-2 text-xs text-destructive' role='alert'>{runStartError}</p>}
      {runId && <ReconciliationRunStatus programId={programId} bindingId={binding.id} runId={runId} />}
    </div>
    <div className='flex items-center gap-2'>
      <Switch aria-label={t('workspaceBinding.toggle')} checked={binding.enabled} disabled={updateBinding.isPending} onCheckedChange={(enabled) => updateBinding.mutate({ bindingId: binding.id, payload: { enabled } })} />
      <Button type='button' variant='outline' size='sm' disabled={!dataRoomFeatures.reconciliationEnabled || createRun.isPending} onClick={() => startRun(true)}>{t('workspaceBinding.reconcile')}</Button>
      <Button type='button' size='sm' disabled={!dataRoomFeatures.reconciliationEnabled || createRun.isPending} onClick={() => startRun(false)}>{t('workspaceBinding.repair')}</Button>
      <Button type='button' variant='ghost' size='icon' aria-label={t('workspaceBinding.remove')} disabled={deleteBinding.isPending} onClick={() => deleteBinding.mutate(binding.id)}><Trash2 className='h-4 w-4' /></Button>
    </div>
  </div>;
}
