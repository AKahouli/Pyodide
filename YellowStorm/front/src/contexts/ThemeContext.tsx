import { useAuth } from '@/modules/auth';
import { createContext, useEffect, useState } from 'react';

export const COLOR_THEMES = [
  { value: 'default', labelKey: 'appearance.colorTheme.default' },
  { value: 'yellow', labelKey: 'appearance.colorTheme.yellow' },
  { value: 'orange', labelKey: 'appearance.colorTheme.orange' },
  { value: 'blue', labelKey: 'appearance.colorTheme.blue' },
] as const;

export type ColorTheme = (typeof COLOR_THEMES)[number]['value'];

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: string;
  defaultColorTheme?: ColorTheme;
  resolveLogoForTheme?: (colorTheme: ColorTheme) => 'yellowmind' | 'kpmg';
};

export type ThemeProviderState = {
  theme: string;
  setTheme: (theme: string) => void;
  colorTheme: ColorTheme;
  setColorTheme: (colorTheme: ColorTheme) => void;
  colorThemeLabels: Record<ColorTheme, string>;
  logo: 'yellowmind' | 'kpmg';
  setLogo: (logo: 'yellowmind' | 'kpmg') => void;
};

const COLOR_THEME_LABELS: Record<ColorTheme, string> = {
  default: 'Original',
  yellow: 'Jaune',
  orange: 'Orange',
  blue: 'Bleu',
};

const initialState: ThemeProviderState = {
  theme: 'dark',
  setTheme: () => null,
  colorTheme: 'default',
  setColorTheme: () => null,
  colorThemeLabels: COLOR_THEME_LABELS,
  logo: 'yellowmind',
  setLogo: () => null,
};

export const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

export function ThemeProvider({ children, defaultTheme = 'dark', defaultColorTheme = 'default', resolveLogoForTheme, ...props }: ThemeProviderProps) {
  const [theme, setTheme] = useState(defaultTheme);
  const [colorTheme, setColorTheme] = useState<ColorTheme>(defaultColorTheme);
  const [logo, setLogo] = useState<'yellowmind' | 'kpmg'>(() => 'yellowmind');
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
    const root = globalThis.document.documentElement;

    root.classList.remove('theme-default', 'theme-yellow', 'theme-orange', 'theme-blue', 'theme-yellowsys', 'theme-claude', 'theme-kpmg');
    if (colorTheme === 'yellow') root.classList.add('theme-yellowsys');
    if (colorTheme === 'orange') root.classList.add('theme-claude');
    if (colorTheme === 'blue') root.classList.add('theme-kpmg');
    setLogo(resolveLogoForTheme?.(colorTheme) ?? (colorTheme === 'blue' ? 'kpmg' : 'yellowmind'));
  }, [colorTheme, resolveLogoForTheme]);

  useEffect(() => {
    if (!isAuthenticated) {
      setColorTheme(defaultColorTheme);
      return;
    }

    if (user) {
      setColorTheme(user.appearance?.colorTheme ?? defaultColorTheme);
    }
  }, [defaultColorTheme, isAuthenticated, user]);

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
