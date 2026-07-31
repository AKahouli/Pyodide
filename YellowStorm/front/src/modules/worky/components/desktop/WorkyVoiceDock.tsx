import type { JSX } from 'react';
import { Mic } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';

/**
 * Persistent voice dock for the desktop workspace: a gold pill anchored
 * bottom-center that expands the live voice session. Chief-of-Staff chat stays
 * hidden behind the orchestrator panel; this is the primary way to reach it.
 */
export function WorkyVoiceDock({ onOpen }: { onOpen: () => void }): JSX.Element {
  const { t } = useModuleTranslation('worky');
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-20 flex justify-center">
      <button
        type="button"
        onClick={onOpen}
        aria-label={t('nav.voice')}
        className="pointer-events-auto flex items-center gap-3 rounded-full border border-border bg-card/95 py-2 pr-2 pl-4 shadow-lg backdrop-blur transition-colors hover:bg-accent/40"
      >
        <span className="flex flex-col text-left">
          <span className="text-sm font-semibold text-foreground">{t('voice.manager')}</span>
          <span className="text-xs text-muted-foreground">{t('voice.tapToTalk')}</span>
        </span>
        <span className="flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
          <Mic className="size-5" />
        </span>
      </button>
    </div>
  );
}
