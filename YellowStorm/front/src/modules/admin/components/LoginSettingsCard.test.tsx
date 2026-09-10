import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginSettingsCard } from './LoginSettingsCard';

const api = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
const translate = vi.hoisted(() => (key: string) => key);

vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: translate }) }));
vi.mock('../api', () => ({ getLoginSettings: api.get, setLoginSettings: api.set }));
vi.mock('../hooks/usePermissions', () => ({ usePermissions: () => ({ hasPermission: () => true }) }));
vi.mock('@/lib/notifications', () => ({ showError: vi.fn(), showSuccess: vi.fn() }));

describe('LoginSettingsCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockResolvedValue({ accessExpiry: '3600m', refreshExpiry: '7d' });
    api.set.mockImplementation(async (settings) => settings);
  });

  it('loads and saves token expiry settings', async () => {
    render(<LoginSettingsCard />);
    const access = await screen.findByLabelText('system.login.access.label');
    await waitFor(() => expect(access).toBeEnabled());
    expect(access).toHaveValue('3600m');
    fireEvent.change(access, { target: { value: '30m' } });
    await waitFor(() => expect(access).toHaveValue('30m'));
    await userEvent.click(screen.getByRole('button', { name: 'system.login.actions.save' }));
    await waitFor(() => expect(api.set).toHaveBeenCalledWith({ accessExpiry: '30m', refreshExpiry: '7d' }));
  });
});
