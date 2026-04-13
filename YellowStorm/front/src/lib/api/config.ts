/**
 * API Configuration
 */

export const API_CONFIG = {
  baseURL: process.env.NODE_ENV === 'development'
    ? import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1'
    : 'MY_APP_VITE_API_URL',
  timeout: 30000,
  withCredentials: true, // Required for HTTP-only cookies (refresh token)
} as const;

export const AUTH_STORAGE_KEYS = {
  accessToken: 'yellostorm_access_token',
  user: 'yellostorm_user',
} as const;

export const API_ENDPOINTS = {
  auth: {
    register: '/auth/register',
    login: '/auth/login',
    logout: '/auth/logout',
    refresh: '/auth/refresh',
    verifyEmail: '/auth/verify-email',
    resendVerification: '/auth/resend-verification',
    resendVerificationPublic: '/auth/resend-verification-public',
    sessions: '/auth/sessions',
    forgotPassword: '/auth/forgot-password',
    resetPassword: '/auth/reset-password',
  },
  users: {
    me: '/users/me',
    completeProfile: '/users/me/complete-profile',
  },
  health: {
    check: '/health',
    live: '/health/live',
    ready: '/health/ready',
    history: '/health/history',
    stats: '/health/stats',
  },
  system: {
    maintenance: '/experimental/system/maintenance',
    registration: '/experimental/system/registration',
  },
  usage: {
    status: '/usage/status',
    plan: '/usage/plan',
    history: '/usage/history',
    plans: '/usage/plans',
    plansAll: '/usage/plans/all',
    planById: (id: string) => `/usage/plans/${id}`,
  },
  notifications: {
    stream: '/notifications/stream',
    list: '/notifications',
    unreadCount: '/notifications/unread/count',
    markRead: '/notifications/read',
    markAllRead: '/notifications/read-all',
  },
  workspaces: {
    list: '/workspaces',
    create: '/workspaces',
    byId: (id: string) => `/workspaces/${id}`,
    byAlias: (alias: string) => `/workspaces/alias/${alias}`,
  },
  workspaceDocuments: {
    list: (workspaceId: string) => `/workspaces/${workspaceId}/documents`,
    byId: (workspaceId: string, docId: string) =>
      `/workspaces/${workspaceId}/documents/${docId}`,
    downloadUrl: (workspaceId: string, docId: string) =>
      `/workspaces/${workspaceId}/documents/${docId}/download-url`,
    reindex: (workspaceId: string, docId: string) =>
      `/workspaces/${workspaceId}/documents/${docId}/reindex`,
    bulkDelete: (workspaceId: string) => `/workspaces/${workspaceId}/documents`,
    deleteAll: (workspaceId: string) => `/workspaces/${workspaceId}/documents/all`,
    // Upload endpoints
    upload: (workspaceId: string) => `/workspaces/${workspaceId}/documents`,
    uploadUrl: (workspaceId: string) => `/workspaces/${workspaceId}/documents/upload-url`,
    confirm: (workspaceId: string) => `/workspaces/${workspaceId}/documents/confirm`,
    bulk: (workspaceId: string) => `/workspaces/${workspaceId}/documents/bulk`,
    bulkProgress: (workspaceId: string, sessionId: string) =>
      `/workspaces/${workspaceId}/documents/bulk/${sessionId}/progress`,
    bulkComplete: (workspaceId: string, sessionId: string) =>
      `/workspaces/${workspaceId}/documents/bulk/${sessionId}/complete`,
    bulkSession: (workspaceId: string, sessionId: string) =>
      `/workspaces/${workspaceId}/documents/bulk/${sessionId}`,
  },
  workspaceSettings: {
    list: '/workspace-settings',
    templates: '/workspace-settings/templates',
    create: '/workspace-settings',
    byId: (id: string) => `/workspace-settings/${id}`,
  },
  models: {
    list: '/models',
    byId: (id: string) => `/models/${id}`,
    byChef: (chefSlug: string) => `/models/chef/${chefSlug}`,
  },
  conversations: {
    list: '/conversations',
    create: '/conversations',
    byId: (id: string) => `/conversations/${id}`,
    join: (id: string) => `/conversations/${id}/join`,
    messages: (id: string) => `/conversations/${id}/messages`,
    messageById: (convId: string, msgId: string) => `/conversations/${convId}/messages/${msgId}`,
    feedback: (convId: string, msgId: string) => `/conversations/${convId}/messages/${msgId}/feedback`,
    regenerate: (convId: string, msgId: string) => `/conversations/${convId}/messages/${msgId}/regenerate`,
    stop: (convId: string, msgId: string) => `/conversations/${convId}/messages/${msgId}/stop`,
    branches: (convId: string, msgId: string) => `/conversations/${convId}/messages/${msgId}/branches`,
    report: (convId: string, msgId: string) => `/conversations/${convId}/messages/${msgId}/report`,
    workspaceDocuments: (id: string) => `/conversations/${id}/workspace-documents`,
    taggedAgents: (id: string) => `/conversations/${id}/tagged-agents`,
    markMentionSeen: (convId: string, msgId: string) => `/conversations/${convId}/mentions/${msgId}/seen`,
    fileUploadUrl: (convId: string) => `/conversations/${convId}/files/upload-url`,
    fileUpload: (convId: string) => `/conversations/${convId}/files/upload`,
    fileConfirm: (convId: string) => `/conversations/${convId}/files/confirm`,
    fileDelete: (convId: string, docId: string) => `/conversations/${convId}/files/${docId}`,
    stream: '/conversations/stream',
    artifactUrl: '/conversations/artifact-url',
    // Share endpoints
    shares: (id: string) => `/conversations/${id}/shares`,
    share: (id: string) => `/conversations/${id}/share`,
    revokeShare: (convId: string, shareId: string) => `/conversations/${convId}/share/${shareId}`,
    publicShare: (accessToken: string) => `/conversations/shared/${accessToken}`,
  },
  analytics: {
    users: '/experimental/analytics/users',
    usage: '/experimental/analytics/usage',
    conversations: '/experimental/analytics/conversations',
    quality: '/experimental/analytics/quality',
    summary: '/experimental/analytics/summary',
  },
  roles: {
    base: '/admin/roles',
    active: '/admin/roles/active',
    byId: (id: string) => `/admin/roles/${id}`,
    assign: '/admin/roles/assign',
    unassign: '/admin/roles/unassign',
    userRoles: (userId: string) => `/admin/roles/user/${userId}`,
  },
  adminUsers: {
    base: '/admin/users',
    byId: (id: string) => `/admin/users/${id}`,
    suspend: (id: string) => `/admin/users/${id}/suspend`,
    activate: (id: string) => `/admin/users/${id}/activate`,
    assignPlan: (id: string) => `/admin/users/${id}/assign-plan`,
  },
  auditLogs: {
    base: '/admin/audit-logs',
    actions: '/admin/audit-logs/actions',
    features: '/admin/audit-logs/features',
  },
  logs: {
    base: '/admin/logs',
    levels: '/admin/logs/levels',
    contexts: '/admin/logs/contexts',
    counts: '/admin/logs/counts',
  },
  reports: {
    base: '/reports',
    byId: (id: string) => `/reports/${id}`,
    status: (id: string) => `/reports/${id}/status`,
  },
  adminTools: {
    list: '/admin/tools',
    byId: (id: string) => `/admin/tools/${id}`,
  },
  adminAgentTypes: {
    list: '/admin/agent-types',
    byId: (id: string) => `/admin/agent-types/${id}`,
    prompts: (id: string) => `/admin/agent-types/${id}/prompts`,
    promptByModel: (id: string, modelId: string) => `/admin/agent-types/${id}/prompts/${encodeURIComponent(modelId)}`,
  },
  adminAgents: {
    list: '/admin/agents',
    byId: (id: string) => `/admin/agents/${id}`,
  },
  agentTypes: {
    active: '/agent-types/active',
  },
  agents: {
    list: '/agents',
    all: '/agents/all',
    byId: (id: string) => `/agents/${id}`,
  },
  tools: {
    active: '/tools/active',
  },
  playbooks: {
    list: '/playbooks',
    generate: '/playbooks/generate',
    byId: (id: string) => `/playbooks/${id}`,
    execute: (id: string) => `/playbooks/${id}/execute`,
    resume: (id: string) => `/playbooks/${id}/resume`,
    skipStep: (id: string) => `/playbooks/${id}/skip-step`,
    rerunStep: (id: string, executionId: string) => `/playbooks/${id}/executions/${executionId}/rerun-step`,
    resumeFromStep: (id: string, executionId: string) => `/playbooks/${id}/executions/${executionId}/resume-from-step`,
    stop: (id: string) => `/playbooks/${id}/stop`,
    executions: (id: string) => `/playbooks/${id}/executions`,
    execution: (id: string, execId: string) => `/playbooks/${id}/executions/${execId}`,
    deleteAllExecutions: (id: string) => `/playbooks/${id}/executions`,
    deleteExecution: (id: string, execId: string) => `/playbooks/${id}/executions/${execId}`,
    deleteStepExecution: (id: string, execId: string, taskId: string, stepExecutionId: string) =>
      `/playbooks/${id}/executions/${execId}/tasks/${taskId}/step-executions/${stepExecutionId}`,
    validateReplay: (id: string, taskId: string) => `/playbooks/${id}/tasks/${taskId}/validate-replay`,
    replays: (id: string, taskId: string) => `/playbooks/${id}/tasks/${taskId}/replays`,
    activateReplay: (id: string, taskId: string, replayId: string) => `/playbooks/${id}/tasks/${taskId}/replays/${replayId}/activate`,
    updateReplayFormatGuide: (id: string, taskId: string, replayId: string) => `/playbooks/${id}/tasks/${taskId}/replays/${replayId}/format-guide`,
    grabOutputFormatTemplate: (id: string, taskId: string) => `/playbooks/${id}/tasks/${taskId}/output-format-template`,
    outputFormatTemplate: (id: string, taskId: string) => `/playbooks/${id}/tasks/${taskId}/output-format-template`,
    stream: '/playbooks/stream',
    design: (id: string) => `/playbooks/${id}/design`,
    designMessages: (id: string) => `/playbooks/${id}/design-messages`,
    revertDesign: (id: string, msgId: string) => `/playbooks/${id}/design-messages/${msgId}/revert`,
    clone: (id: string) => `/playbooks/${id}/clone`,
    cloneShare: (id: string) => `/playbooks/${id}/clone-share`,
    favorite: (id: string) => `/playbooks/${id}/favorite`,
    bulkDelete: '/playbooks/bulk-delete',
    activeExecutions: '/playbooks/active-executions',
    schedule: (id: string) => `/playbooks/${id}/schedule`,
  },
  adminModels: {
    list: '/admin/models',
    byId: (id: string) => `/admin/models/${id}`,
    setDefault: (id: string) => `/admin/models/${id}/set-default`,
    clearDefault: (id: string) => `/admin/models/${id}/clear-default`,
    sync: '/admin/models/sync',
    default: '/admin/models/default',
  },
} as const;
