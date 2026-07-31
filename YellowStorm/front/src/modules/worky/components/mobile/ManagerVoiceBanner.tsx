import type { JSX } from 'react';
import { Sparkles } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';

const WAVE = [8, 14, 20, 12, 16, 9];

/**
 * Compact "Chief of Staff" banner atop the mobile agent view. The whole card is
 * tappable to start the voice session; a gold waveform stands in for the mic.
 */
export function ManagerVoiceBanner({ onTalk }: { onTalk: () => void }): JSX.Element {
  const { t } = useModuleTranslation('worky');
  return (
    <button
      type="button"
      onClick={onTalk}
      aria-label={t('voice.talk')}
      className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-3 text-left transition-colors hover:bg-accent/40"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
        <Sparkles className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">{t('voice.manager')}</span>
        <span className="block truncate text-xs text-muted-foreground">{t('voice.tapToTalk')}</span>
      </span>
      <span className="flex h-5 items-center gap-[3px]" aria-hidden>
        {WAVE.map((h, i) => (
          <span key={i} className="w-[3px] rounded-full bg-primary" style={{ height: h }} />
        ))}
      </span>
    </button>
  );
}
