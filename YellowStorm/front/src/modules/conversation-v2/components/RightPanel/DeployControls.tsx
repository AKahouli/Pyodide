import { Copy, ExternalLink, Globe, Loader2, RefreshCw, Rocket } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useConversationV2Store } from '../../store';
import { useConversationV2Translation } from '../../translation';

/**
 * Publish/deploy control, rendered in the conv v2 RightPanel header (v2-only —
 * never leaks into the shared file-viewer/v1 surfaces). Idle → "Publish";
 * deploying → spinner; deployed → a Globe dropdown (live URL / copy / open) to
 * the left of an "Update" button.
 */
export function DeployControls() {
  const { t } = useConversationV2Translation();
  const deployStatus = useConversationV2Store((s) => s.deployStatus);
  const deployedUrl = useConversationV2Store((s) => s.deployedUrl);
  const deploy = useConversationV2Store((s) => s.deploy);

  const isDeploying = deployStatus === 'deploying';
  const isDeployed = deployStatus === 'deployed' && !!deployedUrl;

  const handleDeploy = async () => {
    try {
      await deploy();
      toast.success(t('toasts.deploy.success'));
    } catch {
      toast.error(t('toasts.deploy.error'));
    }
  };

  const handleCopyUrl = async () => {
    if (!deployedUrl) return;
    try {
      await navigator.clipboard.writeText(deployedUrl);
      toast.success(t('toasts.deploy.copied'));
    } catch {
      toast.error(t('toasts.deploy.copyError'));
    }
  };

  return (
    <>
      {isDeployed && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant='ghost' size='icon-sm' className='shrink-0' aria-label={t('deploy.viewUrl')}>
              <Globe className='h-4 w-4' />
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

      <Button
        variant={isDeployed ? 'outline' : 'default'}
        size='sm'
        onClick={handleDeploy}
        disabled={isDeploying}
        className='shrink-0 gap-1.5'
      >
        {isDeploying ? (
          <Loader2 className='h-4 w-4 animate-spin' />
        ) : isDeployed ? (
          <RefreshCw className='h-4 w-4' />
        ) : (
          <Rocket className='h-4 w-4' />
        )}
        {isDeploying ? t('deploy.publishing') : isDeployed ? t('deploy.update') : t('deploy.publish')}
      </Button>
    </>
  );
}
