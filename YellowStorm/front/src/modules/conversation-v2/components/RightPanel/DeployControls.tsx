import { useState } from 'react';
import {
  Copy,
  ExternalLink,
  Globe,
  Loader2,
  Monitor,
  RefreshCw,
  Rocket,
  Share2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { showError, showSuccess } from '@/lib/notifications';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useConversationV2Store } from '../../store';
import { useConversationV2Translation } from '../../translation';
import { ShareDeployDialog } from './ShareDeployDialog';

/**
 * Publish/deploy control in the conv v2 RightPanel header.
 * After deploy: toggles between deployed iframe and Nodepod preview.
 */
export function DeployControls() {
  const { t } = useConversationV2Translation();
  const deployStatus = useConversationV2Store((s) => s.deployStatus);
  const deployedUrl = useConversationV2Store((s) => s.deployedUrl);
  const appViewMode = useConversationV2Store((s) => s.appViewMode);
  const sessionId = useConversationV2Store((s) => s.sessionId);
  const deploy = useConversationV2Store((s) => s.deploy);
  const setAppViewMode = useConversationV2Store((s) => s.setAppViewMode);
  const [shareOpen, setShareOpen] = useState(false);

  const isDeploying = deployStatus === 'deploying';
  const isDeployed = deployStatus === 'deployed' && !!deployedUrl;
  const hasUrl = !!deployedUrl;
  const showingDeployed = hasUrl && appViewMode === 'deployed';

  const handleDeploy = async () => {
    try {
      await deploy();
      showSuccess(t('toasts.deploy.success'));
    } catch {
      showError(t('toasts.deploy.error'));
    }
  };

  const handleCopyUrl = async () => {
    if (!deployedUrl) return;
    try {
      await navigator.clipboard.writeText(deployedUrl);
      showSuccess(t('toasts.deploy.copied'));
    } catch {
      showError(t('toasts.deploy.copyError'));
    }
  };

  return (
    <TooltipProvider delayDuration={300}>
      {hasUrl && showingDeployed && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='ghost'
              size='icon-sm'
              className='shrink-0'
              onClick={() => setAppViewMode('nodepod')}
              aria-label={t('deploy.switchToNodepod')}
            >
              <Monitor className='h-4 w-4' />
            </Button>
          </TooltipTrigger>
          <TooltipContent side='bottom' className='text-xs'>
            {t('deploy.switchToNodepod')}
          </TooltipContent>
        </Tooltip>
      )}

      {hasUrl && !showingDeployed && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='ghost'
              size='icon-sm'
              className='shrink-0'
              onClick={() => setAppViewMode('deployed')}
              aria-label={t('deploy.switchToDeployed')}
            >
              <Globe className='h-4 w-4' />
            </Button>
          </TooltipTrigger>
          <TooltipContent side='bottom' className='text-xs'>
            {t('deploy.switchToDeployed')}
          </TooltipContent>
        </Tooltip>
      )}

      {hasUrl && showingDeployed && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant='ghost'
              size='icon-sm'
              className='shrink-0'
              aria-label={t('deploy.viewUrl')}
            >
              <ExternalLink className='h-4 w-4' />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end' className='w-80'>
            <div className='px-2 py-1.5 text-xs text-muted-foreground'>{t('deploy.liveUrl')}</div>
            <a
              href={deployedUrl ?? undefined}
              target='_blank'
              rel='noreferrer'
              className='block truncate px-2 pb-1.5 text-sm text-primary hover:underline'
            >
              {deployedUrl}
            </a>
            <DropdownMenuItem onClick={handleCopyUrl} className='cursor-pointer'>
              <Copy className='mr-2 h-4 w-4' />
              {t('deploy.copy')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => window.open(deployedUrl ?? '', '_blank', 'noreferrer')}
              className='cursor-pointer'
            >
              <ExternalLink className='mr-2 h-4 w-4' />
              {t('deploy.open')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {hasUrl && (
        <Button
          variant='ghost'
          size='icon-sm'
          className='shrink-0'
          onClick={() => setShareOpen(true)}
          aria-label={t('share.title')}
        >
          <Share2 className='h-4 w-4' />
        </Button>
      )}

      {hasUrl && sessionId && (
        <ShareDeployDialog
          sessionId={sessionId}
          deployedUrl={deployedUrl!}
          open={shareOpen}
          onOpenChange={setShareOpen}
        />
      )}

      <Button
        variant={isDeployed ? 'outline' : 'default'}
        size='sm'
        onClick={handleDeploy}
        disabled={isDeploying}
        className='shrink-0 gap-1.5'
        aria-label={isDeploying ? t('deploy.publishing') : undefined}
      >
        {isDeploying ? (
          <Loader2 className='h-4 w-4 animate-spin' />
        ) : isDeployed ? (
          <RefreshCw className='h-4 w-4' />
        ) : (
          <Rocket className='h-4 w-4' />
        )}
        {!isDeploying && (isDeployed ? t('deploy.update') : t('deploy.publish'))}
      </Button>
    </TooltipProvider>
  );
}
