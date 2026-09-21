import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppBuilderAiPage } from './AppBuilderAiPage';

const api = vi.hoisted(() => ({
  getAppBuilderAiOverview: vi.fn(),
  listAppBuilderAiUsers: vi.fn(),
  listAppBuilderAiOffers: vi.fn(),
  setAppBuilderAiEnabled: vi.fn(),
  getAppBuilderAiUserDetail: vi.fn(),
  assignAppBuilderAiOffer: vi.fn(),
  createAppBuilderAiOffer: vi.fn(),
  updateAppBuilderAiOffer: vi.fn(),
  deleteAppBuilderAiOffer: vi.fn(),
}));

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>();
  return { ...actual, ...api };
});

vi.mock('@/lib/notifications', () => ({
  showError: vi.fn(),
  showSuccess: vi.fn(),
}));

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
    language: 'en',
  }),
}));

describe('AppBuilderAiPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getAppBuilderAiOverview.mockResolvedValue({
      enabled: true,
      periodHours: 24,
      totalTokens: 1200,
      requestCount: 10,
      errorCount: 1,
      aiAppsCount: 3,
      usersWithOffer: 2,
      topModels: [{ model: 'gpt-4o', totalTokens: 800, requestCount: 5 }],
    });
    api.listAppBuilderAiUsers.mockResolvedValue({
      items: [
        {
          userId: 'u1',
          email: 'a@example.com',
          displayName: 'Ada',
          aiAppsCount: 2,
          offer: { id: 'o1', name: 'AI Free', slug: 'ai-free', tokenLimit: 50000 },
          usage: { currentUsage: 100, limit: 50000, resetsAt: new Date().toISOString(), percentUsed: 0 },
        },
      ],
      pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
    });
    api.listAppBuilderAiOffers.mockResolvedValue({
      items: [
        {
          id: 'o1',
          name: 'AI Free',
          slug: 'ai-free',
          tokenLimit: 50000,
          windowHours: 24,
          requestsPerMinute: 20,
          maxTokensPerRequest: 4096,
          priority: 0,
          isActive: true,
          isDefault: true,
          displayOrder: 0,
        },
      ],
    });
  });

  it('renders overview stats and user table', async () => {
    render(<AppBuilderAiPage />);
    await waitFor(() => {
      expect(screen.getByText('appBuilderAi.title')).toBeInTheDocument();
    });
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getByText('AI Free')).toBeInTheDocument();
    expect(api.getAppBuilderAiOverview).toHaveBeenCalled();
  });
});
