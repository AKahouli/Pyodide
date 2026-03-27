import { CORE_NAMESPACES, DEFAULT_LANGUAGE, LANGUAGE_STORAGE_KEY, NAMESPACES, SUPPORTED_LANGUAGES } from './constants';
import { namespaceLoaders } from './namespace-loaders';
import { i18nInstance } from './i18nInstance';
import type { Language, Namespace } from './types';

function normalizeLanguage(candidate?: string | null): Language | null {
  if (!candidate) return null;
  const [base] = candidate.toLowerCase().split('-');
  return SUPPORTED_LANGUAGES.find((lang) => lang === base) ?? null;
}

function getStoredLanguage(): Language | null {
  if (typeof globalThis === 'undefined' || !globalThis.localStorage) {
    return null;
  }
  try {
    const storedValue = globalThis.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return normalizeLanguage(storedValue);
  } catch {
    return null;
  }
}

function getBrowserLanguage(): string | null {
  if (typeof globalThis === 'undefined' || !globalThis.navigator) {
    return null;
  }
  return globalThis.navigator.language ?? null;
}

function detectInitialLanguage(): Language {
  const stored = getStoredLanguage();
  if (stored) return stored;

  const browserLanguage = normalizeLanguage(getBrowserLanguage());
  if (browserLanguage) return browserLanguage;

  return DEFAULT_LANGUAGE;
}

const INITIAL_NAMESPACES: Namespace[] = [...CORE_NAMESPACES];

type InitialResourceMap = Record<Language, Partial<Record<Namespace, Record<string, unknown>>>>;

/**
 * Load translation resources for a single language.
 * This is much faster than loading all languages upfront.
 */
async function loadResourcesForLanguage(lang: Language): Promise<Record<Namespace, Record<string, unknown>>> {
  const resources: Partial<Record<Namespace, Record<string, unknown>>> = {};

  for (const ns of INITIAL_NAMESPACES) {
    const loader = namespaceLoaders[lang]?.[ns];
    if (!loader) continue;
    const module = await loader();
    resources[ns] = module.default ?? module;
  }

  return resources as Record<Namespace, Record<string, unknown>>;
}

/**
 * Load resources only for the detected language and its fallback.
 * Instead of loading all languages (en + fr + ...) upfront, we load only
 * what the user actually needs. This reduces initial load time by ~50%.
 */
async function loadInitialResources(detectedLanguage: Language): Promise<InitialResourceMap> {
  // Always load DEFAULT_LANGUAGE as fallback for missing translations
  const languagesToLoad = new Set<Language>([DEFAULT_LANGUAGE, detectedLanguage]);

  const entries = await Promise.all(
    Array.from(languagesToLoad).map(async (lang) => {
      const resources = await loadResourcesForLanguage(lang);
      return { lang, resources };
    }),
  );

  return entries.reduce<InitialResourceMap>((acc, { lang, resources }) => {
    acc[lang] = resources;
    return acc;
  }, {} as InitialResourceMap);
}

let initPromise: Promise<void> | null = null;

export async function initI18n(): Promise<void> {
  if (initPromise) return initPromise;
  if (i18nInstance.isInitialized) return Promise.resolve();

  initPromise = (async () => {
    const initialLanguage = detectInitialLanguage();
    const initialResources = await loadInitialResources(initialLanguage);

    await i18nInstance.init({
      lng: initialLanguage,
      fallbackLng: DEFAULT_LANGUAGE,
      supportedLngs: SUPPORTED_LANGUAGES,
      // Declare all available namespaces (so i18next knows about them)
      ns: NAMESPACES,
      // But only core namespaces are pre-loaded; others load on demand
      partialBundledLanguages: true,
      defaultNS: 'common',
      fallbackNS: 'common',
      resources: initialResources,
      interpolation: { escapeValue: false },
      react: { useSuspense: false },
      returnNull: false,
    });
  })();

  return initPromise;
}

export function isI18nReady(): boolean {
  return i18nInstance.isInitialized;
}
