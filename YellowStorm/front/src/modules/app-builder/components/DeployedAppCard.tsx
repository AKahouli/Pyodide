import { memo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, Globe, MessageSquare, Share2, Users } from 'lucide-react';
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
import { DeleteDeployedAppButton } from './DeleteDeployedAppButton';
import { AppEndUsersDialog } from './AppEndUsersDialog';
import { AppRevisionMeta } from './AppRevisionMeta';

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
          className='h-7 w-7'
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

  const openApp = () => window.open(app.deployedUrl, '_blank', 'noreferrer');
  const goToConversation = () => navigate(`/conversation-v2/${app.sessionId}`);

  const statusBadge = isOwned ? (
    <Badge
      variant='outline'
      className='shrink-0 border-emerald-500/30 px-1.5 py-0 text-[10px] text-emerald-800 dark:text-emerald-200'
    >
      {t('card.deployed')}
    </Badge>
  ) : (
    <Badge
      variant='outline'
      className='shrink-0 border-sky-500/30 px-1.5 py-0 text-[10px] text-sky-800 dark:text-sky-200'
    >
      {t('card.shared')}
    </Badge>
  );

  const actions = (
    <TooltipProvider>
      <div
        className={cn(
          'flex items-center gap-0.5 opacity-60 transition group-hover:opacity-100',
          view === 'list' && 'shrink-0',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <ActionButton label={t('card.open')} onClick={openApp}>
          <ExternalLink className='h-3.5 w-3.5' />
        </ActionButton>
        {canOpenConversation && (
          <ActionButton label={t('card.conversation')} onClick={goToConversation}>
            <MessageSquare className='h-3.5 w-3.5' />
          </ActionButton>
        )}
        {isOwned && (
          <ActionButton label={t('card.manageUsers')} onClick={() => setUsersOpen(true)}>
            <Users className='h-3.5 w-3.5' />
          </ActionButton>
        )}
        {canOpenConversation && (
          <ActionButton label={t('card.share')} onClick={() => setShareOpen(true)}>
            <Share2 className='h-3.5 w-3.5' />
          </ActionButton>
        )}
        <DeleteDeployedAppButton sessionId={app.sessionId} source={app.source} />
      </div>
    </TooltipProvider>
  );

  const body = (
    <>
      <div
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-md',
          isOwned ? 'bg-emerald-500/15' : 'bg-sky-500/15',
        )}
      >
        <Globe className={cn('h-4 w-4', isOwned ? 'text-emerald-700 dark:text-emerald-300' : 'text-sky-700 dark:text-sky-300')} />
      </div>
      <div className='min-w-0 flex-1'>
        <div className='flex min-w-0 items-start gap-2'>
          <h3 className='min-w-0 flex-1 truncate text-sm font-medium leading-snug tracking-tight' title={title}>
            {title}
          </h3>
          {statusBadge}
        </div>
        <p className='mt-0.5 truncate text-xs text-muted-foreground' title={app.deployedUrl}>
          {app.deployedUrl}
        </p>
        {app.lastDeployedAt && (
          <p className='mt-0.5 text-[11px] text-muted-foreground'>
            {t('card.deployedAt', { date: new Date(app.lastDeployedAt).toLocaleString() })}
          </p>
        )}
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
        <div
          className={cn(
            'group relative flex items-center gap-3 rounded-lg border bg-card px-4 py-3 transition hover:bg-accent/30',
            isOwned
              ? 'border-emerald-500/15 hover:border-emerald-500/30'
              : 'border-sky-500/15 hover:border-sky-500/30',
          )}
        >
          {body}
          {actions}
        </div>
        {dialogs}
      </>
    );
  }

  return (
    <>
      <div
        className={cn(
          'group relative flex h-full flex-col rounded-xl border bg-card p-5 transition hover:shadow-sm',
          isOwned
            ? 'border-emerald-500/15 bg-gradient-to-br from-emerald-500/[0.04] to-transparent hover:border-emerald-500/30'
            : 'border-sky-500/15 bg-gradient-to-br from-sky-500/[0.04] to-transparent hover:border-sky-500/30',
        )}
      >
        <div className='flex items-start gap-3'>{body}</div>
        <div className='-mx-5 -mb-5 mt-4 flex items-center justify-end border-t border-border/50 bg-accent/20 px-3 py-2'>
          {actions}
        </div>
      </div>
      {dialogs}
    </>
  );
});
