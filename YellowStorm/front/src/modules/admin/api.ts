/**
 * Admin API Functions
 */

import apiClient, { type ApiResponse } from '@/lib/api/client';
import { API_ENDPOINTS } from '@/lib/api/config';
import type {
  AgentTypeListResponse,
  AgentTypeResponse,
  CreateAgentTypeRequest,
  UpdateAgentTypeRequest,
  AgentTypeQueryParams,
  AgentTypePromptResponse,
  UpsertAgentTypePromptRequest,
  AgentListResponse,
  AgentResponse,
  CreateAgentRequest,
  UpdateAgentRequest,
  AgentQueryParams,
  AnalyticsQueryParams,
  UserAnalyticsResponse,
  UsageAnalyticsResponse,
  ConversationAnalyticsResponse,
  QualityAnalyticsResponse,
  SummaryAnalyticsResponse,
  MaintenanceStatus,
  SetMaintenanceRequest,
  RegistrationStatus,
  SetRegistrationRequest,
  CorsSettings,
  SetCorsSettingsRequest,
  AppearanceSettings,
  PlanResponse,
  CreatePlanRequest,
  UpdatePlanRequest,
  RoleResponse,
  CreateRoleRequest,
  UpdateRoleRequest,
  AssignRoleRequest,
  AdminUserResponse,
  AdminUserListResponse,
  AdminUserListParams,
  AssignPlanRequest,
  AuditLogListResponse,
  AuditLogQueryParams,
  LogQueryResult,
  LogQueryParams,
  ReportListResponse,
  ReportDetailResponse,
  ReportResponse,
  ReportQueryParams,
  UpdateReportStatusRequest,
  AdminModelsListResponse,
  AdminModelResponse,
  UpdateModelRequest,
  SyncModelsResponse,
  AdminPlaybookSettings,
  UpdateAdminPlaybookSettingsRequest,
  PlaybookPromptListResponse,
  PlaybookPromptResponse,
  UpsertPlaybookPromptRequest,
  PlaybookNodeTemplateListResponse,
  PlaybookNodeTemplateResponse,
  CreatePlaybookNodeTemplateRequest,
  UpdatePlaybookNodeTemplateRequest,
  ToolListResponse,
  ToolResponse,
  ToolCategoryResponse,
  CreateToolRequest,
  UpdateToolRequest,
  CreateToolCategoryRequest,
  UpdateToolCategoryRequest,
  ToolQueryParams,
  SkillListResponse,
  SkillResponse,
  SkillCategoryResponse,
  CreateSkillRequest,
  UpdateSkillRequest,
  CreateSkillCategoryRequest,
  UpdateSkillCategoryRequest,
  SkillQueryParams,
  ConnectorListResponse,
  ConnectorResponse,
  CreateConnectorRequest,
  UpdateConnectorRequest,
  ConnectorQueryParams,
  McpInspectResult,
  ConnectorOAuthStatusResponse,
  ConnectorCategoryResponse,
  CreateConnectorCategoryRequest,
  UpdateConnectorCategoryRequest,
  TeamAutoBuilderConfigResponse,
  UpsertTeamAutoBuilderConfigRequest,
} from './types';

// Helper to build query string
function buildQueryString(params: AnalyticsQueryParams): string {
  const searchParams = new URLSearchParams();
  if (params.dateFrom) searchParams.set('dateFrom', params.dateFrom);
  if (params.dateTo) searchParams.set('dateTo', params.dateTo);
  if (params.groupBy) searchParams.set('groupBy', params.groupBy);
  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : '';
}

// Analytics API

export async function getUserAnalytics(
  params: AnalyticsQueryParams = {}
): Promise<UserAnalyticsResponse> {
  const response = await apiClient.get<ApiResponse<UserAnalyticsResponse>>(
    `${API_ENDPOINTS.analytics.users}${buildQueryString(params)}`
  );
  return response.data.data;
}

export async function getUsageAnalytics(
  params: AnalyticsQueryParams = {}
): Promise<UsageAnalyticsResponse> {
  const response = await apiClient.get<ApiResponse<UsageAnalyticsResponse>>(
    `${API_ENDPOINTS.analytics.usage}${buildQueryString(params)}`
  );
  return response.data.data;
}

export async function getConversationAnalytics(
  params: AnalyticsQueryParams = {}
): Promise<ConversationAnalyticsResponse> {
  const response = await apiClient.get<ApiResponse<ConversationAnalyticsResponse>>(
    `${API_ENDPOINTS.analytics.conversations}${buildQueryString(params)}`
  );
  return response.data.data;
}

