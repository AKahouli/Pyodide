import { i18nInstance } from '@/modules/localization/i18nInstance';
import type { ModuleTranslationKey, TranslationParams } from '@/modules/localization';

const NAMESPACE = 'team';

export function translateTeam(key: ModuleTranslationKey<'team'>, params?: TranslationParams) {
  return i18nInstance.t(`${NAMESPACE}:${key}`, params);
}
