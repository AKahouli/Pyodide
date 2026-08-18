import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deletePlan,
  getAllPlans,
  getMaintenanceStatus,
  getPlaybookPlannerAgents,
  getPlaybookSuggestorAgents,
  getFeatureVisibility,
  getCopilotAssistantAgents,
  getCopilotAssistantSettings,
  getUserAnalytics,
  setMaintenanceMode,
  updatePlan,
  updateFeatureVisibility,
  updateCopilotAssistantSettings,
} from './api';

const getMock = vi.hoisted(() => vi.fn());
const postMock = vi.hoisted(() => vi.fn());
const putMock = vi.hoisted(() => vi.fn());
const deleteMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/client', () => ({
  default: {
    get: getMock,
    post: postMock,
    put: putMock,
    delete: deleteMock,
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
    },
    usage: {
      plansAll: '/usage/plans/all',
      planById: (id: string) => `/usage/plans/${id}`,
    },
    adminPlaybookSettings: {
      plannerAgents: '/admin/playbook-settings/planner-agents',
      suggestorAgents: '/admin/playbook-settings/suggestor-agents',
    },
    adminCopilotAssistant: {
      base: '/admin/copilot-assistant',
      agents: '/admin/copilot-assistant/agents',
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

  it('lists eligible playbook suggestor agents', async () => {
    const agents = [{ id: 'suggestor-1', name: 'Suggestor', model: 'model-1' }];
    getMock.mockResolvedValue({ data: { data: agents } });

    await expect(getPlaybookSuggestorAgents()).resolves.toEqual(agents);
    expect(getMock).toHaveBeenCalledWith('/admin/playbook-settings/suggestor-agents');
  });

  it('gets and updates feature visibility', async () => {
    const visibility = {
      conversation: true,
      workspace: true,
      playbook: false,
      governance: true,
      appMarketplace: true,
      worky: false,
      agents: true,
    };
    getMock.mockResolvedValue({ data: { data: visibility } });
    putMock.mockResolvedValue({ data: { data: visibility } });

    await expect(getFeatureVisibility()).resolves.toEqual(visibility);
    await expect(updateFeatureVisibility(visibility)).resolves.toEqual(visibility);
    expect(getMock).toHaveBeenCalledWith('/system/features');
    expect(putMock).toHaveBeenCalledWith('/system/features', visibility);
  });

  it('gets, lists, and updates the copilot assistant agent mapping', async () => {
    const settings = { agentId: 'agent-1' };
    const agents = [{ id: 'agent-1', name: 'Agent 1', model: 'model-1' }];
    getMock.mockResolvedValue({ data: { data: settings } });
    getMock.mockResolvedValueOnce({ data: { data: settings } });
    getMock.mockResolvedValueOnce({ data: { data: agents } });
    putMock.mockResolvedValue({ data: { data: settings } });

    const [copilotSettings, copilotAgents] = await Promise.all([
      getCopilotAssistantSettings(),
      getCopilotAssistantAgents(),
    ]);
    const updated = await updateCopilotAssistantSettings({ agentId: 'agent-1' });

    expect(copilotSettings).toEqual(settings);
    expect(copilotAgents).toEqual(agents);
    expect(updated).toEqual(settings);
    expect(getMock).toHaveBeenCalledWith('/admin/copilot-assistant');
    expect(getMock).toHaveBeenCalledWith('/admin/copilot-assistant/agents');
    expect(putMock).toHaveBeenCalledWith('/admin/copilot-assistant', { agentId: 'agent-1' });
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
});