export async function getQualityAnalytics(
  params: AnalyticsQueryParams = {}
): Promise<QualityAnalyticsResponse> {
  const response = await apiClient.get<ApiResponse<QualityAnalyticsResponse>>(
    `${API_ENDPOINTS.analytics.quality}${buildQueryString(params)}`
  );
  return response.data.data;
}

export async function getSummaryAnalytics(
  params: AnalyticsQueryParams = {}
): Promise<SummaryAnalyticsResponse> {
  const response = await apiClient.get<ApiResponse<SummaryAnalyticsResponse>>(
    `${API_ENDPOINTS.analytics.summary}${buildQueryString(params)}`
  );
  return response.data.data;
}

// System API

export async function getMaintenanceStatus(): Promise<MaintenanceStatus> {
  const response = await apiClient.get<ApiResponse<MaintenanceStatus>>(
    API_ENDPOINTS.system.maintenance
  );
  return response.data.data;
}

export async function setMaintenanceMode(
  data: SetMaintenanceRequest
): Promise<MaintenanceStatus> {
  const response = await apiClient.post<ApiResponse<MaintenanceStatus>>(
    API_ENDPOINTS.system.maintenance,
    data
  );
  return response.data.data;
}

export async function getRegistrationStatus(): Promise<RegistrationStatus> {
  const response = await apiClient.get<ApiResponse<RegistrationStatus>>(
    API_ENDPOINTS.system.registration
  );
  return response.data.data;
}

export async function setRegistrationStatus(
  data: SetRegistrationRequest
): Promise<RegistrationStatus> {
  const response = await apiClient.post<ApiResponse<RegistrationStatus>>(
    API_ENDPOINTS.system.registration,
    data
  );
  return response.data.data;
}

export async function getCorsSettings(): Promise<CorsSettings> {
  const response = await apiClient.get<ApiResponse<CorsSettings>>(API_ENDPOINTS.system.cors);
  return response.data.data;
}

export async function setCorsSettings(data: SetCorsSettingsRequest): Promise<CorsSettings> {
  const response = await apiClient.post<ApiResponse<CorsSettings>>(
    API_ENDPOINTS.system.cors,
    data,
  );
  return response.data.data;
}

export async function getAppearanceSettings(): Promise<AppearanceSettings> {
  const response = await apiClient.get<ApiResponse<AppearanceSettings>>(
    `${API_ENDPOINTS.system.maintenance.replace('/maintenance', '/appearance')}`
  );
  return response.data.data;
}

export async function setAppearanceSettings(data: AppearanceSettings): Promise<AppearanceSettings> {
  const response = await apiClient.post<ApiResponse<AppearanceSettings>>(
    `${API_ENDPOINTS.system.maintenance.replace('/maintenance', '/appearance')}`,
    data
  );
  return response.data.data;
}

// Plans API

export async function getAllPlans(): Promise<PlanResponse[]> {
  const response = await apiClient.get<ApiResponse<PlanResponse[]>>(
    API_ENDPOINTS.usage.plansAll
  );
  return response.data.data;
}

export async function createPlan(data: CreatePlanRequest): Promise<PlanResponse> {
  const response = await apiClient.post<ApiResponse<PlanResponse>>(
    API_ENDPOINTS.usage.plans,
    data
  );
  return response.data.data;
}

export async function updatePlan(
  id: string,
  data: UpdatePlanRequest
): Promise<PlanResponse> {
  const response = await apiClient.put<ApiResponse<PlanResponse>>(
    API_ENDPOINTS.usage.planById(id),
    data
  );
  return response.data.data;
}

export async function deletePlan(id: string): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.usage.planById(id));
}

// Roles API

export async function getAllRoles(): Promise<RoleResponse[]> {
  const response = await apiClient.get<ApiResponse<RoleResponse[]>>(
    API_ENDPOINTS.roles.base
  );
  return response.data.data;
}

export async function getActiveRoles(): Promise<RoleResponse[]> {
  const response = await apiClient.get<ApiResponse<RoleResponse[]>>(
    API_ENDPOINTS.roles.active
  );
  return response.data.data;
}

export async function getRoleById(id: string): Promise<RoleResponse> {
  const response = await apiClient.get<ApiResponse<RoleResponse>>(
    API_ENDPOINTS.roles.byId(id)
  );
  return response.data.data;
}

export async function createRole(data: CreateRoleRequest): Promise<RoleResponse> {
  const response = await apiClient.post<ApiResponse<RoleResponse>>(
    API_ENDPOINTS.roles.base,
    data
  );
  return response.data.data;
}

