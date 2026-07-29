import type { JSX } from 'react';
import { Home, LayoutGrid, MessageCircle, Menu, Mic } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import type { WorkyMobileTab } from '../../uiStore';

interface TabDef {
  tab: WorkyMobileTab;
  icon: typeof Home;
  labelKey: string;
}

const TABS: TabDef[] = [
  { tab: 'agents', icon: LayoutGrid, labelKey: 'nav.agents' },
  { tab: 'chat', icon: MessageCircle, labelKey: 'nav.chat' },
  { tab: 'more', icon: Menu, labelKey: 'nav.more' },
];

function TabButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: typeof Home;
  label: string;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex min-w-12 flex-col items-center gap-1 text-[10px] font-medium transition-colors',
        active ? 'text-primary' : 'text-muted-foreground',
      )}
    >
      <Icon className="size-[22px]" />
      {label}
    </button>
  );
}

/**
 * Bottom capsule tab bar with a centered, elevated voice button. `Home`
 * navigates back to the streams list; the three tabs switch the mobile view;
 * the center button opens the voice session.
 */
export function WorkyMobileNav({
  active,
  onChange,
  onVoice,
  onHome,
}: {
  active: WorkyMobileTab;
  onChange: (tab: WorkyMobileTab) => void;
  onVoice: () => void;
  onHome: () => void;
}): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const [agents, chat, more] = TABS;

  return (
    <nav className="pointer-events-none relative flex justify-center px-4 pb-3">
      <div className="pointer-events-auto relative flex h-16 w-full max-w-md items-center justify-between rounded-full border border-border bg-card/95 px-7 shadow-lg backdrop-blur">
        <div className="flex items-center gap-6">
          <TabButton icon={Home} label={t('nav.home')} active={false} onClick={onHome} />
          <TabButton
            icon={agents.icon}
            label={t(agents.labelKey)}
            active={active === agents.tab}
            onClick={() => onChange(agents.tab)}
          />
        </div>

        <div className="w-14" aria-hidden />

        <div className="flex items-center gap-6">
          <TabButton
            icon={chat.icon}
            label={t(chat.labelKey)}
            active={active === chat.tab}
            onClick={() => onChange(chat.tab)}
          />
          <TabButton
            icon={more.icon}
            label={t(more.labelKey)}
            active={active === more.tab}
            onClick={() => onChange(more.tab)}
          />
        </div>

        <button
          type="button"
          aria-label={t('nav.voice')}
          onClick={onVoice}
          className="absolute -top-4 left-1/2 flex size-16 -translate-x-1/2 items-center justify-center rounded-full border-4 border-background bg-primary text-primary-foreground shadow-lg"
        >
          <Mic className="size-7" />
        </button>
      </div>
    </nav>
  );
}
