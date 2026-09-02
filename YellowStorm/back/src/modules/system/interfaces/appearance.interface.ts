export type ColorTheme = 'default' | 'yellow' | 'orange' | 'blue';

export type BuiltinThemeLogo = 'yellowmind' | 'kpmg';

export interface AppearanceThemeConfig {
  labelKey: string;
  logo: string;
}

export interface AppearanceLogo {
  id: string;
  name: string;
  kind: 'builtin' | 'custom';
  contentType?: string;
  width?: number;
  height?: number;
  url?: string;
  updatedAt?: string;
}

export interface AppearanceThemeSettings {
  defaultColorTheme: ColorTheme;
  themes: Record<ColorTheme, AppearanceThemeConfig>;
}

export interface AppearanceSettings extends AppearanceThemeSettings {
  logos: AppearanceLogo[];
}
