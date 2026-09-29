export const VITE_BASE_RE = /base\s*:\s*process\.env\.VITE_APP_BASE\s*\|\|/;
const ALIAS_RE = /['"]@['"]\s*:/;
const DEFINE_CONFIG_OBJECT_RE = /defineConfig\s*\(\s*\{/;
const EXPORT_DEFAULT_OBJECT_RE = /export\s+default\s*\{/;

export interface ViteConfigTransformResult {
  content: string | null;
  changed: boolean;
  /** Set when the config shape is not something we can safely patch. */
  violation: string | null;
}

/**
 * Ensure the template's Vite config honours the deploy sub-path and the `@`
 * alias the platform files import from. Insertion is done on the config object
 * opening brace so existing options are preserved.
 */
export function transformViteConfig(source: string): ViteConfigTransformResult {
  const hasBase = VITE_BASE_RE.test(source);
  const hasAlias = ALIAS_RE.test(source);
  if (hasBase && hasAlias) {
    return { content: null, changed: false, violation: null };
  }

  const match = DEFINE_CONFIG_OBJECT_RE.exec(source) ?? EXPORT_DEFAULT_OBJECT_RE.exec(source);
  if (!match) {
    return {
      content: null,
      changed: false,
      violation:
        'vite config must export a literal config object (defineConfig({ ... })) so the platform can inject base and the @ alias.',
    };
  }

  const insertAt = match.index + match[0].length;
  const injected: string[] = [];
  if (!hasBase) {
    injected.push("  base: process.env.VITE_APP_BASE || '/',");
  }
  if (!hasAlias) {
    injected.push(
      "  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },",
    );
  }

  const content = `${source.slice(0, insertAt)}\n${injected.join('\n')}${source.slice(insertAt)}`;
  return { content, changed: true, violation: null };
}
