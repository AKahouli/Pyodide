import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CORE_NAMESPACES } from './constants';
import { useLocalizationContext } from './LocalizationProvider';
import type { Language, ModuleTranslationKey, Namespace, TranslationParams } from './types';

export interface UseModuleTranslationResult<N extends Namespace> {
  t: (key: ModuleTranslationKey<N>, params?: TranslationParams) => string;
  language: Language;
  ready: boolean;
}

type TranslationHookOptions = Parameters<typeof useTranslation>[1];

export function useModuleTranslation<N extends Namespace>(namespace: N, options?: TranslationHookOptions): UseModuleTranslationResult<N> {
  const { ensureNamespaces, isReady: providerReady, loadedNamespaces } = useLocalizationContext();
  const [namespaceReady, setNamespaceReady] = useState(() => {
    // Core namespaces are always ready at startup
    return (CORE_NAMESPACES as readonly Namespace[]).includes(namespace);
  });

  // FIX: Always pass useSuspense: false to prevent Promise return
  const hookOptions = { ...options, useSuspense: false };

  let tResult, i18nResult;
  try {
    ({ t: tResult, i18n: i18nResult } = useTranslation(namespace, hookOptions));
  } catch (error) {
    console.error('[useModuleTranslation] ERROR in useTranslation:', error);
    throw error;
  }

  const { t, i18n } = { t: tResult, i18n: i18nResult } as { t: typeof tResult; i18n: any };

  // Check if namespace is loaded for current language
  const currentLanguage = i18n?.language as Language;
  const isNamespaceLoaded = currentLanguage && loadedNamespaces[currentLanguage]?.[namespace];

  // Load namespace on mount and track readiness
  useEffect(() => {
    const loadNamespace = async () => {
      await ensureNamespaces(namespace);
      setNamespaceReady(true);
    };

    // If not a core namespace, load it
    if (!(CORE_NAMESPACES as readonly Namespace[]).includes(namespace)) {
      void loadNamespace();
    }
  }, [namespace, ensureNamespaces]);

  const translate = useCallback(
    (key: ModuleTranslationKey<N>, params?: TranslationParams) => {
      return t(key, params);
    },
    [t],
  );

  return {
    t: translate,
    language: i18n?.language as Language,
    ready: providerReady && (namespaceReady || !!isNamespaceLoaded)
  };
}
