import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ensureAppHomeTrailingSlash, collapseDuplicateSlashesInLocation, resolveRouterBasename } from '@/lib/app-base';
import { AuthProvider, isDevPreview } from '@/lib/yellowmind-auth';
import { ymDiag } from '@/lib/ym-diag';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { LoginPage, RegisterPage } from '@/pages/AuthPages';
import App from '@/App';

/**
 * Deployed apps live under /apps/{sessionId}/ but React Router renders the
 * basename without the trailing slash. Restore it on every navigation so the
 * address bar always matches the Vite base. Also collapse accidental `//`.
 */
function AppUrlNormalizer() {
  const location = useLocation();
  useEffect(() => {
    collapseDuplicateSlashesInLocation();
    ensureAppHomeTrailingSlash();
    ymDiag.debug('router', 'navigate', { pathname: location.pathname, search: location.search });
  }, [location.pathname, location.search]);
  return null;
}

function AppHomeRedirect() {
  return <Navigate to="/" replace />;
}

export function AppRouter() {
  const previewDev = isDevPreview();
  const basename = resolveRouterBasename();
  ymDiag.info('router', 'AppRouter mount', { previewDev, basename });

  return (
    <AuthProvider>
      <BrowserRouter basename={basename}>
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
