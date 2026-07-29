import React, { Suspense } from 'react';
import { createHashRouter, Navigate } from 'react-router-dom';

import NoMatch from './pages/NoMatch';
import MaintenancePage from './pages/MaintenancePage';
import { SharedConversationPage } from './pages/SharedConversationPage';
import { EmailVerificationPage, ResetPasswordPage, ProfileCompletionPage } from './modules/auth';
import { OAuthCallbackPage } from './modules/auth/components/OAuthCallbackPage';
import { UpgradePage } from './modules/usage/components/UpgradePage';
import { RootGuard } from './modules/auth/components/RootGuard';
import { dataRoomFeatures } from './config/dataRoomFeatures';

const ConversationPage = React.lazy(() =>
  import('./modules/conversation').then((m) => ({ default: m.ConversationPage }))
);
const ConversationV2Page = React.lazy(() =>
  import('./modules/conversation-v2').then((m) => ({ default: m.ConversationV2Page }))
);
const ConversationV2SessionPage = React.lazy(() =>
  import('./modules/conversation-v2').then((m) => ({ default: m.ConversationV2SessionPage }))
);
const SharedConversationV2Page = React.lazy(() =>
  import('./modules/conversation-v2').then((m) => ({ default: m.SharedConversationV2Page }))
);
const PlaybookExecutionListPage = React.lazy(() =>
  import('./modules/playbook/components/PlaybookExecutionListPage').then((m) => ({ default: m.PlaybookExecutionListPage }))
);
const PlaybookExecutionComparePage = React.lazy(() =>
  import('./modules/playbook/components/PlaybookExecutionComparePage').then((m) => ({ default: m.PlaybookExecutionComparePage }))
);

// Lazy-loaded connected apps
const ConnectedAppsPage = React.lazy(() => import('./modules/connected-app/components/ConnectedAppsPage').then((m) => ({ default: m.ConnectedAppsPage })));

// Lazy-loaded app marketplace
const AppMarketplacePage = React.lazy(() => import('./modules/app-marketplace/components/AppMarketplacePage').then((m) => ({ default: m.AppMarketplacePage })));

