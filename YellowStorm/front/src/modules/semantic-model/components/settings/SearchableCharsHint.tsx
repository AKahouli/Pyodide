import { useEffect, useState } from 'react';
import { useModuleTranslation } from '@/modules/localization';
import { searchSettingsApi, type SearchIndexSettings } from '../../searchSettings';
import type { RunLimits } from '../../types';

type Cut = Pick<SearchIndexSettings, 'passageTargetChars' | 'passageOverlapChars' | 'maxPassagesPerField'>;

/** What the search index can find in one text field: its passages, minus the overlap each one repeats. */
export function searchableChars({ passageTargetChars, passageOverlapChars, maxPassagesPerField }: Cut): number {
  return maxPassagesPerField * (passageTargetChars - passageOverlapChars) + passageOverlapChars;
}

/**
 * Next to the reading limits: how many characters of one field the search index can find, so a person does not
 * raise a reading limit that stores text no search will reach. The global index settings are used; a field's own
 * override can differ and is not looked at here.
 */
export function SearchableCharsHint({ reading }: Readonly<{ reading: Partial<Pick<RunLimits, 'maxAttachmentChars' | 'maxBodyChars'>> }>) {
  const { t } = useModuleTranslation('semantic-model');
  const [index, setIndex] = useState<SearchIndexSettings | null>(null);

  useEffect(() => {
    let current = true;
    // The hint is an aid: without the index settings the pane shows no hint, and the limits stay editable.
    searchSettingsApi.getAdminIndex().then((response) => { if (current) setIndex(response.settings); }).catch(() => { if (current) setIndex(null); });
    return () => { current = false; };
  }, []);

  if (!index) return null;
  const searchable = searchableChars(index);
  const stored = Math.max(reading.maxAttachmentChars ?? 100000, reading.maxBodyChars ?? 100000);
  return <div className='space-y-1 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground' role='note'>
    <p>{t('settings.extraction.searchable', {
      chars: searchable.toLocaleString(), passages: index.maxPassagesPerField, target: index.passageTargetChars, overlap: index.passageOverlapChars })}</p>
    {stored > searchable && <p className='text-amber-700 dark:text-amber-400'>{t('settings.extraction.searchableWarn', { limit: stored.toLocaleString(), chars: searchable.toLocaleString() })}</p>}
  </div>;
}
