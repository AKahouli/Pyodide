import { useEffect, useContext, useState } from 'react';
import { Palette, Image, Save, Globe2 } from 'lucide-react';
import { toast } from 'sonner';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';
import { cn } from '@/lib/utils';
import { ThemeProviderContext } from '@/contexts/ThemeContext';
import { Icons } from '@/components/icons';
import { getAppearanceSettings, setAppearanceSettings } from '../api';
import { getGlobalAppearanceSettings } from '@/modules/auth/api';

type ColorTheme = 'default' | 'yellow' | 'orange' | 'blue';
type ThemeLogo = 'yellowmind' | 'kpmg';

const COLOR_THEMES: { value: ColorTheme; labelKey: string }[] = [
  { value: 'default', labelKey: 'appearance.colorTheme.default' },
   { value: 'yellow', labelKey: 'appearance.colorTheme.yellow' },
   { value: 'orange', labelKey: 'appearance.colorTheme.orange' },
   { value: 'blue', labelKey: 'appearance.colorTheme.blue' },
];

const LOGOS: { value: ThemeLogo; label: string }[] = [
  { value: 'yellowmind', label: 'Yellowmind' },
  { value: 'kpmg', label: 'KPMG' },
];

export function AppearancePage() {
  const { t } = useModuleTranslation('admin');
  const { theme, setColorTheme, setLogo } = useContext(ThemeProviderContext);
  const [selectedTheme, setSelectedTheme] = useState<ColorTheme>('default');
  const [themeLogoMap, setThemeLogoMap] = useState<Record<ColorTheme, ThemeLogo>>({
    default: 'yellowmind',
    yellow: 'yellowmind',
    orange: 'yellowmind',
    blue: 'kpmg',
  });
  const [savingTheme, setSavingTheme] = useState(false);

  useEffect(() => {
    getAppearanceSettings()
      .then((settings) => {
        setSelectedTheme(settings.defaultColorTheme);
        setThemeLogoMap(
          Object.fromEntries(
            Object.entries(settings.themes).map(([key, value]) => [key, value.logo]),
          ) as Record<ColorTheme, ThemeLogo>,
        );
      })
      .catch(() => {
        // Keep defaults if settings cannot be loaded
      });
  }, []);

  const selectedLogo = themeLogoMap[selectedTheme];
  const selectedThemePreviewLogo = selectedTheme === 'orange' || selectedTheme === 'blue' ? 'kpmg' : 'yellowmind';

  const applyThemeImmediately = (colorTheme: ColorTheme) => {
    const root = document.documentElement;
    root.classList.remove('theme-default', 'theme-yellow', 'theme-orange', 'theme-blue', 'theme-yellowsys', 'theme-claude', 'theme-kpmg');
    if (colorTheme === 'yellow') root.classList.add('theme-yellowsys');
    if (colorTheme === 'orange') root.classList.add('theme-claude');
    if (colorTheme === 'blue') root.classList.add('theme-kpmg');
  };

  const saveLogoMapping = async () => {
    setSavingTheme(true);
    try {
      const nextSettings = {
        defaultColorTheme: selectedTheme,
        themes: {
          default: { labelKey: 'appearance.colorTheme.default', logo: themeLogoMap.default },
          yellow: { labelKey: 'appearance.colorTheme.yellow', logo: themeLogoMap.yellow },
          orange: { labelKey: 'appearance.colorTheme.orange', logo: themeLogoMap.orange },
          blue: { labelKey: 'appearance.colorTheme.blue', logo: themeLogoMap.blue },
        },
      };

      await setAppearanceSettings(nextSettings);
      const refreshedSettings = await getGlobalAppearanceSettings();
      setSelectedTheme(refreshedSettings.defaultColorTheme);
      setThemeLogoMap(
        Object.fromEntries(
          Object.entries(refreshedSettings.themes).map(([key, value]) => [key, value.logo]),
        ) as Record<ColorTheme, ThemeLogo>,
      );
      toast.success(t('appearance.actions.applied'));
    } catch {
      toast.error(t('appearance.actions.applyFailed'));
    } finally {
      setSavingTheme(false);
    }
  };

  return (
    <div className='space-y-6'>
      <div>
        <h1 className='text-2xl font-bold tracking-tight'>{t('appearance.title')}</h1>
        <p className='text-muted-foreground'>{t('appearance.description')}</p>
      </div>

      <Card>
        <CardHeader>
          <div className='flex items-center gap-3'>
            <div className='flex h-10 w-10 items-center justify-center rounded-lg bg-muted'>
              <Palette className='h-5 w-5' />
            </div>
            <div>
              <CardTitle>{t('appearance.colorTheme.label')}</CardTitle>
              <CardDescription>{t('appearance.colorTheme.description')}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
            {COLOR_THEMES.map((themeOption) => (
              <button
                key={themeOption.value}
                type='button'
                onClick={() => setSelectedTheme(themeOption.value)}
                className={cn(
                  'rounded-lg border p-4 text-left transition-colors',
                  selectedTheme === themeOption.value ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40',
                )}>
                <div className='flex items-center gap-3'>
                  <div className={cn('flex h-12 w-28 items-center justify-center rounded-md border bg-background', theme === 'dark' ? 'border-white/10' : 'border-black/10')}>
                    {themeLogoMap[themeOption.value] === 'kpmg' ? (
                      <Icons.Kpmg className='max-h-8 w-auto' style={{ color: theme === 'light' ? '#2563eb' : '#ffffff' }} />
                    ) : (
                      <Icons.YellowMind className='max-h-8 w-auto' />
                    )}
                  </div>
                  <span className='font-medium'>{t(themeOption.labelKey as never)}</span>
                </div>
              </button>
            ))}
          </div>

          <div className='flex gap-3'>
            <Button
              onClick={async () => {
                setSavingTheme(true);
                try {
                  const nextSettings = {
                    defaultColorTheme: selectedTheme,
                    themes: {
                      default: { labelKey: 'appearance.colorTheme.default', logo: themeLogoMap.default },
                      yellow: { labelKey: 'appearance.colorTheme.yellow', logo: themeLogoMap.yellow },
                      orange: { labelKey: 'appearance.colorTheme.orange', logo: themeLogoMap.orange },
                      blue: { labelKey: 'appearance.colorTheme.blue', logo: themeLogoMap.blue },
                    },
                  };

                  await setAppearanceSettings(nextSettings);
                  const refreshedSettings = await getGlobalAppearanceSettings();
                  setSelectedTheme(refreshedSettings.defaultColorTheme);
                  setThemeLogoMap(
                    Object.fromEntries(
                      Object.entries(refreshedSettings.themes).map(([key, value]) => [key, value.logo]),
                    ) as Record<ColorTheme, ThemeLogo>,
                  );
                  applyThemeImmediately(nextSettings.defaultColorTheme);
                  setColorTheme(nextSettings.defaultColorTheme);
                  toast.success(t('appearance.actions.applied'));
                } catch {
                  toast.error(t('appearance.actions.applyFailed'));
                } finally {
                  setSavingTheme(false);
                }
              }}
              disabled={savingTheme}
            >
              <Globe2 className='mr-2 h-4 w-4' />
              {savingTheme ? t('appearance.actions.applying') : t('appearance.actions.applyToAll')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className='flex items-center gap-3'>
            <div className='flex h-10 w-10 items-center justify-center rounded-lg bg-muted'>
              <Image className='h-5 w-5' />
            </div>
            <div>
              <CardTitle>{t('appearance.logo.title')}</CardTitle>
              <CardDescription>{t('appearance.logo.description')}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='grid gap-3 sm:grid-cols-2'>
            {LOGOS.map((logo) => (
              <button
                key={logo.value}
                type='button'
                onClick={() => setThemeLogoMap((current) => ({ ...current, [selectedTheme]: logo.value }))}
                className={cn(
                  'rounded-lg border p-4 transition-colors',
                  selectedLogo === logo.value ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40',
                )}>
                <div className='flex items-center justify-between'>
                  <span className='font-medium'>{logo.label}</span>
                  <div className={cn('flex h-10 w-28 items-center justify-center rounded-md border bg-background', theme === 'dark' ? 'border-white/10' : 'border-black/10')}>
                    {logo.value === 'yellowmind' ? (
                      <Icons.YellowMind className='max-h-7 w-auto' />
                    ) : (
                      <Icons.Kpmg className='max-h-7 w-auto' style={{ color: theme === 'light' ? '#2563eb' : '#ffffff' }} />
                    )}
                  </div>
                  </div>
                  <p className='mt-2 text-xs text-muted-foreground'>
                    {selectedTheme} → {logo.label}
                  </p>
                </button>
            ))}
          </div>

          <div className='flex gap-3'>
              <Button variant='outline' onClick={saveLogoMapping} disabled={savingTheme}>
                <Save className='mr-2 h-4 w-4' />
                {t('appearance.actions.saveLogo')}
              </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