export async function updateRole(
  id: string,
  data: UpdateRoleRequest
): Promise<RoleResponse> {
  const response = await apiClient.put<ApiResponse<RoleResponse>>(
    API_ENDPOINTS.roles.byId(id),
    data
  );
  return response.data.data;
}

export async function deleteRole(id: string): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.roles.byId(id));
}

export async function assignRoleToUser(data: AssignRoleRequest): Promise<void> {
  await apiClient.post(API_ENDPOINTS.roles.assign, data);
}

export async function unassignRoleFromUser(data: AssignRoleRequest): Promise<void> {
  await apiClient.post(API_ENDPOINTS.roles.unassign, data);
}

export async function getUserRoles(userId: string): Promise<RoleResponse[]> {
  const response = await apiClient.get<ApiResponse<RoleResponse[]>>(
    API_ENDPOINTS.roles.userRoles(userId)
  );
  return response.data.data;
}

// Admin Users API

function buildUserQueryString(params: AdminUserListParams): string {
  const searchParams = new URLSearchParams();
  if (params.page) searchParams.set('page', params.page.toString());
  if (params.limit) searchParams.set('limit', params.limit.toString());
  if (params.search) searchParams.set('search', params.search);
  if (params.status) searchParams.set('status', params.status);
  if (params.emailVerified !== undefined) searchParams.set('emailVerified', params.emailVerified.toString());
  if (params.profileComplete !== undefined) searchParams.set('profileComplete', params.profileComplete.toString());
  if (params.sortBy) searchParams.set('sortBy', params.sortBy);
  if (params.sortOrder) searchParams.set('sortOrder', params.sortOrder);
  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : '';
}

export async function getAdminUsers(
  params: AdminUserListParams = {}
): Promise<AdminUserListResponse> {
  const response = await apiClient.get<ApiResponse<AdminUserListResponse>>(
    `${API_ENDPOINTS.adminUsers.base}${buildUserQueryString(params)}`
  );
  return response.data.data;
}

export async function getAdminUserById(id: string): Promise<AdminUserResponse> {
  const response = await apiClient.get<ApiResponse<AdminUserResponse>>(
    API_ENDPOINTS.adminUsers.byId(id)
  );
  return response.data.data;
}

export async function suspendUser(id: string): Promise<void> {
  await apiClient.post(API_ENDPOINTS.adminUsers.suspend(id));
}

export async function activateUser(id: string): Promise<void> {
  await apiClient.post(API_ENDPOINTS.adminUsers.activate(id));
}

export async function assignPlanToUser(
  userId: string,
  data: AssignPlanRequest
): Promise<AdminUserResponse> {
  const response = await apiClient.post<ApiResponse<AdminUserResponse>>(
    API_ENDPOINTS.adminUsers.assignPlan(userId),
    data
  );
  return response.data.data;
}

// Audit Logs API

function buildAuditLogQueryString(params: AuditLogQueryParams): string {
  const searchParams = new URLSearchParams();
  if (params.actorId) searchParams.set('actorId', params.actorId);
  if (params.actorEmail) searchParams.set('actorEmail', params.actorEmail);
  if (params.action) searchParams.set('action', params.action);
  if (params.feature) searchParams.set('feature', params.feature);
  if (params.targetType) searchParams.set('targetType', params.targetType);
  if (params.status) searchParams.set('status', params.status);
  if (params.startDate) searchParams.set('startDate', params.startDate);
  if (params.endDate) searchParams.set('endDate', params.endDate);
  if (params.limit) searchParams.set('limit', params.limit.toString());
  if (params.skip !== undefined) searchParams.set('skip', params.skip.toString());
  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : '';
}

export async function getAuditLogs(
  params: AuditLogQueryParams = {}
): Promise<AuditLogListResponse> {
  const response = await apiClient.get<ApiResponse<AuditLogListResponse>>(
    `${API_ENDPOINTS.auditLogs.base}${buildAuditLogQueryString(params)}`
  );
  return response.data.data;
}

export async function getAuditLogActions(): Promise<string[]> {
  const response = await apiClient.get<ApiResponse<string[]>>(
    API_ENDPOINTS.auditLogs.actions
  );
  return response.data.data;
}

export async function getAuditLogFeatures(): Promise<string[]> {
  const response = await apiClient.get<ApiResponse<string[]>>(
    API_ENDPOINTS.auditLogs.features
  );
  return response.data.data;
}

// System Logs API

function buildLogQueryString(params: LogQueryParams): string {
  const searchParams = new URLSearchParams();
  if (params.level) searchParams.set('level', params.level);
  if (params.context) searchParams.set('context', params.context);
  if (params.message) searchParams.set('message', params.message);
  if (params.requestId) searchParams.set('requestId', params.requestId);
  if (params.from) searchParams.set('from', params.from);
  if (params.to) searchParams.set('to', params.to);
  if (params.page) searchParams.set('page', params.page.toString());
  if (params.limit) searchParams.set('limit', params.limit.toString());
  if (params.sort) searchParams.set('sort', params.sort);
  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : '';
}

