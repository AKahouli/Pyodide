export { YELLOWMIND_DATA_STARTER } from './yellowmind-data.starter';
export { YELLOWMIND_AUTH_STARTER } from './yellowmind-auth.starter';
export {
  YELLOWMIND_PROTECTED_ROUTE_STARTER,
  YELLOWMIND_AUTH_PAGES_STARTER,
  YELLOWMIND_APP_ROUTER_STARTER,
} from './yellowmind-auth-ui.starter';

/** Starter file paths relative to generated app root (for Ceph starter sync). */
export const YELLOWMIND_STARTER_FILES = [
  { path: 'src/lib/yellowmind-data.ts', exportName: 'YELLOWMIND_DATA_STARTER' as const },
  { path: 'src/lib/yellowmind-auth.tsx', exportName: 'YELLOWMIND_AUTH_STARTER' as const },
  { path: 'src/components/auth/ProtectedRoute.tsx', exportName: 'YELLOWMIND_PROTECTED_ROUTE_STARTER' as const },
  { path: 'src/pages/AuthPages.tsx', exportName: 'YELLOWMIND_AUTH_PAGES_STARTER' as const },
  { path: 'src/AppRouter.tsx', exportName: 'YELLOWMIND_APP_ROUTER_STARTER' as const },
] as const;
