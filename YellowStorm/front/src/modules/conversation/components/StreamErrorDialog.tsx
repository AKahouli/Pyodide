import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle, WifiOff } from 'lucide-react';
import { useCriticalError, useSSEError, useConversationStore } from '../store';
import { conversationStreamService } from '../stream';
import { useModuleTranslation } from '@/modules/localization';

export function StreamErrorDialog() {
  const criticalError = useCriticalError();
  const sseError = useSSEError();
  const dismissCriticalError = useConversationStore((s) => s.dismissCriticalError);
  const dismissSSEError = useConversationStore((s) => s.dismissSSEError);
  const retryLastMessage = useConversationStore((s) => s.retryLastMessage);
  const { t } = useModuleTranslation('conversation');
  const { t: tCommon } = useModuleTranslation('common');

  // SSE connection error takes priority
  if (sseError) {
    const handleReconnect = () => {
      dismissSSEError();
      conversationStreamService.disconnect();
      conversationStreamService.reconnectWithNewToken();
    };

    return (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) dismissSSEError();
        }}>
        <DialogContent aria-live='assertive'>
          <DialogHeader>
            <div className='flex items-center gap-3'>
              <div className='flex-shrink-0 w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center'>
                <WifiOff className='h-5 w-5 text-destructive' />
              </div>
              <DialogTitle>{t('dialogs.streamError.connectionFailed')}</DialogTitle>
            </div>
            <DialogDescription className='pt-2'>{sseError}</DialogDescription>
          </DialogHeader>
          <DialogFooter className='gap-2'>
            <Button variant='outline' onClick={dismissSSEError}>
              {tCommon('actionClose')}
            </Button>
            <Button onClick={handleReconnect}>{t('dialogs.streamError.reconnect')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  if (!criticalError) return null;

  return (
    <Dialog
      open={!!criticalError}
      onOpenChange={(open) => {
        if (!open) dismissCriticalError();
      }}>
      <DialogContent aria-live='assertive'>
        <DialogHeader>
          <div className='flex items-center gap-3'>
            <div className='flex-shrink-0 w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center'>
              <AlertTriangle className='h-5 w-5 text-destructive' />
            </div>
            <DialogTitle>{t('dialogs.streamError.aiServiceError')}</DialogTitle>
          </div>
          <DialogDescription className='pt-2'>{criticalError.message}</DialogDescription>
        </DialogHeader>
        <DialogFooter className='gap-2'>
          <Button variant='outline' onClick={dismissCriticalError}>
            {tCommon('actionClose')}
          </Button>
          {/*<Button onClick={handleRetry}> EXPERIMENTAL
            Retry
          </Button>*/}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
