import { i18nInstance } from '@/modules/localization/i18nInstance';
import type { ModuleTranslationKey, TranslationParams } from '@/modules/localization';

const NAMESPACE = 'groups';

export function translateGroup(key: ModuleTranslationKey<'groups'>, params?: TranslationParams) {
  return i18nInstance.t(`${NAMESPACE}:${key}`, params);
}