const PlatformOverviewPage = React.lazy(() =>
  import('@/modules/platform-overview').then((m) => ({ default: m.PlatformOverviewPage }))
);

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
const WorkyWhatsAppSystemBotPage = React.lazy(() =>
  import("./modules/admin/pages/WorkyWhatsAppSystemBotPage").then((m) => ({
    default: m.WorkyWhatsAppSystemBotPage,
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
  import("./modules/workspace").then((m) => ({ default: m.WorkspacePage }))
);
const WorkspaceHubPage = React.lazy(() =>
  import("./modules/workspace").then((m) => ({ default: m.WorkspaceHubPage }))
);
const DecisionFlowEditorPage = React.lazy(() =>
  import('./modules/workspace').then((m) => ({ default: m.DecisionFlowEditorPage }))
);
const GovernancePage = React.lazy(() =>
  import('./modules/governance').then((m) => ({ default: m.GovernancePage }))
);
const AdminGuard = React.lazy(() =>
  import('./modules/admin').then((m) => ({ default: m.AdminGuard }))
);
const AdminLayout = React.lazy(() =>
  import('./modules/admin').then((m) => ({ default: m.AdminLayout }))
);
const AdminDashboard = React.lazy(() =>
  import('./modules/admin').then((m) => ({ default: m.AdminDashboard }))
);
const AppearancePage = React.lazy(() =>
  import('./modules/admin').then((m) => ({ default: m.AppearancePage }))
);
const UsersPage = React.lazy(() =>
  import('./modules/admin').then((m) => ({ default: m.UsersPage }))
);
const RolesPage = React.lazy(() =>
  import('./modules/admin').then((m) => ({ default: m.RolesPage }))
);
const AuditLogsPage = React.lazy(() =>
  import('./modules/admin').then((m) => ({ default: m.AuditLogsPage }))
);
const LogsPage = React.lazy(() =>
  import('./modules/admin').then((m) => ({ default: m.LogsPage }))
);
const PlansPage = React.lazy(() =>
  import('./modules/admin').then((m) => ({ default: m.PlansPage }))
);
const AnalyticsPage = React.lazy(() =>
  import('./modules/admin').then((m) => ({ default: m.AnalyticsPage }))
);
const SystemPage = React.lazy(() =>
  import('./modules/admin').then((m) => ({ default: m.SystemPage }))
);
const ReportsPage = React.lazy(() =>
  import('./modules/admin').then((m) => ({ default: m.ReportsPage }))
);
const ModelsPage = React.lazy(() =>
  import('./modules/admin').then((m) => ({ default: m.ModelsPage }))
);
const ToolsPage = React.lazy(() =>
  import('./modules/admin').then((m) => ({ default: m.ToolsPage }))
);
const SkillsPage = React.lazy(() =>
  import('./modules/admin').then((m) => ({ default: m.SkillsPage }))
);
const ConnectorsPage = React.lazy(() =>
  import('./modules/admin').then((m) => ({ default: m.ConnectorsPage }))
);
const AgentTypesPage = React.lazy(() =>
  import('./modules/admin').then((m) => ({ default: m.AgentTypesPage }))
);
const DefaultAgentsPage = React.lazy(() =>
  import('./modules/admin').then((m) => ({ default: m.DefaultAgentsPage }))
);
const PlaybookPromptsPage = React.lazy(() =>
  import('./modules/admin').then((m) => ({ default: m.PlaybookPromptsPage }))
);
const PlaybookSettingsPage = React.lazy(() =>
  import('./modules/admin').then((m) => ({ default: m.PlaybookSettingsPage }))
);
const WorkspaceSettingsAdminPage = React.lazy(() =>
  import('./modules/admin').then((m) => ({ default: m.WorkspaceSettingsPage }))
);
const ConversationSettingsPage = React.lazy(() =>
  import('./modules/admin').then((m) => ({ default: m.ConversationSettingsPage }))
);
const TeamAutoBuilderPage = React.lazy(() =>
  import('./modules/admin').then((m) => ({ default: m.TeamAutoBuilderPage }))
);
const PermissionGuard = React.lazy(() =>
  import('./modules/admin').then((m) => ({ default: m.PermissionGuard }))
);
const AuthProvidersPage = React.lazy(() =>
  import('./modules/admin').then((m) => ({ default: m.AuthProvidersPage }))
);
const ConnectedAppsAdminPage = React.lazy(() =>
  import('./modules/admin').then((m) => ({ default: m.ConnectedAppsAdminPage }))
);
const GuardrailsPage = React.lazy(() =>
  import('./modules/admin').then((m) => ({ default: m.GuardrailsPage }))
);
const EvaluationSettingsPage = React.lazy(() =>
  import('./modules/admin').then((m) => ({ default: m.EvaluationSettingsPage }))
);

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
        path: 'conversation/:id',
        element: <Suspense fallback={null}><ConversationPage /></Suspense>,
      },
      {
        path: 'conversation-v2',
        element: <Suspense fallback={null}><ConversationV2Page /></Suspense>,
      },
      {
        path: 'conversation-v2/:sessionId',
        element: <Suspense fallback={null}><ConversationV2SessionPage /></Suspense>,
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
            <AppMarketplacePage />
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
        element: <Suspense fallback={null}><PermissionGuard permissions={['governance.read', 'governance.*', '*']} fallbackPath='/'><GovernancePage /></PermissionGuard></Suspense>,
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
    element: <UpgradePage />,
  },
  // Admin routes - protected by AdminGuard
  {
    path: '/admin',
    element: <Suspense fallback={null}><AdminGuard /></Suspense>,
    children: [
      {
        element: <Suspense fallback={null}><AdminLayout /></Suspense>,
        children: [
          { index: true, element: <Suspense fallback={null}><AdminDashboard /></Suspense> },
          { path: 'appearance', element: <Suspense fallback={null}><AppearancePage /></Suspense> },
          { path: "users", element: <Suspense fallback={null}><UsersPage /></Suspense> },
          { path: "roles", element: <Suspense fallback={null}><RolesPage /></Suspense> },
          { path: "audit", element: <Suspense fallback={null}><AuditLogsPage /></Suspense> },
          { path: "logs", element: <Suspense fallback={null}><LogsPage /></Suspense> },
          { path: "plans", element: <Suspense fallback={null}><PlansPage /></Suspense> },
          { path: "reports", element: <Suspense fallback={null}><ReportsPage /></Suspense> },
          { path: "models", element: <Suspense fallback={null}><ModelsPage /></Suspense> },
          { path: "guardrails", element: <Suspense fallback={null}><GuardrailsPage /></Suspense> },
          { path: 'evaluation-settings', element: <Suspense fallback={null}><PermissionGuard permissions={['admin.*', '*']}><EvaluationSettingsPage /></PermissionGuard></Suspense> },
          { path: "tools", element: <Suspense fallback={null}><ToolsPage /></Suspense> },
          { path: "skills", element: <Suspense fallback={null}><SkillsPage /></Suspense> },
          { path: "connectors", element: <Suspense fallback={null}><ConnectorsPage /></Suspense> },
          { path: "agent-types", element: <Suspense fallback={null}><AgentTypesPage /></Suspense> },
          { path: "agents", element: <Suspense fallback={null}><DefaultAgentsPage /></Suspense> },
          { path: "playbook-prompts", element: <Suspense fallback={null}><PlaybookPromptsPage /></Suspense> },
          { path: "analytics", element: <Suspense fallback={null}><AnalyticsPage /></Suspense> },
          { path: "system", element: <Suspense fallback={null}><SystemPage /></Suspense> },
          {
            path: 'playbook-settings',
            element: <Suspense fallback={null}><PermissionGuard permissions={['system.maintenance', 'system.*', '*']}><PlaybookSettingsPage /></PermissionGuard></Suspense>,
          },
          {
            path: 'workspace-settings',
            element: <Suspense fallback={null}><PermissionGuard permissions={['workspaces.*', '*']}><WorkspaceSettingsAdminPage /></PermissionGuard></Suspense>,
          },
          {
            path: 'conversation-settings',
            element: <Suspense fallback={null}><PermissionGuard permissions={['conversations.settings.manage', 'conversations.*', '*']}><ConversationSettingsPage /></PermissionGuard></Suspense>,
          },
          {
            path: 'worky-governance',
            element: <Suspense fallback={null}><PermissionGuard permissions={['worky.admin.governance', 'worky.admin.*', '*']}><WorkyGovernanceAdminPage /></PermissionGuard></Suspense>,
          },
          {
            path: 'worky-whatsapp-system',
            element: <Suspense fallback={null}><PermissionGuard permissions={['worky.admin.governance', 'worky.admin.*', '*']}><WorkyWhatsAppSystemBotPage /></PermissionGuard></Suspense>,
          },
          {
            path: 'team-auto-builder',
            element: <Suspense fallback={null}><PermissionGuard permissions={['team_auto_builder.read', 'team_auto_builder.*', '*']}><TeamAutoBuilderPage /></PermissionGuard></Suspense>,
          },
          {
            path: 'users',
            element: <Suspense fallback={null}><PermissionGuard permissions={['users.read', 'users.*', '*']}><UsersPage /></PermissionGuard></Suspense>,
          },
          {
            path: 'roles',
            element: <Suspense fallback={null}><PermissionGuard permissions={['admin.roles.read', 'admin.*', '*']}><RolesPage /></PermissionGuard></Suspense>,
          },
          {
            path: 'audit',
            element: <Suspense fallback={null}><PermissionGuard permissions={['admin.audit.read', 'admin.*', '*']}><AuditLogsPage /></PermissionGuard></Suspense>,
          },
          {
            path: 'logs',
            element: <Suspense fallback={null}><PermissionGuard permissions={['admin.logs.read', 'admin.*', '*']}><LogsPage /></PermissionGuard></Suspense>,
          },
          {
            path: 'plans',
            element: <Suspense fallback={null}><PermissionGuard permissions={['plans.read_all', 'plans.*', '*']}><PlansPage /></PermissionGuard></Suspense>,
          },
          {
            path: 'reports',
            element: <Suspense fallback={null}><PermissionGuard permissions={['reports.read', 'reports.*', '*']}><ReportsPage /></PermissionGuard></Suspense>,
          },
          {
            path: 'models',
            element: <Suspense fallback={null}><PermissionGuard permissions={['models.read_all', 'models.*', '*']}><ModelsPage /></PermissionGuard></Suspense>,
          },
          {
            path: 'guardrails',
            element: <Suspense fallback={null}><PermissionGuard permissions={['admin.*', '*']}><GuardrailsPage /></PermissionGuard></Suspense>,
          },
          {
            path: 'tools',
            element: <Suspense fallback={null}><PermissionGuard permissions={['tools.read', 'tools.*', '*']}><ToolsPage /></PermissionGuard></Suspense>,
          },
          {
            path: 'auth-providers',
            element: <Suspense fallback={null}><PermissionGuard permissions={['auth_providers.read', 'auth_providers.*', '*']}><AuthProvidersPage /></PermissionGuard></Suspense>,
          },
          {
            path: 'connected-apps',
            element: <Suspense fallback={null}><PermissionGuard permissions={['connected_apps.read', 'connected_apps.*', '*']}><ConnectedAppsAdminPage /></PermissionGuard></Suspense>,
          },
          {
            path: 'agent-types',
            element: <Suspense fallback={null}><PermissionGuard permissions={['agent_types.read', 'agent_types.*', '*']}><AgentTypesPage /></PermissionGuard></Suspense>,
          },
          {
            path: 'agents',
            element: <Suspense fallback={null}><PermissionGuard permissions={['agents.read', 'agents.*', '*']}><DefaultAgentsPage /></PermissionGuard></Suspense>,
          },
          {
            path: 'analytics',
            element: <Suspense fallback={null}><PermissionGuard permissions={['analytics.read', 'analytics.*', '*']}><AnalyticsPage /></PermissionGuard></Suspense>,
          },
          {
            path: 'system',
            element: <Suspense fallback={null}><PermissionGuard permissions={['system.maintenance', 'system.registration', 'system.*', '*']}><SystemPage /></PermissionGuard></Suspense>,
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
    element: <Suspense fallback={null}><SharedConversationV2Page /></Suspense>,
  },

  // Catch-all for 404
  {
    path: '*',
    element: <NoMatch />,
  },
]);
