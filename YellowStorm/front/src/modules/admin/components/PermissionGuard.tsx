/**
 * PermissionGuard - Per-page route guard for admin sub-routes.
 * Redirects to /admin dashboard if user lacks required permissions.
 */

import { Navigate } from 'react-router-dom';
import { usePermissions } from '../hooks/usePermissions';

interface PermissionGuardProps {
  permissions: string[];
  children: React.ReactNode;
  fallbackPath?: string;
}

export function PermissionGuard({ permissions, children, fallbackPath = '/admin' }: PermissionGuardProps) {
  const { hasAnyPermission } = usePermissions();

  if (!hasAnyPermission(permissions)) {
    return <Navigate to={fallbackPath} replace />;
  }

  return <>{children}</>;
}
