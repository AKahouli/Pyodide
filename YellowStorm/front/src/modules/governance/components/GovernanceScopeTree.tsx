import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import type { GovernanceScope, GovernanceScopeOverview } from '@/modules/governance';
import { useGovernanceCheckLabel } from '../useGovernanceCheckLabel';
import { ReadinessRing } from './ReadinessRing';

interface Props {
  scopes: GovernanceScope[];
  selectedScopeId: string | null;
  overviewsByScopeId: Record<string, GovernanceScopeOverview | undefined>;
  onSelectScope: (scopeId: string) => void;
  onCreateScope: () => void;
}

function isVisibleBlocker(key: string): boolean {
  return !key.startsWith('deployment_') && key !== 'draft_revision_publishable';
}

export function GovernanceScopeTree({ scopes, selectedScopeId, overviewsByScopeId, onSelectScope, onCreateScope }: Readonly<Props>): JSX.Element {
  const { t } = useModuleTranslation('governance');
  const { translateBlocker } = useGovernanceCheckLabel();

  return (
    <aside className='rounded-2xl border bg-card p-4 shadow-sm lg:sticky lg:top-4 lg:self-start'>
      <div className='flex items-center justify-between gap-2'>
        <div>
          <p className='text-xs font-semibold uppercase tracking-wide text-primary'>{t('scopeShell.scopeTree.kicker')}</p>
          <h2 className='mt-1 text-lg font-semibold'>{t('scopeShell.scopeTree.title')}</h2>
        </div>
      </div>
      <Button type='button' variant='outline' size='sm' className='mt-3 w-full justify-center' onClick={onCreateScope}><Plus className='h-4 w-4' />{t('cockpit.newScope')}</Button>
      <div className='mt-4 grid gap-2'>
        {scopes.map((scope) => {
          const isSelected = scope.id === selectedScopeId;
          const overview = overviewsByScopeId[scope.id];
          const score = overview?.readiness.score;
          const topBlocker = overview?.readiness.blockers.find((blocker) => isVisibleBlocker(blocker.key));
          return (
            <button key={scope.id} type='button' className={cn('grid grid-cols-[30px_1fr] items-center gap-3 rounded-xl border p-3 text-left transition hover:bg-muted/60', isSelected && 'border-primary bg-primary/5')} onClick={() => onSelectScope(scope.id)}>
              <ReadinessRing score={score ?? 0} size={30} />
              <span className='min-w-0'>
                <span className='block truncate font-medium'>{scope.name}</span>
                <span className='block truncate text-xs text-muted-foreground'>{t(`scopeShell.scopeTypes.${scope.type}`)}</span>
                {topBlocker && <span className='mt-0.5 block truncate text-xs text-destructive'>{translateBlocker(topBlocker.key, topBlocker.label)}</span>}
              </span>
            </button>
          );
        })}
        {scopes.length === 0 && <p className='rounded-xl border border-dashed p-4 text-sm text-muted-foreground'>{t('scopes.empty')}</p>}
      </div>
    </aside>
  );
}
