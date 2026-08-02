/**
 * Localization module constants.
 */

export const LANGUAGE_STORAGE_KEY = 'yellowmind:locale';

const localizationLanguageEntries = import.meta.glob('./locales/*/common.json');

const detectedLanguages = Object.keys(localizationLanguageEntries)
  .map((path) => path.match(/\.\/locales\/([^/]+)\//)?.[1])
  .filter((lang): lang is string => Boolean(lang));

const FALLBACK_LANGUAGE = 'en';
const languageSet = new Set<string>([FALLBACK_LANGUAGE, ...detectedLanguages]);

export const SUPPORTED_LANGUAGES = Array.from(languageSet);

export const DEFAULT_LANGUAGE = FALLBACK_LANGUAGE;

export const NAMESPACES = ['common', 'errors', 'admin', 'agent', 'app-marketplace', 'auth', 'connected-app', 'conversation', 'conversation-v2', 'file-viewer', 'governance', 'groups', 'models', 'notifications', 'platform-overview', 'playbook', 'profile', 'semantic-model', 'sidebar', 'team', 'usage', 'workspace', 'worky'] as const;

/**
 * Core namespaces loaded at startup.
 * These contain translations needed for the initial render (landing page, auth, etc.)
 * Other namespaces are lazy-loaded on demand.
 */
export const CORE_NAMESPACES = ['common', 'auth', 'errors', 'conversation', 'sidebar'] as const;

export const COMMON_NAMESPACE = 'common';
