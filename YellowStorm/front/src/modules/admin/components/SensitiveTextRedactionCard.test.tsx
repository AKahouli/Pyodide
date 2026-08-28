import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SensitiveTextRedactionCard } from './SensitiveTextRedactionCard';

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateRedaction: vi.fn(),
  setCache: vi.fn(),
  showError: vi.fn(),
  showSuccess: vi.fn(),
}));

vi.mock('../api', () => ({
  getAdminConversationSettings: mocks.getSettings,
  updateSensitiveTextRedaction: mocks.updateRedaction,
}));
vi.mock('@/modules/conversation', () => ({ setCachedConversationSettings: mocks.setCache }));
vi.mock('@/lib/notifications', () => ({ showError: mocks.showError, showSuccess: mocks.showSuccess }));
vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

const settings = {
  redactSensitiveText: false,
  composerSuggestions: {
    enabled: true,
    agentId: null,
    debounceMs: 400,
    minimumDraftLength: 3,
    requestsPerMinute: 60,
    maxOutputTokens: 256,
  },
};

describe('SensitiveTextRedactionCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue(settings);
    mocks.updateRedaction.mockResolvedValue({ ...settings, redactSensitiveText: true });
  });

  it('loads the disabled setting and warns about exposure', async () => {
    render(<SensitiveTextRedactionCard />);

    expect(await screen.findByRole('switch')).not.toBeChecked();
    expect(screen.getByText('system.redaction.warningTitle')).toBeInTheDocument();
  });

  it('persists toggle changes and refreshes the conversation cache', async () => {
    render(<SensitiveTextRedactionCard />);
    await userEvent.click(await screen.findByRole('switch'));

    await waitFor(() => expect(mocks.updateRedaction).toHaveBeenCalledWith({ redactSensitiveText: true }));
    expect(mocks.setCache).toHaveBeenCalledWith(expect.objectContaining({ redactSensitiveText: true }));
    expect(mocks.showSuccess).toHaveBeenCalledWith('system.redaction.saved');
  });

  it('fails safely with redaction enabled when loading fails', async () => {
    mocks.getSettings.mockRejectedValue(new Error('offline'));
    render(<SensitiveTextRedactionCard />);

    expect(await screen.findByRole('switch')).toBeChecked();
    expect(mocks.showError).toHaveBeenCalled();
  });
});
