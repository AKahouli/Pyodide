import React, { Suspense } from 'react';
import { createHashRouter, Navigate } from 'react-router-dom';

import NoMatch from './pages/NoMatch';
import MaintenancePage from './pages/MaintenancePage';
import { EmailVerificationPage, ResetPasswordPage, ProfileCompletionPage } from './modules/auth';
import { OAuthCallbackPage } from './modules/auth/components/OAuthCallbackPage';
import { RootGuard } from './modules/auth/components/RootGuard';
import { AdminGuard } from './modules/admin/components/AdminGuard';
import { AdminLayout } from './modules/admin/components/AdminLayout';
import { PermissionGuard } from './modules/admin/components/PermissionGuard';

// Lazy-loaded connected apps
const ConnectedAppsPage = React.lazy(() => import('./modules/connected-app/components/ConnectedAppsPage').then((m) => ({ default: m.ConnectedAppsPage })));

// Lazy-loaded app builder
const AppBuilderPage = React.lazy(() => import('./modules/app-builder/components/AppBuilderPage').then((m) => ({ default: m.AppBuilderPage })));

const PlatformOverviewPage = React.lazy(() =>
  import('@/modules/platform-overview').then((m) => ({ default: m.PlatformOverviewPage }))
);

const ConversationPage = React.lazy(() =>
  import('./modules/conversation/ConversationPage').then((m) => ({ default: m.ConversationPage }))
);
const NewConversationPage = React.lazy(() =>
  import('./modules/conversation/NewConversationPage').then((m) => ({ default: m.NewConversationPage }))
);
const ConversationV2Page = React.lazy(() =>
  import('./modules/conversation-v2/ConversationV2Page')
);
const ConversationV2SessionPage = React.lazy(() =>
  import('./modules/conversation-v2/ConversationV2SessionPage')
);
const SharedConversationPage = React.lazy(() =>
  import('./pages/SharedConversationPage').then((m) => ({ default: m.SharedConversationPage }))
);
const SharedConversationV2Page = React.lazy(() =>
  import('./modules/conversation-v2/SharedConversationV2Page')
);
const AllChatsPage = React.lazy(() =>
  import('./modules/sidebar').then((m) => ({ default: m.AllChatsPage }))
);
const UpgradePage = React.lazy(() =>
  import('./modules/usage/components/UpgradePage').then((m) => ({ default: m.UpgradePage }))
);

// Lazy-loaded playbook routes
const PlaybooksConsolePage = React.lazy(() =>
  import("./modules/playbook/console/PlaybooksConsolePage").then((m) => ({ default: m.PlaybooksConsolePage }))
);
const PlaybookCanvasPage = React.lazy(() =>
  import("./modules/playbook/components/PlaybookCanvasPage").then((m) => ({ default: m.PlaybookCanvasPage }))
);
const PlaybookExecutionPage = React.lazy(() =>
  import("./modules/playbook/components/PlaybookExecutionPage").then((m) => ({ default: m.PlaybookExecutionPage }))
);
const PlaybookExecutionListRoute = React.lazy(() =>
  import('./modules/playbook/components/PlaybookExecutionListPage').then((m) => ({ default: m.PlaybookExecutionListPage }))
);
const PlaybookExecutionCompareRoute = React.lazy(() =>
  import('./modules/playbook/components/PlaybookExecutionComparePage').then((m) => ({ default: m.PlaybookExecutionComparePage }))
);

// Lazy-loaded Worky routes
const WorkyPage = React.lazy(() =>
  import("./modules/worky/components/WorkyPage").then((m) => ({ default: m.WorkyPage }))
);
const WorkyStreamPage = React.lazy(() =>
  import("./modules/worky/components/WorkyStreamPage").then((m) => ({ default: m.WorkyStreamPage }))
);
const WorkyStreamReportPage = React.lazy(() =>
  import("./modules/worky/components/StreamReportPage").then((m) => ({
    default: m.StreamReportPage,
  })),
)

