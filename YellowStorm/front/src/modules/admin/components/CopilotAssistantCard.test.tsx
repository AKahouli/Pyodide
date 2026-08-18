import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';
import { CopilotAssistantCard } from './CopilotAssistantCard';
import { getCopilotAssistantAgents, getCopilotAssistantSettings, updateCopilotAssistantSettings } from '../api';

const useAuthMock = vi.hoisted(() => vi.fn(() => ({ isAuthenticated: true, user: { id: 'admin' } })));
const translateMock = vi.hoisted(() => (key: string) => key);
vi.mock('@/modules/auth/useAuth', () => ({ useAuth: useAuthMock }));
vi.mock('@/modules/localization', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/localization')>();
  return { ...actual, useModuleTranslation: () => ({ t: translateMock, ready: true, language: 'en' }) };
});
vi.mock('@/lib/notifications', () => ({ showError: vi.fn(), showSuccess: vi.fn() }));
vi.mock('../api', () => ({
  getCopilotAssistantSettings: vi.fn(),
  getCopilotAssistantAgents: vi.fn(),
  updateCopilotAssistantSettings: vi.fn(),
}));
vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: () => true }),
}));

describe('CopilotAssistantCard', () => {
  beforeEach(() => {
    vi.mocked(getCopilotAssistantSettings).mockReset();
    vi.mocked(getCopilotAssistantAgents).mockReset();
    vi.mocked(updateCopilotAssistantSettings).mockReset();
    vi.mocked(getCopilotAssistantSettings).mockResolvedValue({ agentId: null });
    vi.mocked(getCopilotAssistantAgents).mockResolvedValue([]);
    vi.mocked(updateCopilotAssistantSettings).mockResolvedValue({ agentId: 'agent-1' });
  });

  it('loads the mapped agent and available agent options', async () => {
    vi.mocked(getCopilotAssistantSettings).mockResolvedValue({ agentId: 'agent-1' });
    vi.mocked(getCopilotAssistantAgents).mockResolvedValue([{ id: 'agent-1', name: 'Agent 1', model: 'model-1' }]);

    renderWithProviders(<CopilotAssistantCard />);

    await waitFor(() => expect(getCopilotAssistantSettings).toHaveBeenCalled());
    await waitFor(() => expect(getCopilotAssistantAgents).toHaveBeenCalled());
    expect(await screen.findByText(/Agent 1/)).toBeInTheDocument();
  });

  it('saves a newly mapped agent', async () => {
    const { user } = renderWithProviders(<CopilotAssistantCard />);
    await screen.findByText('system.copilotAssistant.agent.noOptions');

    await user.click(screen.getByRole('button', { name: 'system.copilotAssistant.actions.save' }));

    await waitFor(() => expect(updateCopilotAssistantSettings).toHaveBeenCalledWith({ agentId: null }));
  });
});
