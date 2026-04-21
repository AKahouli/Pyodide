import { useContext, useState } from 'react';
import { Palette, Image, Save, Globe2 } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';
import { cn } from '@/lib/utils';
import { ThemeProviderContext } from '@/contexts/ThemeContext';
import { Icons } from '@/components/icons';

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
  const { theme } = useContext(ThemeProviderContext);
  const [selectedTheme, setSelectedTheme] = useState<ColorTheme>('default');
  const [themeLogoMap, setThemeLogoMap] = useState<Record<ColorTheme, ThemeLogo>>({
    default: 'yellowmind',
    yellow: 'yellowmind',
    orange: 'kpmg',
    blue: 'kpmg',
  });

  const selectedLogo = themeLogoMap[selectedTheme];

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
            {COLOR_THEMES.map((theme) => (
              <button
                key={theme.value}
                type='button'
                onClick={() => setSelectedTheme(theme.value)}
                className={cn(
                  'rounded-lg border p-4 text-left transition-colors',
                  selectedTheme === theme.value ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40',
                )}>
                <div className='flex items-center gap-3'>
                  <div className={cn('flex h-12 w-28 items-center justify-center rounded-md border bg-background', theme === 'dark' ? 'border-white/10' : 'border-black/10')}>
                    {theme.value === 'blue' ? (
                      <Icons.Kpmg className='max-h-8 w-auto' style={{ color: theme === 'light' ? '#2563eb' : '#ffffff' }} />
                    ) : (
                      <Icons.YellowMind className='max-h-8 w-auto' />
                    )}
                  </div>
                  <span className='font-medium'>{t(theme.labelKey as never)}</span>
                </div>
              </button>
            ))}
          </div>

          <div className='flex gap-3'>
            <Button>
              <Globe2 className='mr-2 h-4 w-4' />
              {t('appearance.actions.applyToAll')}
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
            <Button variant='outline'>
              <Save className='mr-2 h-4 w-4' />
              {t('appearance.actions.saveLogo')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
