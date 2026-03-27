/**
 * Settings Modal Context
 * Provides a way to open/close settings modal from anywhere in the app
 */

import * as React from 'react';
import type { SettingsSection, SettingsModalContextType } from './types';

const SettingsModalContext = React.createContext<SettingsModalContextType | null>(null);

interface SettingsModalProviderProps {
  children: React.ReactNode;
}

export function SettingsModalProvider({ children }: SettingsModalProviderProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [activeSection, setActiveSection] = React.useState<SettingsSection>('profile');

  const openSettings = React.useCallback((section: SettingsSection = 'profile') => {
    setActiveSection(section);
    setIsOpen(true);
  }, []);

  const closeSettings = React.useCallback(() => {
    setIsOpen(false);
  }, []);

  const value = React.useMemo<SettingsModalContextType>(
    () => ({
      isOpen,
      activeSection,
      openSettings,
      closeSettings,
      setActiveSection,
    }),
    [isOpen, activeSection, openSettings, closeSettings]
  );

  return (
    <SettingsModalContext.Provider value={value}>
      {children}
    </SettingsModalContext.Provider>
  );
}

export function useSettingsModal() {
  const context = React.useContext(SettingsModalContext);
  if (!context) {
    throw new Error('useSettingsModal must be used within a SettingsModalProvider');
  }
  return context;
}
