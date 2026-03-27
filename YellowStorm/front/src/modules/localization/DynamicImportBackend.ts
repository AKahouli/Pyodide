import type { BackendModule, ReadCallback } from 'i18next';
import { namespaceLoaders } from './namespace-loaders';
import type { Language, Namespace } from './types';

/**
 * i18next backend that loads translation JSON through Vite dynamic imports.
 * Enables code-splitting per namespace and language.
 */
export class DynamicImportBackend implements BackendModule {
  readonly type = 'backend' as const;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  init(): void {}

  read(language: string, namespace: string, callback: ReadCallback): void {
    const lang = language as Language;
    const ns = namespace as Namespace;
    const loader = namespaceLoaders[lang]?.[ns];

    if (!loader) {
      const error = new Error(`No translation loader found for ${language}/${namespace}`);
      if (import.meta.env?.DEV) {
        console.error('[Localization] Missing loader:', { language, namespace });
      }
      callback(error, null);
      return;
    }

    loader()
      .then((module) => {
        const resources = module.default ?? module;
        callback(null, resources);
      })
      .catch((error) => {
        if (import.meta.env?.DEV) {
          console.error('[Localization] Failed to load namespace', namespace, 'for', language, error);
        }
        callback(error as Error, null);
      });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  create(): void {}
}
