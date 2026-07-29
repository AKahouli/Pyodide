/**
 * RootGuard - Handles root route "/" for both authenticated and non-authenticated users
 *
 * - Shows landing page for guests
 * - Shows app layout for authenticated users
 * - Redirects to profile completion if needed
 */

import * as React from 'react';
import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

import { SidebarProvider, SidebarInset, SidebarTriggerMobile } from '@/components/ui/sidebar';
import { AppSidebar } from '@/modules/sidebar';
import { useAuth } from '../useAuth';
import { LandingPage } from './LandingPage';
import { NewConversationPage } from '@/modules/conversation';
import { useModelsStore } from '@/modules/models';
import { useConversationStream } from '@/modules/conversation/hooks/useConversationStream';
import { useConversationV2StreamConnection } from '@/modules/conversation-v2/useStream';

export function RootGuard() {
  const { isAuthenticated, isLoading, requiresEmailVerification, requiresProfileCompletion } = useAuth();
  const location = useLocation();
  const fetchModels = useModelsStore((state) => state.fetchModels);

  // Keep SSE connections alive at app level so streaming persists across
  // navigation. v2 uses its own per-user pipe (one connection for all
  // conversation-v2 sessions) so multiple conversations can stream at once.
  useConversationStream();
  useConversationV2StreamConnection();

  // Initialize models when authenticated
  React.useEffect(() => {
    if (isAuthenticated && !requiresEmailVerification && !requiresProfileCompletion) {
      fetchModels();
    }
  }, [isAuthenticated, requiresEmailVerification, requiresProfileCompletion, fetchModels]);

  // Still loading auth state - show spinner to prevent flash of wrong content
  if (isLoading) {
    return (
      <div className='flex min-h-screen items-center justify-center'>
        <Loader2 className='h-8 w-8 animate-spin text-primary' />
      </div>
    );
  }

  // Not authenticated - show landing page directly (no loading spinner for guests)
  if (!isAuthenticated) {
    return <LandingPage />;
  }

  // Email not verified - show landing page
  if (requiresEmailVerification) {
    return <LandingPage />;
  }

  // Authenticated but profile incomplete - redirect to complete profile
  if (requiresProfileCompletion) {
    return <Navigate to='/complete-profile' replace />;
  }

  // Fully authenticated - show app layout
  const isIndexRoute = location.pathname === '/';

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className='bg-transparent'>
        <header className='flex h-14 shrink-0 items-center gap-2 md:hidden'>
          <SidebarTriggerMobile />
        </header>
        <div className='flex flex-1 min-h-0 flex-col items-center  overflow-hidden'>{isIndexRoute ? <NewConversationPage /> : <Outlet />}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
