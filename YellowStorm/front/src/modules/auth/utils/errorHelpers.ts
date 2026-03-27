import type { TranslationParams } from '@/modules/localization';

type Translator = (key: string, params?: TranslationParams) => string;

export function getErrorCode(err: unknown): string | null {
  if (err && typeof err === 'object' && 'code' in err) {
    return (err as { code: string }).code;
  }
  return null;
}

interface ErrorMessageOptions {
  translationPrefix: string;
  fallbackKey: string;
}

export function getErrorMessage(err: unknown, translate: Translator, { translationPrefix, fallbackKey }: ErrorMessageOptions): string {
  const code = getErrorCode(err);
  if (code) {
    const translationKey = `${translationPrefix}.${code}`;
    const translated = translate(translationKey);
    if (translated !== translationKey) {
      return translated;
    }
  }

  if (err && typeof err === 'object' && 'message' in err) {
    return (err as { message: string }).message;
  }

  return translate(fallbackKey);
}
