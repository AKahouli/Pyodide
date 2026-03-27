/**
 * AdminGuard - Route protection for admin routes
 * Redirects unauthorized users to the home page
 */

import { Navigate, Outlet } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/modules/auth';
import { useAdminAccess } from '../hooks';

export function AdminGuard() {
  const { isAuthenticated, isLoading } = useAuth();
  const { hasAdminAccess } = useAdminAccess();

  // Show loading while checking auth state
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Redirect if not authenticated or no admin access
  if (!isAuthenticated || !hasAdminAccess) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
