/**
 * Admin Module Types
 */

import type { LucideIcon } from 'lucide-react';
import type { ModuleTranslationKey } from '@/modules/localization';
import type {
  AgentConnectorActionSelection,
  AgentDeploymentSettings,
  AgentGuardrails,
} from '@/modules/agent/types';

export interface AdminMenuItem {
  id: string;
  label: string;
  labelKey: ModuleTranslationKey<'admin'>;
  path: string;
  icon: LucideIcon;
  permissions: string[];
  description: string;
  descriptionKey: ModuleTranslationKey<'admin'>;
}

export interface PromptInjectionGuardrailsConfig {
  inputGuardrailEnabled: boolean;
  outputGuardrailEnabled: boolean;
  toolCallGuardrailEnabled: boolean;
  inputClassifierPrompt: string;
  outputClassifierPrompt: string;
  toolCallClassifierPrompt: string;
  blockMessage: string;
}

export interface AdminGuardrailsSettings {
  forceActivation: boolean;
  promptInjection: PromptInjectionGuardrailsConfig;
}

export interface AdminEvaluationSettings {
  responseReliability: {
    enabled: boolean;
    mode: 'informative' | 'corrective_transparent' | 'corrective_guarded';
    judgeModelId: string | null;
    maxConcurrentEvaluations: number;
    timeoutMs: number;
    maxFindings: number;
    correction: {
      threshold: number;
      maxAttempts: number;
      maxDurationMs: number;
      allowAdditionalDocumentRetrieval: boolean;
      allowConnectorQueries: boolean;
      allowCalculationReruns: boolean;
      failureBehavior: 'publish_with_warning' | 'abstain' | 'require_human_review';
      showOriginalAnswer: boolean;
    };
  };
}

// Analytics Types

export interface TimeSeriesDataPoint {
  date: string;
  count: number;
}

export interface UserAnalyticsResponse {
  totalConsentingUsers: number;
  newUsersOverTime: TimeSeriesDataPoint[];
  verificationStatus: {
    verified: number;
    unverified: number;
  };
  profileCompletion: {
    complete: number;
    incomplete: number;
  };
}

export interface TokensByModel {
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  requestCount: number;
}

export interface UsageAnalyticsResponse {
  totalTokens: {
    input: number;
    output: number;
    total: number;
  };
  tokensByModel: TokensByModel[];
  averageTokensPerConversation: number;
  usageOverTime: TimeSeriesDataPoint[];
  errorRates: {
    model: string;
    totalRequests: number;
    failedRequests: number;
    errorRate: number;
  }[];
}

export interface ComponentTypeDistribution {
  type: string;
  count: number;
  percentage: number;
}

export interface ConversationAnalyticsResponse {
  totalConversations: number;
  messagesPerConversation: {
    average: number;
    min: number;
    max: number;
  };
  conversationsOverTime: TimeSeriesDataPoint[];
  componentTypeDistribution: ComponentTypeDistribution[];
  averageConversationDurationMs: number;
}

export interface FeedbackDistribution {
  likes: number;
  dislikes: number;
  none: number;
}

export interface ReportsByCategory {
  category: string;
  count: number;
}

export interface QualityAnalyticsResponse {
  feedbackDistribution: FeedbackDistribution;
  feedbackRate: number;
  reportsByCategory: ReportsByCategory[];
  totalReports: number;
  regenerationRate: number;
}

export interface SummaryAnalyticsResponse {
  users: {
    totalConsenting: number;
    newThisPeriod: number;
    verifiedPercentage: number;
  };
  usage: {
    totalTokens: number;
    averagePerConversation: number;
    topModel: string | null;
  };
  conversations: {
    total: number;
    averageMessages: number;
    newThisPeriod: number;
  };
  quality: {
    feedbackRate: number;
    likePercentage: number;
    totalReports: number;
  };
  periodStart: string;
  periodEnd: string;
}

export interface AnalyticsQueryParams {
  dateFrom?: string;
  dateTo?: string;
  groupBy?: 'day' | 'week' | 'month';
}

// System Types

export interface MaintenanceStatus {
  enabled: boolean;
  message: string;
  startedAt?: string;
  startedBy?: string;
  estimatedEndAt?: string;
}

export interface SetMaintenanceRequest {
  enabled: boolean;
  message?: string;
  estimatedEndAt?: string;
}

export interface RegistrationStatus {
  enabled: boolean;
  disabledAt?: string;
  disabledBy?: string;
}

export interface SetRegistrationRequest {
  enabled: boolean;
}

export interface FeatureVisibility {
  conversation: boolean;
  workspace: boolean;
  playbook: boolean;
  governance: boolean;
  appMarketplace: boolean;
  worky: boolean;
  agents: boolean;
}

export interface CorsOriginEntry {
  origin: string;
  enabled: boolean;
}

export interface CorsSettings {
  origins: CorsOriginEntry[];
  updatedAt?: string;
  updatedBy?: string;
}

export interface SetCorsSettingsRequest {
  origins: CorsOriginEntry[];
}

export type AdminColorTheme = 'default' | 'yellow' | 'orange' | 'blue';

export type AdminThemeLogo = 'yellowmind' | 'kpmg';

export interface AppearanceThemeConfig {
  labelKey: string;
  logo: AdminThemeLogo;
}

