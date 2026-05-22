import React, { Suspense } from 'react';
import { createHashRouter } from 'react-router-dom';

import NoMatch from './pages/NoMatch';
import MaintenancePage from './pages/MaintenancePage';
import { SharedConversationPage } from './pages/SharedConversationPage';
import { ConversationPage } from './modules/conversation';
import { ConversationV2Page, ConversationV2SessionPage, SharedConversationV2Page } from './modules/conversation-v2';
import { EmailVerificationPage, ResetPasswordPage, ProfileCompletionPage } from './modules/auth';
import { OAuthCallbackPage } from './modules/auth/components/OAuthCallbackPage';
import { UpgradePage } from './modules/usage';
import { RootGuard } from './modules/auth/components/RootGuard';

// Lazy-loaded connected apps
const ConnectedAppsPage = React.lazy(() => import('./modules/connected-app/components/ConnectedAppsPage').then((m) => ({ default: m.ConnectedAppsPage })));

// Lazy-loaded playbook routes
const PlaybookListPage = React.lazy(() =>
  import("./modules/playbook/components/PlaybookListPage").then((m) => ({ default: m.PlaybookListPage }))
);
const PlaybookCanvasPage = React.lazy(() =>
  import("./modules/playbook/components/PlaybookCanvasPage").then((m) => ({ default: m.PlaybookCanvasPage }))
);
const PlaybookExecutionPage = React.lazy(() =>
  import("./modules/playbook/components/PlaybookExecutionPage").then((m) => ({ default: m.PlaybookExecutionPage }))
);
const PlaybookExecutionListPage = React.lazy(() =>
  import("./modules/playbook/components/PlaybookExecutionListPage").then((m) => ({ default: m.PlaybookExecutionListPage }))
);
const PlaybookExecutionComparePage = React.lazy(() =>
  import("./modules/playbook/components/PlaybookExecutionComparePage").then((m) => ({ default: m.PlaybookExecutionComparePage }))
);
const AgentHubPage = React.lazy(() =>
  import("./modules/agent/components/AgentHubPage").then((m) => ({ default: m.AgentHubPage }))
);
const ProjectPage = React.lazy(() =>
  import("./modules/project").then((m) => ({ default: m.ProjectPage }))
);
const ClassifierPage = React.lazy(() =>
  import("./modules/classifier").then((m) => ({ default: m.ClassifierPage }))
);
import {
  AdminGuard,
  AdminLayout,
  AdminDashboard,
  AppearancePage,
  UsersPage,
  RolesPage,
  AuditLogsPage,
  LogsPage,
  PlansPage,
  AnalyticsPage,
  SystemPage,
  ReportsPage,
  ModelsPage,
  ToolsPage,
  SkillsPage,
  ConnectorsPage,
  AgentTypesPage,
  DefaultAgentsPage,
  PlaybookPromptsPage,
  PlaybookSettingsPage,
  PermissionGuard,
  AuthProvidersPage,
  ConnectedAppsAdminPage,
} from "./modules/admin";

function RouteErrorFallback() {
  return (
    <div className='flex min-h-screen items-center justify-center bg-neutral-950'>
      <div className='text-center space-y-4'>
        <h1 className='text-2xl font-bold text-white'>Something went wrong</h1>
        <p className='text-neutral-400'>An unexpected error occurred.</p>
        <a href='/#/' className='inline-block px-4 py-2 bg-primary text-primary-foreground rounded-md'>
          Go to Home
        </a>
      </div>
    </div>
  );
}

