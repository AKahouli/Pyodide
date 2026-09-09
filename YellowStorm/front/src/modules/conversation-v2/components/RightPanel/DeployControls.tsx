import { useState } from 'react';
import {
  ExternalLink,
  Loader2,
  RefreshCw,
  Rocket,
  Share2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { showError, showSuccess } from '@/lib/notifications';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useConversationV2Store } from '../../store';
import { useConversationV2Translation } from '../../translation';
import { ShareDeployDialog } from './ShareDeployDialog';

const modeTabClass = (active: boolean) =>
  cn(
    'inline-flex items-center rounded-md px-2 py-1 text-xs font-medium transition-colors',
    '@max-[620px]/right-panel:px-1.5 @max-[620px]/right-panel:py-0.5',
    active
      ? 'bg-background text-foreground shadow-sm'
      : 'text-muted-foreground hover:text-foreground',
  );

/**
 * Centered Preview ↔ Deploy mode switch for the conv v2 RightPanel header.
 * Only shown once a live deployed URL exists.
 */
export function AppViewModeToggle() {
  const { t } = useConversationV2Translation();
  const deployedUrl = useConversationV2Store((s) => s.deployedUrl);
  const appViewMode = useConversationV2Store((s) => s.appViewMode);
  const setAppViewMode = useConversationV2Store((s) => s.setAppViewMode);

  if (!deployedUrl) return null;

  const showingDeployed = appViewMode === 'deployed';

  return (
    <div
      role='tablist'
      aria-label={t('deploy.modeSwitch')}
      className='inline-flex max-w-full shrink items-center rounded-lg border bg-muted/40 p-0.5'
    >
      <button
        type='button'
        role='tab'
        aria-selected={!showingDeployed}
        className={modeTabClass(!showingDeployed)}
        onClick={() => setAppViewMode('nodepod')}
      >
        <span className='truncate'>{t('deploy.modePreview')}</span>
      </button>
      <button
        type='button'
        role='tab'
        aria-selected={showingDeployed}
        className={modeTabClass(showingDeployed)}
        onClick={() => setAppViewMode('deployed')}
      >
        <span className='truncate'>{t('deploy.modeDeploy')}</span>
      </button>
    </div>
  );
}

/**
 * Publish/deploy actions in the conv v2 RightPanel header.
 * Share + Update/Publish stay available when a URL exists.
 * Mode switching lives in {@link AppViewModeToggle} (header center).
 */
export function DeployControls() {
  const { t } = useConversationV2Translation();
  const deployStatus = useConversationV2Store((s) => s.deployStatus);
  const deployedUrl = useConversationV2Store((s) => s.deployedUrl);
  const appViewMode = useConversationV2Store((s) => s.appViewMode);
  const sessionId = useConversationV2Store((s) => s.sessionId);
  const deploy = useConversationV2Store((s) => s.deploy);
  const previewRevisionId = useConversationV2Store((s) => s.previewRevisionId);
  const finalizedVersions = useConversationV2Store((s) => s.finalizedVersions);
  const setAppViewMode = useConversationV2Store((s) => s.setAppViewMode);
  const [shareOpen, setShareOpen] = useState(false);

  const isDeploying = deployStatus === 'deploying';
  const isDeployed = deployStatus === 'deployed' && !!deployedUrl;
  const hasUrl = !!deployedUrl;
  const showingDeployed = hasUrl && appViewMode === 'deployed';
  const deployLabel = isDeploying
    ? t('deploy.publishing')
    : isDeployed
      ? t('deploy.update')
      : t('deploy.publish');

  const handleDeploy = async () => {
    try {
      const deployRevisionId =
        previewRevisionId ??
        finalizedVersions[0]?.revisionId ??
        undefined;
      await deploy(deployRevisionId);
      showSuccess(t('toasts.deploy.success'));
    } catch {
      showError(t('toasts.deploy.error'));
    }
  };

  const handleOpenDeployed = () => {
    if (!deployedUrl) return;
    window.open(deployedUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className='flex min-w-0 shrink items-center gap-0.5 @max-[620px]/right-panel:gap-0'>
        {hasUrl && showingDeployed && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant='ghost'
                size='icon-sm'
                className='shrink-0'
                onClick={handleOpenDeployed}
                aria-label={t('deploy.open')}
              >
                <ExternalLink className='h-4 w-4' />
              </Button>
            </TooltipTrigger>
            <TooltipContent side='bottom' className='text-xs'>
              {t('deploy.open')}
            </TooltipContent>
          </Tooltip>
        )}

        {hasUrl && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant='ghost'
                size='icon-sm'
                className='shrink-0'
                onClick={() => setShareOpen(true)}
                aria-label={t('share.title')}
              >
                <Share2 className='h-4 w-4' />
              </Button>
            </TooltipTrigger>
            <TooltipContent side='bottom' className='text-xs'>
              {t('share.title')}
            </TooltipContent>
          </Tooltip>
        )}

        {hasUrl && sessionId && (
          <ShareDeployDialog
            sessionId={sessionId}
            deployedUrl={deployedUrl!}
            open={shareOpen}
            onOpenChange={setShareOpen}
          />
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={isDeployed ? 'outline' : 'default'}
              size='sm'
              onClick={handleDeploy}
              disabled={isDeploying}
              className={cn(
                'shrink-0 gap-1.5',
                '@max-[620px]/right-panel:size-8 @max-[620px]/right-panel:gap-0 @max-[620px]/right-panel:px-0',
              )}
              aria-label={deployLabel}
            >
              {isDeploying ? (
                <Loader2 className='h-4 w-4 animate-spin' />
              ) : isDeployed ? (
                <RefreshCw className='h-4 w-4' />
              ) : (
                <Rocket className='h-4 w-4' />
              )}
              {!isDeploying && (
                <span className='@max-[620px]/right-panel:hidden'>
                  {isDeployed ? t('deploy.update') : t('deploy.publish')}
                </span>
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side='bottom' className='text-xs'>
            {deployLabel}
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
