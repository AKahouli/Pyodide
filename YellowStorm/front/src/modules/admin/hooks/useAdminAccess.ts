/**
 * Admin access check hook
 * Determines if user has access to admin panel
 */

import { useMemo } from 'react';
import { usePermissions } from './usePermissions';
import { ADMIN_ACCESS_PERMISSIONS, ADMIN_MENU_ITEMS } from '../constants';
import type { AdminMenuItem } from '../types';

export function useAdminAccess() {
  const { hasAnyPermission } = usePermissions();

  // Check if user has access to admin panel
  const hasAdminAccess = useMemo(() => {
    return hasAnyPermission([...ADMIN_ACCESS_PERMISSIONS]);
  }, [hasAnyPermission]);

  // Get menu items user has access to
  const accessibleMenuItems = useMemo((): AdminMenuItem[] => {
    return ADMIN_MENU_ITEMS.filter((item) => hasAnyPermission(item.permissions));
  }, [hasAnyPermission]);

  return {
    hasAdminAccess,
    accessibleMenuItems,
  };
}