export const router = createHashRouter([
  // Root route - shows landing or app based on auth state
  {
    path: '/',
    element: <RootGuard />,
    children: [
      // These will be rendered inside RootGuard based on auth state
      {
        index: true,
        element: null, // RootGuard handles this
      },
      {
        path: 'conversation/:id',
        element: <ConversationPage />,
      },
      {
        path: 'conversation-v2',
        element: <ConversationV2Page />,
      },
      {
        path: 'conversation-v2/:sessionId',
        element: <ConversationV2SessionPage />,
      },
      {
        path: 'apps',
        element: (
          <Suspense fallback={null}>
            <ConnectedAppsPage />
          </Suspense>
        ),
      },
      {
        path: 'playbooks',
        element: (
          <Suspense fallback={null}>
            <PlaybookListPage />
          </Suspense>
        ),
      },
      {
        path: 'playbooks/:id',
        element: (
          <Suspense fallback={null}>
            <PlaybookCanvasPage />
          </Suspense>
        ),
      },
      {
        path: 'playbooks/:id/executions',
        element: (
          <Suspense fallback={null}>
            <PlaybookExecutionListPage />
          </Suspense>
        ),
      },
      {
        path: 'playbooks/:id/executions/compare',
        element: (
          <Suspense fallback={null}>
            <PlaybookExecutionComparePage />
          </Suspense>
        ),
      },
      {
        path: 'playbooks/:id/executions/:executionId',
        element: (
          <Suspense fallback={null}>
            <PlaybookExecutionPage />
          </Suspense>
        ),
      },
      {
        path: 'agents',
        element: (
          <Suspense fallback={null}>
            <AgentHubPage />
          </Suspense>
        ),
      },
      {
        path: 'projet/:id',
        element: (
          <Suspense fallback={null}>
            <ProjectPage />
          </Suspense>
        ),
      },
      {
        path: 'classifier',
        element: (
          <Suspense fallback={null}>
            <ClassifierPage />
          </Suspense>
        ),
      },
    ],
  },
  {
    path: 'upgrade',
    element: <UpgradePage />,
  },
  // Admin routes - protected by AdminGuard
  {
    path: '/admin',
    element: <AdminGuard />,
    children: [
      {
        element: <AdminLayout />,
        children: [
          { index: true, element: <AdminDashboard /> },
          { path: 'appearance', element: <AppearancePage /> },
          { path: "users", element: <UsersPage /> },
          { path: "roles", element: <RolesPage /> },
          { path: "audit", element: <AuditLogsPage /> },
          { path: "logs", element: <LogsPage /> },
          { path: "plans", element: <PlansPage /> },
          { path: "reports", element: <ReportsPage /> },
          { path: "models", element: <ModelsPage /> },
          { path: "tools", element: <ToolsPage /> },
          { path: "skills", element: <SkillsPage /> },
          { path: "connectors", element: <ConnectorsPage /> },
          { path: "agent-types", element: <AgentTypesPage /> },
          { path: "agents", element: <DefaultAgentsPage /> },
          { path: "playbook-prompts", element: <PlaybookPromptsPage /> },
          { path: "analytics", element: <AnalyticsPage /> },
          { path: "system", element: <SystemPage /> },
          {
            path: 'playbook-settings',
            element: (
              <PermissionGuard permissions={['system.maintenance', 'system.*', '*']}>
                <PlaybookSettingsPage />
              </PermissionGuard>
            ),
          },
          {
            path: 'users',
            element: (
              <PermissionGuard permissions={['users.read', 'users.*', '*']}>
                <UsersPage />
              </PermissionGuard>
            ),
          },
          {
            path: 'roles',
            element: (
              <PermissionGuard permissions={['admin.roles.read', 'admin.*', '*']}>
                <RolesPage />
              </PermissionGuard>
            ),
          },
          {
            path: 'audit',
            element: (
              <PermissionGuard permissions={['admin.audit.read', 'admin.*', '*']}>
                <AuditLogsPage />
              </PermissionGuard>
            ),
          },
          {
            path: 'logs',
            element: (
              <PermissionGuard permissions={['admin.logs.read', 'admin.*', '*']}>
                <LogsPage />
              </PermissionGuard>
            ),
          },
          {
            path: 'plans',
            element: (
              <PermissionGuard permissions={['plans.read_all', 'plans.*', '*']}>
                <PlansPage />
              </PermissionGuard>
            ),
          },
          {
            path: 'reports',
            element: (
              <PermissionGuard permissions={['reports.read', 'reports.*', '*']}>
                <ReportsPage />
              </PermissionGuard>
            ),
          },
          {
            path: 'models',
            element: (
              <PermissionGuard permissions={['models.read_all', 'models.*', '*']}>
                <ModelsPage />
              </PermissionGuard>
            ),
          },
          {
            path: 'tools',
            element: (
              <PermissionGuard permissions={['tools.read', 'tools.*', '*']}>
                <ToolsPage />
              </PermissionGuard>
            ),
          },
          {
            path: 'auth-providers',
            element: (
              <PermissionGuard permissions={['auth_providers.read', 'auth_providers.*', '*']}>
                <AuthProvidersPage />
              </PermissionGuard>
            ),
          },
          {
            path: 'connected-apps',
            element: (
              <PermissionGuard permissions={['connected_apps.read', 'connected_apps.*', '*']}>
                <ConnectedAppsAdminPage />
              </PermissionGuard>
            ),
          },
          {
            path: 'agent-types',
            element: (
              <PermissionGuard permissions={['agent_types.read', 'agent_types.*', '*']}>
                <AgentTypesPage />
              </PermissionGuard>
            ),
          },
          {
            path: 'agents',
            element: (
              <PermissionGuard permissions={['agents.read', 'agents.*', '*']}>
                <DefaultAgentsPage />
              </PermissionGuard>
            ),
          },
          {
            path: 'analytics',
            element: (
              <PermissionGuard permissions={['analytics.read', 'analytics.*', '*']}>
                <AnalyticsPage />
              </PermissionGuard>
            ),
          },
          {
            path: 'system',
            element: (
              <PermissionGuard permissions={['system.maintenance', 'system.registration', 'system.*', '*']}>
                <SystemPage />
              </PermissionGuard>
            ),
          },
        ],
      },
    ],
  },
  // Profile completion - requires auth but not profile completion
  {
    path: '/complete-profile',
    element: <ProfileCompletionPage />,
  },

  // Email verification - accessible by anyone (magic link)
  {
    path: '/verify-email',
    element: <EmailVerificationPage />,
    errorElement: <RouteErrorFallback />,
  },

  // OAuth callback - handles OAuth redirect
  {
    path: '/oauth-callback',
    element: <OAuthCallbackPage />,
    errorElement: <RouteErrorFallback />,
  },

  // Password reset - accessible by anyone (from email link)
  {
    path: '/reset-password',
    element: <ResetPasswordPage />,
    errorElement: <RouteErrorFallback />,
  },

  // Maintenance page - shown when system is under maintenance
  {
    path: '/maintenance',
    element: <MaintenancePage />,
  },

  // Public share view - accessible by anyone (no auth required)
  {
    path: '/share/:accessToken',
    element: <SharedConversationPage />,
  },

  // Public v2 share view - accessible by anyone (no auth required)
  {
    path: '/share/v2/:token',
    element: <SharedConversationV2Page />,
  },

  // Catch-all for 404
  {
    path: '*',
    element: <NoMatch />,
  },
]);
