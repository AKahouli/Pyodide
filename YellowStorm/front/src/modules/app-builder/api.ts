import { apiClient, type ApiResponse } from '@/lib/api/client';
import type {
  AppEndUserGrants,
  AppEndUserSummary,
  AppBuilderCatalog,
  AppTemplate,
  ListAppBuilderAppsResponse,
  TemplateCategory,
  TemplatePreviewFilesResponse,
  TemplatePreviewPresignResponse,
} from './types';

export type { AppEndUserGrants, AppEndUserSummary };

/**
 * Publishing a template ZIP hashes and uploads every file to Ceph one blob at a
 * time, so a large template legitimately outlives the 30 s default HTTP budget.
 */
const TEMPLATE_ZIP_TIMEOUT_MS = 300_000;

export const appBuilderApi = {
  /** Owned deployed, shared, and draft apps for the current user. */
  async listApps(): Promise<AppBuilderCatalog> {
    const res = await apiClient.get<ApiResponse<Partial<ListAppBuilderAppsResponse> | null>>(
      '/conversation-v2/apps',
    );

    const data = res.data.data;
    return {
      deployed: data?.deployed ?? [],
      shared: data?.shared ?? [],
      drafts: data?.drafts ?? [],
    };
  },
  /** Remove an app from App Builder without deleting its conversation. */
  async removeApp(sessionId: string): Promise<void> {
    await apiClient.delete(`/conversation-v2/apps/${sessionId}`);
  },
  async listEndUsers(sessionId: string): Promise<AppEndUserSummary[]> {
    const res = await apiClient.get<ApiResponse<{ users: AppEndUserSummary[] }>>(
      `/conversation-v2/sessions/${sessionId}/app-data/end-users`,
    );
    return res.data.data.users;
  },
  async updateEndUserGrants(
    sessionId: string,
    userId: string,
    grants: AppEndUserGrants,
  ): Promise<AppEndUserSummary> {
    const res = await apiClient.put<ApiResponse<{ user: AppEndUserSummary }>>(
      `/conversation-v2/sessions/${sessionId}/app-data/end-users/${userId}/grants`,
      grants,
    );
    return res.data.data.user;
  },
};

/** Read-only template gallery (categories + published templates). */
export const templateCatalogApi = {
  async listCategories(): Promise<TemplateCategory[]> {
    const res = await apiClient.get<ApiResponse<TemplateCategory[]>>(
      '/conversation-v2/template-catalog/categories',
    );
    return res.data.data;
  },
  async listTemplates(categoryId?: string): Promise<AppTemplate[]> {
    const res = await apiClient.get<ApiResponse<AppTemplate[]>>(
      '/conversation-v2/template-catalog/templates',
      { params: categoryId ? { categoryId } : undefined },
    );
    return res.data.data;
  },
  async getTemplate(id: string): Promise<AppTemplate> {
    const res = await apiClient.get<ApiResponse<AppTemplate>>(
      `/conversation-v2/template-catalog/templates/${id}`,
    );
    return res.data.data;
  },
  async listTemplatePreviewFiles(
    templateId: string,
  ): Promise<TemplatePreviewFilesResponse> {
    const res = await apiClient.get<ApiResponse<TemplatePreviewFilesResponse>>(
      `/conversation-v2/template-catalog/templates/${templateId}/preview/files`,
    );
    return res.data.data;
  },
  async presignTemplatePreviewFiles(
    templateId: string,
    paths: string[],
  ): Promise<TemplatePreviewPresignResponse> {
    const res = await apiClient.post<ApiResponse<TemplatePreviewPresignResponse>>(
      `/conversation-v2/template-catalog/templates/${templateId}/preview/presign`,
      { paths },
    );
    return res.data.data;
  },
};

/** Super-admin-only catalog management. */
export const adminTemplateApi = {
  listCategories: () => templateCatalogApi.listCategories(),
  async createCategory(input: {
    name: string;
    slug?: string;
    icon?: string;
  }): Promise<TemplateCategory> {
    const res = await apiClient.post<ApiResponse<TemplateCategory>>(
      '/admin/conversation-v2/template-categories',
      input,
    );
    return res.data.data;
  },
  async updateCategory(
    id: string,
    input: { name?: string; slug?: string; icon?: string },
  ): Promise<TemplateCategory> {
    const res = await apiClient.patch<ApiResponse<TemplateCategory>>(
      `/admin/conversation-v2/template-categories/${id}`,
      input,
    );
    return res.data.data;
  },
  async deleteCategory(id: string): Promise<void> {
    await apiClient.delete(`/admin/conversation-v2/template-categories/${id}`);
  },
  /**
   * Admin catalog: every template (draft + published), not filtered by category.
   * Distinct from `templateCatalogApi.listTemplates(categoryId)` (published only).
   */
  async listAllTemplates(): Promise<AppTemplate[]> {
    const res = await apiClient.get<ApiResponse<AppTemplate[]>>(
      '/admin/conversation-v2/templates',
    );
    return res.data.data;
  },
  async createTemplate(input: {
    categoryId: string;
    title: string;
    description?: string;
    zip: File;
    cover: File;
  }): Promise<AppTemplate> {
    const form = new FormData();
    form.append('categoryId', input.categoryId);
    form.append('title', input.title);
    if (input.description) form.append('description', input.description);
    form.append('zip', input.zip);
    form.append('cover', input.cover);
    const res = await apiClient.post<ApiResponse<AppTemplate>>(
      '/admin/conversation-v2/templates',
      form,
      { timeout: TEMPLATE_ZIP_TIMEOUT_MS },
    );
    return res.data.data;
  },
  async updateTemplate(
    id: string,
    input: { categoryId?: string; title?: string; description?: string },
  ): Promise<AppTemplate> {
    const res = await apiClient.patch<ApiResponse<AppTemplate>>(
      `/admin/conversation-v2/templates/${id}`,
      input,
    );
    return res.data.data;
  },
  async replaceCover(id: string, cover: File): Promise<AppTemplate> {
    const form = new FormData();
    form.append('cover', cover);
    const res = await apiClient.put<ApiResponse<AppTemplate>>(
      `/admin/conversation-v2/templates/${id}/cover`,
      form,
    );
    return res.data.data;
  },
  async replaceSource(id: string, zip: File): Promise<AppTemplate> {
    const form = new FormData();
    form.append('zip', zip);
    const res = await apiClient.put<ApiResponse<AppTemplate>>(
      `/admin/conversation-v2/templates/${id}/source`,
      form,
      { timeout: TEMPLATE_ZIP_TIMEOUT_MS },
    );
    return res.data.data;
  },
  async deleteTemplate(id: string): Promise<void> {
    await apiClient.delete(`/admin/conversation-v2/templates/${id}`);
  },
};
