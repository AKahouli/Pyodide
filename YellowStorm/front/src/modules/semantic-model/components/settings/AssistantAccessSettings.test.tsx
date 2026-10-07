import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantAccessSettings } from './AssistantAccessSettings';

const api = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }));
vi.mock('../../api', () => ({ semanticModelApi: { getAdminAssistantAccess: api.get, updateAdminAssistantAccess: api.update } }));
vi.mock('@/lib/notifications', () => ({ showError: vi.fn(), showSuccess: vi.fn() }));
// A stable t, as in the app: a new one on each render would load the setting again.
const translation = vi.hoisted(() => ({ t: (key: string) => key }));
vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => translation }));

describe('AssistantAccessSettings', () => {
  beforeEach(() => {
    localStorage.setItem('semantic-model.settings-open', JSON.stringify({ 'assistant-access': true }));
    api.get.mockReset().mockResolvedValue({ enforcePermissions: true });
    api.update.mockReset().mockImplementation(async (settings) => settings);
  });

  it('shows the permission check as on and turns it off with a warning', async () => {
    render(<AssistantAccessSettings />);
    const toggle = await screen.findByRole('switch');
    await waitFor(() => expect(toggle).not.toBeDisabled());
    expect(toggle).toBeChecked();
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(toggle);
    await waitFor(() => expect(api.update).toHaveBeenCalledWith({ enforcePermissions: false }));
    await waitFor(() => expect(toggle).not.toBeChecked());
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
