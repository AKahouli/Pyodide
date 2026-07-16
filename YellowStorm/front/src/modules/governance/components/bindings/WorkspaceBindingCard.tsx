import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, ChevronDown, PauseCircle, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Switch } from '@/components/ui/switch';
import { dataRoomFeatures } from '@/config/dataRoomFeatures';
import { parseApiError } from '@/lib/api-error';
import { showError } from '@/lib/notifications';
import { useModuleTranslation } from '@/modules/localization';
import { getWorkspace } from '@/modules/workspace';
import { useCreateGovernanceReconciliationRun, useDeleteGovernanceWorkspaceBinding, useUpdateGovernanceWorkspaceBinding, type GovernanceWorkspaceBinding } from '@/modules/governance';
import { ReconciliationRunStatus } from './ReconciliationRunStatus';

export function WorkspaceBindingCard({ programId, binding }: Readonly<{ programId: string | null; binding: GovernanceWorkspaceBinding }>): JSX.Element {
  const { t } = useModuleTranslation('governance');
  const workspace = useQuery({ queryKey: ['workspace', binding.workspaceId, 'governance-binding-label'], queryFn: () => getWorkspace(binding.workspaceId), retry: false });
  const updateBinding = useUpdateGovernanceWorkspaceBinding(programId);
  const deleteBinding = useDeleteGovernanceWorkspaceBinding(programId);
  const createRun = useCreateGovernanceReconciliationRun(programId);
  const [runId, setRunId] = useState<string | null>(null);
  const [runStartError, setRunStartError] = useState<string | null>(null);
  const label = workspace.isPending ? t('workspaceBinding.loadingWorkspace') : workspace.data?.name ?? t('workspaceBinding.unavailableWorkspace');
  const ingestionMode = binding.ingestionMode ?? 'assisted';
  const startRun = (dryRun: boolean) => createRun.mutate(
    { bindingId: binding.id, dryRun },
    {
      onSuccess: (run) => {
        if (!run?.id) { setRunStartError(t('workspaceBinding.run.invalidResponse')); return; }
        setRunStartError(null); setRunId(run.id);
      },
      onError: (error) => { const message = parseApiError(error).message; setRunStartError(message); showError(t('workspaceBinding.run.startError'), { description: message }); },
    },
  );
  const StatusIcon = binding.enabled ? CheckCircle2 : PauseCircle;
  return <article className='grid gap-3 rounded-xl border bg-background p-4'>
    <div className='flex flex-wrap items-start justify-between gap-3'>
      <div className='min-w-0'><p className='truncate font-medium'>{label}</p><p className='mt-1 flex items-center gap-1.5 text-xs text-muted-foreground'><StatusIcon className='h-3.5 w-3.5' />{binding.enabled ? t('workspaceBinding.connected') : t('workspaceBinding.paused')}</p></div>
      <Button type='button' variant='outline' size='sm' disabled={!binding.enabled || !dataRoomFeatures.reconciliationEnabled || createRun.isPending} onClick={() => startRun(true)}><RefreshCw className='mr-1 h-3.5 w-3.5' />{t('workspaceBinding.updateCheck.action')}</Button>
    </div>
    {!binding.enabled && <p className='rounded-lg bg-muted/40 p-2 text-xs text-muted-foreground'>{t('workspaceBinding.pausedHelp')}</p>}
    {!dataRoomFeatures.reconciliationEnabled && <p className='text-xs text-muted-foreground'>{t('workspaceBinding.reconciliationUnavailable')}</p>}
    {runStartError && <p className='text-xs text-destructive' role='alert'>{runStartError}</p>}
    {runId && <ReconciliationRunStatus programId={programId} bindingId={binding.id} runId={runId} importAllowed={binding.enabled && ingestionMode !== 'manual'} importPending={createRun.isPending} onImport={() => startRun(false)} />}
    <Collapsible><CollapsibleTrigger asChild><Button type='button' variant='ghost' size='sm' className='px-0 text-muted-foreground'>{t('workspaceBinding.settings')}<ChevronDown className='ml-1 h-4 w-4' /></Button></CollapsibleTrigger><CollapsibleContent className='mt-2 border-t pt-3'>
      <div className='grid gap-4'><div className='grid gap-1'><label className='grid gap-1 text-xs text-muted-foreground'>{t('workspaceBinding.ingestionMode')}<select className='h-9 rounded-md border bg-background px-2 text-sm text-foreground' value={ingestionMode} disabled={updateBinding.isPending} onChange={(event) => updateBinding.mutate({ bindingId: binding.id, payload: { ingestionMode: event.target.value as GovernanceWorkspaceBinding['ingestionMode'] } })}><option value='manual'>{t('workspaceBinding.modeManual')}</option><option value='assisted'>{t('workspaceBinding.modeAssisted')}</option><option value='automatic'>{t('workspaceBinding.modeAutomatic')}</option></select></label><p className='text-xs text-muted-foreground'>{t(`workspaceBinding.modeDescription.${ingestionMode}`)}</p></div>
        <div className='flex flex-wrap items-center gap-2'><Switch aria-label={t('workspaceBinding.toggle')} checked={binding.enabled} disabled={updateBinding.isPending} onCheckedChange={(enabled) => updateBinding.mutate({ bindingId: binding.id, payload: { enabled } })} /><span className='text-xs text-muted-foreground'>{t('workspaceBinding.toggle')}</span></div>
        <Button type='button' variant='ghost' size='sm' className='w-fit text-destructive' disabled={deleteBinding.isPending} onClick={() => deleteBinding.mutate(binding.id)}><Trash2 className='mr-1 h-4 w-4' />{t('workspaceBinding.remove')}</Button>
      </div>
    </CollapsibleContent></Collapsible>
  </article>;
}
