import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deletePlan,
  deleteEmailLogo,
  getAllPlans,
  getEmailLogo,
  getMaintenanceStatus,
  getPlaybookPlannerAgents,
  getFeatureVisibility,
  getUserAnalytics,
  setMaintenanceMode,
  updatePlan,
  updateFeatureVisibility,
  updateSensitiveTextRedaction,
  uploadEmailLogo,
} from './api';

const getMock = vi.hoisted(() => vi.fn());
const postMock = vi.hoisted(() => vi.fn());
const putMock = vi.hoisted(() => vi.fn());
const deleteMock = vi.hoisted(() => vi.fn());
const patchMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/client', () => ({
  default: {
    get: getMock,
    post: postMock,
    put: putMock,
    delete: deleteMock,
    patch: patchMock,
  },
}));

vi.mock('@/lib/api/config', () => ({
  API_ENDPOINTS: {
    analytics: {
      users: '/analytics/users',
    },
    system: {
      maintenance: '/system/maintenance',
      features: '/system/features',
      emailLogo: '/system/email-logo',
    },
    usage: {
      plansAll: '/usage/plans/all',
      planById: (id: string) => `/usage/plans/${id}`,
    },
    adminPlaybookSettings: {
      plannerAgents: '/admin/playbook-settings/planner-agents',
    },
    adminConversationSettings: {
      sensitiveTextRedaction: '/admin/conversation-settings/sensitive-text-redaction',
    },
  },
}));

describe('admin api', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds analytics query string from params', async () => {
    getMock.mockResolvedValue({ data: { data: { totalConsentingUsers: 1 } } });

    await getUserAnalytics({ dateFrom: '2026-01-01', dateTo: '2026-01-31', groupBy: 'day' });

    expect(getMock).toHaveBeenCalledWith('/analytics/users?dateFrom=2026-01-01&dateTo=2026-01-31&groupBy=day');
  });

  it('gets and sets maintenance mode', async () => {
    getMock.mockResolvedValue({ data: { data: { enabled: false, message: '' } } });
    postMock.mockResolvedValue({ data: { data: { enabled: true, message: 'maint' } } });

    const status = await getMaintenanceStatus();
    const updated = await setMaintenanceMode({ enabled: true, message: 'maint' });

    expect(getMock).toHaveBeenCalledWith('/system/maintenance');
    expect(postMock).toHaveBeenCalledWith('/system/maintenance', { enabled: true, message: 'maint' });
    expect(status.enabled).toBe(false);
    expect(updated.enabled).toBe(true);
  });

  it('lists eligible playbook planner agents', async () => {
    const agents = [{ id: 'planner-1', name: 'Planner', model: 'model-1' }];
    getMock.mockResolvedValue({ data: { data: agents } });

    await expect(getPlaybookPlannerAgents()).resolves.toEqual(agents);
    expect(getMock).toHaveBeenCalledWith('/admin/playbook-settings/planner-agents');
  });

  it('gets and updates feature visibility', async () => {
    const visibility = {
      conversation: true,
      workspace: true,
      playbook: false,
      governance: true,
      appBuilder: true,
      worky: false,
      agents: true,
      semanticModel: true,
      platformCopilot: false,
    };
    getMock.mockResolvedValue({ data: { data: visibility } });
    putMock.mockResolvedValue({ data: { data: visibility } });

    await expect(getFeatureVisibility()).resolves.toEqual(visibility);
    await expect(updateFeatureVisibility(visibility)).resolves.toEqual(visibility);
    expect(getMock).toHaveBeenCalledWith('/system/features');
    expect(putMock).toHaveBeenCalledWith('/system/features', visibility);
  });

  it('handles plans CRUD endpoints', async () => {
    getMock.mockResolvedValue({ data: { data: [{ id: 'p1' }] } });
    putMock.mockResolvedValue({ data: { data: { id: 'p1', name: 'pro' } } });
    deleteMock.mockResolvedValue(undefined);

    const plans = await getAllPlans();
    const plan = await updatePlan('p1', { name: 'pro' });
    await deletePlan('p1');

    expect(getMock).toHaveBeenCalledWith('/usage/plans/all');
    expect(putMock).toHaveBeenCalledWith('/usage/plans/p1', { name: 'pro' });
    expect(deleteMock).toHaveBeenCalledWith('/usage/plans/p1');
    expect(plans).toEqual([{ id: 'p1' }]);
    expect(plan).toEqual({ id: 'p1', name: 'pro' });
  });

  it('updates sensitive text redaction through the dedicated endpoint', async () => {
    patchMock.mockResolvedValue({ data: { data: { redactSensitiveText: false, composerSuggestions: {} } } });

    await expect(updateSensitiveTextRedaction({ redactSensitiveText: false }))
      .resolves.toMatchObject({ redactSensitiveText: false });
    expect(patchMock).toHaveBeenCalledWith(
      '/admin/conversation-settings/sensitive-text-redaction',
      { redactSensitiveText: false },
    );
  });

  it('gets, uploads, and deletes the email logo', async () => {
    const logo = {
      filename: 'brand.png',
      contentType: 'image/png',
      size: 42,
      updatedAt: '2026-09-06T00:00:00.000Z',
      dataUri: 'data:image/png;base64,ZmFrZQ==',
    };
    getMock.mockResolvedValue({ data: { data: { logo } } });
    postMock.mockResolvedValue({ data: { data: { logo } } });
    deleteMock.mockResolvedValue(undefined);

    await expect(getEmailLogo()).resolves.toEqual(logo);
    expect(getMock).toHaveBeenCalledWith('/system/email-logo');

    const file = new File(['fake'], 'brand.png', { type: 'image/png' });
    await expect(uploadEmailLogo(file)).resolves.toEqual(logo);
    const [url, formData, options] = postMock.mock.calls[0];
    expect(url).toBe('/system/email-logo');
    expect(formData).toBeInstanceOf(FormData);
    expect(formData.get('file')).toBe(file);
    expect(options.headers['Content-Type']).toBe('multipart/form-data');

    await deleteEmailLogo();
    expect(deleteMock).toHaveBeenCalledWith('/system/email-logo');
  });
});
