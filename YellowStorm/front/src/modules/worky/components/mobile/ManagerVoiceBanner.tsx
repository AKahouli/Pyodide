import type { JSX } from 'react';
import { Sparkles, Mic } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';

/**
 * Compact "Chief of Staff" banner shown atop the mobile agent view. The manager
 * chat is hidden by default; the mic is the primary way to reach the manager.
 */
export function ManagerVoiceBanner({ onTalk }: { onTalk: () => void }): JSX.Element {
  const { t } = useModuleTranslation('worky');
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
        <Sparkles className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-foreground">{t('voice.manager')}</div>
        <div className="truncate text-xs text-muted-foreground">{t('voice.tapToTalk')}</div>
      </div>
      <button
        type="button"
        aria-label={t('voice.talk')}
        onClick={onTalk}
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
      >
        <Mic className="size-5" />
      </button>
    </div>
  );
}