export async function getLogs(
  params: LogQueryParams = {}
): Promise<LogQueryResult> {
  const response = await apiClient.get<ApiResponse<LogQueryResult>>(
    `${API_ENDPOINTS.logs.base}${buildLogQueryString(params)}`
  );
  return response.data.data;
}

export async function getLogLevels(): Promise<string[]> {
  const response = await apiClient.get<ApiResponse<string[]>>(
    API_ENDPOINTS.logs.levels
  );
  return response.data.data;
}

export async function getLogContexts(): Promise<string[]> {
  const response = await apiClient.get<ApiResponse<string[]>>(
    API_ENDPOINTS.logs.contexts
  );
  return response.data.data;
}

export async function getLogCounts(): Promise<Record<string, number>> {
  const response = await apiClient.get<ApiResponse<Record<string, number>>>(
    API_ENDPOINTS.logs.counts
  );
  return response.data.data;
}

// Reports API

function buildReportQueryString(params: ReportQueryParams): string {
  const searchParams = new URLSearchParams();
  if (params.page) searchParams.set('page', params.page.toString());
  if (params.limit) searchParams.set('limit', params.limit.toString());
  if (params.status) searchParams.set('status', params.status);
  if (params.reason) searchParams.set('reason', params.reason);
  if (params.sortOrder) searchParams.set('sortOrder', params.sortOrder);
  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : '';
}

export async function getReports(
  params: ReportQueryParams = {}
): Promise<ReportListResponse> {
  const response = await apiClient.get<ApiResponse<ReportListResponse>>(
    `${API_ENDPOINTS.reports.base}${buildReportQueryString(params)}`
  );
  return response.data.data;
}

export async function getReportById(id: string): Promise<ReportDetailResponse> {
  const response = await apiClient.get<ApiResponse<ReportDetailResponse>>(
    API_ENDPOINTS.reports.byId(id)
  );
  return response.data.data;
}

export async function updateReportStatus(
  id: string,
  data: UpdateReportStatusRequest
): Promise<ReportResponse> {
  const response = await apiClient.patch<ApiResponse<ReportResponse>>(
    API_ENDPOINTS.reports.status(id),
    data
  );
  return response.data.data;
}

// Admin Models API

export async function getAllModels(): Promise<AdminModelsListResponse> {
  const response = await apiClient.get<ApiResponse<AdminModelsListResponse>>(
    API_ENDPOINTS.adminModels.list
  );
  return response.data.data;
}

export async function updateModel(
  id: string,
  data: UpdateModelRequest
): Promise<AdminModelResponse> {
  const response = await apiClient.patch<ApiResponse<AdminModelResponse>>(
    API_ENDPOINTS.adminModels.byId(id),
    data
  );
  return response.data.data;
}

export async function setDefaultModel(id: string): Promise<AdminModelResponse> {
  const response = await apiClient.post<ApiResponse<AdminModelResponse>>(
    API_ENDPOINTS.adminModels.setDefault(id)
  );
  return response.data.data;
}

export async function clearDefaultModel(id: string): Promise<AdminModelResponse> {
  const response = await apiClient.post<ApiResponse<AdminModelResponse>>(
    API_ENDPOINTS.adminModels.clearDefault(id)
  );
  return response.data.data;
}

export async function syncModels(): Promise<SyncModelsResponse> {
  const response = await apiClient.post<ApiResponse<SyncModelsResponse>>(
    API_ENDPOINTS.adminModels.sync
  );
  return response.data.data;
}

export async function getAdminPlaybookSettings(): Promise<AdminPlaybookSettings> {
  const response = await apiClient.get<ApiResponse<AdminPlaybookSettings>>(
    API_ENDPOINTS.adminPlaybookSettings.base,
  );
  return response.data.data;
}

export async function updateAdminPlaybookSettings(
  data: UpdateAdminPlaybookSettingsRequest,
): Promise<AdminPlaybookSettings> {
  const response = await apiClient.post<ApiResponse<AdminPlaybookSettings>>(
    API_ENDPOINTS.adminPlaybookSettings.base,
    data,
  );
  return response.data.data;
}

// Playbook Prompts API

export async function getPlaybookPrompts(): Promise<PlaybookPromptListResponse> {
  const response = await apiClient.get<ApiResponse<PlaybookPromptListResponse>>(
    API_ENDPOINTS.adminPlaybookPrompts.list
  );
  return response.data.data;
}

