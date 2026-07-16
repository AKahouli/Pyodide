import { useModuleTranslation } from '@/modules/localization';
import type { GovernanceWorkspaceBinding } from '@/modules/governance';
import { WorkspaceBindingCard } from './WorkspaceBindingCard';

export function WorkspaceBindingList({ programId, bindings }: Readonly<{ programId: string | null; bindings: GovernanceWorkspaceBinding[] }>): JSX.Element {
  const { t } = useModuleTranslation('governance');
  if (bindings.length === 0) return <p className='text-sm text-muted-foreground'>{t('workspaceBinding.empty')}</p>;
  return <div className='grid gap-2'>{bindings.map((binding) => <WorkspaceBindingCard key={binding.id} programId={programId} binding={binding} />)}</div>;
}
