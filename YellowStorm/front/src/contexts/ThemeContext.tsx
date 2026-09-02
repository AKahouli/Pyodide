import { useAuth } from '@/modules/auth';
import { createContext, useEffect, useState } from 'react';
import { applyColorThemeClass } from './apply-color-theme';

export const COLOR_THEMES = [
  { value: 'default', labelKey: 'appearance.colorTheme.default' },
  { value: 'yellow', labelKey: 'appearance.colorTheme.yellow' },
  { value: 'orange', labelKey: 'appearance.colorTheme.orange' },
  { value: 'blue', labelKey: 'appearance.colorTheme.blue' },
] as const;

export type ColorTheme = (typeof COLOR_THEMES)[number]['value'];

export type ThemeLogoValue = {
  id: string;
  url?: string | null;
};

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: string;
  defaultColorTheme?: ColorTheme;
  resolveLogoForTheme?: (colorTheme: ColorTheme) => ThemeLogoValue;
};

export type ThemeProviderState = {
  theme: string;
  setTheme: (theme: string) => void;
  colorTheme: ColorTheme;
  setColorTheme: (colorTheme: ColorTheme) => void;
  colorThemeLabels: Record<ColorTheme, string>;
  logo: ThemeLogoValue;
  setLogo: (logo: ThemeLogoValue) => void;
};

const COLOR_THEME_LABELS: Record<ColorTheme, string> = {
  default: 'Original',
  yellow: 'Jaune',
  orange: 'Orange',
  blue: 'Bleu',
};

const DEFAULT_LOGO: ThemeLogoValue = { id: 'yellowmind' };

const initialState: ThemeProviderState = {
  theme: 'dark',
  setTheme: () => null,
  colorTheme: 'default',
  setColorTheme: () => null,
  colorThemeLabels: COLOR_THEME_LABELS,
  logo: DEFAULT_LOGO,
  setLogo: () => null,
};

export const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

export function ThemeProvider({ children, defaultTheme = 'dark', defaultColorTheme = 'default', resolveLogoForTheme, ...props }: ThemeProviderProps) {
  const [theme, setTheme] = useState(defaultTheme);
  const [colorTheme, setColorTheme] = useState<ColorTheme>(defaultColorTheme);
  const [logo, setLogo] = useState<ThemeLogoValue>(DEFAULT_LOGO);
  const { isAuthenticated, user } = useAuth();

  useEffect(() => {
    const root = globalThis.document.documentElement;

    root.classList.remove('light', 'dark');

    if (theme === 'system') {
      const systemTheme = globalThis.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      root.classList.add(systemTheme);
      return;
    }

    root.classList.add(theme);
  }, [theme]);

  useEffect(() => {
    applyColorThemeClass(colorTheme);
    setLogo(resolveLogoForTheme?.(colorTheme) ?? (colorTheme === 'blue' ? { id: 'kpmg' } : DEFAULT_LOGO));
  }, [colorTheme, resolveLogoForTheme]);

  useEffect(() => {
    if (!isAuthenticated) {
      setColorTheme(defaultColorTheme);
    }
  }, [defaultColorTheme, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || !user) {
      return;
    }
    const fromUser = user.appearance?.colorTheme;
    if (fromUser) {
      setColorTheme(fromUser);
    }
  }, [isAuthenticated, user]);

  return (
    <ThemeProviderContext.Provider
      {...props}
      value={{
        theme,
        setTheme: (nextTheme: string) => {
          setTheme(nextTheme);
        },
        colorTheme,
        setColorTheme,
        colorThemeLabels: COLOR_THEME_LABELS,
        logo,
        setLogo,
      }}>
      {children}
    </ThemeProviderContext.Provider>
  );
}
