import { memo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ExternalLink,
  Globe,
  Layers,
  MessageSquare,
  Share2,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { ShareDeployDialog } from '@/modules/conversation-v2/components/RightPanel/ShareDeployDialog';
import { useModuleTranslation } from '@/modules/localization';
import type { AppViewMode } from '../hooks/useAppBuilderFilters';
import type { DeployedApp } from '../types';
import {
  appCardBadgeClass,
  appCardIconClass,
  appCardSurfaceClass,
  extractAppHost,
  type AppCardTone,
} from './app-card-tones';
import { DeleteDeployedAppButton } from './DeleteDeployedAppButton';
import { AppEndUsersDialog } from './AppEndUsersDialog';
import { AppRevisionMeta } from './AppRevisionMeta';
import { AppAiBadge } from './AppAiBadge';

interface DeployedAppCardProps {
  app: DeployedApp;
  view?: AppViewMode;
}

function ActionButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant='ghost'
          size='icon'
          className='size-8 text-muted-foreground hover:text-foreground'
          aria-label={label}
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export const DeployedAppCard = memo(function DeployedAppCard({
  app,
  view = 'grid',
}: DeployedAppCardProps) {
  const { t } = useModuleTranslation('app-builder');
  const navigate = useNavigate();
  const [shareOpen, setShareOpen] = useState(false);
  const [usersOpen, setUsersOpen] = useState(false);
  const isOwned = app.source !== 'shared';
  const canOpenConversation = isOwned || app.canOpenConversation === true;
  const title = app.title || t('card.untitled');
  const tone: AppCardTone = isOwned ? 'live' : 'shared';
  const host = extractAppHost(app.deployedUrl);
  const versionCount = app.finalizedVersionCount ?? 0;

  const openApp = () => window.open(app.deployedUrl, '_blank', 'noreferrer');
  const goToConversation = () => navigate(`/conversation-v2/${app.sessionId}`);

  const statusBadge = (
    <Badge variant='outline' className={appCardBadgeClass(tone)}>
      {isOwned ? t('card.deployed') : t('card.shared')}
    </Badge>
  );

  const featureChips = (
    <div className='mt-2.5 flex flex-wrap items-center gap-1.5'>
      <Badge
        variant='secondary'
        className='h-5 gap-1 border-0 bg-muted/70 px-2 text-[10px] font-medium text-muted-foreground'
      >
        {isOwned ? t('card.category.live') : t('card.category.shared')}
      </Badge>
      {app.hasAiFeatures ? <AppAiBadge /> : null}
      {versionCount > 0 ? (
        <Badge
          variant='secondary'
          className='h-5 gap-1 border-0 bg-muted/70 px-2 text-[10px] font-medium text-muted-foreground'
        >
          <Layers className='size-2.5' aria-hidden />
          {t('card.versionsCount', { count: versionCount })}
        </Badge>
      ) : null}
    </div>
  );

  const actions = (
    <TooltipProvider>
      <div
        className={cn(
          'flex items-center gap-0.5 opacity-70 transition-opacity group-hover:opacity-100',
          view === 'list' && 'shrink-0',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <ActionButton label={t('card.open')} onClick={openApp}>
          <ExternalLink className='size-3.5' />
        </ActionButton>
        {canOpenConversation && (
          <ActionButton label={t('card.conversation')} onClick={goToConversation}>
            <MessageSquare className='size-3.5' />
          </ActionButton>
        )}
        {isOwned && (
          <ActionButton label={t('card.manageUsers')} onClick={() => setUsersOpen(true)}>
            <Users className='size-3.5' />
          </ActionButton>
        )}
        {canOpenConversation && (
          <ActionButton label={t('card.share')} onClick={() => setShareOpen(true)}>
            <Share2 className='size-3.5' />
          </ActionButton>
        )}
        <DeleteDeployedAppButton sessionId={app.sessionId} source={app.source} />
      </div>
    </TooltipProvider>
  );

  const body = (
    <>
      <div className={appCardIconClass(tone)}>
        <Globe className='size-5' aria-hidden />
      </div>
      <div className='min-w-0 flex-1'>
        <div className='flex min-w-0 items-start gap-2'>
          <h3
            className='min-w-0 flex-1 truncate text-base font-semibold leading-snug tracking-tight text-foreground'
            title={title}
          >
            {title}
          </h3>
          {statusBadge}
        </div>
        <p className='mt-1 line-clamp-2 text-sm leading-relaxed text-muted-foreground'>
          {isOwned ? t('card.liveHint') : t('card.sharedHint')}
        </p>
        {host ? (
          <p className='mt-1.5 truncate font-mono text-[11px] text-muted-foreground/90' title={app.deployedUrl}>
            {host}
          </p>
        ) : null}
        {app.lastDeployedAt ? (
          <p className='mt-1 text-[11px] tabular-nums text-muted-foreground'>
            {t('card.deployedAt', { date: new Date(app.lastDeployedAt).toLocaleString() })}
          </p>
        ) : null}
        {featureChips}
        <AppRevisionMeta revision={app} />
      </div>
    </>
  );

  const dialogs = (
    <>
      {isOwned && (
        <AppEndUsersDialog
          sessionId={app.sessionId}
          appTitle={title}
          hasAiFeatures={app.hasAiFeatures === true}
          open={usersOpen}
          onOpenChange={setUsersOpen}
        />
      )}
      {canOpenConversation && (
        <ShareDeployDialog
          sessionId={app.sessionId}
          deployedUrl={app.deployedUrl}
          open={shareOpen}
          onOpenChange={setShareOpen}
        />
      )}
    </>
  );

  if (view === 'list') {
    return (
      <>
        <div className={appCardSurfaceClass(tone, 'list')}>
          {body}
          {actions}
        </div>
        {dialogs}
      </>
    );
  }

  return (
    <>
      <div className={appCardSurfaceClass(tone, 'grid')}>
        <div className='flex flex-1 items-start gap-3.5 p-5 pb-4'>{body}</div>
        <div className='mt-auto flex items-center justify-between gap-2 border-t border-border/50 bg-muted/20 px-3 py-2.5'>
          <span className='truncate text-[11px] text-muted-foreground'>
            {t('card.openHint')}
          </span>
          {actions}
        </div>
      </div>
      {dialogs}
    </>
  );
});
