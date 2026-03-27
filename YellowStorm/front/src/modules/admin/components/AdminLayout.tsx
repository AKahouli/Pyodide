/**
 * AdminLayout - Main layout for admin pages
 * Wraps admin pages with SidebarProvider and AdminSidebar
 */

import { Outlet } from 'react-router-dom';
import { SidebarProvider, SidebarInset, SidebarTriggerMobile } from '@/components/ui/sidebar';
import { ModeToggle } from '@/components/mode-toggle';
import { useModuleTranslation } from '@/modules/localization';
import { AdminSidebar } from './AdminSidebar';

export function AdminLayout() {
  const { t } = useModuleTranslation('admin');
  return (
    <div className="h-screen w-screen">
      <SidebarProvider>
        <AdminSidebar />
        <SidebarInset className="bg-transparent ">
          <header className="flex h-14 shrink-0 items-center gap-2 px-4 md:hidden">
            <SidebarTriggerMobile />
            <span className="font-medium">{t('layout.header')}</span>
          </header>
          <div className="flex flex-1 min-h-0 flex-col px-4 md:px-8 py-4 overflow-auto">
            <Outlet />
          </div>
        </SidebarInset>
        <div className="hidden md:block fixed bottom-4 right-4 z-50">
          <ModeToggle />
        </div>
      </SidebarProvider>
    </div>
  );
}
