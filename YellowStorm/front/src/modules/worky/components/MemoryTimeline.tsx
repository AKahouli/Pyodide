import { useModuleTranslation } from '@/modules/localization';
import { useMemoryEntries } from '../query/hooks';

/**
 * Confirmed owner-scoped memory entries (Part 4 §7). The owner sees
 * what has been durably written; rejected proposals never appear.
 */
export function MemoryTimeline() {
  const { t } = useModuleTranslation('worky');
  const { data: entries = [], isLoading } = useMemoryEntries();

  if (isLoading) {
    return <div data-testid="memory-timeline-loading">{t('memory.loading')}</div>;
  }
  if (entries.length === 0) {
    return (
      <div data-testid="memory-timeline-empty" className="p-3 text-sm text-gray-500">
        {t('memory.timelineEmpty')}
      </div>
    );
  }

  return (
    <ol data-testid="memory-timeline" className="space-y-2 p-3">
      {entries.map((entry) => (
        <li
          key={entry.id}
          data-testid="memory-timeline-entry"
          className="rounded border border-gray-200 bg-white p-3 text-sm"
        >
          <div className="flex items-center justify-between">
            <span className="font-medium">{entry.title}</span>
            <span className="text-xs text-gray-400">
              {new Date(entry.createdAt).toLocaleString()}
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-600">{entry.content}</p>
          <span className="mt-2 inline-block rounded bg-gray-100 px-2 py-0.5 text-xs">
            {t(`memory.categories.${entry.category}`)}
          </span>
        </li>
      ))}
    </ol>
  );
}
