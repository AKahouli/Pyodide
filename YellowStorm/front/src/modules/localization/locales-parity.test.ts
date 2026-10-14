import { describe, expect, it } from 'vitest';

type Dictionary = Record<string, string>;

// Call sites select plural variants manually (dotted ".one/.other", underscore
// "_one/_many", or custom suffixes), so Arabic files must mirror English keys.
const PLURAL_SUFFIX = /[._](zero|one|two|few|many|other)$/;

const coreLocales = import.meta.glob<{ default: Dictionary }>('./locales/*/*.json', { eager: true });
const moduleLocales = import.meta.glob<{ default: Dictionary }>('../*/locales/*.json', { eager: true });

const namespaces = new Map<string, Map<string, Dictionary>>();

for (const [path, module] of Object.entries(coreLocales)) {
  const match = path.match(/\.\/locales\/([^/]+)\/([^/]+)\.json$/);
  if (match) {
    const langs = namespaces.get(match[2]) ?? new Map<string, Dictionary>();
    langs.set(match[1], module.default);
    namespaces.set(match[2], langs);
  }
}

for (const [path, module] of Object.entries(moduleLocales)) {
  const match = path.match(/\.\.\/([^/]+)\/locales\/([^/.]+)\.json$/);
  if (match) {
    const langs = namespaces.get(match[1]) ?? new Map<string, Dictionary>();
    langs.set(match[2], module.default);
    namespaces.set(match[1], langs);
  }
}

const stem = (key: string) => key.replace(PLURAL_SUFFIX, '');

describe('Arabic locale parity with English', () => {
  it('every namespace with an English file has an Arabic file', () => {
    const missing = [...namespaces.entries()].filter(([, langs]) => langs.has('en') && !langs.has('ar')).map(([ns]) => ns);
    expect(missing).toEqual([]);
  });

  it.each([...namespaces.keys()])('namespace "%s": Arabic has every English key and no orphan keys', (namespace) => {
    const langs = namespaces.get(namespace);
    if (!langs?.has('en') || !langs?.has('ar')) return;

    const enKeys = Object.keys(langs.get('en')!);
    const arKeys = new Set(Object.keys(langs.get('ar')!));

    const missing = enKeys.filter((key) => !arKeys.has(key));
    const enStems = new Set(enKeys.map(stem));
    const orphans = [...arKeys].filter((key) => !enKeys.includes(key) && !enStems.has(stem(key)));

    expect({ namespace, missing, orphans }).toEqual({ namespace, missing: [], orphans: [] });
  });
});
