import type { ModuleTranslationKey, TranslationParams } from '@/modules/localization/types';

/** Matches `useModuleTranslation('playbook')`’s `t` (keys + optional ICU-style params). */
export type PlaybookScheduleT = (
  key: ModuleTranslationKey<'playbook'>,
  params?: TranslationParams,
) => string;
