import { useModuleTranslation } from '@/modules/localization';
import type { GovernanceWorkspaceBinding } from '@/modules/governance';
import { WorkspaceBindingCard } from './WorkspaceBindingCard';

export function WorkspaceBindingList({ programId, scopeId, bindings }: Readonly<{ programId: string | null; scopeId: string; bindings: GovernanceWorkspaceBinding[] }>): JSX.Element {
  const { t } = useModuleTranslation('governance');
  if (bindings.length === 0) return <p className='text-sm text-muted-foreground'>{t('workspaceBinding.empty')}</p>;
  return <div className='grid gap-2'>{bindings.map((binding) => <WorkspaceBindingCard key={binding.id} programId={programId} scopeId={scopeId} binding={binding} />)}</div>;
}
