/**
 * RootGuard - Handles root route "/" for both authenticated and non-authenticated users
 *
 * - Shows landing page for guests
 * - Shows app layout for authenticated users
 * - Redirects to profile completion if needed
 * - Shows a full-screen pending-approval page until Super Admin validation
 */

import * as React from 'react';
import { matchPath, Outlet, Navigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

import { SidebarProvider, SidebarInset, SidebarTriggerMobile } from '@/components/ui/sidebar';
import { AppSidebar } from '@/modules/sidebar';
import { useAuth } from '../useAuth';
import { LandingPage } from './LandingPage';
import { PendingApprovalPage } from './PendingApprovalPage';
import { NewConversationPage } from '@/modules/conversation';
import { useModelsStore } from '@/modules/models';
import { useConversationStream } from '@/modules/conversation/hooks/useConversationStream';
import { useConversationV2StreamConnection } from '@/modules/conversation-v2/useStream';
import { usePlaybookStreamGlobal } from '@/modules/playbook/services/playbookStreamService';
import { DEFAULT_FEATURE_VISIBILITY, getFeatureVisibility } from '@/modules/admin';
import { usePermissions } from '@/modules/admin/hooks/usePermissions';
import { PlatformCopilotMascot } from '@/modules/platform-copilot';
import { isPendingAdminApproval } from '../utils/isPendingAdminApproval';
import { useFeatureVisibilityStore } from '@/modules/admin/featureVisibilityStore';

export function RootGuard() {
  const {
    isAuthenticated,
    isLoading,
    logout,
    requiresEmailVerification,
    requiresProfileCompletion,
    user,
  } = useAuth();
  const location = useLocation();
  const fetchModels = useModelsStore((state) => state.fetchModels);
  const pendingApproval = isPendingAdminApproval(user);
  const { canUseFeature } = usePermissions();
  const [platformCopilotEnabled, setPlatformCopilotEnabled] = React.useState(
    DEFAULT_FEATURE_VISIBILITY.platformCopilot,
  );
  const setFeatureVisibility = useFeatureVisibilityStore((state) => state.setVisibility);

  const wasPendingRef = React.useRef(pendingApproval);
  const [justApproved, setJustApproved] = React.useState(false);
  const approvedTimerRef = React.useRef<number | undefined>(undefined);

  React.useLayoutEffect(() => {
    const wasPending = wasPendingRef.current;
    wasPendingRef.current = pendingApproval;

    if (wasPending && !pendingApproval && user?.status !== 'inactive') {
      // Approval picked up by polling. Show the completed step-3 state briefly
      // before revealing the app shell, so the status updates without a refresh.
      setJustApproved(true);
      if (approvedTimerRef.current !== undefined) {
        window.clearTimeout(approvedTimerRef.current);
      }
      approvedTimerRef.current = window.setTimeout(() => {
        setJustApproved(false);
        approvedTimerRef.current = undefined;
      }, 2500);
    } else if (pendingApproval) {
      setJustApproved(false);
    }

    return () => {
      if (approvedTimerRef.current !== undefined) {
        window.clearTimeout(approvedTimerRef.current);
        approvedTimerRef.current = undefined;
      }
    };
  }, [pendingApproval, user?.status]);

  // Keep SSE connections alive at app level so streaming persists across
  // navigation. v2 uses its own per-user pipe (one connection for all
  // conversation-v2 sessions) so multiple conversations can stream at once.
  useConversationStream();
  useConversationV2StreamConnection();
  // Playbook execution events drive live canvas step statuses during runs.
  usePlaybookStreamGlobal(isAuthenticated);

  // Initialize models when authenticated
  React.useEffect(() => {
    if (isAuthenticated && !requiresEmailVerification && !requiresProfileCompletion && !pendingApproval && !justApproved) {
      fetchModels();
    }
  }, [isAuthenticated, requiresEmailVerification, requiresProfileCompletion, pendingApproval, justApproved, fetchModels]);

  React.useEffect(() => {
    if (!isAuthenticated || requiresEmailVerification || requiresProfileCompletion || pendingApproval || justApproved) {
      setPlatformCopilotEnabled(false);
      return;
    }
    let active = true;
    void getFeatureVisibility()
      .then((visibility) => {
        if (active) {
          setPlatformCopilotEnabled(visibility.platformCopilot);
          setFeatureVisibility(visibility);
        }
      })
      .catch(() => {
        if (active) setPlatformCopilotEnabled(false);
      });
    return () => { active = false; };
  }, [isAuthenticated, requiresEmailVerification, requiresProfileCompletion, pendingApproval, justApproved, setFeatureVisibility]);

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

  if (pendingApproval || justApproved) {
    const status = justApproved
      ? 'approved'
      : user?.registrationApproval === 'rejected'
        ? 'rejected'
        : 'pending';

    return (
      <PendingApprovalPage
        onLogout={() => void logout()}
        status={status}
      />
    );
  }

  // Fully authenticated - show app layout
  const isIndexRoute = location.pathname === '/';

  // Hide the floating Second Brain mascot inside a Worky stream workspace
  // (`/worky/:streamId`): it floats over the stream chat. It stays visible on
  // the Worky dashboard (`/worky`), the stream report (`/worky/:id/report`) and
  // everywhere else.
  const isWorkyStreamRoute = Boolean(
    matchPath({ path: '/worky/:streamId', end: true }, location.pathname),
  );

  // Restore the persisted sidebar state before first paint to avoid a visible flip.
  const sidebarOpen =
    typeof document === 'undefined' || !/(?:^|;\s*)sidebar_state=false(?:;|$)/.test(document.cookie);

  return (
    <SidebarProvider defaultOpen={sidebarOpen}>
      <AppSidebar />
      <SidebarInset className='bg-transparent'>
        <header className='flex h-14 shrink-0 items-center gap-2 md:hidden'>
          <SidebarTriggerMobile />
        </header>
        <div className='flex flex-1 min-h-0 flex-col items-center  overflow-hidden'>{isIndexRoute ? <NewConversationPage /> : <Outlet />}</div>
      </SidebarInset>
      {platformCopilotEnabled && canUseFeature('platformCopilot') && !isWorkyStreamRoute && <PlatformCopilotMascot />}
    </SidebarProvider>
  );
}
