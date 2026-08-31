import { memo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, Globe, MessageSquare, Share2, Users } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ShareDeployDialog } from '@/modules/conversation-v2/components/RightPanel/ShareDeployDialog';
import { useModuleTranslation } from '@/modules/localization';
import type { AppViewMode } from '../hooks/useAppBuilderFilters';
import type { DeployedApp } from '../types';
import { DeleteDeployedAppButton } from './DeleteDeployedAppButton';
import { AppEndUsersDialog } from './AppEndUsersDialog';

interface DeployedAppCardProps {
  app: DeployedApp;
  view?: AppViewMode;
}

export const DeployedAppCard = memo(function DeployedAppCard({
  app,
  view = 'list',
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

  const actions = (
    <TooltipProvider>
      <div className='flex shrink-0 items-center gap-1'>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='ghost'
              size='icon-sm'
              aria-label={t('card.open')}
              onClick={openApp}
            >
              <ExternalLink className='h-4 w-4' />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('card.open')}</TooltipContent>
        </Tooltip>
        {canOpenConversation && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant='ghost'
                size='icon-sm'
                aria-label={t('card.conversation')}
                onClick={goToConversation}
              >
                <MessageSquare className='h-4 w-4' />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('card.conversation')}</TooltipContent>
          </Tooltip>
        )}
        {isOwned && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant='ghost'
                size='icon-sm'
                aria-label={t('card.manageUsers')}
                onClick={() => setUsersOpen(true)}
              >
                <Users className='h-4 w-4' />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('card.manageUsers')}</TooltipContent>
          </Tooltip>
        )}
        {canOpenConversation && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant='ghost'
                size='icon-sm'
                aria-label={t('card.share')}
                onClick={() => setShareOpen(true)}
              >
                <Share2 className='h-4 w-4' />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('card.share')}</TooltipContent>
          </Tooltip>
        )}
        <DeleteDeployedAppButton sessionId={app.sessionId} source={app.source} />
      </div>
    </TooltipProvider>
  );

  return (
    <>
      <Card className='overflow-hidden shadow-sm'>
        <CardContent className='flex items-start gap-2.5 p-3'>
          <div className='flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10'>
            <Globe className='h-4 w-4 text-primary' />
          </div>

          <div className='min-w-0 flex-1'>
            <div className='flex min-w-0 items-start gap-2'>
              <h3 className='min-w-0 flex-1 truncate text-sm font-medium leading-snug' title={title}>
                {title}
              </h3>
              {!isOwned && (
                <Badge variant='outline' className='shrink-0 px-1.5 py-0 text-[10px]'>
                  {t('card.shared')}
                </Badge>
              )}
            </div>
            <p
              className='mt-0.5 truncate text-xs text-muted-foreground'
              title={app.deployedUrl}
            >
              {app.deployedUrl}
            </p>
            {app.lastDeployedAt && (
              <p className='mt-0.5 text-[11px] text-muted-foreground'>
                {t('card.deployedAt', { date: new Date(app.lastDeployedAt).toLocaleString() })}
              </p>
            )}
          </div>

          <div className={view === 'grid' ? 'shrink-0 self-start' : 'shrink-0'}>{actions}</div>
        </CardContent>
      </Card>

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
});
