import { useContext, useEffect, useState, type KeyboardEvent } from 'react';
import { Globe2, Image, Palette } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { COLOR_THEMES, ThemeProviderContext, type ColorTheme } from '@/contexts/ThemeContext';
import { parseApiError } from '@/lib/api-error';
import { showError, showSuccess } from '@/lib/notifications';
import { useAuth } from '@/modules/auth/useAuth';
import { getGlobalAppearanceSettings } from '@/modules/auth/api';
import { useModuleTranslation } from '@/modules/localization';
import type { ModuleTranslationKey } from '@/modules/localization';
import { getAppearanceSettings, setAppearanceSettings } from '../api';
import type { AppearanceLogo, AppearanceSettings } from '../types';
import { ColorThemeCard } from '../appearance/ColorThemeCard';
import { LogoLibrarySection } from '../appearance/LogoLibrarySection';
import { DEFAULT_LOGO_MAP, FALLBACK_LOGOS } from '../appearance/constants';
import {
  appearanceLogoSrc,
  buildAppearanceSettings,
  logoMapForAllThemes,
  logosFromSettings,
  mapFromSettings,
  notifyAppearanceSettingsUpdated,
  replaceMissingLogos,
} from '../appearance/utils';

export function AppearancePage() {
  const { t } = useModuleTranslation('admin');
  const { refreshUser } = useAuth();
  const { setColorTheme, setLogo } = useContext(ThemeProviderContext);
  const [selectedTheme, setSelectedTheme] = useState<ColorTheme>('default');
  const [savedTheme, setSavedTheme] = useState<ColorTheme>('default');
  const [themeLogoMap, setThemeLogoMap] = useState<Record<ColorTheme, string>>(DEFAULT_LOGO_MAP);
  const [logos, setLogos] = useState<AppearanceLogo[]>(FALLBACK_LOGOS);
  const [saving, setSaving] = useState(false);
  const [assigningLogo, setAssigningLogo] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getAppearanceSettings()
      .then((settings) => {
        if (cancelled) return;
        applySettings(settings);
      })
      .catch(() => {
        if (!cancelled) showError(t('appearance.actions.loadFailed'));
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  const applySettings = (settings: AppearanceSettings) => {
    const nextLogos = logosFromSettings(settings);
    const nextMap = mapFromSettings(settings);
    setSelectedTheme(settings.defaultColorTheme);
    setSavedTheme(settings.defaultColorTheme);
    setThemeLogoMap(nextMap);
    setLogos(nextLogos);
  };

  const hasUnsavedTheme = selectedTheme !== savedTheme;

  const persistAppearance = async () => {
    setSaving(true);
    try {
      const nextSettings = buildAppearanceSettings(selectedTheme, themeLogoMap, logos);
      await setAppearanceSettings(nextSettings);
      const refreshedSettings = await getGlobalAppearanceSettings();
      applySettings(refreshedSettings);
      setColorTheme(refreshedSettings.defaultColorTheme);
      try {
        await refreshUser();
      } catch {
        // Keep the live theme even if /me is unavailable.
      }
      notifyAppearanceSettingsUpdated();
      showSuccess(t('appearance.actions.applied'));
    } catch (error) {
      showError(parseApiError(error).message || t('appearance.actions.applyFailed'));
    } finally {
      setSaving(false);
    }
  };

  const persistAssignedLogo = async (logoId: string, catalog: AppearanceLogo[], notifyUser: boolean) => {
    if (assigningLogo || themeLogoMap[savedTheme] === logoId) {
      return;
    }
    const nextMap = logoMapForAllThemes(logoId);
    const entry = catalog.find((item) => item.id === logoId);
    setAssigningLogo(true);
    setThemeLogoMap(nextMap);
    setLogo({ id: logoId, url: entry ? appearanceLogoSrc(entry) : undefined });
    try {
      await setAppearanceSettings(buildAppearanceSettings(savedTheme, nextMap, catalog));
      const refreshedSettings = await getGlobalAppearanceSettings();
      applySettings(refreshedSettings);
      notifyAppearanceSettingsUpdated();
      if (notifyUser) {
        showSuccess(t('appearance.logo.applied'));
      }
    } catch (error) {
      showError(parseApiError(error).message || t('appearance.logo.applyFailed'));
      getAppearanceSettings().then(applySettings).catch(() => undefined);
    } finally {
      setAssigningLogo(false);
    }
  };

  const handleLogosChange = (nextLogos: AppearanceLogo[], assignId?: string) => {
    setLogos(nextLogos);
    const validIds = new Set(nextLogos.map((logo) => logo.id));
    if (!validIds.has(themeLogoMap[savedTheme])) {
      setLogo({ id: 'yellowmind' });
    }
    setThemeLogoMap((current) => replaceMissingLogos(current, validIds));
    if (assignId) {
      void persistAssignedLogo(assignId, nextLogos, false);
      return;
    }
    notifyAppearanceSettingsUpdated();
  };

  const onThemeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = COLOR_THEMES.findIndex((theme) => theme.value === selectedTheme);
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedTheme(COLOR_THEMES[(index + 1) % COLOR_THEMES.length].value);
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedTheme(COLOR_THEMES[(index - 1 + COLOR_THEMES.length) % COLOR_THEMES.length].value);
    }
  };

  return (
    <div className='space-y-6'>
      <div>
        <h1 className='text-2xl font-semibold tracking-tight'>{t('appearance.title')}</h1>
        <p className='text-sm text-muted-foreground'>{t('appearance.description')}</p>
      </div>

      <Card>
        <CardHeader>
          <div className='flex items-start gap-3'>
            <div className='flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary'>
              <Palette className='h-5 w-5' />
            </div>
            <div className='space-y-1'>
              <CardTitle>{t('appearance.colorTheme.label')}</CardTitle>
              <CardDescription>{t('appearance.colorTheme.description')}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className='space-y-5'>
          <div
            role='radiogroup'
            aria-label={t('appearance.colorTheme.label')}
            onKeyDown={onThemeKeyDown}
            className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>
            {COLOR_THEMES.map((themeOption) => (
              <ColorThemeCard
                key={themeOption.value}
                value={themeOption.value}
                label={t(themeOption.labelKey as ModuleTranslationKey<'admin'>)}
                selected={selectedTheme === themeOption.value}
                isActive={savedTheme === themeOption.value}
                activeLabel={t('appearance.colorTheme.active')}
                onSelect={setSelectedTheme}
              />
            ))}
          </div>
          <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
            <p className='text-sm text-muted-foreground'>
              {hasUnsavedTheme ? t('appearance.colorTheme.applyHint') : t('appearance.colorTheme.alreadyApplied')}
            </p>
            <Button onClick={() => void persistAppearance()} disabled={saving || !hasUnsavedTheme} className='sm:w-auto'>
              <Globe2 className='mr-2 h-4 w-4' />
              {saving ? t('appearance.actions.applying') : t('appearance.actions.applyToAll')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className='flex items-start gap-3'>
            <div className='flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary'>
              <Image className='h-5 w-5' />
            </div>
            <div className='space-y-1'>
              <CardTitle>{t('appearance.logo.title')}</CardTitle>
              <CardDescription>{t('appearance.logo.description')}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <LogoLibrarySection
            logos={logos}
            selectedLogoId={themeLogoMap[savedTheme]}
            assigning={assigningLogo}
            onSelectLogo={(logoId) => void persistAssignedLogo(logoId, logos, true)}
            onLogosChange={handleLogosChange}
          />
        </CardContent>
      </Card>
    </div>
  );
}
