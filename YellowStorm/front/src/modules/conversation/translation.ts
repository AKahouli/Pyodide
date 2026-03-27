import { i18nInstance } from '@/modules/localization/i18nInstance';
import type { ModuleTranslationKey, TranslationParams } from '@/modules/localization';

const NAMESPACE = 'conversation';

export function translateConversation(key: ModuleTranslationKey<'conversation'>, params?: TranslationParams) {
  return i18nInstance.t(`${NAMESPACE}:${key}`, params);
}
