import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useModuleTranslation } from '@/modules/localization';
import type { FlowSettings } from '../types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: FlowSettings;
  onSettingsChange: (settings: Partial<FlowSettings>) => void;
  isSaving?: boolean;
}

export function PlaybookFlowSettingsDrawer({ open, onOpenChange, settings, onSettingsChange, isSaving }: Props) {
  const { t } = useModuleTranslation('playbook');

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[320px] sm:w-[400px]">
        <SheetHeader>
          <SheetTitle>{t('flowSettings.title')}</SheetTitle>
          <SheetDescription>{t('flowSettings.description')}</SheetDescription>
        </SheetHeader>
        <div className="space-y-6 py-6">
          <div className="space-y-2">
            <Label htmlFor="flow-recursion-limit">{t('flowSettings.recursionLimit')}</Label>
            <p className="text-xs text-muted-foreground">{t('flowSettings.recursionLimitHint')}</p>
            <Input
              id="flow-recursion-limit"
              type="number"
              min={1}
              max={100}
              value={settings.recursionLimit}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                if (!isNaN(val) && val > 0 && val <= 100) {
                  onSettingsChange({ recursionLimit: val });
                }
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="flow-max-parallelism">{t('flowSettings.maxParallelism')}</Label>
            <p className="text-xs text-muted-foreground">{t('flowSettings.maxParallelismHint')}</p>
            <Input
              id="flow-max-parallelism"
              type="number"
              min={1}
              max={32}
              value={settings.maxParallelism}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                if (!isNaN(val) && val > 0 && val <= 32) {
                  onSettingsChange({ maxParallelism: val });
                }
              }}
            />
          </div>
        </div>
        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.done')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
