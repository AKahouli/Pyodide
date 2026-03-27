import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useModuleTranslation } from '@/modules/localization';

const STORAGE_KEY = 'yellostorm_playbook_beta_dismissed';

export function PlaybookBetaDisclaimer() {
  const { t } = useModuleTranslation('playbook');
  const [open, setOpen] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  useEffect(() => {
    const dismissed = localStorage.getItem(STORAGE_KEY);
    if (dismissed !== 'true') {
      setOpen(true);
    }
  }, []);

  const handleClose = () => {
    if (dontShowAgain) {
      localStorage.setItem(STORAGE_KEY, 'true');
    }
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {t('beta.title')}
          </DialogTitle>
          <DialogDescription>{t('beta.subtitle')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm text-muted-foreground">
          <p>{t('beta.disclaimer1')}</p>
          <p>{t('beta.disclaimer2')}</p>
          <p>{t('beta.disclaimer3')}</p>
        </div>

        <DialogFooter className="flex-col gap-3 sm:flex-col">
          <div className="flex items-center gap-2">
            <Checkbox
              id="beta-dismiss"
              checked={dontShowAgain}
              onCheckedChange={(checked) => setDontShowAgain(checked === true)}
            />
            <Label htmlFor="beta-dismiss" className="text-sm cursor-pointer">
              {t('beta.dontShowAgain')}
            </Label>
          </div>
          <Button onClick={handleClose} className="w-full">
            {t('beta.understood')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