const WorkyGovernanceAdminPage = React.lazy(() =>
  import("./modules/worky/components/admin/WorkyGovernancePage").then((m) => ({
    default: m.WorkyGovernancePage,
  }))
);
const AgentHubPage = React.lazy(() =>
  import("./modules/agent/components/AgentHubPage").then((m) => ({ default: m.AgentHubPage }))
);
const TeamsPage = React.lazy(() =>
  import("./modules/team").then((m) => ({ default: m.TeamsPage }))
);
const TeamOrgChartPage = React.lazy(() =>
  import("./modules/team").then((m) => ({ default: m.TeamOrgChartPage }))
);
const GroupsPage = React.lazy(() =>
  import("./modules/groups").then((m) => ({ default: m.GroupsPage }))
);
const ProjectPage = React.lazy(() =>
  import("./modules/project").then((m) => ({ default: m.ProjectPage }))
);
const WorkspacePage = React.lazy(() =>
  import('./modules/workspace/components/WorkspacePage').then((m) => ({ default: m.WorkspacePage }))
);
const WorkspaceHubPage = React.lazy(() =>
  import('./modules/workspace/components/WorkspaceHubPage').then((m) => ({
    default: m.WorkspaceHubPage,
  }))
);
const DecisionFlowEditorPage = React.lazy(() =>
  import('./modules/workspace/components/decision-flow/DecisionFlowEditorPage').then((m) => ({
    default: m.DecisionFlowEditorPage,
  }))
);
const GovernancePage = React.lazy(() =>
  import('./modules/governance').then((m) => ({ default: m.GovernancePage }))
);
const SemanticModelCatalogPage = React.lazy(() => import('./modules/semantic-model').then((m) => ({ default: m.SemanticModelCatalogPage })));
const SemanticModelEditorPage = React.lazy(() => import('./modules/semantic-model').then((m) => ({ default: m.SemanticModelEditorPage })));
const WorkspaceSemanticModelPage = React.lazy(() => import('./modules/semantic-model').then((m) => ({ default: m.WorkspaceSemanticModelPage })));

