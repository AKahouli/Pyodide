import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';
import { ConversationSettingsPage } from './ConversationSettingsPage';
import { getAdminConversationSettings, getAdminConversationSettingsAgents, getAllModels, updateAdminConversationSettings } from '../api';

const useAuthMock = vi.hoisted(() => vi.fn(() => ({ isAuthenticated: true, user: { id: 'admin' } })));
const translateMock = vi.hoisted(() => (key: string) => key);
vi.mock('@/modules/auth/useAuth', () => ({ useAuth: useAuthMock }));
vi.mock('@/modules/localization', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/localization')>();
  return { ...actual, useModuleTranslation: () => ({ t: translateMock, ready: true, language: 'en' }) };
});
vi.mock('@/lib/notifications', () => ({ showError: vi.fn(), showSuccess: vi.fn() }));
vi.mock('../api', () => ({
  getAdminConversationSettings: vi.fn(),
  getAdminConversationSettingsAgents: vi.fn(),
  getAllModels: vi.fn(),
  updateAdminConversationSettings: vi.fn(),
}));

const settings = {
  enabled: true,
  agentId: null,
  debounceMs: 400,
  minimumDraftLength: 3,
  requestsPerMinute: 60,
  maxOutputTokens: 256,
};

describe('ConversationSettingsPage', () => {
  beforeEach(() => {
    vi.mocked(getAdminConversationSettings).mockReset();
    vi.mocked(getAdminConversationSettingsAgents).mockReset();
    vi.mocked(getAllModels).mockReset();
    vi.mocked(updateAdminConversationSettings).mockReset();
    vi.mocked(getAdminConversationSettings).mockResolvedValue({ composerSuggestions: settings });
    vi.mocked(getAdminConversationSettingsAgents).mockResolvedValue([]);
    vi.mocked(getAllModels).mockResolvedValue({ models: [] } as unknown as Awaited<ReturnType<typeof getAllModels>>);
    vi.mocked(updateAdminConversationSettings).mockResolvedValue({ composerSuggestions: settings });
  });

  it('loads and saves bounded composer suggestion settings', async () => {
    const { user } = renderWithProviders(<ConversationSettingsPage />);
    const debounce = await screen.findByLabelText('conversationSettings.debounce.label');
    fireEvent.change(debounce, { target: { value: '750' } });
    await user.click(screen.getByRole('button', { name: 'conversationSettings.actions.save' }));

    await waitFor(() => expect(updateAdminConversationSettings).toHaveBeenCalledWith({
      composerSuggestions: { ...settings, debounceMs: 750 },
      conversationName: { modelId: null },
      latencyInstrumentationEnabled: true,
      compaction: { enabled: true, compactionInterval: 10, overlapSize: 2, tokenFraction: 0.75, eventRetentionSize: 6, summarizerModel: '' },
      attachmentIntelligence: { enabled: false, maxIndexedTabularRows: 5000 },
    }));
  });

  it('loads and toggles attachment intelligence settings', async () => {
    vi.mocked(getAdminConversationSettings).mockResolvedValue({
      composerSuggestions: settings,
      attachmentIntelligence: { enabled: true, maxIndexedTabularRows: 2500 },
    } as never);
    const { user } = renderWithProviders(<ConversationSettingsPage />);

    const rows = await screen.findByLabelText('conversationSettings.attachments.maxRows.label');
    expect(rows).toHaveValue(2500);
    await user.click(screen.getByRole('switch', { name: 'conversationSettings.attachments.enabled.label' }));
    await user.click(screen.getByRole('button', { name: 'conversationSettings.actions.save' }));

    await waitFor(() => expect(updateAdminConversationSettings).toHaveBeenCalledWith(
      expect.objectContaining({ attachmentIntelligence: { enabled: false, maxIndexedTabularRows: 2500 } }),
    ));
  });

  it('saves an explicit latency instrumentation toggle', async () => {
    const { user } = renderWithProviders(<ConversationSettingsPage />);
    const latencyToggle = await screen.findByRole('switch', { name: 'conversationSettings.latency.enabled.label' });
    await user.click(latencyToggle);
    await user.click(screen.getByRole('button', { name: 'conversationSettings.actions.save' }));

    await waitFor(() => expect(updateAdminConversationSettings).toHaveBeenCalledWith(
      expect.objectContaining({ latencyInstrumentationEnabled: false }),
    ));
  });

  it('disables dependent controls when suggestions are switched off', async () => {
    const { user } = renderWithProviders(<ConversationSettingsPage />);
    const toggle = await screen.findByRole('switch', { name: 'conversationSettings.enabled.label' });
    await user.click(toggle);

    expect(screen.getByLabelText('conversationSettings.debounce.label')).toBeDisabled();
    expect(screen.getByLabelText('conversationSettings.minimumLength.label')).toBeDisabled();
  });
});
