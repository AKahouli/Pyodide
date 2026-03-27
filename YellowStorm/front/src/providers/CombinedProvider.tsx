/**
 * Combined Provider
 * Combines all app providers into a single component to reduce nesting
 * and improve readability.
 */

import { ReactNode, useMemo } from 'react';
import { AuthProvider } from '@/modules/auth';
import { SettingsModalProvider } from '@/modules/profile';
import { UsageProvider } from '@/modules/usage';
import { NotificationsProvider } from '@/modules/notifications';
import { LocalizationProvider } from '@/modules/localization';
import { ThemeProvider } from '@/contexts/ThemeContext';

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
  const Provider = useMemo(
    () =>
      function ProviderComponent({ children: providerChildren }: { children: ReactNode }) {
        return (
          <LocalizationProvider>
            <AuthProvider>
              <NotificationsProvider>
                <UsageProvider>
                  <ThemeProvider>
                    <SettingsModalProvider>{providerChildren}</SettingsModalProvider>
                  </ThemeProvider>
                </UsageProvider>
              </NotificationsProvider>
            </AuthProvider>
          </LocalizationProvider>
        );
      },
    [],
  );

  return <Provider>{children}</Provider>;
}