const AdminDashboard = React.lazy(() =>
  import('./modules/admin/components/AdminDashboard').then((m) => ({ default: m.AdminDashboard }))
);
const AppearancePage = React.lazy(() =>
  import('./modules/admin/pages/AppearancePage').then((m) => ({ default: m.AppearancePage }))
);
const UsersPage = React.lazy(() =>
  import('./modules/admin/pages/UsersPage').then((m) => ({ default: m.UsersPage }))
);
const RolesPage = React.lazy(() =>
  import('./modules/admin/pages/RolesPage').then((m) => ({ default: m.RolesPage }))
);
const AuditLogsPage = React.lazy(() =>
  import('./modules/admin/pages/AuditLogsPage').then((m) => ({ default: m.AuditLogsPage }))
);
const LogsPage = React.lazy(() =>
  import('./modules/admin/pages/LogsPage').then((m) => ({ default: m.LogsPage }))
);
const PlansPage = React.lazy(() =>
  import('./modules/admin/pages/PlansPage').then((m) => ({ default: m.PlansPage }))
);
const AnalyticsPage = React.lazy(() =>
  import('./modules/admin/pages/AnalyticsPage').then((m) => ({ default: m.AnalyticsPage }))
);
const SystemPage = React.lazy(() =>
  import('./modules/admin/pages/SystemPage').then((m) => ({ default: m.SystemPage }))
);
const ReportsPage = React.lazy(() =>
  import('./modules/admin/pages/ReportsPage').then((m) => ({ default: m.ReportsPage }))
);
const ModelsPage = React.lazy(() =>
  import('./modules/admin/pages/ModelsPage').then((m) => ({ default: m.ModelsPage }))
);
const ToolsPage = React.lazy(() =>
  import('./modules/admin/pages/ToolsPage').then((m) => ({ default: m.ToolsPage }))
);
const SkillsPage = React.lazy(() =>
  import('./modules/admin/pages/SkillsPage').then((m) => ({ default: m.SkillsPage }))
);
const ConnectorsPage = React.lazy(() =>
  import('./modules/admin/pages/connectors/ConnectorsPage').then((m) => ({ default: m.ConnectorsPage }))
);
const AgentTypesPage = React.lazy(() =>
  import('./modules/admin/pages/AgentTypesPage').then((m) => ({ default: m.AgentTypesPage }))
);
const DefaultAgentsPage = React.lazy(() =>
  import('./modules/admin/pages/DefaultAgentsPage').then((m) => ({ default: m.DefaultAgentsPage }))
);
const PlaybookPromptsPage = React.lazy(() =>
  import('./modules/admin/pages/PlaybookPromptsPage').then((m) => ({ default: m.PlaybookPromptsPage }))
);
const PlaybookSettingsPage = React.lazy(() =>
  import('./modules/admin/pages/PlaybookSettingsPage').then((m) => ({ default: m.PlaybookSettingsPage }))
);
const WorkspaceSettingsPage = React.lazy(() =>
  import('./modules/admin/pages/WorkspaceSettingsPage').then((m) => ({ default: m.WorkspaceSettingsPage }))
);
const ConversationSettingsPage = React.lazy(() =>
  import('./modules/admin/pages/ConversationSettingsPage').then((m) => ({ default: m.ConversationSettingsPage }))
);
const TeamAutoBuilderPage = React.lazy(() =>
  import('./modules/admin/pages/TeamAutoBuilderPage').then((m) => ({ default: m.TeamAutoBuilderPage }))
);
const AuthProvidersPage = React.lazy(() =>
  import('./modules/admin/pages/AuthProvidersPage').then((m) => ({ default: m.AuthProvidersPage }))
);
const ConnectedAppsAdminPage = React.lazy(() =>
  import('./modules/admin/pages/ConnectedAppsAdminPage').then((m) => ({ default: m.ConnectedAppsAdminPage }))
);
const GuardrailsPage = React.lazy(() =>
  import('./modules/admin/pages/GuardrailsPage').then((m) => ({ default: m.GuardrailsPage }))
);
const EvaluationSettingsPage = React.lazy(() =>
  import('./modules/admin/pages/EvaluationSettingsPage').then((m) => ({ default: m.EvaluationSettingsPage }))
);

