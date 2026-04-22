/**
 * Combined Provider
 * Combines all app providers into a single component to reduce nesting
 * and improve readability.
 */

import { ReactNode, useEffect, useState } from 'react';
import { AuthProvider } from '@/modules/auth';
import { SettingsModalProvider } from '@/modules/profile';
import { UsageProvider } from '@/modules/usage';
import { NotificationsProvider } from '@/modules/notifications';
import { LocalizationProvider } from '@/modules/localization';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { getGlobalAppearanceSettings } from '@/modules/auth/api';

type CombinedProviderProps = Readonly<{
  children: ReactNode;
}>;

/**
 * Combines all application providers into a single component.
 * Provider order matters:
 * - LocalizationProvider: outermost for translations
 * - AuthProvider: handles authentication
 * - NotificationsProvider: handles system notifications
 * - UsageProvider: handles usage quotas
 * - ThemeProvider: handles theme (light/dark)
 * - SettingsModalProvider: handles settings modals
 */
export function CombinedProvider({ children }: CombinedProviderProps) {
  function ProviderComponent({ children: providerChildren }: { children: ReactNode }) {
    const [defaultColorTheme, setDefaultColorTheme] = useState<'default' | 'yellow' | 'orange' | 'blue'>('default');

    const applyAppearanceClass = (colorTheme: 'default' | 'yellow' | 'orange' | 'blue') => {
      const root = document.documentElement;
      root.classList.remove('theme-default', 'theme-yellow', 'theme-orange', 'theme-blue', 'theme-yellowsys', 'theme-claude', 'theme-kpmg');
      if (colorTheme === 'yellow') root.classList.add('theme-yellowsys');
      if (colorTheme === 'orange') root.classList.add('theme-claude');
      if (colorTheme === 'blue') root.classList.add('theme-kpmg');
    };

    useEffect(() => {
      let isMounted = true;

      getGlobalAppearanceSettings()
        .then((appearance) => {
          if (isMounted) {
            setDefaultColorTheme(appearance.defaultColorTheme);
            applyAppearanceClass(appearance.defaultColorTheme);
          }
        })
        .catch(() => {
          if (isMounted) {
            setDefaultColorTheme('default');
          }
        });

      return () => {
        isMounted = false;
      };
    }, []);

    useEffect(() => {
    const handleThemeSync = () => {
        getGlobalAppearanceSettings()
          .then((appearance) => {
            setDefaultColorTheme(appearance.defaultColorTheme);
            applyAppearanceClass(appearance.defaultColorTheme);
          })
          .catch(() => {
            // Keep the current theme if sync fails.
          });
      };

      window.addEventListener('storage', handleThemeSync);
      window.addEventListener('focus', handleThemeSync);
      return () => {
        window.removeEventListener('storage', handleThemeSync);
        window.removeEventListener('focus', handleThemeSync);
      };
    }, []);

    return (
      <LocalizationProvider>
        <AuthProvider>
          <NotificationsProvider>
            <UsageProvider>
              <ThemeProvider defaultColorTheme={defaultColorTheme} initialColorTheme={defaultColorTheme}>
                <SettingsModalProvider>{providerChildren}</SettingsModalProvider>
              </ThemeProvider>
            </UsageProvider>
          </NotificationsProvider>
        </AuthProvider>
      </LocalizationProvider>
    );
  }

  return <ProviderComponent>{children}</ProviderComponent>;
}
