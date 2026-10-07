import { useModuleTranslation } from '@/modules/localization';
import type { ModuleTranslationKey } from '@/modules/localization/types';
import type { SegmentId } from './consoleState';

const SEGMENT_LABELS: Record<SegmentId, ModuleTranslationKey<'playbook'>> = {
  all: 'console.segment.all',
  shared: 'console.segment.shared',
  live: 'console.segment.live',
  fav: 'console.segment.fav',
  scheduled: 'console.segment.scheduled',
  never: 'console.segment.never',
};

const ORDER: SegmentId[] = ['all', 'shared', 'live', 'fav', 'scheduled', 'never'];

export function SegmentTabs({
  counts,
  active,
  onChange,
}: {
  counts: Record<SegmentId, number>;
  active: SegmentId;
  onChange: (segment: SegmentId) => void;
}) {
  const { t } = useModuleTranslation('playbook');
  return (
    <div
      role="tablist"
      aria-label={t('console.segments')}
      className="flex items-center gap-1 overflow-x-auto px-4 sm:px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {ORDER.map((segment) => {
        const count = counts[segment] ?? 0;
        const isActive = segment === active;
        return (
          <button
            key={segment}
            role="tab"
            type="button"
            aria-selected={isActive}
            onClick={() => onChange(segment)}
            className={`relative shrink-0 px-3 pb-2.5 pt-2 text-[13px] transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring ${
              isActive ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t(SEGMENT_LABELS[segment])}
            {count > 0 && <span className="ml-1.5 font-mono text-[11px] tabular-nums text-muted-foreground">{count}</span>}
            <span
              aria-hidden
              className={`absolute inset-x-2 bottom-0 h-0.5 rounded-full transition-opacity ${
                isActive ? 'bg-primary opacity-100' : 'opacity-0'
              }`}
            />
          </button>
        );
      })}
    </div>
  );
}
