import type { JSX } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useModuleTranslation } from '@/modules/localization';
import { BudgetControl } from '../BudgetControl';

/** Bottom-sheet wrapper around the existing BudgetControl for the mobile layout. */
export function BudgetSheet({
  streamId,
  open,
  onOpenChange,
}: {
  streamId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const { t } = useModuleTranslation('worky');
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto rounded-t-2xl">
        <SheetHeader>
          <SheetTitle>{t('budget.title')}</SheetTitle>
        </SheetHeader>
        <div className="pt-2">
          <BudgetControl streamId={streamId} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
