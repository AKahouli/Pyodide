import { getContrastRatio, getRelativeLuminance, isTextContrastCompliant, isUiContrastCompliant } from './widget-contrast';

describe('widget contrast utilities', () => {
  it('calculates WCAG luminance and contrast for full and shorthand hex colors', () => {
    expect(getRelativeLuminance('#000')).toBe(0);
    expect(getRelativeLuminance('#fff')).toBe(1);
    expect(getContrastRatio('#000000', '#ffffff')).toBe(21);
  });

  it('rejects invalid colors and evaluates text and UI thresholds', () => {
    expect(getContrastRatio('red', '#fff')).toBeNull();
    expect(isTextContrastCompliant('#777777', '#ffffff')).toBe(false);
    expect(isUiContrastCompliant('#777777', '#ffffff')).toBe(true);
  });
});