export interface AppearanceSettings {
  defaultColorTheme: AdminColorTheme;
  themes: Record<AdminColorTheme, AppearanceThemeConfig>;
}

// Plan Types

export interface PlanResponse {
  id: string;
  name: string;
  slug: string;
  description?: string;
  tokenLimit: number;
  windowHours: number;
  requestsPerMinute: number;
  maxTokensPerRequest: number;
  features: string[];
  priority: number;
  priceMonthly: number;
  priceYearly: number;
  currency: string;
  isActive: boolean;
  isDefault: boolean;
  displayOrder: number;
  maxWorkspaces: number;
  workspaceStorageBytes: number;
  isUnlimited: boolean;
}

export interface CreatePlanRequest {
  name: string;
  slug: string;
  description?: string;
  tokenLimit: number;
  windowHours: number;
  requestsPerMinute?: number;
  maxTokensPerRequest?: number;
  features?: string[];
  priority: number;
  priceMonthly?: number;
  priceYearly?: number;
  currency?: string;
  isActive?: boolean;
  isDefault?: boolean;
  displayOrder?: number;
  maxWorkspaces?: number;
  workspaceStorageBytes?: number;
}

export interface UpdatePlanRequest {
  name?: string;
  description?: string;
  tokenLimit?: number;
  windowHours?: number;
  requestsPerMinute?: number;
  maxTokensPerRequest?: number;
  features?: string[];
  priority?: number;
  priceMonthly?: number;
  priceYearly?: number;
  currency?: string;
  isActive?: boolean;
  isDefault?: boolean;
  displayOrder?: number;
  maxWorkspaces?: number;
  workspaceStorageBytes?: number;
}

// Role Types

export interface RoleResponse {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  isActive: boolean;
  isSystem: boolean;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRoleRequest {
  name: string;
  description: string;
  permissions: string[];
  isActive?: boolean;
  priority?: number;
}

export interface UpdateRoleRequest {
  name?: string;
  description?: string;
  permissions?: string[];
  isActive?: boolean;
  priority?: number;
}

export interface AssignRoleRequest {
  userId: string;
  roleId: string;
}

// Permission groups for UI display
export interface PermissionGroup {
  namespace: string;
  labelKey: ModuleTranslationKey<'admin'>;
  descriptionKey?: ModuleTranslationKey<'admin'>;
  disabled: boolean;
  permissions: {
    value: string;
    labelKey: ModuleTranslationKey<'admin'>;
    descriptionKey: ModuleTranslationKey<'admin'>;
  }[];
}

// All available permissions grouped by namespace
export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    namespace: 'users',
    labelKey: 'roles.permissions.groups.users.label',
    descriptionKey: 'roles.permissions.groups.users.description',
    disabled: false,

