import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationHomePanels } from './ConversationHomePanels';

const mocks = vi.hoisted(() => ({
  fetchConversations: vi.fn(),
  fetchConversationArtifacts: vi.fn(),
  getPlaybooks: vi.fn(),
  fetchPlaybookArtifacts: vi.fn(),
  deniedFeatures: new Set<string>(),
  semanticReadAllowed: true,
  visibility: { conversation: true, workspace: true, playbook: true, governance: true, appMarketplace: true, worky: true, agents: true, semanticModel: true },
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (key: string) => key, language: 'en' }) }));
vi.mock('@/modules/admin', () => ({
  DEFAULT_FEATURE_VISIBILITY: mocks.visibility,
  getFeatureVisibility: vi.fn().mockResolvedValue(mocks.visibility),
}));
vi.mock('@/modules/admin/hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasAnyPermission: () => mocks.semanticReadAllowed,
    canUseFeature: (feature: string) => !mocks.deniedFeatures.has(feature),
    canSeeMenu: () => true,
  }),
}));
vi.mock('../api', () => ({
  fetchConversations: mocks.fetchConversations,
  fetchRecentConversationArtifacts: mocks.fetchConversationArtifacts,
  getArtifactDownloadUrl: vi.fn(),
}));
vi.mock('@/modules/playbook/api', () => ({
  getPlaybooks: mocks.getPlaybooks,
  fetchRecentPlaybookArtifacts: mocks.fetchPlaybookArtifacts,
  requestPlaybookArtifactAccess: vi.fn(),
}));

const CONVERSATION = {
  id: 'c1',
  title: 'Hello',
  lastMessageAt: '2026-09-13T10:00:00.000Z',
  updatedAt: '2026-09-13T10:00:00.000Z',
};

describe('ConversationHomePanels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deniedFeatures = new Set();
    mocks.semanticReadAllowed = true;
    mocks.fetchConversations.mockRejectedValue(new Error('offline'));
    mocks.getPlaybooks.mockResolvedValue({ playbooks: [], pagination: {} });
    mocks.fetchConversationArtifacts.mockResolvedValue([]);
    mocks.fetchPlaybookArtifacts.mockResolvedValue([]);
  });

  it('shows and retries a recent activity load error only when every source fails', async () => {
    mocks.getPlaybooks.mockRejectedValue(new Error('403'));
    render(<ConversationHomePanels />);

    expect(await screen.findByText('home.activity.loadError')).toBeInTheDocument();
    expect(mocks.getPlaybooks).toHaveBeenCalledWith(expect.objectContaining({ sortBy: 'activityAt', limit: 6 }));
    await userEvent.click(screen.getByRole('button', { name: 'home.retry' }));

    await waitFor(() => expect(mocks.fetchConversations).toHaveBeenCalledTimes(2));
  });

  it('degrades to a working source when only the playbook call fails', async () => {
    mocks.fetchConversations.mockResolvedValue({ items: [CONVERSATION] });
    mocks.getPlaybooks.mockRejectedValue(new Error('403'));

    render(<ConversationHomePanels />);

    expect(await screen.findByText('Hello')).toBeInTheDocument();
    expect(screen.queryByText('home.activity.loadError')).toBeNull();
  });

  it('never calls playbook endpoints when the role lacks the playbook feature', async () => {
    mocks.deniedFeatures = new Set(['playbook']);
    mocks.fetchConversations.mockResolvedValue({ items: [] });

    render(<ConversationHomePanels />);

    await waitFor(() => expect(mocks.fetchConversations).toHaveBeenCalled());
    expect(mocks.getPlaybooks).not.toHaveBeenCalled();
    expect(mocks.fetchPlaybookArtifacts).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText('home.artifacts.loadError')).toBeNull());
  });

  it('renders every starter card when the role allows all features', async () => {
    mocks.fetchConversations.mockResolvedValue({ items: [] });
    render(<ConversationHomePanels />);

    await screen.findByText('home.starters.work.title');
    expect(screen.getByText('home.starters.playbook.title')).toBeInTheDocument();
    expect(screen.getByText('home.starters.agent.title')).toBeInTheDocument();
    expect(screen.getByText('home.starters.appBuilder.title')).toBeInTheDocument();
    expect(screen.getByText('home.starters.semanticModel.title')).toBeInTheDocument();
  });

  it('hides starter cards the role cannot use (permission sync)', async () => {
    mocks.deniedFeatures = new Set(['worky', 'playbook', 'appMarketplace']);
    mocks.fetchConversations.mockResolvedValue({ items: [] });

    render(<ConversationHomePanels />);

    await screen.findByText('home.starters.agent.title');
    expect(screen.queryByText('home.starters.work.title')).toBeNull();
    expect(screen.queryByText('home.starters.playbook.title')).toBeNull();
    expect(screen.queryByText('home.starters.appBuilder.title')).toBeNull();
    expect(screen.getByText('home.starters.semanticModel.title')).toBeInTheDocument();
  });

  it('hides the feature zone entirely when no starter is allowed', async () => {
    mocks.deniedFeatures = new Set(['worky', 'playbook', 'agents', 'appMarketplace', 'semanticModel']);
    mocks.fetchConversations.mockResolvedValue({ items: [] });

    render(<ConversationHomePanels />);

    await waitFor(() => expect(screen.queryByText('home.starters.title')).toBeNull());
  });

  it('errors the activity panel when the only attempted source fails', async () => {
    mocks.deniedFeatures = new Set(['playbook']);

    render(<ConversationHomePanels />);

    expect(await screen.findByText('home.activity.loadError')).toBeInTheDocument();
    expect(mocks.getPlaybooks).not.toHaveBeenCalled();
  });

  it('hides the semantic model card without the semantic_models.read data permission', async () => {
    mocks.semanticReadAllowed = false;
    mocks.fetchConversations.mockResolvedValue({ items: [] });

    render(<ConversationHomePanels />);

    await screen.findByText('home.starters.agent.title');
    expect(screen.queryByText('home.starters.semanticModel.title')).toBeNull();
  });
});