export async function getPlaybookPrompt(key: string): Promise<PlaybookPromptResponse | null> {
  const response = await apiClient.get<ApiResponse<PlaybookPromptResponse | null>>(
    API_ENDPOINTS.adminPlaybookPrompts.byKey(key)
  );
  return response.data.data;
}

export async function updatePlaybookPrompt(
  key: string,
  data: UpsertPlaybookPromptRequest,
): Promise<PlaybookPromptResponse> {
  const response = await apiClient.patch<ApiResponse<PlaybookPromptResponse>>(
    API_ENDPOINTS.adminPlaybookPrompts.byKey(key),
    data,
  );
  return response.data.data;
}

export async function deletePlaybookPrompt(key: string): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.adminPlaybookPrompts.byKey(key));
}

// Playbook Node Templates API

export async function getPlaybookNodeTemplates(): Promise<PlaybookNodeTemplateListResponse> {
  const response = await apiClient.get<ApiResponse<PlaybookNodeTemplateListResponse>>(
    API_ENDPOINTS.adminPlaybookNodeTemplates.list
  );
  return response.data.data;
}

export async function getPlaybookNodeTemplate(id: string): Promise<PlaybookNodeTemplateResponse | null> {
  const response = await apiClient.get<ApiResponse<PlaybookNodeTemplateResponse | null>>(
    API_ENDPOINTS.adminPlaybookNodeTemplates.byId(id)
  );
  return response.data.data;
}

export async function createPlaybookNodeTemplate(
  data: CreatePlaybookNodeTemplateRequest,
): Promise<PlaybookNodeTemplateResponse> {
  const response = await apiClient.post<ApiResponse<PlaybookNodeTemplateResponse>>(
    API_ENDPOINTS.adminPlaybookNodeTemplates.list,
    data
  );
  return response.data.data;
}

export async function updatePlaybookNodeTemplate(
  id: string,
  data: UpdatePlaybookNodeTemplateRequest,
): Promise<PlaybookNodeTemplateResponse> {
  const response = await apiClient.patch<ApiResponse<PlaybookNodeTemplateResponse>>(
    API_ENDPOINTS.adminPlaybookNodeTemplates.byId(id),
    data
  );
  return response.data.data;
}

export async function deletePlaybookNodeTemplate(id: string): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.adminPlaybookNodeTemplates.byId(id));
}

export async function getDefaultModel(): Promise<AdminModelResponse | null> {
  const response = await apiClient.get<ApiResponse<AdminModelResponse | null>>(
    API_ENDPOINTS.adminModels.default
  );
  return response.data.data;
}

// Tools API

function buildToolQueryString(params: ToolQueryParams): string {
  const searchParams = new URLSearchParams();
  if (params.page) searchParams.set('page', params.page.toString());
  if (params.limit) searchParams.set('limit', params.limit.toString());
  if (params.search) searchParams.set('search', params.search);
  if (params.agentType) searchParams.set('agentType', params.agentType);
  if (params.isActive !== undefined) searchParams.set('isActive', params.isActive.toString());
  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : '';
}

export async function getTools(
  params: ToolQueryParams = {}
): Promise<ToolListResponse> {
  const response = await apiClient.get<ApiResponse<ToolListResponse>>(
    `${API_ENDPOINTS.adminTools.list}${buildToolQueryString(params)}`
  );
  return response.data.data;
}

export async function getToolById(id: string): Promise<ToolResponse> {
  const response = await apiClient.get<ApiResponse<ToolResponse>>(
    API_ENDPOINTS.adminTools.byId(id)
  );
  return response.data.data;
}

export async function createTool(data: CreateToolRequest): Promise<ToolResponse> {
  const response = await apiClient.post<ApiResponse<ToolResponse>>(
    API_ENDPOINTS.adminTools.list,
    data
  );
  return response.data.data;
}

export async function updateTool(
  id: string,
  data: UpdateToolRequest
): Promise<ToolResponse> {
  const response = await apiClient.patch<ApiResponse<ToolResponse>>(
    API_ENDPOINTS.adminTools.byId(id),
    data
  );
  return response.data.data;
}

export async function deleteTool(id: string): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.adminTools.byId(id));
}

// Tool Categories API

export async function getToolCategories(): Promise<ToolCategoryResponse[]> {
  const response = await apiClient.get<ApiResponse<ToolCategoryResponse[]>>(
    API_ENDPOINTS.adminToolCategories.list,
  );
  return response.data.data;
}