    permissions: [
      {
        value: 'users.read',
        labelKey: 'roles.permissions.items.users.read.label',
        descriptionKey: 'roles.permissions.items.users.read.description',
      },
      {
        value: 'users.suspend',
        labelKey: 'roles.permissions.items.users.suspend.label',
        descriptionKey: 'roles.permissions.items.users.suspend.description',
      },
      {
        value: 'users.activate',
        labelKey: 'roles.permissions.items.users.activate.label',
        descriptionKey: 'roles.permissions.items.users.activate.description',
      },
      {
        value: 'users.assign_plan',
        labelKey: 'roles.permissions.items.users.assign_plan.label',
        descriptionKey: 'roles.permissions.items.users.assign_plan.description',
      },
      {
        value: 'users.assign_role',
        labelKey: 'roles.permissions.items.users.assign_role.label',
        descriptionKey: 'roles.permissions.items.users.assign_role.description',
      },
      {
        value: 'users.*',
        labelKey: 'roles.permissions.items.users.all.label',
        descriptionKey: 'roles.permissions.items.users.all.description',
      },
    ],
  },
  {
    namespace: 'plans',
    labelKey: 'roles.permissions.groups.plans.label',
    descriptionKey: 'roles.permissions.groups.plans.description',
    disabled: false,
    permissions: [
      {
        value: 'plans.read_all',
        labelKey: 'roles.permissions.items.plans.read_all.label',
        descriptionKey: 'roles.permissions.items.plans.read_all.description',
      },
      {
        value: 'plans.create',
        labelKey: 'roles.permissions.items.plans.create.label',
        descriptionKey: 'roles.permissions.items.plans.create.description',
      },
      {
        value: 'plans.update',
        labelKey: 'roles.permissions.items.plans.update.label',
        descriptionKey: 'roles.permissions.items.plans.update.description',
      },
      {
        value: 'plans.delete',
        labelKey: 'roles.permissions.items.plans.delete.label',
        descriptionKey: 'roles.permissions.items.plans.delete.description',
      },
      {
        value: 'plans.*',
        labelKey: 'roles.permissions.items.plans.all.label',
        descriptionKey: 'roles.permissions.items.plans.all.description',
      },
    ],
  },
  {
    namespace: 'reports',
    labelKey: 'roles.permissions.groups.reports.label',
    descriptionKey: 'roles.permissions.groups.reports.description',
    disabled: false,
    permissions: [
      {
        value: 'reports.read',
        labelKey: 'roles.permissions.items.reports.read.label',
        descriptionKey: 'roles.permissions.items.reports.read.description',
      },
      {
        value: 'reports.update',
        labelKey: 'roles.permissions.items.reports.update.label',
        descriptionKey: 'roles.permissions.items.reports.update.description',
      },
      {
        value: 'reports.*',
        labelKey: 'roles.permissions.items.reports.all.label',
        descriptionKey: 'roles.permissions.items.reports.all.description',
      },
    ],
  },
  {
    namespace: 'system',
    labelKey: 'roles.permissions.groups.system.label',
    descriptionKey: 'roles.permissions.groups.system.description',
    disabled: false,
    permissions: [
      {
        value: 'system.maintenance',
        labelKey: 'roles.permissions.items.system.maintenance.label',
        descriptionKey: 'roles.permissions.items.system.maintenance.description',
      },
      {
        value: 'system.skip_maintenance',
        labelKey: 'roles.permissions.items.system.skip_maintenance.label',
        descriptionKey: 'roles.permissions.items.system.skip_maintenance.description',
      },
      {
        value: 'system.registration',
        labelKey: 'roles.permissions.items.system.registration.label',
        descriptionKey: 'roles.permissions.items.system.registration.description',
      },
      {
        value: 'system.cors',
        labelKey: 'roles.permissions.items.system.cors.label',
        descriptionKey: 'roles.permissions.items.system.cors.description',
      },
      {
        value: 'system.*',
        labelKey: 'roles.permissions.items.system.all.label',
        descriptionKey: 'roles.permissions.items.system.all.description',
      },
    ],
  },
  {
    namespace: 'workspaces',
    labelKey: 'roles.permissions.groups.workspaces.label',
    descriptionKey: 'roles.permissions.groups.workspaces.description',
    disabled: true,
    permissions: [
      {
        value: 'workspaces.admin_delete',
        labelKey: 'roles.permissions.items.workspaces.admin_delete.label',
        descriptionKey: 'roles.permissions.items.workspaces.admin_delete.description',
      },
      {
        value: 'workspaces.manage_templates',
        labelKey: 'roles.permissions.items.workspaces.manage_templates.label',
        descriptionKey: 'roles.permissions.items.workspaces.manage_templates.description',
      },
      {
        value: 'workspaces.*',
        labelKey: 'roles.permissions.items.workspaces.all.label',
        descriptionKey: 'roles.permissions.items.workspaces.all.description',
      },
    ],
  },
  {
    namespace: 'analytics',
    disabled: false,

    labelKey: 'roles.permissions.groups.analytics.label',
    descriptionKey: 'roles.permissions.groups.analytics.description',
    permissions: [
      {
        value: 'analytics.read',
        labelKey: 'roles.permissions.items.analytics.read.label',
        descriptionKey: 'roles.permissions.items.analytics.read.description',
      },
      {
        value: 'analytics.*',
        labelKey: 'roles.permissions.items.analytics.all.label',
        descriptionKey: 'roles.permissions.items.analytics.all.description',
      },
    ],
  },
  {
    namespace: 'conversations',
    labelKey: 'roles.permissions.groups.conversations.label',
    descriptionKey: 'roles.permissions.groups.conversations.description',
    disabled: false,

    permissions: [
      {
        value: 'conversations.admin_delete',
        labelKey: 'roles.permissions.items.conversations.admin_delete.label',
        descriptionKey: 'roles.permissions.items.conversations.admin_delete.description',
      },
      {
        value: 'conversations.settings.manage',
        labelKey: 'roles.permissions.items.conversations.settingsManage.label',
        descriptionKey: 'roles.permissions.items.conversations.settingsManage.description',
      },
      {
        value: 'conversations.*',
        labelKey: 'roles.permissions.items.conversations.all.label',
        descriptionKey: 'roles.permissions.items.conversations.all.description',
      },
    ],
  },
  {
    namespace: 'models',
    labelKey: 'roles.permissions.groups.models.label',
    descriptionKey: 'roles.permissions.groups.models.description',
    disabled: false,
    permissions: [
      {
        value: 'models.read_all',
        labelKey: 'roles.permissions.items.models.read_all.label',
        descriptionKey: 'roles.permissions.items.models.read_all.description',
      },
      {
        value: 'models.update',
        labelKey: 'roles.permissions.items.models.update.label',
        descriptionKey: 'roles.permissions.items.models.update.description',
      },
      {
        value: 'models.set_default',
        labelKey: 'roles.permissions.items.models.set_default.label',
        descriptionKey: 'roles.permissions.items.models.set_default.description',
      },
      {
        value: 'models.*',
        labelKey: 'roles.permissions.items.models.all.label',
        descriptionKey: 'roles.permissions.items.models.all.description',
      },
    ],
  },
  {
    namespace: 'admin',
    labelKey: 'roles.permissions.groups.admin.label',
    descriptionKey: 'roles.permissions.groups.admin.description',
    disabled: false,

    permissions: [
      {
        value: 'admin.roles.read',
        labelKey: 'roles.permissions.items.admin.roles_read.label',
        descriptionKey: 'roles.permissions.items.admin.roles_read.description',
      },
      {
        value: 'admin.roles.manage',
        labelKey: 'roles.permissions.items.admin.roles_manage.label',
        descriptionKey: 'roles.permissions.items.admin.roles_manage.description',
      },
      {
        value: 'admin.audit.read',
        labelKey: 'roles.permissions.items.admin.audit_read.label',
        descriptionKey: 'roles.permissions.items.admin.audit_read.description',
      },
      {
        value: 'admin.logs.read',
        labelKey: 'roles.permissions.items.admin.logs_read.label',
        descriptionKey: 'roles.permissions.items.admin.logs_read.description',
      },
      {
        value: 'admin.*',
        labelKey: 'roles.permissions.items.admin.all.label',
        descriptionKey: 'roles.permissions.items.admin.all.description',
      },
    ],
  },
  {
    namespace: 'tools',
    labelKey: 'roles.permissions.groups.tools.label',
    descriptionKey: 'roles.permissions.groups.tools.description',
    disabled: false,
    permissions: [
      {
        value: 'tools.read',
        labelKey: 'roles.permissions.items.tools.read.label',
        descriptionKey: 'roles.permissions.items.tools.read.description',
      },
      {
        value: 'tools.create',
        labelKey: 'roles.permissions.items.tools.create.label',
        descriptionKey: 'roles.permissions.items.tools.create.description',
      },
      {
        value: 'tools.update',
        labelKey: 'roles.permissions.items.tools.update.label',
        descriptionKey: 'roles.permissions.items.tools.update.description',
      },
      {
        value: 'tools.delete',
        labelKey: 'roles.permissions.items.tools.delete.label',
        descriptionKey: 'roles.permissions.items.tools.delete.description',
      },
      {
        value: 'tools.*',
        labelKey: 'roles.permissions.items.tools.all.label',
        descriptionKey: 'roles.permissions.items.tools.all.description',
      },
    ],
  },
  {
    namespace: 'skills',
    labelKey: 'roles.permissions.groups.skills.label',
    descriptionKey: 'roles.permissions.groups.skills.description',
    disabled: false,
    permissions: [
      {
        value: 'skills.read',
        labelKey: 'roles.permissions.items.skills.read.label',
        descriptionKey: 'roles.permissions.items.skills.read.description',
      },
      {
        value: 'skills.create',
        labelKey: 'roles.permissions.items.skills.create.label',
        descriptionKey: 'roles.permissions.items.skills.create.description',
      },
      {
        value: 'skills.update',
        labelKey: 'roles.permissions.items.skills.update.label',
        descriptionKey: 'roles.permissions.items.skills.update.description',
      },
      {
        value: 'skills.delete',
        labelKey: 'roles.permissions.items.skills.delete.label',
        descriptionKey: 'roles.permissions.items.skills.delete.description',
      },
      {
        value: 'skills.*',
        labelKey: 'roles.permissions.items.skills.all.label',
        descriptionKey: 'roles.permissions.items.skills.all.description',
      },
    ],
  },
  {
    namespace: 'agent_types',
    labelKey: 'roles.permissions.groups.agent_types.label',
    descriptionKey: 'roles.permissions.groups.agent_types.description',
    disabled: false,
    permissions: [
      {
        value: 'agent_types.read',
        labelKey: 'roles.permissions.items.agent_types.read.label',
        descriptionKey: 'roles.permissions.items.agent_types.read.description',
      },
      {
        value: 'agent_types.create',
        labelKey: 'roles.permissions.items.agent_types.create.label',
        descriptionKey: 'roles.permissions.items.agent_types.create.description',
      },
      {
        value: 'agent_types.update',
        labelKey: 'roles.permissions.items.agent_types.update.label',
        descriptionKey: 'roles.permissions.items.agent_types.update.description',
      },
      {
        value: 'agent_types.delete',
        labelKey: 'roles.permissions.items.agent_types.delete.label',
        descriptionKey: 'roles.permissions.items.agent_types.delete.description',
      },
      {
        value: 'agent_types.*',
        labelKey: 'roles.permissions.items.agent_types.all.label',
        descriptionKey: 'roles.permissions.items.agent_types.all.description',
      },
    ],
  },
  {
    namespace: 'agents',
    labelKey: 'roles.permissions.groups.agents.label',
    descriptionKey: 'roles.permissions.groups.agents.description',
    disabled: false,
    permissions: [
      {
        value: 'agents.read',
        labelKey: 'roles.permissions.items.agents.read.label',
        descriptionKey: 'roles.permissions.items.agents.read.description',
      },
      {
        value: 'agents.create',
        labelKey: 'roles.permissions.items.agents.create.label',
        descriptionKey: 'roles.permissions.items.agents.create.description',
      },
      {
        value: 'agents.update',
        labelKey: 'roles.permissions.items.agents.update.label',
        descriptionKey: 'roles.permissions.items.agents.update.description',
      },
      {
        value: 'agents.delete',
        labelKey: 'roles.permissions.items.agents.delete.label',
        descriptionKey: 'roles.permissions.items.agents.delete.description',
      },
      {
        value: 'agents.*',
        labelKey: 'roles.permissions.items.agents.all.label',
        descriptionKey: 'roles.permissions.items.agents.all.description',
      },
    ],
  },
  {
    namespace: 'super',
    labelKey: 'roles.permissions.groups.super.label',
    descriptionKey: 'roles.permissions.groups.super.description',
    disabled: false,

    permissions: [
      {
        value: '*',
        labelKey: 'roles.permissions.items.super.all.label',
        descriptionKey: 'roles.permissions.items.super.all.description',
      },
    ],
  },
];

