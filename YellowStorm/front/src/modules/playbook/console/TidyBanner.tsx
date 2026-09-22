import { useEffect, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';
import { TIDY_STORAGE_KEY } from './consoleState';

const DISMISS_DAYS = 30;

/** Suggests cleanup when drafts or duplicate copies pile up (§7.11). Never auto-archives. */
export function TidyBanner({ neverRunCount, duplicateCount, onReview }: { neverRunCount: number; duplicateCount: number; onReview: () => void }) {
  const { t } = useModuleTranslation('playbook');
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    const until = parseInt(localStorage.getItem(TIDY_STORAGE_KEY) ?? '', 10);
    setDismissed(Number.isFinite(until) && until > Date.now());
  }, []);

  const visible = !dismissed && (neverRunCount >= 5 || duplicateCount >= 2);
  if (!visible) return null;

  return (
    <div className="mx-4 mt-3 flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 sm:mx-6" data-testid="tidy-banner" role="status">
      <Sparkles className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <p className="min-w-0 flex-1 text-xs text-muted-foreground">
        {t('console.tidy.copy', { neverRun: neverRunCount, duplicates: duplicateCount })}
      </p>
      <Button variant="outline" size="sm" className="h-7 shrink-0 px-2.5 text-xs" onClick={onReview}>
        {t('console.tidy.review')}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        aria-label={t('console.tidy.dismiss')}
        onClick={() => {
          localStorage.setItem(TIDY_STORAGE_KEY, String(Date.now() + DISMISS_DAYS * 86_400_000));
          setDismissed(true);
        }}
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </Button>
    </div>
  );
}
