import { Outlet } from 'react-router-dom';
import { AppSidebar } from '@/modules/sidebar';
import { SidebarProvider, SidebarInset, SidebarTriggerMobile } from '../ui/sidebar';

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
    </SidebarProvider>
  );
}
