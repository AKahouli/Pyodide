/**
 * PermissionGuard - Per-page route guard for admin sub-routes.
 * Redirects to /admin dashboard if user lacks required permissions.
 */

import { Navigate } from 'react-router-dom';
import { usePermissions } from '../hooks/usePermissions';

interface PermissionGuardProps {
  permissions: string[];
  children: React.ReactNode;
}

export function PermissionGuard({ permissions, children }: PermissionGuardProps) {
  const { hasAnyPermission } = usePermissions();

  if (!hasAnyPermission(permissions)) {
    return <Navigate to="/admin" replace />;
  }

  return <>{children}</>;
}
