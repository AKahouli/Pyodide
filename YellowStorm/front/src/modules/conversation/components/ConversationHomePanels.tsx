import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppWindow, Bot, Database, FileOutput, MessageSquare, Network, Play, ScrollText } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { showError } from '@/lib/notifications';
import { fetchConversations, fetchRecentConversationArtifacts, getArtifactDownloadUrl } from '../api';
import type { ConversationSummary, RecentConversationArtifact } from '../types';
import { fetchRecentPlaybookArtifacts, getPlaybooks, requestPlaybookArtifactAccess } from '@/modules/playbook/api';
import type { PlaybookSummary, RecentPlaybookArtifact } from '@/modules/playbook/types';
import { DEFAULT_FEATURE_VISIBILITY, getFeatureVisibility } from '@/modules/admin';
import { usePermissions } from '@/modules/admin/hooks/usePermissions';
import type { FeatureVisibility } from '@/modules/admin';
import { useModuleTranslation } from '@/modules/localization';
import { formatRelativeTimeLabel } from '@/utils/date';

type RecentArtifact = RecentConversationArtifact | RecentPlaybookArtifact;

const STARTER_DEFS = [
  { key: 'work', path: '/worky', icon: Bot },
  { key: 'playbook', path: '/playbooks', icon: Network },
  { key: 'agent', path: '/agents', icon: ScrollText },
  { key: 'appBuilder', path: '/app-market', icon: AppWindow },
  { key: 'semanticModel', path: '/semantic-models', icon: Database },
] as const;

