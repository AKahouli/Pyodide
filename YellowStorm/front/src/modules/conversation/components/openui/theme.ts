import { createTheme, defaultLightTheme, type Theme } from '@openuidev/react-ui';

/**
 * The stock OpenUI typography is sized for a full-page chat (16px body). Inside
 * a conversation bubble it reads too large next to our own markdown, so every
 * font size token is stepped down: 16px body becomes 14px, headings scale in
 * proportion. Only `--openui-*` tokens inside `[data-openui-scope]` change.
 */
const COMPACT_PX: Readonly<Record<number, number>> = { 10: 10, 12: 11, 14: 13, 16: 14, 18: 16, 20: 18, 24: 20, 28: 24, 32: 28, 36: 30 };

const TYPOGRAPHY_SIZE_KEY = /^(text[A-Z]\w*|fontSize\w+)$/;

/** Whole-pixel sizes only: skips letter-spacing values such as `-0.1px`. */
function compactSizes(value: string): string {
  return value.replace(/(?<![\d.])(\d+)px/g, (_match, px: string) => `${COMPACT_PX[Number(px)] ?? Math.round(Number(px) * 0.875)}px`);
}

export function buildCompactTypography(base: Record<string, unknown>): Theme {
  const overrides: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (typeof value !== 'string' || key.endsWith('LetterSpacing') || !TYPOGRAPHY_SIZE_KEY.test(key)) continue;
    const compact = compactSizes(value);
    // Colour tokens share the `text` prefix; leaving them out keeps the dark palette intact.
    if (compact !== value) overrides[key] = compact;
  }
  return createTheme(overrides as Theme);
}

/** Typography does not differ between modes, so one override serves light and dark. */
export const OPENUI_COMPACT_THEME: Theme = buildCompactTypography(defaultLightTheme as Record<string, unknown>);
