import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Bot, BookOpen, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';
import { createGovernedConversation } from '@/modules/conversation/api';
import { showError } from '@/lib/notifications';
import { parseApiError } from '@/lib/api-error';
import { governedConversationFeatures } from '@/config/governedConversationFeatures';
import { useAvailableGovernedScopes, type AvailableGovernedScope } from '@/modules/governance';

export function GovernedScopesCarousel(): JSX.Element | null {
  const { t } = useModuleTranslation('conversation');
  const navigate = useNavigate();
  const { data: scopes = [], isLoading, isError, refetch } = useAvailableGovernedScopes(governedConversationFeatures.carouselEnabled);
  const [startingScopeId, setStartingScopeId] = useState<string | null>(null);
  if (!governedConversationFeatures.carouselEnabled) return null;
  if (!isLoading && !isError && scopes.length === 0) return null;

  const start = async (scope: AvailableGovernedScope) => {
    setStartingScopeId(scope.scopeId);
    try {
      const conversation = await createGovernedConversation(scope.scopeId, crypto.randomUUID());
      navigate(`/conversation/${conversation.id}`);
    } catch (error) {
      showError(t('governedScopes.startError'), { description: parseApiError(error).message });
    } finally { setStartingScopeId(null); }
  };

  return <section aria-labelledby='governed-scopes-heading' className='rounded-2xl border bg-card/70 p-5 shadow-sm backdrop-blur-sm'>
    <div className='mb-4 flex items-start gap-3'><span className='rounded-xl bg-primary/10 p-2.5 text-primary'><ShieldCheck className='size-5' /></span><div><h2 id='governed-scopes-heading' className='text-base font-semibold'>{t('governedScopes.title')}</h2><p className='mt-1 text-sm text-muted-foreground'>{t('governedScopes.description')}</p></div></div>
    {isError ? <div className='flex items-center justify-between rounded-xl border border-dashed p-4 text-sm text-muted-foreground'><span>{t('governedScopes.error')}</span><Button variant='outline' size='sm' onClick={() => void refetch()}><RefreshCw className='mr-2 size-4' />{t('governedScopes.retry')}</Button></div> : <div className='flex snap-x gap-4 overflow-x-auto pb-2' role='list'>
      {isLoading ? Array.from({ length: 3 }).map((_, index) => <div key={index} className='h-64 min-w-[280px] flex-1 animate-pulse rounded-xl border bg-muted/40' />) : scopes.map((scope) => <article key={scope.scopeId} role='listitem' className='min-w-[280px] max-w-[360px] flex-1 snap-start rounded-xl border bg-background p-4 transition-shadow hover:shadow-md'>
        <div className='mb-3 flex items-center justify-between'><span className='inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary'><ShieldCheck className='size-3.5' />{t('governedScopes.badge')}</span><span className='text-xs text-muted-foreground'>{t('governedScopes.version', { number: scope.revisionNumber })}</span></div>
        <h3 className='line-clamp-2 font-semibold'>{scope.name}</h3><p className='mt-1 line-clamp-2 min-h-10 text-sm text-muted-foreground'>{scope.description || scope.primaryAgent.description || t('governedScopes.defaultDescription')}</p>
        <div className='mt-4 space-y-2 border-t pt-3 text-sm'><div className='flex items-center gap-2'><Bot className='size-4 text-muted-foreground' /><span className='truncate'>{scope.primaryAgent.name}</span>{scope.agentCount > 1 && <span className='text-xs text-muted-foreground'>+{scope.agentCount - 1}</span>}</div><div className='flex items-center gap-2 text-muted-foreground'><BookOpen className='size-4' /><span>{t('governedScopes.knowledgeCount', { count: scope.workspaceCount })}</span></div></div>
        <Button className='mt-4 w-full' onClick={() => void start(scope)} disabled={startingScopeId === scope.scopeId}>{startingScopeId === scope.scopeId ? t('governedScopes.starting') : t('governedScopes.start')}<ArrowRight className='ml-2 size-4' /></Button>
      </article>)}
    </div>}
  </section>;
}
