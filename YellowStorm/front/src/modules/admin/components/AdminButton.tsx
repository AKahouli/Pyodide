/**
 * AdminButton - Sidebar button for admin panel access
 * Only visible to users with admin permissions
 */

import { NavLink, useLocation } from 'react-router-dom';
import { Shield } from 'lucide-react';
import {
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { useModuleTranslation } from '@/modules/localization';
import { useAdminAccess } from '../hooks';

export function AdminButton({ label }: { label?: string }) {
  const { hasAdminAccess } = useAdminAccess();
  const location = useLocation();
  const { t } = useModuleTranslation('admin');

  if (!hasAdminAccess) {
    return null;
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        tooltip={label ?? t('sidebar.admin')}
        isActive={location.pathname.startsWith('/admin')}
      >
        <NavLink to="/admin">
          <Shield />
          <span>{label ?? t('sidebar.admin')}</span>
        </NavLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
