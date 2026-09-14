import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ensureAppHomeTrailingSlash, resolveRouterBasename } from '@/lib/app-base';
import { AuthProvider, isDevPreview } from '@/lib/yellowmind-auth';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { LoginPage, RegisterPage } from '@/pages/AuthPages';
import App from '@/App';

/**
 * Deployed apps live under /apps/{sessionId}/ but React Router renders the
 * basename without the trailing slash. Restore it on every navigation so the
 * address bar always matches the Vite base.
 */
function AppUrlNormalizer() {
  const location = useLocation();
  useEffect(() => {
    ensureAppHomeTrailingSlash();
  }, [location.pathname]);
  return null;
}

function AppHomeRedirect() {
  return <Navigate to="/" replace />;
}

export function AppRouter() {
  const previewDev = isDevPreview();

  return (
    <AuthProvider>
      <BrowserRouter basename={resolveRouterBasename()}>
        <AppUrlNormalizer />
        <Routes>
          <Route
            path="/login"
            element={previewDev ? <AppHomeRedirect /> : <LoginPage />}
          />
          <Route
            path="/register"
            element={previewDev ? <AppHomeRedirect /> : <RegisterPage />}
          />
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<App />} />
            <Route path="*" element={<App />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
