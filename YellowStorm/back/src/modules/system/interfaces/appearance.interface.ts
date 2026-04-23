export type ColorTheme = 'default' | 'yellow' | 'orange' | 'blue';

export type ThemeLogo = 'yellowmind' | 'kpmg';

export interface AppearanceThemeConfig {
  labelKey: string;
  logo: ThemeLogo;
}

export interface AppearanceSettings {
  defaultColorTheme: ColorTheme;
  themes: Record<ColorTheme, AppearanceThemeConfig>;
}
