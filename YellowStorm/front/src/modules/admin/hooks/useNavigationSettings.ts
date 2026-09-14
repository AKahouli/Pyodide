import { useEffect, useState } from 'react';
import { getNavigationSettings } from '../api';
import { DEFAULT_NAVIGATION_SETTINGS } from '../navigation';
import type { NavigationSettings } from '../types';

export function useNavigationSettings(): NavigationSettings {
  const [settings, setSettings] = useState(DEFAULT_NAVIGATION_SETTINGS);

  useEffect(() => {
    let active = true;
    getNavigationSettings().then((value) => { if (active) setSettings(value); }).catch(() => undefined);
    const handleUpdate = (event: Event) => {
      if (active) setSettings((event as CustomEvent<NavigationSettings>).detail);
    };
    window.addEventListener('navigation-settings-updated', handleUpdate);
    return () => {
      active = false;
      window.removeEventListener('navigation-settings-updated', handleUpdate);
    };
  }, []);

  return settings;
}
