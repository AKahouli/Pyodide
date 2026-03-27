/**
 * AdminSidebar - Navigation sidebar for admin panel
 */

import { NavLink, useLocation } from 'react-router-dom';
import { ArrowLeft, LayoutDashboard } from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';
import { useAdminAccess } from '../hooks';

export function AdminSidebar() {
  const location = useLocation();
  const { accessibleMenuItems } = useAdminAccess();
  const { t } = useModuleTranslation('admin');

  return (
    <Sidebar collapsible="icon"  >
      <SidebarHeader className="pt-8 gap-4">
        <NavLink to="/">
          <Button
            variant="outline"
            className="w-full rounded-full h-8 group-data-[collapsible=icon]:w-12 border-none cursor-pointer flex flex-row justify-start"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="group-data-[collapsible=icon]:hidden">{t('sidebar.back')}</span>
          </Button>
        </NavLink>
      </SidebarHeader>

      <SidebarContent className="my-3 w-full px-2 overflow-hidden">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={location.pathname === '/admin'}
              tooltip={t('sidebar.dashboard')}
            >
              <NavLink to="/admin">
                <LayoutDashboard className="h-4 w-4" />
                <span className="group-data-[collapsible=icon]:hidden">{t('sidebar.dashboard')}</span>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>

          {accessibleMenuItems.map((item) => (
            <SidebarMenuItem key={item.id}>
              <SidebarMenuButton
                asChild
                isActive={location.pathname === item.path}
                tooltip={t(item.labelKey)}
              >
                <NavLink to={item.path}>
                  <item.icon className="h-4 w-4" />
                  <span className="group-data-[collapsible=icon]:hidden">{t(item.labelKey)}</span>
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarContent>

      <SidebarFooter className="flex flex-row items-center justify-end transition-all duration-200 ease-linear group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:gap-2 group-data-[collapsible=icon]:py-3">
        <div className="transition-transform duration-200 ease-linear">
          <SidebarTrigger />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
