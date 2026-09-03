import { describe, expect, it } from 'vitest';
import type { AppearanceSettings } from '@/modules/admin/types';
import { FALLBACK_LOGOS } from '../constants';
import {
  logoMapForAllThemes,
  logosFromSettings,
  replaceMissingLogos,
  resolveThemeLogo,
} from './appearance-settings';

const settings: AppearanceSettings = {
  defaultColorTheme: 'blue',
  logos: [
    { id: 'yellowmind', name: 'Yellowmind', kind: 'builtin' },
    { id: 'kpmg', name: 'KPMG', kind: 'builtin' },
    { id: 'abc', name: 'Custom', kind: 'custom', updatedAt: '1' },
  ],
  themes: {
    default: { labelKey: 'appearance.colorTheme.default', logo: 'abc' },
    yellow: { labelKey: 'appearance.colorTheme.yellow', logo: 'abc' },
    orange: { labelKey: 'appearance.colorTheme.orange', logo: 'abc' },
    blue: { labelKey: 'appearance.colorTheme.blue', logo: 'abc' },
  },
};

describe('appearance-settings', () => {
  it('merges missing builtin logos into the catalog', () => {
    expect(logosFromSettings({ ...settings, logos: [] })).toEqual(FALLBACK_LOGOS);
  });

  it('assigns one logo to every color theme', () => {
    expect(logoMapForAllThemes('kpmg')).toEqual({
      default: 'kpmg',
      yellow: 'kpmg',
      orange: 'kpmg',
      blue: 'kpmg',
    });
  });

  it('replaces unknown theme logos with the default builtin', () => {
    expect(replaceMissingLogos({ default: 'gone', yellow: 'kpmg', orange: 'gone', blue: 'kpmg' }, new Set(['kpmg', 'yellowmind']))).toEqual({
      default: 'yellowmind',
      yellow: 'kpmg',
      orange: 'yellowmind',
      blue: 'kpmg',
    });
  });

  it('resolves the custom logo file URL for a theme', () => {
    const logo = resolveThemeLogo(settings, 'blue');
    expect(logo.id).toBe('abc');
    expect(logo.url).toContain('/experimental/system/appearance/logos/abc/file');
  });
});
