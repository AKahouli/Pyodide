import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useConversationV2Translation } from '../translation';
import type { PreviewPhase } from '../hooks/useTemplateClonePreview';

export interface SessionStatusBannerProps {
  previewPhase: PreviewPhase;
  isTemplateCloneSession: boolean;
  isDraftClone: boolean;
  showAppBuilderBanner: boolean;
  streamError: string | null;
  onDismissReady: () => void;
  onDismissAppBuilder: () => void;
}

/**
 * Waiting / ready / App Builder / stream-error banners for the session page.
 */
export function SessionStatusBanner({
  previewPhase,
  isTemplateCloneSession,
  isDraftClone,
  showAppBuilderBanner,
  streamError,
  onDismissReady,
  onDismissAppBuilder,
}: SessionStatusBannerProps) {
  const { t } = useConversationV2Translation();

  const waitingCopy =
    previewPhase === 'waiting' && isTemplateCloneSession
      ? {
          title: t('session.templateClone.waitingTitle'),
          body: isDraftClone
            ? t('session.templateClone.waitingBodyDraft')
            : t('session.templateClone.waitingBody'),
        }
      : {
          title: t('session.waitingForPreview.title'),
          body: t('session.waitingForPreview.body'),
        };

  return (
    <>
      {previewPhase === 'waiting' && (
        <div
          className='border-b border-border/60 bg-muted/40 px-4 py-3'
          role='status'
          data-testid='template-preview-waiting'
        >
          <p className='text-sm font-medium'>{waitingCopy.title}</p>
          <p className='mt-0.5 text-xs text-muted-foreground sm:text-sm'>{waitingCopy.body}</p>
        </div>
      )}
      {previewPhase === 'ready' && isTemplateCloneSession && (
        <div
          className='flex items-start gap-3 border-b border-border/60 bg-muted/40 px-4 py-3'
          role='status'
          data-testid='template-preview-ready'
        >
          <div className='min-w-0 flex-1'>
            <p className='text-sm font-medium'>{t('session.templateClone.readyTitle')}</p>
            <p className='mt-0.5 text-xs text-muted-foreground sm:text-sm'>
              {t('session.templateClone.readyBody')}
            </p>
          </div>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            className='shrink-0'
            onClick={onDismissReady}
          >
            <X className='mr-1 h-3.5 w-3.5' aria-hidden />
            {t('session.templateClone.dismiss')}
          </Button>
        </div>
      )}
      {showAppBuilderBanner && (
        <div className='flex items-start gap-3 border-b border-border/60 bg-muted/40 px-4 py-3'>
          <div className='min-w-0 flex-1'>
            <p className='text-sm font-medium'>{t('session.fromAppBuilder.title')}</p>
            <p className='mt-0.5 text-xs text-muted-foreground sm:text-sm'>
              {t('session.fromAppBuilder.body')}
            </p>
          </div>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            className='shrink-0'
            onClick={onDismissAppBuilder}
          >
            <X className='mr-1 h-3.5 w-3.5' aria-hidden />
            {t('session.fromAppBuilder.dismiss')}
          </Button>
        </div>
      )}
      {streamError && (
        <div className='bg-destructive p-2 text-sm text-destructive-foreground'>
          {t('session.errorTitle')}: {streamError}
        </div>
      )}
    </>
  );
}
