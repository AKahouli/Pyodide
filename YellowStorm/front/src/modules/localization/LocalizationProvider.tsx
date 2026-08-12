import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { DEFAULT_LANGUAGE, LANGUAGE_STORAGE_KEY, SUPPORTED_LANGUAGES } from './constants';
import { i18nInstance } from './i18nInstance';
import type { Language, LocalizationContextValue, Namespace, TranslationFunction, TranslationKey, TranslationParams } from './types';

type LocalizationProviderProps = Readonly<{ children: React.ReactNode }>;

type LoadedMap = Record<Language, Partial<Record<Namespace, boolean>>>;

const LocalizationContext = createContext<LocalizationContextValue | null>(null);

const emptyLoadedMap: LoadedMap = SUPPORTED_LANGUAGES.reduce((acc, lang) => {
  acc[lang] = {};
  return acc;
}, {} as LoadedMap);

function normalizeLanguage(candidate?: string | null): Language | null {
  if (!candidate) return null;
  const [base] = candidate.toLowerCase().split('-');
  return SUPPORTED_LANGUAGES.find((lang) => lang === base) ?? null;
}

function setStoredLanguage(lang: Language) {
  if (typeof globalThis === 'undefined' || !globalThis.localStorage) {
    return;
  }
  try {
    globalThis.localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  } catch {
    // ignore storage errors (private mode, quota, etc.)
  }
}

export function LocalizationProvider({ children }: LocalizationProviderProps) {
  const [language, setLanguage] = useState<Language>(() => {
    return normalizeLanguage(i18nInstance.language) ?? DEFAULT_LANGUAGE;
  });
  const [isReady, setIsReady] = useState(() => i18nInstance.isInitialized);
  const [loadedNamespaces, setLoadedNamespaces] = useState<LoadedMap>(emptyLoadedMap);

  useEffect(() => {
    let active = true;

    const handleLoaded = (loaded: Record<string, unknown>) => {
      setLoadedNamespaces((prev) => {
        const next = { ...prev };
        for (const [lng, namespaces] of Object.entries(loaded)) {
          const typedLng = normalizeLanguage(lng) ?? DEFAULT_LANGUAGE;
          const current = next[typedLng] ?? ({} as Partial<Record<Namespace, boolean>>);
          const updated: Partial<Record<Namespace, boolean>> = { ...current };
          const nsList = Array.isArray(namespaces)
            ? namespaces
            : typeof namespaces === 'object' && namespaces !== null
              ? Object.keys(namespaces)
              : [];
          for (const ns of nsList) {
            updated[ns as Namespace] = true;
          }
          next[typedLng] = updated;
        }
        return next;
      });
    };

    const handleLanguageChanged = (lng: string) => {
      if (active) {
        setLanguage(normalizeLanguage(lng) ?? DEFAULT_LANGUAGE);
      }
    };

    const missingHandler = (lng: string, ns: string, key: string) => {
      if (import.meta.env?.DEV) {
        console.warn('[Localization] Missing translation key', `${lng}:${ns}:${key}`);
      }
    };

    // Mark as ready if already initialized
    if (i18nInstance.isInitialized && !isReady) {
      setIsReady(true);
    }

    i18nInstance.on('loaded', handleLoaded);
    i18nInstance.on('languageChanged', handleLanguageChanged);
    i18nInstance.on('missingKey', missingHandler);

    return () => {
      active = false;
      i18nInstance.off('loaded', handleLoaded);
      i18nInstance.off('languageChanged', handleLanguageChanged);
      i18nInstance.off('missingKey', missingHandler);
    };
  }, [isReady]);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const changeLanguage = useCallback(
    async (nextLanguage: Language) => {
      if (nextLanguage === language) {
        return;
      }
      await i18nInstance.changeLanguage(nextLanguage);
      setLanguage(nextLanguage);
      setStoredLanguage(nextLanguage);
    },
    [language],
  );

  const ensureNamespaces = useCallback(async (namespaces: Namespace | Namespace[]) => {
    const namespaceList = Array.isArray(namespaces) ? namespaces : [namespaces];
    await i18nInstance.loadNamespaces(namespaceList);
  }, []);

  const translate = useCallback<TranslationFunction>((key: TranslationKey, params?: TranslationParams) => i18nInstance.t(key, params), []);

  const value = useMemo<LocalizationContextValue>(
    () => ({
      language,
      availableLanguages: [...SUPPORTED_LANGUAGES],
      isReady,
      isLoading: false,
      t: translate,
      changeLanguage,
      ensureNamespaces,
      loadedNamespaces,
    }),
    [language, isReady, changeLanguage, ensureNamespaces, loadedNamespaces, translate],
  );

  return (
    <LocalizationContext.Provider value={value}>
      <I18nextProvider i18n={i18nInstance}>{children}</I18nextProvider>
    </LocalizationContext.Provider>
  );
}

export function useLocalizationContext() {
  const context = useContext(LocalizationContext);
  if (!context) {
    console.error('[useLocalizationContext] ERROR: Context is null - was the hook called outside LocalizationProvider?');
    throw new Error('useLocalizationContext must be used within LocalizationProvider');
  }
  return context;
}
