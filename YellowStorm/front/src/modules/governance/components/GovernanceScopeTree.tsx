import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { useCreateGovernanceScope, type GovernanceScope, type GovernanceScopeOverview } from '@/modules/governance';
import { useGovernanceCheckLabel } from '../useGovernanceCheckLabel';

interface Props {
  programId: string | null;
  scopes: GovernanceScope[];
  selectedScopeId: string | null;
  overview?: GovernanceScopeOverview;
  onSelectScope: (scopeId: string) => void;
}

export function GovernanceScopeTree({ programId, scopes, selectedScopeId, overview, onSelectScope }: Readonly<Props>): JSX.Element {
  const { t } = useModuleTranslation('governance');
  const createScope = useCreateGovernanceScope(programId);
  const [scopeName, setScopeName] = useState('');
  const { translateBlocker } = useGovernanceCheckLabel();

  const handleCreateScope = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = scopeName.trim();
    if (!name || !programId) return;
    createScope.mutate({ name, type: 'custom' }, { onSuccess: (scope) => { setScopeName(''); onSelectScope(scope.id); } });
  };

  return (
    <aside className='rounded-2xl border bg-card p-4 shadow-sm lg:sticky lg:top-4 lg:self-start'>
      <div>
        <p className='text-xs font-semibold uppercase tracking-wide text-primary'>{t('scopeShell.scopeTree.kicker')}</p>
        <h2 className='mt-1 text-lg font-semibold'>{t('scopeShell.scopeTree.title')}</h2>
        <p className='mt-2 text-sm text-muted-foreground'>{t('scopeShell.scopeTree.description')}</p>
      </div>
      <form className='mt-4 grid gap-2' onSubmit={handleCreateScope}>
        <Input id='governance-new-scope-name' name='scopeName' aria-label={t('scopes.nameLabel')} value={scopeName} onChange={(event) => setScopeName(event.target.value)} placeholder={t('scopes.namePlaceholder')} disabled={!programId} />
        <Button type='submit' disabled={!programId || createScope.isPending}>{t('scopes.create')}</Button>
      </form>
      <div className='mt-4 grid gap-2'>
        {scopes.map((scope) => {
          const isSelected = scope.id === selectedScopeId;
          const score = isSelected ? overview?.readiness.score : undefined;
          return (
            <button key={scope.id} type='button' className={cn('rounded-xl border p-3 text-left transition hover:bg-muted/60', isSelected && 'border-primary bg-primary/5')} onClick={() => onSelectScope(scope.id)}>
              <div className='flex items-center justify-between gap-3'>
                <span className='font-medium'>{scope.name}</span>
                <span className='rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground'>{score === undefined ? scope.status : t('scopeShell.readiness.scoreValue', { score })}</span>
              </div>
              <p className='mt-1 text-xs text-muted-foreground'>{t(`scopeShell.scopeTypes.${scope.type}`)}</p>
              {isSelected && overview?.readiness.blockers[0] && <p className='mt-2 text-xs text-destructive'>{translateBlocker(overview.readiness.blockers[0].key, overview.readiness.blockers[0].label)}</p>}
            </button>
          );
        })}
        {scopes.length === 0 && <p className='rounded-xl border border-dashed p-4 text-sm text-muted-foreground'>{t('scopes.empty')}</p>}
      </div>
    </aside>
  );
}
