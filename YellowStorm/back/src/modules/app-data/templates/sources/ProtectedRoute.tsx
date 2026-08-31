import { Navigate, useLocation } from 'react-router-dom';
import { isDevPreview, useAuth } from '@/lib/yellowmind-auth';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const devPreview = isDevPreview();
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (devPreview) {
    return <>{children}</>;
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
