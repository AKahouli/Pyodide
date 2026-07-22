import { memo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, Globe, MessageSquare, Share2 } from 'lucide-react';
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
import type { DeployedApp } from '../types';
import { DeleteDeployedAppButton } from './DeleteDeployedAppButton';

interface DeployedAppCardProps {
  app: DeployedApp;
}

export const DeployedAppCard = memo(function DeployedAppCard({ app }: DeployedAppCardProps) {
  const { t } = useModuleTranslation('app-marketplace');
  const navigate = useNavigate();
  const [shareOpen, setShareOpen] = useState(false);
  const isOwned = app.source !== 'shared';
  const canOpenConversation = isOwned || app.canOpenConversation === true;

  const openApp = () => window.open(app.deployedUrl, '_blank', 'noreferrer');
  const goToConversation = () => navigate(`/conversation-v2/${app.sessionId}`);

  return (
    <>
      <Card className='overflow-hidden'>
        <CardContent className='flex items-center gap-4 p-4'>
          <div className='flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10'>
            <Globe className='h-6 w-6 text-primary' />
          </div>

          <div className='min-w-0 flex-1'>
            <div className='flex items-center gap-2'>
              <h3 className='truncate font-medium'>{app.title || t('card.untitled')}</h3>
              {!isOwned && (
                <Badge variant='outline' className='shrink-0'>
                  {t('card.shared')}
                </Badge>
              )}
            </div>
            <p className='mt-0.5 truncate text-sm text-muted-foreground' title={app.deployedUrl}>
              {app.deployedUrl}
            </p>
            {app.lastDeployedAt && (
              <p className='mt-0.5 text-xs text-muted-foreground'>
                {t('card.deployedAt', { date: new Date(app.lastDeployedAt).toLocaleString() })}
              </p>
            )}
          </div>

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
        </CardContent>
      </Card>

      {isOwned && (
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
