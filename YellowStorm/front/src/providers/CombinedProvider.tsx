/**
 * Combined Provider
 * Combines all app providers into a single component to reduce nesting
 * and improve readability.
 */

import { ReactNode, useCallback, useEffect, useState } from 'react';
import type { ColorTheme } from '@/contexts/ThemeContext';
import { AuthProvider } from '@/modules/auth';
import { SettingsModalProvider } from '@/modules/profile';
import { UsageProvider } from '@/modules/usage/UsageContext';
import { NotificationsProvider } from '@/modules/notifications';
import { LocalizationProvider } from '@/modules/localization';
import { applyColorThemeClass } from '@/contexts/apply-color-theme';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { getGlobalAppearanceSettings } from '@/modules/auth/api';
import { PlaybookQueryProvider } from '@/modules/playbook/query/queryProvider';
import { APPEARANCE_SETTINGS_UPDATED_EVENT } from '@/modules/admin/appearance/constants';
import { resolveThemeLogo } from '@/modules/admin/appearance/utils/appearance-settings';
import type { AppearanceSettings } from '@/modules/admin/types';

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
    const [appearanceSettings, setAppearanceSettings] = useState<AppearanceSettings | null>(null);

    useEffect(() => {
      let isMounted = true;

      getGlobalAppearanceSettings()
        .then((appearance) => {
          if (isMounted) {
            setAppearanceSettings(appearance);
            applyColorThemeClass(appearance.defaultColorTheme);
          }
        })
        .catch(() => {
          if (isMounted) {
            applyColorThemeClass('default');
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
            setAppearanceSettings(appearance);
            applyColorThemeClass(appearance.defaultColorTheme);
          })
          .catch(() => {
            // Keep the current theme if sync fails.
          });
      };

      window.addEventListener('storage', handleThemeSync);
      window.addEventListener('focus', handleThemeSync);
      window.addEventListener(APPEARANCE_SETTINGS_UPDATED_EVENT, handleThemeSync);
      return () => {
        window.removeEventListener('storage', handleThemeSync);
        window.removeEventListener('focus', handleThemeSync);
        window.removeEventListener(APPEARANCE_SETTINGS_UPDATED_EVENT, handleThemeSync);
      };
    }, []);

    const resolveLogoForTheme = useCallback(
      (colorTheme: ColorTheme) => resolveThemeLogo(appearanceSettings, colorTheme),
      [appearanceSettings],
    );

    return (
      <LocalizationProvider>
        <AuthProvider>
          <PlaybookQueryProvider>
            <NotificationsProvider>
              <UsageProvider>
                <ThemeProvider
                  defaultColorTheme={appearanceSettings?.defaultColorTheme}
                  resolveLogoForTheme={resolveLogoForTheme}>
                  <SettingsModalProvider>{providerChildren}</SettingsModalProvider>
                </ThemeProvider>
              </UsageProvider>
            </NotificationsProvider>
          </PlaybookQueryProvider>
        </AuthProvider>
      </LocalizationProvider>
    );
  }

  return <ProviderComponent>{children}</ProviderComponent>;
}
