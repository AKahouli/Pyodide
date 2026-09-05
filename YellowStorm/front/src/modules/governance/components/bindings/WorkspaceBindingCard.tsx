import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';
import { getWorkspace } from '@/modules/workspace';
import { useDeleteGovernanceWorkspaceBinding, type GovernanceWorkspaceBinding } from '@/modules/governance';

export function WorkspaceBindingCard({ programId, scopeId, binding }: Readonly<{ programId: string | null; scopeId: string; binding: GovernanceWorkspaceBinding }>): JSX.Element {
  const { t } = useModuleTranslation('governance');
  const workspace = useQuery({ queryKey: ['workspace', binding.workspaceId, 'governance-binding-label'], queryFn: () => getWorkspace(binding.workspaceId), retry: false });
  const deleteBinding = useDeleteGovernanceWorkspaceBinding(programId);
  const label = workspace.isPending ? t('workspaceBinding.loadingWorkspace') : workspace.data?.name ?? t('workspaceBinding.unavailableWorkspace');
  const canDisconnect = binding.visibility === 'scope_specific' && binding.scopeIds?.length === 1 && binding.scopeIds[0] === scopeId;
  return <article className='flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-background p-4'>
    <div className='min-w-0'><p className='truncate font-medium'>{label}</p><p className='mt-1 flex items-center gap-1.5 text-xs text-muted-foreground'><CheckCircle2 className='h-3.5 w-3.5' />{t(canDisconnect ? 'workspaceBinding.connected' : 'workspaceBinding.sharedConnection')}</p></div>
    {canDisconnect && <Button type='button' variant='ghost' size='sm' className='text-destructive' disabled={deleteBinding.isPending} onClick={() => deleteBinding.mutate(binding.id)}><Trash2 className='mr-1 h-4 w-4' />{t('workspaceBinding.remove')}</Button>}
  </article>;
}
