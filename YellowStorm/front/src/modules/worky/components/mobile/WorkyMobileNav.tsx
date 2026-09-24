import type { JSX } from 'react';
import { Home, MessageCircle, Mic } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';

function NavButton({
  icon: Icon,
  label,
  onClick,
  disabled = false,
}: {
  icon: typeof Home;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex min-w-12 flex-col items-center gap-1 text-[10px] font-medium text-muted-foreground transition-colors enabled:hover:text-foreground disabled:opacity-40"
    >
      <Icon className="size-[22px]" />
      {label}
    </button>
  );
}

/**
 * Bottom capsule with a centered, elevated voice button. These are three
 * actions rather than tabs: Home returns to the streams list, the centre button
 * opens the voice session, and Chat opens the manager sheet. The capsule hugs
 * its content (no `w-full`) so the three sit tightly together.
 */
export function WorkyMobileNav({
  onHome,
  onVoice,
  onChat,
  canOperate = true,
}: {
  onHome: () => void;
  onVoice: () => void;
  onChat: () => void;
  canOperate?: boolean;
}): JSX.Element {
  const { t } = useModuleTranslation('worky');

  return (
    <nav className="pointer-events-none relative flex justify-center px-4 pb-3">
      <div className="pointer-events-auto relative flex h-16 items-center gap-8 rounded-full border border-border bg-card/95 px-8 shadow-lg backdrop-blur">
        <NavButton icon={Home} label={t('nav.home')} onClick={onHome} />
        {/* Reserves the centre column so the raised mic never sits over a label.
            Its width matches the mic, keeping the button exactly centred. */}
        <span className="w-16" aria-hidden />
        <NavButton icon={MessageCircle} label={t('nav.chat')} onClick={onChat} disabled={!canOperate} />

        <button
          type="button"
          aria-label={t('nav.voice')}
          onClick={onVoice}
          disabled={!canOperate}
          className="absolute -top-4 left-1/2 flex size-16 -translate-x-1/2 items-center justify-center rounded-full border-4 border-background bg-primary text-primary-foreground shadow-lg disabled:opacity-40"
        >
          <Mic className="size-7" />
        </button>
      </div>
    </nav>
  );
}
