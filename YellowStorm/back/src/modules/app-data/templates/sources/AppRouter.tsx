import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { resolveRouterBasename } from '@/lib/app-base';
import { AuthProvider, isDevPreview } from '@/lib/yellowmind-auth';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { LoginPage, RegisterPage } from '@/pages/AuthPages';
import App from '@/App';

export function AppRouter() {
  const previewDev = isDevPreview();

  return (
    <AuthProvider>
      <BrowserRouter basename={resolveRouterBasename()}>
        <Routes>
          <Route
            path="/login"
            element={previewDev ? <Navigate to="/" replace /> : <LoginPage />}
          />
          <Route
            path="/register"
            element={previewDev ? <Navigate to="/" replace /> : <RegisterPage />}
          />
          <Route
            path="/*"
            element={
              <ProtectedRoute>
                <App />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
