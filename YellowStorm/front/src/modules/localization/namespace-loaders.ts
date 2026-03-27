import { SUPPORTED_LANGUAGES } from './constants';
import type { Language, Namespace } from './types';

type NamespaceLoader = () => Promise<{ default: Record<string, unknown> }>;

type LoaderMap = Record<Language, Partial<Record<Namespace, NamespaceLoader>>>;

const localizationImports = import.meta.glob('./locales/*/*.json');
const moduleImports = import.meta.glob('../*/locales/*.json');

const loaders: Record<string, Partial<Record<Namespace, NamespaceLoader>>> = {};

function registerLoader(lang: string, namespace: string, loader: NamespaceLoader) {
  const languageEntry = (loaders[lang] ??= {});
  languageEntry[namespace as Namespace] = loader;
}

for (const [path, loader] of Object.entries(localizationImports)) {
  const match = path.match(/\.\/locales\/([^/]+)\/([^/]+)\.json$/);
  if (!match) continue;
  const [, lang, namespace] = match;
  registerLoader(lang, namespace, loader as NamespaceLoader);
}

for (const [path, loader] of Object.entries(moduleImports)) {
  const match = path.match(/\.\.\/([^/]+)\/locales\/([^/.]+)\.json$/);
  if (!match) continue;
  const [, namespace, lang] = match;
  registerLoader(lang, namespace, loader as NamespaceLoader);
}

for (const lang of SUPPORTED_LANGUAGES) {
  loaders[lang] ??= {};
}

export const namespaceLoaders = loaders as LoaderMap;
