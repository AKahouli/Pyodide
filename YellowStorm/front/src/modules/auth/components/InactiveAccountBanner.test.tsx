import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { InactiveAccountBanner } from './InactiveAccountBanner';

const translateMock = vi.hoisted(() => (key: string) => key);

vi.mock('@/modules/localization', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/localization')>();
  return { ...actual, useModuleTranslation: () => ({ t: translateMock, ready: true, language: 'en' }) };
});

describe('InactiveAccountBanner', () => {
  it('renders the pending-approval message and logs out', async () => {
    const onLogout = vi.fn();
    render(<InactiveAccountBanner onLogout={onLogout} />);

    expect(screen.getByRole('alert')).toHaveTextContent('pendingApproval.banner');
    await userEvent.click(screen.getByRole('button', { name: 'pendingApproval.logout' }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });
});