export function ConversationHomePanels() {
  const navigate = useNavigate();
  const { t, language } = useModuleTranslation('conversation');
  const { hasAnyPermission, canUseFeature, canSeeMenu } = usePermissions();
  const [featureVisibility, setFeatureVisibility] = useState<FeatureVisibility>(DEFAULT_FEATURE_VISIBILITY);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [playbooks, setPlaybooks] = useState<PlaybookSummary[]>([]);
  const [artifacts, setArtifacts] = useState<RecentArtifact[]>([]);
  const [activityState, setActivityState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [artifactState, setArtifactState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let active = true;
    getFeatureVisibility()
      .then((value) => {
        if (active) setFeatureVisibility(value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  // Feature zone mirrors the sidebar gating exactly (feature visibility +
  // role permissions), so a card never advertises a page the role cannot open.
  const canOpenSemanticModels = hasAnyPermission(['semantic_models.read', 'semantic_models.*', '*']);
  const starters = useMemo(
    () =>
      STARTER_DEFS.filter(({ key }) => {
        switch (key) {
          case 'work':
            return featureVisibility.worky && canUseFeature('worky') && canSeeMenu('worky');
          case 'playbook':
            return featureVisibility.playbook && canUseFeature('playbook') && canSeeMenu('playbook');
          case 'agent':
            return featureVisibility.agents && canUseFeature('agents') && canSeeMenu('agents');
          case 'appBuilder':
            return featureVisibility.appMarketplace && canUseFeature('appMarketplace') && canSeeMenu('appMarketplace');
          case 'semanticModel':
            return (
              featureVisibility.semanticModel &&
              canUseFeature('semanticModel') &&
              canSeeMenu('semanticModels') &&
              canOpenSemanticModels
            );
        }
      }),
    [featureVisibility, canUseFeature, canSeeMenu, canOpenSemanticModels],
  );

  // Playbook endpoints require playbook permissions — a role without the
  // playbook feature gets 403s, so never call them (and never error the panel).
  const canQueryPlaybooks = featureVisibility.playbook && canUseFeature('playbook');

  const loadActivity = useCallback(async () => {
    setActivityState('loading');
    const results = await Promise.allSettled([
      fetchConversations({ mode: 'cursor', limit: 6 }),
      canQueryPlaybooks ? getPlaybooks({ page: 1, limit: 6, sortBy: 'activityAt', sortOrder: 'desc' }) : Promise.resolve(null),
    ]);
    setConversations(results[0].status === 'fulfilled' ? results[0].value.items : []);
    setPlaybooks(results[1].status === 'fulfilled' && results[1].value ? results[1].value.playbooks : []);
    // A panel only errors when every source it attempted failed; a single
    // failing source degrades to showing the others.
    const attempted = 1 + (canQueryPlaybooks ? 1 : 0);
    const failed = results.filter((r) => r.status === 'rejected').length;
    setActivityState(failed >= attempted ? 'error' : 'ready');
  }, [canQueryPlaybooks]);

  const loadArtifacts = useCallback(async () => {
    setArtifactState('loading');
    const results = await Promise.allSettled([
      fetchRecentConversationArtifacts(6),
      canQueryPlaybooks ? fetchRecentPlaybookArtifacts(6) : Promise.resolve([] as RecentPlaybookArtifact[]),
    ]);
    const conversationArtifacts = results[0].status === 'fulfilled' ? results[0].value : [];
    const playbookArtifacts = results[1].status === 'fulfilled' ? results[1].value : [];
    const items: RecentArtifact[] = [...conversationArtifacts, ...playbookArtifacts];
    setArtifacts(items.sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt)).slice(0, 6));
    const attempted = 1 + (canQueryPlaybooks ? 1 : 0);
    const failed = results.filter((r) => r.status === 'rejected').length;
    setArtifactState(failed >= attempted ? 'error' : 'ready');
  }, [canQueryPlaybooks]);

  useEffect(() => {
    void loadActivity();
    void loadArtifacts();
  }, [loadActivity, loadArtifacts]);

  const activity = useMemo(() => [
    ...conversations.slice(0, 6).map((conversation) => ({
      id: `conversation:${conversation.id}`,
      title: conversation.title,
      detail: t('home.activity.conversation'),
      status: conversation.runtimeMode === 'governed' ? t('home.activity.governed') : undefined,
      at: conversation.lastMessageAt || conversation.updatedAt,
      icon: MessageSquare,
      open: () => navigate(`/conversation/${conversation.id}`),
    })),
    ...playbooks.slice(0, 6).map((playbook) => {
      const executed = Boolean(playbook.lastExecutionAt && Date.parse(playbook.lastExecutionAt) >= Date.parse(playbook.updatedAt));
      const created = !executed && Math.abs(Date.parse(playbook.updatedAt) - Date.parse(playbook.createdAt)) < 1000;
      return {
        id: `playbook:${playbook.id}`,
        title: playbook.name,
        detail: t(executed ? 'home.activity.playbookExecuted' : created ? 'home.activity.playbookCreated' : 'home.activity.playbookEdited'),
        status: playbook.executionStatus ? t(`home.activity.status.${playbook.executionStatus}`) : undefined,
        at: executed ? playbook.lastExecutionAt! : playbook.updatedAt,
        icon: Play,
        open: () => navigate(`/playbooks/${playbook.id}`),
      };
    }),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 6), [conversations, navigate, playbooks, t]);

  const openArtifact = async (artifact: RecentArtifact) => {
    try {
      const url = artifact.source === 'conversation'
        ? (await getArtifactDownloadUrl(artifact.conversationId, artifact.messageId, artifact.artifactId)).viewUrl
        : (await requestPlaybookArtifactAccess(artifact.executionId, artifact.artifactId, 'view')).url;
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      showError(t('home.artifacts.openError'));
    }
  };

  return (
    <div className='w-full space-y-7'>
      {starters.length > 0 && (
        <section aria-labelledby='conversation-starters-heading'>
          <div className='mb-3 flex items-end justify-between gap-4'>
            <div>
              <h2 id='conversation-starters-heading' className='font-semibold'>{t('home.starters.title')}</h2>
              <p className='text-xs text-muted-foreground'>{t('home.starters.description')}</p>
            </div>
          </div>
          <div className='grid gap-3 md:grid-cols-3'>
            {starters.map(({ key, path, icon: Icon }) => (
              <button key={key} type='button' onClick={() => navigate(path)} className='group flex min-h-28 items-start gap-4 rounded-2xl border bg-card/70 p-4 text-left transition-colors hover:border-primary/40 hover:bg-card'>
                <span className='flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary'><Icon className='size-5' /></span>
                <span>
                  <span className='block text-sm font-semibold'>{t(`home.starters.${key}.title`)}</span>
                  <span className='mt-1 block text-xs leading-5 text-muted-foreground'>{t(`home.starters.${key}.description`)}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      <div className='grid gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(18rem,1fr)]'>
        <section aria-labelledby='recent-activity-heading' className='min-w-0'>
          <div className='mb-3 flex items-center justify-between'>
            <h2 id='recent-activity-heading' className='font-semibold'>{t('home.activity.title')}</h2>
          </div>
          <div className='overflow-hidden rounded-2xl border bg-card/60'>
            {activityState === 'loading' ? <EmptyRow label={t('home.loading')} /> : activityState === 'error' ? <ErrorRow label={t('home.activity.loadError')} retryLabel={t('home.retry')} onRetry={loadActivity} /> : activity.length ? activity.map((item) => <button key={item.id} type='button' onClick={item.open} className='flex w-full items-center gap-3 border-b px-4 py-3 text-left last:border-b-0 hover:bg-muted/50'>
              <item.icon className='size-4 shrink-0 text-muted-foreground' />
              <span className='min-w-0 flex-1'>
                <span className='block truncate text-sm font-medium'>{item.title}</span>
                <span className='block truncate text-xs text-muted-foreground'>{item.detail}</span>
              </span>
              {item.status && <span className='hidden rounded-full bg-primary/10 px-2 py-1 text-[11px] text-primary sm:block'>{item.status}</span>}
              <time className='shrink-0 text-xs text-muted-foreground'>{formatRelativeTimeLabel(item.at, '', language)}</time>
            </button>) : <EmptyRow label={t('home.activity.empty')} />}
          </div>
        </section>

        <section aria-labelledby='recent-artifacts-heading' className='min-w-0'>
          <div className='mb-3 flex items-center justify-between'>
            <h2 id='recent-artifacts-heading' className='font-semibold'>{t('home.artifacts.title')}</h2>
          </div>
          <div className='overflow-hidden rounded-2xl border bg-card/60'>
            {artifactState === 'loading' ? <EmptyRow label={t('home.loading')} /> : artifactState === 'error' ? <ErrorRow label={t('home.artifacts.loadError')} retryLabel={t('home.retry')} onRetry={loadArtifacts} /> : artifacts.length ? artifacts.map((artifact) => <Button key={`${artifact.source}:${artifact.artifactId}`} variant='ghost' onClick={() => void openArtifact(artifact)} className='h-auto w-full justify-start gap-3 rounded-none border-b px-4 py-3 text-left last:border-b-0'>
              <FileOutput className='size-4 shrink-0 text-primary' />
              <span className='min-w-0 flex-1'>
                <span className='block truncate text-sm font-medium'>{artifact.filename}</span>
                <span className='block truncate text-xs text-muted-foreground'>{artifact.source === 'conversation' ? artifact.conversationTitle : artifact.playbookName}</span>
              </span>
              <time className='shrink-0 text-xs font-normal text-muted-foreground'>{formatRelativeTimeLabel(artifact.generatedAt, '', language)}</time>
            </Button>) : <EmptyRow label={t('home.artifacts.empty')} />}
          </div>
        </section>
      </div>
    </div>
  );
}

function EmptyRow({ label }: Readonly<{ label: string }>) {
  return <p className='px-4 py-8 text-center text-sm text-muted-foreground'>{label}</p>;
}

function ErrorRow({ label, retryLabel, onRetry }: Readonly<{ label: string; retryLabel: string; onRetry: () => Promise<void> }>) {
  return <div role='alert' className='flex items-center justify-center gap-2 px-4 py-8 text-sm text-destructive'>
    <span>{label}</span>
    <button type='button' className='font-medium underline' onClick={() => void onRetry()}>{retryLabel}</button>
  </div>;
}
