/**
 * Tab Switcher
 * Simple tab switcher for workspace sidebar (Personal / Shared)
 */

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useModuleTranslation } from '@/modules/localization';
import { cn } from '@/lib/utils';
import type { WorkspaceTab } from '../types';

interface TabSwitcherProps {
  activeTab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
}

export function TabSwitcher({ activeTab, onTabChange }: TabSwitcherProps) {
  const { t } = useModuleTranslation('workspace');

  return (
    <Tabs value={activeTab} onValueChange={(value) => onTabChange(value as WorkspaceTab)}>
      <TabsList
        className={cn(
          'w-full mb-3',
          'h-8 bg-muted/50 p-0.5',
          '[&_button]:h-7 [&_button]:text-xs [&_button]:font-medium [&_button]:shrink-0',
        )}
      >
        <TabsTrigger value='personal' className='flex-1 min-w-0 px-2'>
          <span className='truncate'>{t('sidebar.tabPersonal')}</span>
        </TabsTrigger>
        <TabsTrigger value='shared' className='flex-1 min-w-0 px-2'>
          <span className='truncate'>{t('sidebar.tabShared')}</span>
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
