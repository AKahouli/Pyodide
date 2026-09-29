import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { isDevPreview, useAuth } from '@/lib/yellowmind-auth';

/** Layout route: renders <Outlet /> when authenticated (or in Nodepod dev preview). */
export function ProtectedRoute() {
  const devPreview = isDevPreview();
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (devPreview) {
    return <Outlet />;
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!user) {
    const search = location.search;
    return <Navigate to={`/login${search}`} replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
