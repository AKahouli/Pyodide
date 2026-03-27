/**
 * Settings Modal
 * Large modal with sidebar navigation for user settings
 * Responsive: sidebar on desktop, horizontal tabs on mobile
 */

import * as React from 'react';
import { memo, useCallback } from 'react';

import { Dialog, DialogContent } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useSettingsModal } from '../SettingsContext';
import { ProfileSection } from './ProfileSection';
import { SessionsSection } from './SessionsSection';
import { AppearanceSection } from './AppearanceSection';
import { DataControlsSection } from './DataControlsSection';
import { HealthSection } from './HealthSection';
import { UsageSection } from '@/modules/usage';
import { SettingsSidebar } from './SettingsSidebar';

export const SettingsModal = memo(function SettingsModal() {
  const { isOpen, closeSettings, activeSection, setActiveSection } = useSettingsModal();

  const renderSection = useCallback(() => {
    switch (activeSection) {
      case 'profile':
        return <ProfileSection />;
      case 'sessions':
        return <SessionsSection />;
      case 'appearance':
        return <AppearanceSection />;
      case 'data-controls':
        return <DataControlsSection />;
      case 'usage':
        return <UsageSection />;
      case 'health':
        return <HealthSection />;
      default:
        return <ProfileSection />;
    }
  }, [activeSection]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && closeSettings()}>
      <DialogContent className='w-[95vw] max-w-4xl h-[80vh] md:h-150 p-0 gap-0 overflow-hidden'>
        <div className='flex h-full'>
          <SettingsSidebar activeSection={activeSection} onSelect={setActiveSection} />

          {/* Content */}
          <div className='flex-1 min-w-0 overflow-hidden'>
            <ScrollArea className='h-[80vh] md:h-150'>
              <div className='p-4 md:p-6'>{renderSection()}</div>
            </ScrollArea>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
});

SettingsModal.displayName = 'SettingsModal';
