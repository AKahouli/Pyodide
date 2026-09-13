import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationHomePanels } from './ConversationHomePanels';

const mocks = vi.hoisted(() => ({
  fetchConversations: vi.fn(),
  fetchConversationArtifacts: vi.fn(),
  getPlaybooks: vi.fn(),
  fetchPlaybookArtifacts: vi.fn(),
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (key: string) => key, language: 'en' }) }));
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

describe('ConversationHomePanels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchConversations.mockRejectedValue(new Error('offline'));
    mocks.getPlaybooks.mockResolvedValue({ playbooks: [], pagination: {} });
    mocks.fetchConversationArtifacts.mockResolvedValue([]);
    mocks.fetchPlaybookArtifacts.mockResolvedValue([]);
  });

  it('shows and retries a recent activity load error', async () => {
    render(<ConversationHomePanels />);

    expect(await screen.findByText('home.activity.loadError')).toBeInTheDocument();
    expect(mocks.getPlaybooks).toHaveBeenCalledWith(expect.objectContaining({ sortBy: 'activityAt', limit: 6 }));
    await userEvent.click(screen.getByRole('button', { name: 'home.retry' }));

    await waitFor(() => expect(mocks.fetchConversations).toHaveBeenCalledTimes(2));
  });
});