export async function createToolCategory(
  data: CreateToolCategoryRequest,
): Promise<ToolCategoryResponse> {
  const response = await apiClient.post<ApiResponse<ToolCategoryResponse>>(
    API_ENDPOINTS.adminToolCategories.list,
    data,
  );
  return response.data.data;
}

export async function updateToolCategory(
  id: string,
  data: UpdateToolCategoryRequest,
): Promise<ToolCategoryResponse> {
  const response = await apiClient.patch<ApiResponse<ToolCategoryResponse>>(
    API_ENDPOINTS.adminToolCategories.byId(id),
    data,
  );
  return response.data.data;
}

export async function deleteToolCategory(id: string): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.adminToolCategories.byId(id));
}

// Skills API

function buildSkillQueryString(params: SkillQueryParams): string {
  const searchParams = new URLSearchParams();
  if (params.page) searchParams.set('page', params.page.toString());
  if (params.limit) searchParams.set('limit', params.limit.toString());
  if (params.search) searchParams.set('search', params.search);
  if (params.isActive !== undefined) searchParams.set('isActive', params.isActive.toString());
  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : '';
}

export async function getSkills(params: SkillQueryParams = {}): Promise<SkillListResponse> {
  const response = await apiClient.get<ApiResponse<SkillListResponse>>(
    `${API_ENDPOINTS.adminSkills.list}${buildSkillQueryString(params)}`
  );
  return response.data.data;
}

export async function getSkillById(id: string): Promise<SkillResponse> {
  const response = await apiClient.get<ApiResponse<SkillResponse>>(
    API_ENDPOINTS.adminSkills.byId(id)
  );
  return response.data.data;
}

export async function createSkill(data: CreateSkillRequest): Promise<SkillResponse> {
  const response = await apiClient.post<ApiResponse<SkillResponse>>(
    API_ENDPOINTS.adminSkills.list,
    data,
  );
  return response.data.data;
}

export async function updateSkill(id: string, data: UpdateSkillRequest): Promise<SkillResponse> {
  const response = await apiClient.patch<ApiResponse<SkillResponse>>(
    API_ENDPOINTS.adminSkills.byId(id),
    data,
  );
  return response.data.data;
}

export async function deleteSkill(id: string): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.adminSkills.byId(id));
}

export async function importSkill(file: File): Promise<SkillResponse> {
  const formData = new FormData();
  formData.append('file', file);
  const response = await apiClient.post<ApiResponse<SkillResponse>>(
    API_ENDPOINTS.adminSkills.import,
    formData,
    {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    },
  );
  return response.data.data;
}

// Skill Categories API

export async function getSkillCategories(): Promise<SkillCategoryResponse[]> {
  const response = await apiClient.get<ApiResponse<SkillCategoryResponse[]>>(
    API_ENDPOINTS.adminSkillCategories.list,
  );
  return response.data.data;
}

export async function createSkillCategory(
  data: CreateSkillCategoryRequest,
): Promise<SkillCategoryResponse> {
  const response = await apiClient.post<ApiResponse<SkillCategoryResponse>>(
    API_ENDPOINTS.adminSkillCategories.list,
    data,
  );
  return response.data.data;
}

export async function updateSkillCategory(
  id: string,
  data: UpdateSkillCategoryRequest,
): Promise<SkillCategoryResponse> {
  const response = await apiClient.patch<ApiResponse<SkillCategoryResponse>>(
    API_ENDPOINTS.adminSkillCategories.byId(id),
    data,
  );
  return response.data.data;
}

export async function deleteSkillCategory(id: string): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.adminSkillCategories.byId(id));
}

// Connectors API

export async function getConnectors(params: ConnectorQueryParams = {}): Promise<ConnectorListResponse> {
  const searchParams = new URLSearchParams();
  if (params.page) searchParams.set('page', params.page.toString());
  if (params.limit) searchParams.set('limit', params.limit.toString());
  if (params.search) searchParams.set('search', params.search);
  if (params.isActive !== undefined) searchParams.set('isActive', params.isActive.toString());
  const queryString = searchParams.toString();
  const response = await apiClient.get<ApiResponse<ConnectorListResponse>>(
    `${API_ENDPOINTS.adminConnectors.list}${queryString ? `?${queryString}` : ''}`,
  );
  return response.data.data;
}

export async function getConnectorById(id: string): Promise<ConnectorResponse> {
  const response = await apiClient.get<ApiResponse<ConnectorResponse>>(
    API_ENDPOINTS.adminConnectors.byId(id),
  );
  return response.data.data;
}

export async function createConnector(data: CreateConnectorRequest): Promise<ConnectorResponse> {
  const response = await apiClient.post<ApiResponse<ConnectorResponse>>(
    API_ENDPOINTS.adminConnectors.list,
    data,
  );
  return response.data.data;
}

