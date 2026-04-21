import { createContext, useEffect, useState } from 'react';

export const COLOR_THEMES = [
  { value: 'default', label: 'Original' },
  { value: 'yellowsys', label: 'Yellowsys' },
  { value: 'claude', label: 'Neighbor' },
  { value: 'kpmg', label: 'KPMG' },
] as const;

export type ColorTheme = (typeof COLOR_THEMES)[number]['value'];

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: string;
  defaultColorTheme?: ColorTheme;
  storageKey?: string;
  colorThemeStorageKey?: string;
};

export type ThemeProviderState = {
  theme: string;
  setTheme: (theme: string) => void;
  colorTheme: ColorTheme;
  setColorTheme: (colorTheme: ColorTheme) => void;
};

const initialState: ThemeProviderState = {
  theme: 'dark',
  setTheme: () => null,
  colorTheme: 'default',
  setColorTheme: () => null,
};

export const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

export function ThemeProvider({ children, defaultTheme = 'dark', defaultColorTheme = 'default', storageKey = 'ui-theme', colorThemeStorageKey = 'ui-color-theme', ...props }: ThemeProviderProps) {
  const [theme, setTheme] = useState(() => localStorage.getItem(storageKey) ?? defaultTheme);

  const [colorTheme, setColorTheme] = useState<ColorTheme>(() => (localStorage.getItem(colorThemeStorageKey) as ColorTheme) ?? defaultColorTheme);

  useEffect(() => {
    const root = window.document.documentElement;

    root.classList.remove('light', 'dark');

    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

      root.classList.add(systemTheme);
      return;
    }

    root.classList.add(theme);
  }, [theme]);

  useEffect(() => {
    const root = window.document.documentElement;

    // Remove all color theme classes
    for (const t of COLOR_THEMES) {
      if (t.value !== 'default') {
        root.classList.remove(`theme-${t.value}`);
      }
    }

    // Apply the selected color theme
    if (colorTheme !== 'default') {
      root.classList.add(`theme-${colorTheme}`);
    }
  }, [colorTheme]);

  return (
    <ThemeProviderContext.Provider
      {...props}
      value={{
        theme,
        setTheme: (theme: string) => {
          localStorage.setItem(storageKey, theme);
          setTheme(theme);
        },
        colorTheme,
        setColorTheme: (colorTheme: ColorTheme) => {
          localStorage.setItem(colorThemeStorageKey, colorTheme);
          setColorTheme(colorTheme);
        },
      }}>
      {children}
    </ThemeProviderContext.Provider>
  );
}