// Admin User Types

export type UserStatus = 'active' | 'inactive' | 'suspended';

export interface AdminUserResponse {
  id: string;
  email: string;
  emailVerified: boolean;
  profileComplete: boolean;
  profile: {
    firstName?: string;
    lastName?: string;
    company?: string;
  };
  status: UserStatus;
  plan?: {
    id: string;
    slug: string;
    startedAt?: string;
  };
  roles: {
    id: string;
    name: string;
  }[];
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
}

export interface AdminUserListResponse {
  users: AdminUserResponse[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AdminUserListParams {
  page?: number;
  limit?: number;
  search?: string;
  status?: UserStatus;
  emailVerified?: boolean;
  profileComplete?: boolean;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface AssignPlanRequest {
  planId: string;
}

// Audit Log Types

export type AuditLogStatus = 'success' | 'failure';

export interface AuditLogResponse {
  id: string;
  actorId: string;
  actorEmail: string;
  action: string;
  targetId?: string;
  targetType?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  status: AuditLogStatus;
  failureReason?: string;
  createdAt: string;
}

export interface AuditLogListResponse {
  logs: AuditLogResponse[];
  total: number;
  hasMore: boolean;
}

export interface AuditLogQueryParams {
  actorId?: string;
  actorEmail?: string;
  action?: string;
  feature?: string;
  targetType?: string;
  status?: AuditLogStatus;
  startDate?: string;
  endDate?: string;
  limit?: number;
  skip?: number;
}

// System Log Types

export type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG' | 'VERBOSE';

export interface LogEntry {
  _id?: string;
  timestamp: string;
  level: string;
  context?: string;
  message: string;
  data?: Record<string, unknown>;
  traceId?: string;
  requestId?: string;
  hostname?: string;
  nodeEnv?: string;
  createdAt?: string;
  _fromBuffer?: boolean;
}

export interface LogQueryResult {
  data: LogEntry[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export interface LogQueryParams {
  level?: string;
  context?: string;
  message?: string;
  requestId?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
  sort?: 'asc' | 'desc';
}

// Report Types

export type ReportReason = 'inaccurate' | 'wrong_information' | 'offensive' | 'out_of_context' | 'hallucination' | 'other';

export type ReportStatus = 'pending' | 'reviewed' | 'resolved';

export interface ReportResponse {
  id: string;
  conversationId: string;
  messageId: string;
  userId: string;
  reason: ReportReason;
  description: string;
  status: ReportStatus;
  adminNotes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MessageComponent {
  type: string;
  data: Record<string, unknown>;
}

export interface ReportDetailResponse extends ReportResponse {
  userMessage: {
    id: string;
    content: string;
    attachedFileIds?: string[];
    createdAt: string;
  };
  aiMessage: {
    id: string;
    components: MessageComponent[];
    requestId?: string;
    inputTokens?: number;
    outputTokens?: number;
    durationMs?: number;
    isComplete: boolean;
    createdAt: string;
  };
  reporter: {
    id: string;
    email: string;
  };
}

export interface ReportListResponse {
  reports: ReportResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ReportQueryParams {
  page?: number;
  limit?: number;
  status?: ReportStatus;
  reason?: ReportReason;
  sortOrder?: 'asc' | 'desc';
}

export interface UpdateReportStatusRequest {
  status: ReportStatus;
  adminNotes?: string;
}

// Admin Model Types

export interface AdminModelResponse {
  id: string;
  name: string;
  chef: string;
  chefSlug: string;
  litellmModel: string;
  providers: string[];
  type: string;
  types: string[];
  isActive: boolean;
  isDefault: boolean;
  omitTemperature: boolean;
  inputModalities: ModelInputModality[];
}

export interface AdminModelsListResponse {
  models: AdminModelResponse[];
  total: number;
}

export const MODEL_TYPES = [
  'chat',
  'completion',
  'embedding',
  'image_generation',
  'audio_transcription',
  'audio_speech',
  'moderation',
  'guardrails_classifier',
  'search',
] as const;

export type ModelType = (typeof MODEL_TYPES)[number];

export const MODEL_INPUT_MODALITIES = ['text', 'image'] as const;
export type ModelInputModality = (typeof MODEL_INPUT_MODALITIES)[number];

export interface UpdateModelRequest {
  name?: string;
  chef?: string;
  chefSlug?: string;
  providers?: string[];
  type?: string;
  types?: ModelType[];
  isActive?: boolean;
  omitTemperature?: boolean;
  inputModalities?: ModelInputModality[];
}

export interface SyncModelsResponse {
  added: number;
  updated: number;
  reactivated: number;
  deactivated: number;
  total: number;
}

export interface AdminPlaybookSettings {
  inferenceModelId: string | null;
  advisorEvaluationModelId: string | null;
  replayEvaluationModelId: string | null;
  nodeSuggestionsMode: 'auto' | 'manual';
  approvalSuggestionMode: 'auto' | 'manual';
  intentNormalizationLimits: {
    maxWorkflowPlanChanges: number;
    maxInputPorts: number;
    maxOutputPorts: number;
    maxIteratorBodySteps: number;
    maxIteratorBodyEdges: number;
  };
  replayEligibilityConfidenceThreshold: number;
  useDeterministicBlueprintBuilder: boolean;
}

export interface UpdateAdminPlaybookSettingsRequest {
  inferenceModelId?: string | null;
  advisorEvaluationModelId?: string | null;
  replayEvaluationModelId?: string | null;
  nodeSuggestionsMode?: 'auto' | 'manual';
  approvalSuggestionMode?: 'auto' | 'manual';
  intentNormalizationLimits?: Partial<AdminPlaybookSettings['intentNormalizationLimits']>;
  replayEligibilityConfidenceThreshold?: number;
  useDeterministicBlueprintBuilder?: boolean;
}

// Playbook Prompt Types

import type { PlaybookIteratorConfig, PlaybookNodeType, RouterConfig } from '@/modules/playbook';

export interface PlaybookPromptResponse {
  id: string;
  key: string;
  title: string;
  category: string;
  description?: string;
  systemTemplate: string;
  userTemplate: string;
  enabled: boolean;
  version: number;
  isBuiltIn: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PlaybookPromptListResponse {
  items: PlaybookPromptResponse[];
}

export interface PlaybookPromptImportPayload {
  version: 1;
  type: 'playbook-prompts';
  items: Array<Omit<PlaybookPromptResponse, 'id' | 'createdAt' | 'updatedAt' | 'version'>>;
}

export interface UpsertPlaybookPromptRequest {
  title: string;
  category: string;
  description?: string;
  systemTemplate?: string;
  userTemplate?: string;
  enabled?: boolean;
}

// Playbook Node Template Types

export interface PlaybookNodeTemplatePort {
  id: string;
  name: string;
  artifactKind: string;
  required?: boolean;
  description?: string;
}

export interface PlaybookNodeTemplateResponse {
  id: string;
  key: string;
  nodeType: PlaybookNodeType;
  title: string;
  description?: string;
  icon?: string;
  color?: string;
  category: string;
  inputPorts: PlaybookNodeTemplatePort[];
  outputPorts: PlaybookNodeTemplatePort[];
  promptTemplate: string;
  recommendedAgentTypeSlug: string | null;
  requiredToolNames: string[];
  assignedAgentId: string | null;
  selectedAction: string | null;
  iteratorConfig?: PlaybookIteratorConfig | null;
  routerConfig?: RouterConfig | null;
  enabled: boolean;
  version: number;
  isBuiltIn: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PlaybookNodeTemplateListResponse {
  items: PlaybookNodeTemplateResponse[];
}

export interface PlaybookNodeTemplateImportPayload {
  version: 1;
  type: 'playbook-node-templates';
  items: Array<Omit<PlaybookNodeTemplateResponse, 'id' | 'createdAt' | 'updatedAt' | 'version'>>;
}

export interface CreatePlaybookNodeTemplateRequest {
  key: string;
  nodeType: PlaybookNodeType;
  title: string;
  description?: string;
  icon?: string;
  color?: string;
  category: string;
  inputPorts: PlaybookNodeTemplatePort[];
  outputPorts: PlaybookNodeTemplatePort[];
  promptTemplate?: string;
  recommendedAgentTypeSlug?: string | null;
  requiredToolNames?: string[];
  assignedAgentId?: string | null;
  selectedAction?: string | null;
  iteratorConfig?: PlaybookIteratorConfig | null;
  routerConfig?: RouterConfig | null;
  enabled?: boolean;
}

export interface UpdatePlaybookNodeTemplateRequest {
  key?: string;
  nodeType?: PlaybookNodeType;
  title?: string;
  description?: string;
  icon?: string;
  color?: string;
  category?: string;
  inputPorts?: PlaybookNodeTemplatePort[];
  outputPorts?: PlaybookNodeTemplatePort[];
  promptTemplate?: string;
  recommendedAgentTypeSlug?: string | null;
  requiredToolNames?: string[];
  assignedAgentId?: string | null;
  selectedAction?: string | null;
  iteratorConfig?: PlaybookIteratorConfig | null;
  routerConfig?: RouterConfig | null;
  enabled?: boolean;
}

// Agent Type Types

export interface AgentTypeResponse {
  id: string;
  name: string;
  slug: string;
  defaultPrompt: string;
  skills?: string[];
  promptCount: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentTypeListResponse {
  data: AgentTypeResponse[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface CreateAgentTypeRequest {
  name: string;
  defaultPrompt?: string;
  skills?: string[];
  isActive?: boolean;
}

export interface UpdateAgentTypeRequest {
  name?: string;
  defaultPrompt?: string;
  skills?: string[];
  isActive?: boolean;
}

export interface AgentTypePromptResponse {
  id: string;
  agentTypeId: string;
  modelId: string;
  prompt: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertAgentTypePromptRequest {
  prompt: string;
}

export interface AgentTypeQueryParams {
  page?: number;
  limit?: number;
  search?: string;
  isActive?: boolean;
}

// Agent Types (Admin Default Agents)

export interface AgentResponse {
  id: string;
  name: string;
  slug: string;
  agentType: { id: string; name: string };
  role: string;
  description: string;
  temperature: number;
  model?: string;
  instruction: string;
  ignorePrePrompt: boolean;
  knowledgeBases: string[];
  tools: string[];
  skills?: string[];
  disabledSkills?: string[];
  connectors?: string[];
  connectorActionSelections?: AgentConnectorActionSelection[];
  guardrails?: AgentGuardrails;
  deploymentSettings?: AgentDeploymentSettings;
  enable_temporary_child_agents?: boolean;
  max_temporary_child_agents?: number;
  isDefault: boolean;
  isDefaultForType: boolean;
  isActive: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentListResponse {
  data: AgentResponse[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface CreateAgentRequest {
  name: string;
  slug: string;
  agentType: string;
  role: string;
  description?: string;
  temperature?: number;
  model?: string;
  instruction?: string;
  ignorePrePrompt?: boolean;
  knowledgeBases?: string[];
  tools?: string[];
  skills?: string[];
  disabledSkills?: string[];
  connectors?: string[];
  connectorActionSelections?: AgentConnectorActionSelection[];
  enable_temporary_child_agents?: boolean;
  max_temporary_child_agents?: number;
  isActive?: boolean;
  isDefaultForType?: boolean;
  guardrails?: AgentGuardrails;
  deploymentSettings?: AgentDeploymentSettings;
}

export interface UpdateAgentRequest {
  name?: string;
  slug?: string;
  agentType?: string;
  role?: string;
  description?: string;
  temperature?: number;
  model?: string;
  instruction?: string;
  ignorePrePrompt?: boolean;
  knowledgeBases?: string[];
  tools?: string[];
  skills?: string[];
  disabledSkills?: string[];
  connectors?: string[];
  connectorActionSelections?: AgentConnectorActionSelection[];
  enable_temporary_child_agents?: boolean;
  max_temporary_child_agents?: number;
  isActive?: boolean;
  isDefaultForType?: boolean;
  guardrails?: AgentGuardrails;
  deploymentSettings?: AgentDeploymentSettings;
}

export interface AgentQueryParams {
  page?: number;
  limit?: number;
  search?: string;
  agentType?: string;
  isActive?: boolean;
  isDefault?: boolean;
}

// Tool Types

export type ToolAttributeType = 'string' | 'number' | 'boolean' | 'enum';

export interface ToolAttributeResponse {
  id?: string;
  name: string;
  type: ToolAttributeType;
  value: string | number | boolean;
  options?: string[];
}

export interface ToolResponse {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  iconColor: 'light' | 'dark';
  categoryId: string | null;
  defaultAgentTypes: string[];
  attributes: ToolAttributeResponse[];
  requiredAppKey?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ToolCategoryResponse {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateToolCategoryRequest {
  name: string;
  description?: string;
}

export interface UpdateToolCategoryRequest {
  name?: string;
  description?: string;
}

export interface ToolListResponse {
  data: ToolResponse[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface ToolAttributeInput {
  name: string;
  type: ToolAttributeType;
  value: string | number | boolean;
  options?: string[];
}

export interface CreateToolRequest {
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  iconColor?: 'light' | 'dark';
  categoryId?: string | null;
  defaultAgentTypes?: string[];
  attributes?: ToolAttributeInput[];
  requiredAppKey?: string;
  isActive?: boolean;
}

export interface UpdateToolRequest {
  name?: string;
  description?: string;
  icon?: string;
  color?: string;
  iconColor?: 'light' | 'dark';
  categoryId?: string | null;
  defaultAgentTypes?: string[];
  attributes?: ToolAttributeInput[];
  requiredAppKey?: string;
  isActive?: boolean;
}

export interface ToolQueryParams {
  page?: number;
  limit?: number;
  search?: string;
  agentType?: string;
  isActive?: boolean;
}

export type SkillFileKind = 'reference' | 'asset';

export interface SkillFileResponse {
  path: string;
  kind: SkillFileKind;
  mimeType: string;
  content: string;
}

export interface SkillResponse {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  iconColor: 'light' | 'dark';
  categoryId: string | null;
  license: string;
  compatibility: string;
  metadata: Record<string, string>;
  allowedTools: string[];
  instructions: string;
  files: SkillFileResponse[];
  isActive: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface SkillListResponse {
  data: SkillResponse[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface SkillFileInput {
  path: string;
  kind: SkillFileKind;
  mimeType?: string;
  content?: string;
}

export interface SkillCategoryResponse {
  id: string;
  name: string;
  description: string;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSkillCategoryRequest {
  name: string;
  description?: string;
}

export interface UpdateSkillCategoryRequest {
  name?: string;
  description?: string;
}

export interface CreateSkillRequest {
  slug?: string;
  name: string;
  description: string;
  icon?: string;
  color?: string;
  iconColor?: 'light' | 'dark';
  categoryId?: string | null;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  allowedTools?: string[];
  instructions?: string;
  files?: SkillFileInput[];
  isActive?: boolean;
}

export interface UpdateSkillRequest {
  name?: string;
  description?: string;
  icon?: string;
  color?: string;
  iconColor?: 'light' | 'dark';
  categoryId?: string | null;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  allowedTools?: string[];
  instructions?: string;
  files?: SkillFileInput[];
  isActive?: boolean;
}

export interface SkillQueryParams {
  page?: number;
  limit?: number;
  search?: string;
  isActive?: boolean;
}

// === Connector ===

export interface ConnectorActionResponse {
  key: string;
  label: string;
  description: string;
  parameterSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  safety: string;
  supportsBatch: boolean;
  supportsIteration: boolean;
  isEnabled: boolean;
}

export type ConnectorDynamicHeaderSource =
  | 'user_id'
  | 'user_email'
  | 'user_first_name'
  | 'user_last_name'
  | 'user_full_name';

export interface ConnectorDynamicHeader {
  headerName: string;
  source: ConnectorDynamicHeaderSource;
  enabled: boolean;
}

export interface ConnectorResponse {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  iconColor: 'light' | 'dark';
  categoryId: string | null;
  authType: string;
  authConfigSchema: Record<string, unknown>;
  authSourceType: string;
  connectedAppKey: string;
  runtimeAuthConfig: Record<string, unknown>;
  mcpTransportType: string;
  mcpServerUrl: string;
  mcpServerConfig: Record<string, unknown>;
  dynamicHeaders: ConnectorDynamicHeader[];
  actions: ConnectorActionResponse[];
  referencedSkillIds: string[];
  isActive: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectorListResponse {
  data: ConnectorResponse[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface CreateConnectorRequest {
  slug: string;
  name: string;
  description: string;
  icon?: string;
  color?: string;
  iconColor?: 'light' | 'dark';
  categoryId?: string | null;
  authType?: string;
  authConfigSchema?: Record<string, unknown>;
  authSourceType?: string;
  connectedAppKey?: string;
  runtimeAuthConfig?: Record<string, unknown>;
  mcpTransportType?: string;
  mcpServerUrl?: string;
  mcpServerConfig?: Record<string, unknown>;
  dynamicHeaders?: ConnectorDynamicHeader[];
  actions?: Array<{
    key: string;
    label: string;
    description?: string;
    parameterSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    safety?: string;
    supportsBatch?: boolean;
    supportsIteration?: boolean;
    isEnabled?: boolean;
  }>;
  referencedSkillIds?: string[];
  isActive?: boolean;
}

export interface UpdateConnectorRequest extends Partial<CreateConnectorRequest> { }

export interface ConnectorQueryParams {
  page?: number;
  limit?: number;
  search?: string;
  isActive?: boolean;
}

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpInspectResult {
  serverName: string;
  tools: McpToolDefinition[];
  error?: string;
}

export interface ConnectorCategoryResponse {
  id: string;
  name: string;
  description: string;
  isSystem: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateConnectorCategoryRequest {
  name: string;
  description?: string;
}

export interface UpdateConnectorCategoryRequest {
  name?: string;
  description?: string;
}

export interface ConnectorOAuthStatusResponse {
  appKey: string;
  connected: boolean;
  status?: string;
  connectedAt?: string;
  disconnectedAt?: string;
  providerEmail?: string;
}

export type CatalogConflictPolicy = 'skip' | 'overwrite';

export interface CatalogExportRequest {
  selection: 'all' | 'selected';
  ids?: string[];
  includeSecurity?: boolean;
  passphrase?: string;
}

export interface CatalogImportResult {
  skills: { created: number; updated: number; skipped: number };
  connectors: { created: number; updated: number; skipped: number };
  categories: { created: number; reused: number };
  security: { credentials: number; connectedApps: number; tokens: number };
}

// Workspace Upload Settings Types

export interface WorkspaceUploadSettingsResponse {
  allowedExtensions: string[];
  supportedExtensions: string[];
  updatedAt?: string;
}

export interface UpdateWorkspaceUploadSettingsRequest {
  allowedExtensions: string[];
}

export interface WorkspaceEvidenceSearchSettingsResponse { connectorId: string | null; updatedAt?: string; }
export interface UpdateWorkspaceEvidenceSearchSettingsRequest { connectorId: string | null; }
export interface WorkspaceEvidenceSearchConnectorOption { id: string; name: string; }
export interface WorkspaceTransformationSettingsResponse { decisionFlowAgentId: string | null; updatedAt?: string; }
export interface UpdateWorkspaceTransformationSettingsRequest { decisionFlowAgentId: string | null; }
export interface WorkspaceTransformationAgentOption { id: string; name: string; description?: string; agentTypeName?: string; model?: string; }

export interface ComposerSuggestionSettings {
  enabled: boolean;
  agentId: string | null;
  debounceMs: number;
  minimumDraftLength: number;
  requestsPerMinute: number;
  maxOutputTokens: number;
}
export interface ConversationSettingsResponse { composerSuggestions: ComposerSuggestionSettings; updatedAt?: string; }
export type UpdateConversationSettingsRequest = Pick<ConversationSettingsResponse, 'composerSuggestions'>;
export interface ConversationSettingsAgentOption { id: string; name: string; description?: string; agentTypeName?: string; model?: string; }

// ===== Team Auto-Builder =====

export interface TeamAutoBuilderConfigResponse {
  modelId: string;
  systemPrompt: string;
  temperature: number;
  isEnabled: boolean;
  updatedAt: string;
}

export interface UpsertTeamAutoBuilderConfigRequest {
  modelId: string;
  systemPrompt: string;
  temperature: number;
  isEnabled: boolean;
}