export async function updateConnector(id: string, data: UpdateConnectorRequest): Promise<ConnectorResponse> {
  const response = await apiClient.patch<ApiResponse<ConnectorResponse>>(
    API_ENDPOINTS.adminConnectors.byId(id),
    data,
  );
  return response.data.data;
}

export async function deleteConnector(id: string): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.adminConnectors.byId(id));
}

// Connector Categories API

export async function getConnectorCategories(): Promise<ConnectorCategoryResponse[]> {
  const response = await apiClient.get<ApiResponse<ConnectorCategoryResponse[]>>(
    API_ENDPOINTS.adminConnectorCategories.list,
  );
  return response.data.data;
}

export async function createConnectorCategory(
  data: CreateConnectorCategoryRequest,
): Promise<ConnectorCategoryResponse> {
  const response = await apiClient.post<ApiResponse<ConnectorCategoryResponse>>(
    API_ENDPOINTS.adminConnectorCategories.list,
    data,
  );
  return response.data.data;
}

export async function updateConnectorCategory(
  id: string,
  data: UpdateConnectorCategoryRequest,
): Promise<ConnectorCategoryResponse> {
  const response = await apiClient.patch<ApiResponse<ConnectorCategoryResponse>>(
    API_ENDPOINTS.adminConnectorCategories.byId(id),
    data,
  );
  return response.data.data;
}

export async function deleteConnectorCategory(id: string): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.adminConnectorCategories.byId(id));
}

export async function inspectMcp(
  transportType: string,
  serverUrl: string,
  serverConfig?: Record<string, unknown>,
  connectedAppKey?: string,
  runtimeAuthConfig?: Record<string, unknown>,
): Promise<McpInspectResult> {
  const response = await apiClient.post<ApiResponse<McpInspectResult>>(
    API_ENDPOINTS.adminConnectors.inspect,
    { transportType, serverUrl, serverConfig, connectedAppKey, runtimeAuthConfig },
  );
  return response.data.data;
}

export async function importFromMcp(transportType: string, serverUrl: string, serverConfig?: Record<string, unknown>): Promise<McpInspectResult> {
  const response = await apiClient.post<ApiResponse<McpInspectResult>>(
    API_ENDPOINTS.adminConnectors.importMcp,
    { transportType, serverUrl, serverConfig },
  );
  return response.data.data;
}

export async function authorizeConnectorOAuth(connectorId: string): Promise<{ authorizationUrl: string }> {
  const response = await apiClient.get<ApiResponse<{ authorizationUrl: string }>>(
    API_ENDPOINTS.adminConnectors.authorize(connectorId),
  );
  return response.data.data;
}

export async function inspectConnectorWithOAuth(connectorId: string, useOAuth: boolean): Promise<McpInspectResult> {
  const response = await apiClient.post<ApiResponse<McpInspectResult>>(
    API_ENDPOINTS.adminConnectors.inspectConnector(connectorId),
    { useOAuth },
  );
  return response.data.data;
}

export async function authorizeConnectorAppOAuth(appKey: string): Promise<{ authorizationUrl: string }> {
  const response = await apiClient.get<ApiResponse<{ authorizationUrl: string }>>(
    API_ENDPOINTS.adminConnectors.oauthAuthorize(appKey),
  );
  return response.data.data;
}

export async function getConnectorAppOAuthStatus(appKey: string): Promise<ConnectorOAuthStatusResponse> {
  const response = await apiClient.get<ApiResponse<ConnectorOAuthStatusResponse>>(
    API_ENDPOINTS.adminConnectors.oauthStatus(appKey),
  );
  return response.data.data;
}

export async function disconnectConnectorAppOAuth(appKey: string): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.adminConnectors.oauthDisconnect(appKey));
}

// Agent Types API

function buildAgentTypeQueryString(params: AgentTypeQueryParams): string {
  const searchParams = new URLSearchParams();
  if (params.page) searchParams.set('page', params.page.toString());
  if (params.limit) searchParams.set('limit', params.limit.toString());
  if (params.search) searchParams.set('search', params.search);
  if (params.isActive !== undefined) searchParams.set('isActive', params.isActive.toString());
  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : '';
}

export async function getAgentTypes(
  params: AgentTypeQueryParams = {}
): Promise<AgentTypeListResponse> {
  const response = await apiClient.get<ApiResponse<AgentTypeListResponse>>(
    `${API_ENDPOINTS.adminAgentTypes.list}${buildAgentTypeQueryString(params)}`
  );
  return response.data.data;
}

