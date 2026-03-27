import * as React from 'react';
import { memo } from 'react';
import { User, Monitor, Shield, Laptop, Activity, BarChart3 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { DialogTitle } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import type { ModuleTranslationKey } from '@/modules/localization';
import type { SettingsSection } from '../types';

interface NavItem {
  id: SettingsSection;
  icon: React.ReactNode;
  labelKey: ModuleTranslationKey<'profile'>;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'profile', icon: <User className='h-4 w-4' />, labelKey: 'settings.nav.profile' },
  { id: 'sessions', icon: <Laptop className='h-4 w-4' />, labelKey: 'settings.nav.sessions' },
  { id: 'appearance', icon: <Monitor className='h-4 w-4' />, labelKey: 'settings.nav.appearance' },
  { id: 'data-controls', icon: <Shield className='h-4 w-4' />, labelKey: 'settings.nav.data-controls' },
  { id: 'usage', icon: <BarChart3 className='h-4 w-4' />, labelKey: 'settings.nav.usage' },
  { id: 'health', icon: <Activity className='h-4 w-4' />, labelKey: 'settings.nav.health' },
];

type SettingsSidebarProps = Readonly<{
  activeSection: SettingsSection;
  onSelect: (section: SettingsSection) => void;
}>;

export const SettingsSidebar = memo(function SettingsSidebar({ activeSection, onSelect }: SettingsSidebarProps) {
  const { t } = useModuleTranslation('profile');
  const items = React.useMemo(() => NAV_ITEMS.map((item) => ({ ...item, label: t(item.labelKey) })), [t]);

  return (
    <div className='w-14 md:w-56 border-r bg-muted/30 flex flex-col shrink-0'>
      <div className='p-3 md:p-6 md:pb-4'>
        <DialogTitle className='text-lg font-semibold hidden md:block'>{t('settings.title')}</DialogTitle>
        <DialogTitle className='md:hidden sr-only'>{t('settings.title')}</DialogTitle>
      </div>
      <Separator />
      <nav className='flex-1 p-2 md:p-3'>
        <ul className='space-y-1'>
          {items.map((item) => (
            <li key={item.id}>
              <Button variant='ghost' className={cn('w-full justify-center md:justify-start gap-3 h-10', activeSection === item.id && 'bg-accent text-accent-foreground')} onClick={() => onSelect(item.id)} title={item.label}>
                {item.icon}
                <span className='hidden md:inline'>{item.label}</span>
              </Button>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
});

SettingsSidebar.displayName = 'SettingsSidebar';
