/**
 * Appearance Section
 * Theme and visual settings
 */

import * as React from 'react';
import { Moon, Sun, Monitor, Palette, Languages } from 'lucide-react';

import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { ThemeProviderContext, COLOR_THEMES, type ColorTheme } from '@/contexts/ThemeContext';
import { useLocalization, useModuleTranslation } from '@/modules/localization';
import type { Language, ModuleTranslationKey } from '@/modules/localization';

type ThemeOption = 'light' | 'dark' | 'system';

interface ThemeCardProps {
  label: string;
  icon: React.ReactNode;
  selected: boolean;
  onClick: () => void;
}

function ThemeCard({ label, icon, selected, onClick }: ThemeCardProps) {
  return (
    <button type='button' onClick={onClick} className={cn('flex flex-col items-center gap-3 p-4 rounded-lg border-2 transition-colors', 'hover:bg-accent hover:border-accent-foreground/20', selected ? 'border-primary bg-primary/5' : 'border-border bg-background')}>
      <div className={cn('flex items-center justify-center w-12 h-12 rounded-full', selected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>{icon}</div>
      <span className={cn('text-sm font-medium', selected && 'text-primary')}>{label}</span>
    </button>
  );
}

const COLOR_THEME_SWATCHES: Record<ColorTheme, string> = {
  default: 'bg-neutral-500',
  yellowsys: 'bg-amber-500',
  claude: 'bg-orange-700',
  kpmg: 'bg-blue-600',
};

interface ColorThemeCardProps {
  label: string;
  value: ColorTheme;
  selected: boolean;
  onClick: () => void;
}

function ColorThemeCard({ label, value, selected, onClick }: ColorThemeCardProps) {
  return (
    <button type='button' onClick={onClick} className={cn('flex flex-col items-center gap-3 p-4 rounded-lg border-2 transition-colors', 'hover:bg-accent hover:border-accent-foreground/20', selected ? 'border-primary bg-primary/5' : 'border-border bg-background')}>
      <div className={cn('w-12 h-12 rounded-full', COLOR_THEME_SWATCHES[value])} />
      <span className={cn('text-sm font-medium', selected && 'text-primary')}>{label}</span>
    </button>
  );
}

const LANGUAGE_KEYS: Record<Language, ModuleTranslationKey<'profile'>> = {
  en: 'appearance.language.options.en',
  fr: 'appearance.language.options.fr',
};

export function AppearanceSection() {
  const { theme, setTheme, colorTheme, setColorTheme } = React.useContext(ThemeProviderContext);
  const { language, availableLanguages, changeLanguage } = useLocalization();
  const { t } = useModuleTranslation('profile');

  const themeOptions: { value: ThemeOption; label: string; icon: React.ReactNode }[] = [
    { value: 'light', label: t('appearance.theme.light'), icon: <Sun className='h-5 w-5' /> },
    { value: 'dark', label: t('appearance.theme.dark'), icon: <Moon className='h-5 w-5' /> },
    { value: 'system', label: t('appearance.theme.system'), icon: <Monitor className='h-5 w-5' /> },
  ];

  const colorThemeLabels: Record<ColorTheme, string> = {
    default: t('appearance.colorTheme.default'),
    yellowsys: t('appearance.colorTheme.yellowsys'),
    claude: t('appearance.colorTheme.claude'),
    kpmg: t('appearance.colorTheme.kpmg'),
  };

  const languageLabel = (code: Language) => t(LANGUAGE_KEYS[code]);

  return (
    <div className='space-y-6'>
      <div>
        <h2 className='text-xl font-semibold'>{t('appearance.title')}</h2>
        <p className='text-sm text-muted-foreground'>{t('appearance.description')}</p>
      </div>

      <Separator />

      <div className='space-y-4'>
        <div className='flex items-center gap-2'>
          <Languages className='h-4 w-4 text-muted-foreground' />
          <Label className='text-base'>{t('appearance.language.title')}</Label>
        </div>
        <p className='text-sm text-muted-foreground'>{t('appearance.language.description')}</p>

        <Select value={language} onValueChange={(value) => changeLanguage(value as Language)}>
          <SelectTrigger className='w-full md:w-64'>
            <SelectValue placeholder={t('appearance.language.placeholder')}>{languageLabel(language)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {availableLanguages.map((lng) => (
              <SelectItem key={lng} value={lng}>
                {languageLabel(lng as Language)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Separator />

      <div className='space-y-4'>
        <Label className='text-base'>{t('appearance.modeLabel')}</Label>
        <p className='text-sm text-muted-foreground'>{t('appearance.modeDescription')}</p>

        <div className='grid grid-cols-3 gap-4 pt-2'>
          {themeOptions.map((option) => (
            <ThemeCard key={option.value} label={option.label} icon={option.icon} selected={theme === option.value} onClick={() => setTheme(option.value)} />
          ))}
        </div>
      </div>

      <Separator />

      <div className='space-y-4'>
        <div className='flex items-center gap-2'>
          <Palette className='h-4 w-4 text-muted-foreground' />
          <Label className='text-base'>{t('appearance.colorTheme.label')}</Label>
        </div>
        <p className='text-sm text-muted-foreground'>{t('appearance.colorTheme.description')}</p>

        <div className='grid grid-cols-3 gap-4 pt-2'>
          {COLOR_THEMES.map((ct) => (
            <ColorThemeCard key={ct.value} value={ct.value} label={colorThemeLabels[ct.value]} selected={colorTheme === ct.value} onClick={() => setColorTheme(ct.value)} />
          ))}
        </div>
      </div>

      <Separator />

      <div className='rounded-lg border bg-muted/50 p-4'>
        <p className='text-sm text-muted-foreground'>
          <strong>{t('appearance.tipLabel')}:</strong> {t('appearance.tip')}
        </p>
      </div>
    </div>
  );
}