function lazyPage(element: React.ReactNode) {
  return <Suspense fallback={null}>{element}</Suspense>;
}

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
        path: 'platform',
        element: (
          <Suspense fallback={null}>
            <PlatformOverviewPage />
          </Suspense>
        ),
      },
      {
        path: 'conversation',
        element: lazyPage(<NewConversationPage />),
      },
      {
        path: 'conversation/:id',
        element: lazyPage(<ConversationPage />),
      },
      {
        path: 'conversation-v2',
        element: lazyPage(<ConversationV2Page />),
      },
      {
        path: 'conversation-v2/:sessionId',
        element: lazyPage(<ConversationV2SessionPage />),
      },
      {
        path: 'chats',
        element: lazyPage(<AllChatsPage />),
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
        path: 'app-market',
        element: (
          <Suspense fallback={null}>
            <AppBuilderPage />
          </Suspense>
        ),
      },
      {
        path: 'playbooks',
        element: (
          <Suspense fallback={null}>
            <PlaybooksConsolePage />
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
            <PlaybookExecutionListRoute />
          </Suspense>
        ),
      },
      {
        path: 'playbooks/:id/executions/compare',
        element: (
            <Suspense fallback={null}>
            <PlaybookExecutionCompareRoute />
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
        path: 'worky',
        element: (
          <Suspense fallback={null}>
            <WorkyPage />
          </Suspense>
        ),
      },
      {
        path: 'worky/:streamId',
        element: (
          <Suspense fallback={null}>
            <WorkyStreamPage />
          </Suspense>
        ),
      },
      {
        path: 'worky/:streamId/report',
        element: (
          <Suspense fallback={null}>
            <WorkyStreamReportPage />
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
        path: 'governance',
        element: (
          <PermissionGuard permissions={['governance.read', 'governance.*', '*']} fallbackPath='/'>
            <Suspense fallback={null}>
              <GovernancePage />
            </Suspense>
          </PermissionGuard>
        ),
      },
      {
        path: 'teams',
        element: (
          <Suspense fallback={null}>
            <TeamsPage />
          </Suspense>
        ),
      },
      {
        path: 'teams/:id',
        element: (
          <Suspense fallback={null}>
            <TeamOrgChartPage />
          </Suspense>
        ),
      },
      {
        path: 'groups',
        element: (
          <Suspense fallback={null}>
            <GroupsPage />
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
        path: 'workspace',
        element: (
          <Suspense fallback={null}>
            <WorkspaceHubPage />
          </Suspense>
        ),
      },
      {
        path: 'semantic-models',
        element: <PermissionGuard permissions={['semantic_models.read','semantic_models.*','*']} fallbackPath='/'>{lazyPage(<SemanticModelCatalogPage />)}</PermissionGuard>,
      },
      {
        path: 'semantic-models/:modelId',
        element: <PermissionGuard permissions={['semantic_models.read','semantic_models.*','*']} fallbackPath='/'>{lazyPage(<SemanticModelEditorPage />)}</PermissionGuard>,
      },
      {
        path: 'workspace/:id/semantic-model',
        element: <PermissionGuard permissions={['semantic_models.read','semantic_models.*','*']} fallbackPath='/'>{lazyPage(<WorkspaceSemanticModelPage />)}</PermissionGuard>,
      },
      {
        path: 'workspace/:id/artifacts/:artifactId',
        element:<Suspense fallback={null}><DecisionFlowEditorPage /></Suspense> ,
      },
      {
        path: 'workspace/:id',
        element: (
          <Suspense fallback={null}>
            <WorkspacePage />
          </Suspense>
        ),
      },
      {
        path: 'classifier',
        element: <Navigate to='/workspace' replace />,
      },
    ],
  },
  {
    path: 'upgrade',
    element: lazyPage(<UpgradePage />),
  },
  // Admin routes - protected by AdminGuard
  {
    path: '/admin',
    element: <AdminGuard />,
    children: [
      {
        element: <AdminLayout />,
        children: [
          { index: true, element: lazyPage(<AdminDashboard />) },
          { path: 'appearance', element: lazyPage(<AppearancePage />) },
          { path: "users", element: lazyPage(<UsersPage />) },
          { path: "roles", element: lazyPage(<RolesPage />) },
          { path: "audit", element: lazyPage(<AuditLogsPage />) },
          { path: "logs", element: lazyPage(<LogsPage />) },
          { path: "plans", element: lazyPage(<PlansPage />) },
          { path: "reports", element: lazyPage(<ReportsPage />) },
          { path: "models", element: lazyPage(<ModelsPage />) },
          { path: "guardrails", element: lazyPage(<GuardrailsPage />) },
          { path: 'evaluation-settings', element: lazyPage(<PermissionGuard permissions={['admin.*', '*']}><EvaluationSettingsPage /></PermissionGuard>) },
          { path: "tools", element: lazyPage(<ToolsPage />) },
          { path: "skills", element: lazyPage(<SkillsPage />) },
          { path: "connectors", element: lazyPage(<ConnectorsPage />) },
          { path: "agent-types", element: lazyPage(<AgentTypesPage />) },
          { path: "agents", element: lazyPage(<DefaultAgentsPage />) },
          { path: "playbook-prompts", element: lazyPage(<PlaybookPromptsPage />) },
          { path: "analytics", element: lazyPage(<AnalyticsPage />) },
          { path: "system", element: lazyPage(<SystemPage />) },
          {
            path: 'playbook-settings',
            element: lazyPage(
              <PermissionGuard permissions={['system.maintenance', 'system.*', '*']}>
                <PlaybookSettingsPage />
              </PermissionGuard>
            ),
          },
          {
            path: 'workspace-settings',
            element: lazyPage(
              <PermissionGuard permissions={['workspaces.*', '*']}>
                <WorkspaceSettingsPage />
              </PermissionGuard>
            ),
          },
          {
            path: 'conversation-settings',
            element: lazyPage(
              <PermissionGuard permissions={['conversations.settings.manage', 'conversations.*', '*']}>
                <ConversationSettingsPage />
              </PermissionGuard>
            ),
          },
          {
            path: 'worky-governance',
            element: (
              <PermissionGuard permissions={['worky.admin.governance', 'worky.admin.*', '*']}>
                <Suspense fallback={null}>
                  <WorkyGovernanceAdminPage />
                </Suspense>
              </PermissionGuard>
            ),
          },
          {
            path: 'team-auto-builder',
            element: lazyPage(
              <PermissionGuard permissions={['team_auto_builder.read', 'team_auto_builder.*', '*']}>
                <TeamAutoBuilderPage />
              </PermissionGuard>
            ),
          },
          {
            path: 'users',
            element: lazyPage(
              <PermissionGuard permissions={['users.read', 'users.*', '*']}>
                <UsersPage />
              </PermissionGuard>
            ),
          },
          {
            path: 'roles',
            element: lazyPage(
              <PermissionGuard permissions={['admin.roles.read', 'admin.*', '*']}>
                <RolesPage />
              </PermissionGuard>
            ),
          },
          {
            path: 'audit',
            element: lazyPage(
              <PermissionGuard permissions={['admin.audit.read', 'admin.*', '*']}>
                <AuditLogsPage />
              </PermissionGuard>
            ),
          },
          {
            path: 'logs',
            element: lazyPage(
              <PermissionGuard permissions={['admin.logs.read', 'admin.*', '*']}>
                <LogsPage />
              </PermissionGuard>
            ),
          },
          {
            path: 'plans',
            element: lazyPage(
              <PermissionGuard permissions={['plans.read_all', 'plans.*', '*']}>
                <PlansPage />
              </PermissionGuard>
            ),
          },
          {
            path: 'reports',
            element: lazyPage(
              <PermissionGuard permissions={['reports.read', 'reports.*', '*']}>
                <ReportsPage />
              </PermissionGuard>
            ),
          },
          {
            path: 'models',
            element: lazyPage(
              <PermissionGuard permissions={['models.read_all', 'models.*', '*']}>
                <ModelsPage />
              </PermissionGuard>
            ),
          },
          {
            path: 'guardrails',
            element: lazyPage(
              <PermissionGuard permissions={['admin.*', '*']}>
                <GuardrailsPage />
              </PermissionGuard>
            ),
          },
          {
            path: 'tools',
            element: lazyPage(
              <PermissionGuard permissions={['tools.read', 'tools.*', '*']}>
                <ToolsPage />
              </PermissionGuard>
            ),
          },
          {
            path: 'auth-providers',
            element: lazyPage(
              <PermissionGuard permissions={['auth_providers.read', 'auth_providers.*', '*']}>
                <AuthProvidersPage />
              </PermissionGuard>
            ),
          },
          {
            path: 'connected-apps',
            element: lazyPage(
              <PermissionGuard permissions={['connected_apps.read', 'connected_apps.*', '*']}>
                <ConnectedAppsAdminPage />
              </PermissionGuard>
            ),
          },
          {
            path: 'agent-types',
            element: lazyPage(
              <PermissionGuard permissions={['agent_types.read', 'agent_types.*', '*']}>
                <AgentTypesPage />
              </PermissionGuard>
            ),
          },
          {
            path: 'agents',
            element: lazyPage(
              <PermissionGuard permissions={['agents.read', 'agents.*', '*']}>
                <DefaultAgentsPage />
              </PermissionGuard>
            ),
          },
          {
            path: 'analytics',
            element: lazyPage(
              <PermissionGuard permissions={['analytics.read', 'analytics.*', '*']}>
                <AnalyticsPage />
              </PermissionGuard>
            ),
          },
          {
            path: 'system',
            element: lazyPage(
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
    element: lazyPage(<SharedConversationPage />),
  },

  // Public v2 share view - accessible by anyone (no auth required)
  {
    path: '/share/v2/:token',
    element: lazyPage(<SharedConversationV2Page />),
  },

  // Catch-all for 404
  {
    path: '*',
    element: <NoMatch />,
  },
]);
