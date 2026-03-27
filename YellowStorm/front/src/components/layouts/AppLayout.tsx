import { Outlet } from 'react-router-dom';
import { AppSidebar } from '@/modules/sidebar';
import { SidebarProvider, SidebarInset, SidebarTriggerMobile } from '../ui/sidebar';
import { ModeToggle } from '../mode-toggle';

export function Applayout() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className='bg-transparent'>
        <header className='flex h-14 shrink-0 items-center gap-2 px-4 md:hidden'>
          <SidebarTriggerMobile />
        </header>
        <div className='flex grow flex-col items-center justify-center px-4 md:px-16 w-full'>
          <Outlet />
        </div>
      </SidebarInset>
      <div className='hidden md:block fixed bottom-4 right-4 z-50'>
        <ModeToggle />
      </div>
    </SidebarProvider>
  );
}
