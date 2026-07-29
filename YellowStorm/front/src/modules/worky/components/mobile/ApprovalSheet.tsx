import type { JSX } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';
import { useRespondInteraction } from '../../query/hooks';
import type { WorkyPendingClarification } from '../../types';

/**
 * Compact bottom-sheet approval for the mobile layout. The UI cannot
 * self-approve — it always relays the owner's decision through the existing
 * respond-interaction endpoint.
 */
export function ApprovalSheet({
  streamId,
  interaction,
  open,
  onOpenChange,
}: {
  streamId: string;
  interaction: WorkyPendingClarification | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const respond = useRespondInteraction(streamId);

  const submit = async (approve: boolean): Promise<void> => {
    if (!interaction) return;
    await respond.mutateAsync({
      interactionId: interaction.id,
      content: approve ? 'approved' : 'rejected',
      approve,
    });
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl">
        <SheetHeader>
          <SheetTitle>{t('approval.title')}</SheetTitle>
        </SheetHeader>
        {interaction ? (
          <div className="flex flex-col gap-4 pt-2 pb-2">
            <p className="text-sm text-muted-foreground">{interaction.question}</p>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => submit(false)}>
                {t('approval.reject')}
              </Button>
              <Button className="flex-1" onClick={() => submit(true)}>
                {t('approval.approve')}
              </Button>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
