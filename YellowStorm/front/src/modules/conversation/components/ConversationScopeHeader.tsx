import { ChevronDown, LockKeyhole, MessageSquare, ShieldCheck } from 'lucide-react';
import type { AvailableGovernedScope } from '@/modules/governance';
import { useModuleTranslation } from '@/modules/localization';

interface ConversationScopeHeaderProps {
  enabled: boolean;
  scopes: AvailableGovernedScope[];
  scope?: AvailableGovernedScope | null;
  locked: boolean;
  isError?: boolean;
  onChange: (scopeId: string) => void;
  onRetry: () => void;
}

export function ConversationScopeHeader({ enabled, scopes, scope, locked, isError, onChange, onRetry }: ConversationScopeHeaderProps) {
  const { t } = useModuleTranslation('conversation');
  if (!scope && (!enabled || (!scopes.length && !isError))) return null;
  const Icon = scope ? ShieldCheck : MessageSquare;
  // Upload creation pins the scope even if a subsequent availability refresh removes it.
  const options = scope && !scopes.some((item) => item.scopeId === scope.scopeId) ? [scope, ...scopes] : scopes;

  return (
    <div className='conversation-scope-header'>
      <div className='conversation-scope-row'>
        <label className='conversation-scope-picker'>
          <span>{t('home.scope.label')}</span>
          <span className='conversation-scope-select'>
            <Icon aria-hidden='true' className='size-4' />
            <select value={scope?.scopeId ?? ''} disabled={locked} onChange={(event) => onChange(event.target.value)}>
              <option value=''>{t('home.scope.standard')}</option>
              {options.length > 0 && <optgroup label={t('home.scope.governedGroup')}>
                {options.map((item) => <option key={item.scopeId} value={item.scopeId}>{item.name}</option>)}
              </optgroup>}
            </select>
            <ChevronDown aria-hidden='true' className='size-4' />
          </span>
        </label>
        {scope && <span className='conversation-scope-badge'><ShieldCheck aria-hidden='true' className='size-4' />{t('home.activity.governed')}</span>}
      </div>
      {scope && <div className='conversation-scope-description' aria-live='polite'>
        <span className='sr-only'>{t('home.scope.governedBy', { name: scope.name })}</span>
        <span>{t('home.scope.approved')}</span>
        <details key={scope.scopeId} className='conversation-scope-details'>
          <summary>{t('home.scope.viewDetails')}</summary>
          <div>
            {scope.description && <p>{scope.description}</p>}
            <p>{t('home.scope.description', { version: scope.revisionNumber })}</p>
            {scope.primaryAgent?.name && <p>{t('home.scope.primaryAgent', { name: scope.primaryAgent.name })}</p>}
          </div>
        </details>
      </div>}
      {locked && <p className='conversation-scope-note'><LockKeyhole aria-hidden='true' className='size-3.5' />{t('home.scope.locked')}</p>}
      {enabled && isError && <div role='alert' className='conversation-scope-note text-destructive'>
        <span>{t('home.scope.loadError')}</span>
        <button type='button' className='underline underline-offset-4' onClick={onRetry}>{t('home.retry')}</button>
      </div>}
    </div>
  );
}
