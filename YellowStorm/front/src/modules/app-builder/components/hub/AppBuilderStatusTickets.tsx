import { Cloud, PencilLine, Share2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { APP_BUILDER_TAB_LABEL_KEYS } from '../../ticket-i18n';
import type { AppBuilderTab } from '../../types';

const TICKET_ACTIVE =
  'border-border bg-card shadow-sm ring-1 ring-border/60 dark:border-white/25 dark:bg-white/10 dark:ring-white/10';
const TICKET_INACTIVE =
  'border-border/70 bg-background/80 dark:border-border dark:bg-background/55';
const LABEL_ACTIVE = 'font-semibold text-foreground dark:text-white';
const LABEL_INACTIVE = 'font-medium text-muted-foreground dark:text-white/80';
const BADGE_ACTIVE = 'bg-muted text-foreground dark:bg-white/20 dark:text-white';
const BADGE_INACTIVE =
  'bg-muted/90 text-muted-foreground dark:bg-muted dark:text-white/80';

const TICKET_STYLES: Record<
  AppBuilderTab,
  {
    icon: typeof Cloud;
    iconWrap: string;
    iconWrapActive: string;
    focusRing: string;
  }
> = {
  deployed: {
    icon: Cloud,
    iconWrap:
      'bg-emerald-500/12 text-emerald-700 dark:bg-emerald-500/25 dark:text-emerald-300',
    iconWrapActive:
      'bg-emerald-500/25 text-emerald-800 dark:bg-emerald-400/45 dark:text-emerald-100',
    focusRing: 'focus-visible:ring-emerald-500/45 dark:focus-visible:ring-emerald-400/55',
  },
  shared: {
    icon: Share2,
    iconWrap:
      'bg-violet-500/12 text-violet-700 dark:bg-violet-500/25 dark:text-violet-300',
    iconWrapActive:
      'bg-violet-500/25 text-violet-800 dark:bg-violet-400/45 dark:text-violet-100',
    focusRing: 'focus-visible:ring-violet-500/45 dark:focus-visible:ring-violet-400/55',
  },
  draft: {
    icon: PencilLine,
    iconWrap:
      'bg-amber-500/12 text-amber-700 dark:bg-amber-500/25 dark:text-amber-300',
    iconWrapActive:
      'bg-amber-500/25 text-amber-800 dark:bg-amber-400/45 dark:text-amber-100',
    focusRing: 'focus-visible:ring-amber-500/45 dark:focus-visible:ring-amber-400/55',
  },
};

interface AppBuilderStatusTicketsProps {
  activeTab: AppBuilderTab;
  counts: Record<AppBuilderTab, number>;
  onTabChange: (tab: AppBuilderTab) => void;
}

export function AppBuilderStatusTickets({
  activeTab,
  counts,
  onTabChange,
}: AppBuilderStatusTicketsProps) {
  const { t } = useModuleTranslation('app-builder');
  const tabs: AppBuilderTab[] = ['deployed', 'shared', 'draft'];

  return (
    <div className='rounded-xl border border-border/60 bg-card/40 p-1.5 dark:border-border dark:bg-card/55'>
      <div
        className='flex flex-wrap gap-1.5'
        role='tablist'
        aria-label={t('hub.tickets.ariaLabel')}
      >
        {tabs.map((tab) => {
          const styles = TICKET_STYLES[tab];
          const Icon = styles.icon;
          const isActive = activeTab === tab;

          return (
            <button
              key={tab}
              type='button'
              role='tab'
              aria-selected={isActive}
              onClick={() => onTabChange(tab)}
              className={cn(
                'inline-flex min-h-10 flex-1 items-center gap-2.5 rounded-lg border px-3 py-2 text-sm transition-colors duration-200 sm:flex-none sm:px-4',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                styles.focusRing,
                isActive ? TICKET_ACTIVE : TICKET_INACTIVE,
              )}
            >
              <span
                className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors',
                  isActive ? styles.iconWrapActive : styles.iconWrap,
                )}
              >
                <Icon className='h-3.5 w-3.5' aria-hidden />
              </span>
              <span className={cn('truncate', isActive ? LABEL_ACTIVE : LABEL_INACTIVE)}>
                {t(APP_BUILDER_TAB_LABEL_KEYS[tab])}
              </span>
              <span
                className={cn(
                  'ml-auto inline-flex min-w-[1.5rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums sm:ml-0',
                  isActive ? BADGE_ACTIVE : BADGE_INACTIVE,
                )}
              >
                {counts[tab]}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