export async function getActiveAgentTypes(): Promise<AgentTypeResponse[]> {
  const response = await apiClient.get<ApiResponse<AgentTypeResponse[]>>(
    API_ENDPOINTS.agentTypes.active
  );
  return response.data.data;
}

export async function getAgentTypeById(id: string): Promise<AgentTypeResponse> {
  const response = await apiClient.get<ApiResponse<AgentTypeResponse>>(
    API_ENDPOINTS.adminAgentTypes.byId(id)
  );
  return response.data.data;
}

export async function createAgentType(data: CreateAgentTypeRequest): Promise<AgentTypeResponse> {
  const response = await apiClient.post<ApiResponse<AgentTypeResponse>>(
    API_ENDPOINTS.adminAgentTypes.list,
    data
  );
  return response.data.data;
}

export async function updateAgentType(
  id: string,
  data: UpdateAgentTypeRequest
): Promise<AgentTypeResponse> {
  const response = await apiClient.patch<ApiResponse<AgentTypeResponse>>(
    API_ENDPOINTS.adminAgentTypes.byId(id),
    data
  );
  return response.data.data;
}

export async function deleteAgentType(id: string): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.adminAgentTypes.byId(id));
}

// Agent Type Prompts API

export async function getAgentTypePrompts(agentTypeId: string): Promise<AgentTypePromptResponse[]> {
  const response = await apiClient.get<ApiResponse<AgentTypePromptResponse[]>>(
    API_ENDPOINTS.adminAgentTypes.prompts(agentTypeId)
  );
  return response.data.data;
}

export async function upsertAgentTypePrompt(
  agentTypeId: string,
  modelId: string,
  data: UpsertAgentTypePromptRequest
): Promise<AgentTypePromptResponse> {
  const response = await apiClient.put<ApiResponse<AgentTypePromptResponse>>(
    API_ENDPOINTS.adminAgentTypes.promptByModel(agentTypeId, modelId),
    data
  );
  return response.data.data;
}

export async function deleteAgentTypePrompt(
  agentTypeId: string,
  modelId: string
): Promise<void> {
  await apiClient.delete(
    API_ENDPOINTS.adminAgentTypes.promptByModel(agentTypeId, modelId)
  );
}

// Admin Agents API

function buildAgentQueryString(params: AgentQueryParams): string {
  const searchParams = new URLSearchParams();
  if (params.page) searchParams.set('page', params.page.toString());
  if (params.limit) searchParams.set('limit', params.limit.toString());
  if (params.search) searchParams.set('search', params.search);
  if (params.agentType) searchParams.set('agentType', params.agentType);
  if (params.isActive !== undefined) searchParams.set('isActive', params.isActive.toString());
  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : '';
}

export async function getAdminAgents(
  params: AgentQueryParams = {}
): Promise<AgentListResponse> {
  const response = await apiClient.get<ApiResponse<AgentListResponse>>(
    `${API_ENDPOINTS.adminAgents.list}${buildAgentQueryString(params)}`
  );
  return response.data.data;
}

export async function getAdminAgentById(id: string): Promise<AgentResponse> {
  const response = await apiClient.get<ApiResponse<AgentResponse>>(
    API_ENDPOINTS.adminAgents.byId(id)
  );
  return response.data.data;
}

export async function createAdminAgent(data: CreateAgentRequest): Promise<AgentResponse> {
  const response = await apiClient.post<ApiResponse<AgentResponse>>(
    API_ENDPOINTS.adminAgents.list,
    data
  );
  return response.data.data;
}

export async function updateAdminAgent(
  id: string,
  data: UpdateAgentRequest
): Promise<AgentResponse> {
  const response = await apiClient.patch<ApiResponse<AgentResponse>>(
    API_ENDPOINTS.adminAgents.byId(id),
    data
  );
  return response.data.data;
}

export async function deleteAdminAgent(id: string): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.adminAgents.byId(id));
}

// ===== Team Auto-Builder config =====

export async function getTeamAutoBuilderConfig(): Promise<TeamAutoBuilderConfigResponse | null> {
  const response = await apiClient.get<ApiResponse<TeamAutoBuilderConfigResponse | null>>(
    API_ENDPOINTS.adminTeamAutoBuilder.config,
  );
  return response.data.data;
}

export async function upsertTeamAutoBuilderConfig(
  data: UpsertTeamAutoBuilderConfigRequest,
): Promise<TeamAutoBuilderConfigResponse> {
  const response = await apiClient.put<ApiResponse<TeamAutoBuilderConfigResponse>>(
    API_ENDPOINTS.adminTeamAutoBuilder.config,
    data,
  );
  return response.data.data;
}
