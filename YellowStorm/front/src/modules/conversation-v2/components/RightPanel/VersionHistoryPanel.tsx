import { EyeIcon, Loader2Icon, RocketIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useConversationV2Store } from '../../store';
import { useConversationV2Translation } from '../../translation';
import { formatFinalizedDate, resolveLatestFinalizedRevisionId } from '../../utils/finalized-versions';
import { showError, showSuccess } from '@/lib/notifications';

export function VersionHistoryPanel() {
  const { t, language } = useConversationV2Translation();
  const finalizedVersions = useConversationV2Store((s) => s.finalizedVersions);
  const previewRevisionId = useConversationV2Store((s) => s.previewRevisionId);
  const loadingFinalizedVersions = useConversationV2Store((s) => s.loadingFinalizedVersions);
  const previewFinalizedVersion = useConversationV2Store((s) => s.previewFinalizedVersion);
  const deploy = useConversationV2Store((s) => s.deploy);
  const deployStatus = useConversationV2Store((s) => s.deployStatus);

  const latestRevisionId = resolveLatestFinalizedRevisionId(finalizedVersions);
  const activeRevisionId = previewRevisionId ?? latestRevisionId;
  const isPreviewingHistorical =
    !!previewRevisionId &&
    !!latestRevisionId &&
    previewRevisionId !== latestRevisionId;

  const handleDeploy = async (revisionId: string) => {
    try {
      await deploy(revisionId);
      showSuccess(t('toasts.deploy.success'));
    } catch {
      showError(t('toasts.deploy.error'));
    }
  };

  if (loadingFinalizedVersions && finalizedVersions.length === 0) {
    return (
      <div className='flex items-center gap-2 border-b bg-muted/20 px-3 py-2 text-xs text-muted-foreground'>
        <Loader2Icon className='size-3.5 animate-spin' />
        {t('versionHistory.loading')}
      </div>
    );
  }

  if (finalizedVersions.length === 0) {
    return null;
  }

  return (
    <div className='shrink-0 border-b bg-muted/10'>
      {isPreviewingHistorical && (
        <div className='flex items-center justify-between gap-2 border-b border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200'>
          <span className='min-w-0 truncate'>
            {t('versionHistory.previewBanner', { revisionId: previewRevisionId ?? '' })}
          </span>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            className='h-7 shrink-0 px-2 text-xs'
            onClick={() => latestRevisionId && previewFinalizedVersion(latestRevisionId)}
          >
            {t('versionHistory.returnToLatest')}
          </Button>
        </div>
      )}

      <div className='px-3 py-2'>
        <p className='mb-2 text-xs font-medium text-foreground'>{t('versionHistory.title')}</p>
        <ul className='max-h-40 space-y-1 overflow-y-auto'>
          {finalizedVersions.map((version) => {
            const isActive = version.revisionId === activeRevisionId;
            return (
              <li
                key={version.revisionId}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2 py-1.5 text-xs',
                  isActive && 'bg-primary/10',
                )}
              >
                <div className='min-w-0 flex-1'>
                  <div className='flex flex-wrap items-center gap-1.5'>
                    <span className='font-mono font-medium'>{version.revisionId}</span>
                    <Badge variant='secondary' className='h-5 border-0 px-1.5 text-[10px] font-normal'>
                      {t('versionHistory.finalized')}
                    </Badge>
                    {isActive && (
                      <Badge variant='outline' className='h-5 px-1.5 text-[10px] font-normal'>
                        {t('versionHistory.active')}
                      </Badge>
                    )}
                  </div>
                  <p className='truncate text-[11px] text-muted-foreground'>
                    {formatFinalizedDate(version.finalizedAt, language)}{' '}
                    {version.title !== 'App' ? `· ${version.title}` : ''}
                  </p>
                </div>
                <div className='flex shrink-0 items-center gap-1'>
                  {!isActive && (
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon-sm'
                      className='size-7'
                      aria-label={t('versionHistory.preview')}
                      onClick={() => previewFinalizedVersion(version.revisionId)}
                    >
                      <EyeIcon className='size-3.5' />
                    </Button>
                  )}
                  <Button
                    type='button'
                    variant='outline'
                    size='icon-sm'
                    className='size-7'
                    aria-label={t('versionHistory.deploy')}
                    disabled={deployStatus === 'deploying'}
                    onClick={() => void handleDeploy(version.revisionId)}
                  >
                    {deployStatus === 'deploying' ? (
                      <Loader2Icon className='size-3.5 animate-spin' />
                    ) : (
                      <RocketIcon className='size-3.5' />
                    )}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
