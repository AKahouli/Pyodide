import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationHomePanels } from './ConversationHomePanels';

const mocks = vi.hoisted(() => ({
  fetchConversations: vi.fn(),
  fetchConversationArtifacts: vi.fn(),
  getPlaybooks: vi.fn(),
  fetchPlaybookArtifacts: vi.fn(),
  navigate: vi.fn(),
  deniedFeatures: new Set<string>(),
  semanticReadAllowed: true,
  visibility: { conversation: true, workspace: true, playbook: true, governance: true, appBuilder: true, worky: true, agents: true, semanticModel: true },
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
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
    mocks.deniedFeatures = new Set(['worky', 'playbook', 'appBuilder']);
    mocks.fetchConversations.mockResolvedValue({ items: [] });

    render(<ConversationHomePanels />);

    await screen.findByText('home.starters.agent.title');
    expect(screen.queryByText('home.starters.work.title')).toBeNull();
    expect(screen.queryByText('home.starters.playbook.title')).toBeNull();
    expect(screen.queryByText('home.starters.appBuilder.title')).toBeNull();
    expect(screen.getByText('home.starters.semanticModel.title')).toBeInTheDocument();
  });

  it('hides the feature zone entirely when no starter is allowed', async () => {
    mocks.deniedFeatures = new Set(['worky', 'playbook', 'agents', 'appBuilder', 'semanticModel']);
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

  it('expands and collapses the fetched latest files without loading or losing items', async () => {
    mocks.fetchConversations.mockResolvedValue({ items: [] });
    mocks.fetchConversationArtifacts.mockResolvedValue(Array.from({ length: 6 }, (_, index) => ({
      source: 'conversation', artifactId: `a${index}`, filename: `report-${index}.pdf`,
      conversationTitle: 'Reports', generatedAt: `2026-09-13T10:0${index}:00.000Z`,
    })));
    render(<ConversationHomePanels />);
    const panel = within(screen.getByRole('region', { name: 'home.artifacts.title' }));
    const expand = await panel.findByRole('button', { name: 'home.showMore' });
    expect(panel.getAllByRole('button', { name: /report-/ })).toHaveLength(4);
    expect(panel.queryByText('report-0.pdf')).not.toBeInTheDocument();
    await userEvent.click(expand);
    expect(panel.getAllByRole('button', { name: /report-/ })).toHaveLength(6);
    expect(panel.getByRole('button', { name: 'home.showLess' })).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(panel.getByRole('button', { name: 'home.showLess' }));
    expect(panel.getAllByRole('button', { name: /report-/ })).toHaveLength(4);
    expect(mocks.fetchConversationArtifacts).toHaveBeenCalledTimes(1);
  });

  it('opens the actual chat history from the activity panel', async () => {
    mocks.fetchConversations.mockResolvedValue({ items: [] });
    render(<ConversationHomePanels />);
    await userEvent.click(screen.getByRole('button', { name: 'home.activity.allChats' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/chats');
  });
});
