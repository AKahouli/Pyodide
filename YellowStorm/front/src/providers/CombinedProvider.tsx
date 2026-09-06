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
import { ThemeProvider } from '@/contexts/ThemeContext';
import { getGlobalAppearanceSettings } from '@/modules/auth/api';
import { PlaybookQueryProvider } from '@/modules/playbook/query/queryProvider';
import {
  APPEARANCE_SETTINGS_UPDATED_EVENT,
  resolveThemeLogo,
} from '@/lib/appearance';
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
function AppProviders({ children }: { children: ReactNode }) {
  const [appearanceSettings, setAppearanceSettings] = useState<AppearanceSettings | null>(null);

  useEffect(() => {
    let isMounted = true;

    getGlobalAppearanceSettings()
      .then((appearance) => {
        if (isMounted) {
          setAppearanceSettings(appearance);
        }
      })
      .catch(() => undefined);

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const handleAppearanceSync = (event: Event) => {
      const detail = (event as CustomEvent<AppearanceSettings | undefined>).detail;
      if (detail) {
        setAppearanceSettings(detail);
        return;
      }
      getGlobalAppearanceSettings()
        .then(setAppearanceSettings)
        .catch(() => undefined);
    };

    window.addEventListener(APPEARANCE_SETTINGS_UPDATED_EVENT, handleAppearanceSync);
    return () => {
      window.removeEventListener(APPEARANCE_SETTINGS_UPDATED_EVENT, handleAppearanceSync);
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
                <SettingsModalProvider>{children}</SettingsModalProvider>
              </ThemeProvider>
            </UsageProvider>
          </NotificationsProvider>
        </PlaybookQueryProvider>
      </AuthProvider>
    </LocalizationProvider>
  );
}

export function CombinedProvider({ children }: CombinedProviderProps) {
  return <AppProviders>{children}</AppProviders>;
}
