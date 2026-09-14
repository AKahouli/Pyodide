import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppWindow, ArrowRight, Bot, Database, FileOutput, MessageSquare, Network, Play, ScrollText, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
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
  const [showAllArtifacts, setShowAllArtifacts] = useState(false);

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
      governed: conversation.runtimeMode === 'governed',
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
        governed: false,
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
    <div className='conversation-home-panels'>
      {starters.length > 0 && (
        <section aria-labelledby='conversation-starters-heading'>
          <h2 id='conversation-starters-heading' className='conversation-home-section-title'>{t('home.starters.title')}</h2>
          <TooltipProvider delayDuration={250}>
          <div className='conversation-home-shortcuts'>
            {starters.map(({ key, path, icon: Icon }) => (
              <Tooltip key={key}>
                <TooltipTrigger asChild>
                  <button type='button' onClick={() => navigate(path)} className='conversation-home-shortcut'>
                    <Icon aria-hidden='true' className='size-5 shrink-0 text-primary' />
                    <span>{t(`home.starters.${key}.title`)}</span>
                    <ArrowRight aria-hidden='true' className='conversation-home-shortcut-arrow size-4 shrink-0' />
                  </button>
                </TooltipTrigger>
                <TooltipContent className='max-w-64'>{t(`home.starters.${key}.description`)}</TooltipContent>
              </Tooltip>
            ))}
          </div>
          </TooltipProvider>
        </section>
      )}

      <div className='conversation-home-recents'>
        <section aria-labelledby='recent-activity-heading' className='min-w-0'>
          <div className='conversation-home-section-header'>
            <h2 id='recent-activity-heading' className='conversation-home-section-title'>{t('home.activity.title')}</h2>
            <button type='button' className='conversation-home-text-action' onClick={() => navigate('/chats')}>{t('home.activity.allChats')}<ArrowRight aria-hidden='true' className='size-4' /></button>
          </div>
          <div className='conversation-home-list' aria-busy={activityState === 'loading'}>
            {activityState === 'loading' ? <LoadingRows label={t('home.loading')} /> : activityState === 'error' ? <ErrorRow label={t('home.activity.loadError')} retryLabel={t('home.retry')} onRetry={loadActivity} /> : activity.length ? activity.map((item) => <button key={item.id} type='button' onClick={item.open} className='conversation-home-recent-row'>
              <item.icon aria-hidden='true' className='size-5 shrink-0 text-muted-foreground' />
              <span className='min-w-0 flex-1'>
                <span className='block truncate text-sm font-medium' title={item.title}>{item.title}</span>
                <span className='block truncate text-xs text-muted-foreground'>{item.detail}</span>
              </span>
              {item.status && <span className='conversation-home-status'>{item.governed && <ShieldCheck aria-hidden='true' className='size-3.5' />}{item.status}</span>}
              <time dateTime={item.at} className='conversation-home-time'>{formatRelativeTimeLabel(item.at, '', language)}</time>
            </button>) : <EmptyRow label={t('home.activity.empty')} />}
          </div>
        </section>

        <section aria-labelledby='recent-artifacts-heading' className='min-w-0'>
          <div className='conversation-home-section-header'>
            <h2 id='recent-artifacts-heading' className='conversation-home-section-title'>{t('home.artifacts.title')}</h2>
            {artifactState === 'ready' && artifacts.length > 4 && <button type='button' className='conversation-home-text-action' aria-expanded={showAllArtifacts} aria-controls='home-artifact-list' onClick={() => setShowAllArtifacts((value) => !value)}>{t(showAllArtifacts ? 'home.showLess' : 'home.showMore')}<ArrowRight aria-hidden='true' className='size-4' /></button>}
          </div>
          <div id='home-artifact-list' className='conversation-home-list' aria-busy={artifactState === 'loading'}>
            {artifactState === 'loading' ? <LoadingRows label={t('home.loading')} /> : artifactState === 'error' ? <ErrorRow label={t('home.artifacts.loadError')} retryLabel={t('home.retry')} onRetry={loadArtifacts} /> : artifacts.length ? artifacts.slice(0, showAllArtifacts ? artifacts.length : 4).map((artifact) => <Button key={`${artifact.source}:${artifact.artifactId}`} variant='ghost' onClick={() => void openArtifact(artifact)} className='conversation-home-recent-row'>
              <FileOutput aria-hidden='true' className='size-5 shrink-0 text-primary' />
              <span className='min-w-0 flex-1'>
                <span className='block truncate text-sm font-medium' title={artifact.filename}>{artifact.filename}</span>
                <span className='block truncate text-xs text-muted-foreground'>{artifact.source === 'conversation' ? artifact.conversationTitle : artifact.playbookName}</span>
              </span>
              <time dateTime={artifact.generatedAt} className='conversation-home-time'>{formatRelativeTimeLabel(artifact.generatedAt, '', language)}</time>
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

function LoadingRows({ label }: Readonly<{ label: string }>) {
  return <div role='status' aria-label={label} className='conversation-home-loading'>
    {[0, 1, 2, 3].map((index) => <div key={index} aria-hidden='true'><span /><span /></div>)}
  </div>;
}

function ErrorRow({ label, retryLabel, onRetry }: Readonly<{ label: string; retryLabel: string; onRetry: () => Promise<void> }>) {
  return <div role='alert' className='flex items-center justify-center gap-2 px-4 py-8 text-sm text-destructive'>
    <span>{label}</span>
    <button type='button' className='font-medium underline' onClick={() => void onRetry()}>{retryLabel}</button>
  </div>;
}
