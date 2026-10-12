import { describe, expect, it } from 'vitest';
import { defaultLightTheme } from '@openuidev/react-ui';
import { buildCompactTypography, OPENUI_COMPACT_THEME } from './theme';

describe('OpenUI compact theme', () => {
  const theme = OPENUI_COMPACT_THEME as Record<string, string>;

  it('steps the 16px body down to 14px and scales headings in proportion', () => {
    expect(theme.textBodyDefault).toMatch(/^400 14px\//);
    expect(theme.textBodySm).toMatch(/^400 13px\//);
    expect(theme.textHeadingMd).toMatch(/^600 20px\//);
    expect(theme.textHeadingXl).toMatch(/^700 28px\//);
    expect(theme.fontSizeMd).toBe('14px');
  });

  it('keeps font family, line height and weight of the stock shorthand', () => {
    expect(theme.textBodyDefault).toBe((defaultLightTheme as Record<string, string>).textBodyDefault.replace('16px', '14px'));
  });

  it('leaves letter spacing and colour tokens alone so dark mode keeps its palette', () => {
    expect(theme.textHeadingLgLetterSpacing).toBeUndefined();
    expect(theme.textNeutralPrimary).toBeUndefined();
    expect(Object.keys(theme).every((key) => /^(text[A-Z]|fontSize)/.test(key))).toBe(true);
  });

  it('rounds sizes the table does not know instead of leaving them untouched', () => {
    expect((buildCompactTypography({ fontSizeXl: '40px' }) as Record<string, string>).fontSizeXl).toBe('35px');
  });
});
