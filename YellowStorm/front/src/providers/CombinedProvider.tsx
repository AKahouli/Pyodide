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

    useEffect(() => {
      let isMounted = true;

      getGlobalAppearanceSettings()
        .then((appearance) => {
          if (isMounted) {
            setDefaultColorTheme(appearance.defaultColorTheme);
            localStorage.setItem('ui-color-theme', appearance.defaultColorTheme);
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
