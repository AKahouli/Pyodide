import { useEffect, useState } from 'react';
import { getNavigationSettings } from '../api';
import { DEFAULT_NAVIGATION_SETTINGS, withDefaultArabicLabels } from '../navigation';
import type { NavigationSettings } from '../types';

export function useNavigationSettings(): NavigationSettings {
  const [settings, setSettings] = useState(DEFAULT_NAVIGATION_SETTINGS);

  useEffect(() => {
    let active = true;
    getNavigationSettings()
      .then((value) => {
        if (active && value) setSettings(withDefaultArabicLabels(value));
      })
      .catch(() => undefined);
    const handleUpdate = (event: Event) => {
      if (active) setSettings(withDefaultArabicLabels((event as CustomEvent<NavigationSettings>).detail));
    };
    window.addEventListener('navigation-settings-updated', handleUpdate);
    return () => {
      active = false;
      window.removeEventListener('navigation-settings-updated', handleUpdate);
    };
  }, []);

  return settings;
}
