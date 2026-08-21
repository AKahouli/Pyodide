import { useEffect } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { resolveAppHomeHref, resolveRouterBasename } from '@/lib/app-base';
import { AuthProvider, isDevPreview } from '@/lib/yellowmind-auth';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { LoginPage, RegisterPage } from '@/pages/AuthPages';
import App from '@/App';

/** Hard redirect to Vite base (with trailing slash) — RR navigate('/') drops it. */
function AppHomeRedirect() {
  useEffect(() => {
    window.location.replace(resolveAppHomeHref());
  }, []);
  return null;
}

export function AppRouter() {
  const previewDev = isDevPreview();

  return (
    <AuthProvider>
      <BrowserRouter basename={resolveRouterBasename()}>
        <Routes>
          <Route
            path="/login"
            element={previewDev ? <AppHomeRedirect /> : <LoginPage />}
          />
          <Route
            path="/register"
            element={previewDev ? <AppHomeRedirect /> : <RegisterPage />}
          />
          <Route
            path="/*"
            element={
              <ProtectedRoute>
                <App />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<AppHomeRedirect />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
